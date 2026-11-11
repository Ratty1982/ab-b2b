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
import { recordAuditEvent, recordAuditEventInTransaction } from "@/server/audit/record";
import { recordFulfilmentEvent } from "@/server/orders/fulfilment";
import { orderHasAutopartExportRecord } from "@/server/orders/stock-hold-export-filter";
import type { OrderAmendmentEmailFeedback } from "@/domain/order-updated-email";
import {
  loadOrderUpdatedEmailOutcome,
  sendOrderUpdatedEmailAfterCommit,
} from "@/server/email/transactional";
import { reconcileActiveReservations } from "@/server/orders/reservations";
import { toConfirmation, type ResolvedLine } from "@/server/orders/service";
import type { SalesPlaceResult } from "@/server/orders/sales-order-entry";
import { zeroValueReasonForPrice } from "@/domain/zero-value-reason";
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
  /** Raw checkbox. Outstanding quantity is validated here. Unchecked does not clear an active hold. */
  holdUntilComplete: boolean;
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

  for (const line of args.lines) {
    if (line.issue !== "VALID") continue;
    const reason = zeroValueReasonForPrice({
      customerUnitPrice: line.customerUnit2dp,
      code: line.zeroValueReasonCode,
      detail: line.zeroValueReasonDetail,
    });
    if (!reason.ok) {
      throw new AuthError(`${line.sku}: ${reason.message}`, "ZERO_VALUE_REASON_REQUIRED", 400);
    }
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
      autopartExportBatchId: order.autopartExportBatchId,
      externalRef: order.externalRef,
      invoiceCount: order.invoices.length,
      fulfilmentKinds: order.fulfilmentEvents.map((event) => event.kind),
      consumedReservationCount: order.reservations.length,
    });
    if (!eligibility.allowed) {
      throw new AuthError(eligibility.reason ?? "This order can no longer be edited.", "ORDER_LOCKED", 409);
    }
    if (await orderHasAutopartExportRecord(tx, order)) {
      throw new AuthError(
        "This order has an Autopart export record and can no longer be edited.",
        "ORDER_LOCKED",
        409,
      );
    }
    if (args.holdUntilComplete && !args.hasBackorder) {
      throw new AuthError(
        "Hold until complete needs confirmed outstanding quantities on this order.",
        "HOLD_REQUIRES_BACKORDER",
        400,
      );
    }

    const alreadyWaiting =
      order.stockReleasePolicy === "HOLD_UNTIL_COMPLETE" && order.stockHoldState === "WAITING_STOCK";
    const activatingHold = args.holdUntilComplete && args.hasBackorder && !alreadyWaiting;
    const preservedActiveHold = alreadyWaiting;

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
            zeroValueReasonCode: line.zeroValueReasonCode ?? null,
            zeroValueReasonDetail: line.zeroValueReasonDetail ?? null,
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
        ...(activatingHold
          ? {
              stockReleasePolicy: "HOLD_UNTIL_COMPLETE" as const,
              stockHoldState: "WAITING_STOCK" as const,
              stockHeldAt: new Date(),
              stockHeldByUserId: args.actorUserId,
              stockReleasedAt: null,
              stockReleaseReason: null,
              stockHoldCancelledAt: null,
              stockHoldCancelReason: null,
              stockHoldCancelledByUserId: null,
              stockHoldLastCheckedAt: null,
              stockHoldLastCheckResult: Prisma.JsonNull,
            }
          : {}),
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

    if (activatingHold) {
      const outstanding = args.lines.reduce(
        (sum, line) => sum + (line.issue === "VALID" ? line.backorderQtyAtOrder : 0),
        0,
      );
      await recordFulfilmentEvent(tx, {
        orderId: order.id,
        kind: "NOTE",
        summary: "HELD — AWAITING STOCK until every line can be fulfilled",
        source: "MANUAL",
        lineQuantitiesKnown: true,
        metadata: {
          stockHold: true,
          stockHoldState: "WAITING_STOCK",
          stockReleasePolicy: "HOLD_UNTIL_COMPLETE",
          outstandingBackorderUnits: outstanding,
          appliedOnEdit: true,
        },
      });
      await recordAuditEventInTransaction(tx, {
        action: "order.stock_hold.applied_on_edit",
        entityType: "Order",
        entityId: order.id,
        actorUserId: args.actorUserId,
        companyId: args.company.id,
        before: {
          stockHoldState: order.stockHoldState,
          stockReleasePolicy: order.stockReleasePolicy,
        },
        after: {
          orderNumber: order.orderNumber,
          stockHoldState: "WAITING_STOCK",
          stockReleasePolicy: "HOLD_UNTIL_COMPLETE",
          outstandingBackorderUnits: outstanding,
        },
      });
    }

    const afterOrder = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: { orderBy: { id: "asc" } } },
    });
    return {
      kind: "updated" as const,
      before,
      after: commercialSnapshot(afterOrder),
      orderId: order.id,
      hold: {
        activated: activatingHold,
        preserved: preservedActiveHold,
        stockHoldState: afterOrder.stockHoldState,
        stockReleasePolicy: afterOrder.stockReleasePolicy,
      },
    };
  });

  const confirmation = await loadConfirmation(result.orderId);
  if (result.kind === "existing") {
    return {
      ok: true,
      alreadyPlaced: true,
      order: confirmation,
      email: await loadOrderUpdatedEmailOutcome(result.orderId, args.input.idempotencyKey),
    };
  }

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
      stockHoldState: result.hold.stockHoldState,
      stockReleasePolicy: result.hold.stockReleasePolicy,
      stockHoldActivated: result.hold.activated,
      stockHoldPreserved: result.hold.preserved,
    },
  });

  const email = customerFacingChanged(result.before, result.after)
    ? await sendAmendmentEmail({
        actorUserId: args.actorUserId,
        companyId: args.company.id,
        orderId: result.orderId,
        editIdempotencyKey: args.input.idempotencyKey,
      })
    : { status: "skipped" as const, emailId: null };

  return { ok: true, alreadyPlaced: false, order: confirmation, email };
}

async function sendAmendmentEmail(input: {
  actorUserId: string;
  companyId: string;
  orderId: string;
  editIdempotencyKey: string;
}): Promise<OrderAmendmentEmailFeedback> {
  try {
    const email = await sendOrderUpdatedEmailAfterCommit({
      orderId: input.orderId,
      editIdempotencyKey: input.editIdempotencyKey,
    });
    if (email.status !== "sent") {
      await recordAuditEvent({
        action: "order.email_failed",
        entityType: "Order",
        entityId: input.orderId,
        actorUserId: input.actorUserId,
        companyId: input.companyId,
        metadata: {
          channel: "customer",
          purpose: "ORDER_UPDATED",
          status: email.status,
          emailId: email.emailId,
        },
      }).catch(() => undefined);
    }
    return email;
  } catch (error) {
    await recordAuditEvent({
      action: "order.email_failed",
      entityType: "Order",
      entityId: input.orderId,
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      metadata: {
        channel: "customer",
        purpose: "ORDER_UPDATED",
        detail: error instanceof Error ? error.message : "unknown",
      },
    }).catch(() => undefined);
    return { status: "failed", emailId: null };
  }
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

function customerFacingChanged(
  before: ReturnType<typeof commercialSnapshot>,
  after: ReturnType<typeof commercialSnapshot>,
): boolean {
  return JSON.stringify(customerFacingView(before)) !== JSON.stringify(customerFacingView(after));
}

function customerFacingView(snapshot: ReturnType<typeof commercialSnapshot>) {
  return {
    poNumber: snapshot.poNumber ?? null,
    fulfilmentChoice: snapshot.fulfilmentChoice,
    deliveryMethodLabel: snapshot.deliveryMethodLabel,
    deliveryAddress: addressView(snapshot.deliveryAddress),
    contact: contactView(snapshot.contact),
    deliveryInstructions: snapshot.deliveryInstructions ?? null,
    subtotal: money2(snapshot.subtotal),
    vatTotal: money2(snapshot.vatTotal),
    deliveryTotal: money2(snapshot.deliveryTotal),
    grandTotal: money2(snapshot.grandTotal),
    lines: snapshot.lines.map((line) => ({
      sku: line.sku,
      name: line.name,
      qty: line.qty,
      unitPrice: money2(line.unitPrice),
      lineTotal: money2(line.lineTotal),
      availableQty: line.availableQty,
      backorderQty: line.backorderQty,
    })),
  };
}

function contactView(raw: unknown) {
  const contact = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const email = typeof contact["email"] === "string" ? contact["email"].trim().toLowerCase() : "";
  const phone = typeof contact["phone"] === "string" && contact["phone"].trim() ? contact["phone"].trim() : null;
  return {
    name: typeof contact["name"] === "string" ? contact["name"].trim() : "",
    email,
    phone,
  };
}

function addressView(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const address = raw as Record<string, unknown>;
  const line1 = typeof address["line1"] === "string" ? address["line1"].trim() : "";
  if (!line1) return null;
  return {
    line1,
    line2: typeof address["line2"] === "string" && address["line2"].trim() ? address["line2"].trim() : null,
    town: typeof address["town"] === "string" ? address["town"].trim() : "",
    county: typeof address["county"] === "string" && address["county"].trim() ? address["county"].trim() : null,
    postcode: typeof address["postcode"] === "string" ? address["postcode"].trim() : "",
    country: typeof address["country"] === "string" && address["country"].trim() ? address["country"].trim() : "GB",
  };
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
    zeroValueReasonCode?: string | null;
    zeroValueReasonDetail?: string | null;
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
      zeroValueReasonCode: item.zeroValueReasonCode ?? null,
      zeroValueReasonDetail: item.zeroValueReasonDetail ?? null,
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
