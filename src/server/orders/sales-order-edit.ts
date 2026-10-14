/**
 * Amend a submitted sales order in place.
 * Keeps the order id, order number, and original place idempotency key.
 * Replaces commercial lines and reconciles ACTIVE reservations only.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import type { ContactSnapshot, DeliveryAddressSnapshot } from "@/domain/checkout";
import { assessSalesOrderEditEligibility } from "@/domain/order-edit";
import type { PlaceSalesOrderInput } from "@/domain/sales-order-entry";
import { addMoney, moneyToString, moneyZero, parseMoney } from "@/domain/money";
import { calculateTradeOrderTotals, tradeDeliveryTotalsDto } from "@/domain/trade-delivery";
import { recordAuditEvent } from "@/server/audit/record";
import { reconcileActiveReservations } from "@/server/orders/reservations";
import { toConfirmation, type ResolvedLine } from "@/server/orders/service";
import type { SalesPlaceResult } from "@/server/orders/sales-order-entry";
import { AuthError } from "@/server/rbac/guards";

type AmendCompany = {
  id: string;
  name: string;
  paymentTerms: string | null;
  taxStatus: string;
  autopartCustomerCode: string | null;
  autopartCustomerCodeVerifiedAt: Date | null;
};

export async function amendSubmittedSalesOrder(args: {
  actorUserId: string;
  staffName: string;
  draft: { id: string; companyId: string; editingOrderId: string | null };
  company: AmendCompany;
  input: PlaceSalesOrderInput;
  lines: ResolvedLine[];
  deliveryAddress: DeliveryAddressSnapshot | null;
  contact: ContactSnapshot;
  requestedLines: Array<{ variantId: string; qty: number; unitPriceOverride: string | null }>;
  hasBackorder: boolean;
}): Promise<SalesPlaceResult> {
  const orderId = args.draft.editingOrderId;
  if (!orderId) {
    throw new AuthError("This draft is not editing an order", "ORDER_NOT_EDITABLE", 409);
  }
  if (args.lines.some((line) => line.issue !== "VALID")) {
    throw new AuthError(
      "Resolve the line issues before confirming this order.",
      "REVIEW_REQUIRED",
      409,
    );
  }

  const fulfilmentChoice = args.input.fulfilmentChoice;
  const totals = totalsFor(args.lines, args.company.taxStatus, fulfilmentChoice);
  const requestedKey = lineKey(args.requestedLines);

  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE
    `;
    if (locked.length !== 1) {
      throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { orderBy: { id: "asc" } },
        fulfilmentEvents: { select: { kind: true } },
        invoices: { select: { id: true }, take: 1 },
        reservations: { where: { status: "CONSUMED" }, select: { id: true }, take: 1 },
      },
    });
    if (order.companyId !== args.company.id) {
      throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
    }
    if (order.editIdempotencyKey === args.input.idempotencyKey) {
      return { kind: "existing" as const, orderId: order.id };
    }

    const eligibility = assessSalesOrderEditEligibility({
      status: order.status,
      archivedAt: order.archivedAt,
      autopartExportStatus: order.autopartExportStatus,
      autopartExportCount: order.autopartExportCount,
      autopartExportedAt: order.autopartExportedAt,
      externalRef: order.externalRef,
      invoiceCount: order.invoices.length,
      fulfilmentKinds: order.fulfilmentEvents.map((event) => event.kind),
      consumedReservationCount: order.reservations.length,
    });
    if (!eligibility.allowed) {
      throw new AuthError(eligibility.reason ?? "This order can no longer be edited.", "ORDER_LOCKED", 409);
    }

    const draftLock = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status FROM "SalesOrderDraft"
      WHERE id = ${args.draft.id} AND "createdByUserId" = ${args.actorUserId}
      FOR UPDATE
    `;
    if (draftLock.length !== 1 || draftLock[0]!.status !== "OPEN") {
      throw new AuthError(
        "This draft changed while the order was being saved. Review it and try again.",
        "DRAFT_CONFLICT",
        409,
      );
    }
    const draftLines = await tx.salesOrderDraftLine.findMany({
      where: { draftId: args.draft.id },
      select: { variantId: true, qty: true, unitPriceOverride: true },
    });
    if (lineKey(draftLines.map((line) => ({
      variantId: line.variantId,
      qty: line.qty,
      unitPriceOverride: line.unitPriceOverride?.toString() ?? null,
    }))) !== requestedKey) {
      throw new AuthError(
        "This draft changed while the order was being saved. Review it and try again.",
        "DRAFT_CONFLICT",
        409,
      );
    }

    const before = commercialSnapshot(order);
    await tx.orderItem.deleteMany({ where: { orderId: order.id } });
    const createdItems = [];
    for (const line of args.lines) {
      createdItems.push(
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            variantId: line.variantId,
            productId: line.productId,
            sku: line.sku,
            name: line.name,
            qty: line.quantity,
            unitPrice: line.commercialUnit4dp,
            customerUnitPrice: line.customerUnit2dp,
            discountPct: 0,
            vatRate: line.vatRatePercent,
            vatCode: line.vatCode,
            lineTotal: line.lineNet2dp,
            lineVat: line.lineVat2dp,
            lineGross: line.lineGross2dp,
            caseQty: line.caseQty,
            orderingMode: line.orderingMode,
            priceSource: line.priceSource,
            quantityBreakId: line.quantityBreakId,
            promotionId: line.promotionId,
            promotionBaselineUnitPrice: line.promotionBaselineUnit4dp,
            availableQtyAtOrder: line.availableQtyAtOrder,
            backorderQtyAtOrder: line.backorderQtyAtOrder,
          },
        }),
      );
    }

    await reconcileActiveReservations(tx, {
      orderId: order.id,
      lines: createdItems.flatMap((item) =>
        item.variantId
          ? [{ orderItemId: item.id, variantId: item.variantId, quantity: item.availableQtyAtOrder ?? 0 }]
          : [],
      ),
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        poNumber: args.input.poNumber ?? null,
        subtotal: totals.subtotal,
        vatTotal: totals.vatTotal,
        deliveryTotal: totals.deliveryTotal,
        grandTotal: totals.grandTotal,
        deliveryAddress:
          fulfilmentChoice === "COLLECTION" || !args.deliveryAddress
            ? Prisma.JsonNull
            : (args.deliveryAddress as unknown as Prisma.InputJsonValue),
        contactSnapshot: args.contact as unknown as Prisma.InputJsonValue,
        deliveryInstructions: args.input.deliveryInstructions ?? null,
        notes: args.input.internalNote ?? null,
        deliveryMethodLabel: fulfilmentChoice === "COLLECTION" ? "Customer Collection" : "Standard delivery",
        fulfilmentChoice,
        editIdempotencyKey: args.input.idempotencyKey,
        backorderAcknowledgedAt: args.hasBackorder ? new Date() : null,
        backorderAcknowledgedByUserId: args.hasBackorder ? args.actorUserId : null,
      },
    });

    const marked = await tx.salesOrderDraft.updateMany({
      where: { id: args.draft.id, createdByUserId: args.actorUserId, status: "OPEN" },
      data: {
        status: "PLACED",
        source: args.input.source,
        contactId: args.input.contactId ?? null,
        addressId: args.input.oneOffAddress ? null : (args.input.addressId ?? null),
        oneOffAddress: args.input.oneOffAddress
          ? (args.input.oneOffAddress as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        poNumber: args.input.poNumber ?? null,
        deliveryInstructions: args.input.deliveryInstructions ?? null,
        internalNote: args.input.internalNote ?? null,
        fulfilmentChoice,
      },
    });
    if (marked.count !== 1) {
      throw new AuthError(
        "This draft changed while the order was being saved. Review it and try again.",
        "DRAFT_CONFLICT",
        409,
      );
    }

    const afterOrder = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: { orderBy: { id: "asc" } } },
    });
    return { kind: "updated" as const, before, after: commercialSnapshot(afterOrder), orderId: order.id };
  });

  const confirmation = await loadConfirmation(result.orderId);
  if (result.kind === "updated") {
    await recordAuditEvent({
      action: "order.edited_for_customer",
      entityType: "Order",
      entityId: result.orderId,
      actorUserId: args.actorUserId,
      companyId: args.company.id,
      before: result.before,
      after: {
        ...result.after,
        staffUserId: args.actorUserId,
        staffName: args.staffName,
        orderNumber: confirmation.orderNumber,
      },
    });
  }
  return { ok: true, alreadyPlaced: result.kind === "existing", order: confirmation };
}

function totalsFor(
  lines: ResolvedLine[],
  companyTaxStatus: string,
  fulfilmentChoice: "DELIVERY" | "COLLECTION",
) {
  let goodsNet = moneyZero();
  let goodsVat = moneyZero();
  for (const line of lines) {
    if (line.issue !== "VALID" && line.issue !== "PRICE_UPDATED") continue;
    goodsNet = addMoney(goodsNet, parseMoney(line.lineNet2dp)!);
    goodsVat = addMoney(goodsVat, parseMoney(line.lineVat2dp)!);
  }
  return tradeDeliveryTotalsDto(
    calculateTradeOrderTotals({
      goodsNet,
      goodsVat,
      companyTaxStatus,
      fulfilmentChoice,
    }),
  );
}

function lineKey(
  lines: Array<{ variantId: string; qty: number | null; unitPriceOverride: string | null }>,
): string {
  return [...lines]
    .map((line) => `${line.variantId}:${line.qty ?? "blank"}:${money2(line.unitPriceOverride) ?? ""}`)
    .sort()
    .join("|");
}

function money2(value: string | null): string | null {
  if (!value) return null;
  const parsed = parseMoney(value);
  return parsed ? moneyToString(parsed, 2) : null;
}

function commercialSnapshot(order: {
  poNumber: string | null;
  fulfilmentChoice: string;
  deliveryMethodLabel: string | null;
  deliveryAddress: unknown;
  contactSnapshot: unknown;
  deliveryInstructions: string | null;
  notes: string | null;
  subtotal: { toString(): string };
  vatTotal: { toString(): string };
  deliveryTotal: { toString(): string };
  grandTotal: { toString(): string };
  items: Array<{
    sku: string;
    name: string;
    qty: number;
    customerUnitPrice: { toString(): string };
    lineTotal: { toString(): string };
    availableQtyAtOrder: number | null;
    backorderQtyAtOrder: number;
  }>;
}) {
  return {
    poNumber: order.poNumber,
    fulfilmentChoice: order.fulfilmentChoice,
    deliveryMethodLabel: order.deliveryMethodLabel,
    deliveryAddress: order.deliveryAddress,
    contact: order.contactSnapshot,
    deliveryInstructions: order.deliveryInstructions,
    internalNote: order.notes,
    subtotal: order.subtotal.toString(),
    vatTotal: order.vatTotal.toString(),
    deliveryTotal: order.deliveryTotal.toString(),
    grandTotal: order.grandTotal.toString(),
    lines: order.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      qty: item.qty,
      unitPrice: item.customerUnitPrice.toString(),
      lineTotal: item.lineTotal.toString(),
      availableQty: item.availableQtyAtOrder,
      backorderQty: item.backorderQtyAtOrder,
    })),
  };
}

async function loadConfirmation(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true, company: { select: { name: true } } },
  });
  return toConfirmation(order, order.company.name);
}
