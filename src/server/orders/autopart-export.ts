/**
 * Autopart CSV export eligibility and operational handoff.
 *
 * CSV download only — no APC, Autopart API, EDI, or reservation changes.
 */

import type { Prisma } from "@prisma/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { prisma } from "@/infra/database/client";
import { hasPermission } from "@/server/rbac/access";
import { getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";
import { recordAuditEvent } from "@/server/audit/record";
import {
  AUTOPART_ORDER_CSV_HEADERS,
  buildAutopartExportFilename,
  buildAutopartOrdersCsv,
  type AutopartExportContactSnapshot,
  type AutopartExportDeliverySnapshot,
  type AutopartExportOrderInput,
} from "@/domain/autopart-order-export";
import { moneyToString, parseMoney, moneyZero } from "@/domain/money";

export type AutopartExportBlockReason =
  | "CANCELLED"
  | "DRAFT"
  | "NO_ITEMS"
  | "MISSING_AUTOPART_SNAPSHOT"
  | "MISSING_SKU"
  | "MISSING_DELIVERY"
  | "INVALID_FINANCIALS"
  | "ALREADY_EXPORTED"
  | "NOT_FOUND"
  | "FORBIDDEN";

export type AutopartExportEligibility = {
  orderId: string;
  orderNumber: string;
  eligible: boolean;
  reason: AutopartExportBlockReason | null;
  message: string | null;
  exportStatus: "NOT_EXPORTED" | "EXPORTED";
  previouslyExportedAt: string | null;
  previouslyExportedByName: string | null;
  autopartAccountLinked: boolean;
  autopartCustomerCodeSnapshot: string | null;
  lineCount: number;
};

export type AutopartExportPreview = {
  selected: number;
  ready: number;
  blocked: number;
  alreadyExported: number;
  items: AutopartExportEligibility[];
};

export type AutopartExportResult = {
  csv: string;
  filename: string;
  batchId: string;
  batchReference: string;
  orderCount: number;
  lineCount: number;
  orderNumbers: string[];
  isReexport: boolean;
  headers: readonly string[];
};

type OrderForExport = Prisma.OrderGetPayload<{
  include: {
    items: true;
    company: { select: { id: true; name: true } };
    autopartExportedBy: { select: { id: true; name: true; email: true } };
  };
}>;

function money2(value: unknown): string {
  return moneyToString(parseMoney(String(value)) ?? moneyZero(), 2);
}

function parseDelivery(raw: unknown): AutopartExportDeliverySnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as AutopartExportDeliverySnapshot;
}

function parseContact(raw: unknown): AutopartExportContactSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as AutopartExportContactSnapshot;
}

function assessOrder(
  order: OrderForExport,
  opts: { allowAlreadyExported: boolean },
): AutopartExportEligibility {
  const base = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    exportStatus: order.autopartExportStatus as "NOT_EXPORTED" | "EXPORTED",
    previouslyExportedAt: order.autopartExportedAt?.toISOString() ?? null,
    previouslyExportedByName: order.autopartExportedBy?.name ?? order.autopartExportedBy?.email ?? null,
    autopartAccountLinked: order.autopartAccountLinked,
    autopartCustomerCodeSnapshot: order.autopartCustomerCodeSnapshot,
    lineCount: order.items.length,
  };

  const block = (
    reason: AutopartExportBlockReason,
    message: string,
  ): AutopartExportEligibility => ({
    ...base,
    eligible: false,
    reason,
    message,
  });

  if (order.status === "CANCELLED") {
    return block("CANCELLED", "Cancelled orders cannot be exported.");
  }
  if (order.status === "DRAFT") {
    return block("DRAFT", "Draft orders cannot be exported.");
  }
  if (order.items.length === 0) {
    return block("NO_ITEMS", "Order has no line items.");
  }

  const code = order.autopartCustomerCodeSnapshot?.trim();
  if (!order.autopartAccountLinked || !code) {
    return block(
      "MISSING_AUTOPART_SNAPSHOT",
      "AUTOPART ACCOUNT REQUIRED — This order cannot be exported because it does not contain a verified Autopart customer account snapshot.",
    );
  }

  if (order.items.some((it) => !it.sku?.trim())) {
    return block("MISSING_SKU", "One or more lines are missing a Supplier SKU snapshot.");
  }

  const delivery = parseDelivery(order.deliveryAddress);
  if (
    !delivery ||
    !delivery.line1?.trim() ||
    !(delivery.town?.trim() || delivery.city?.trim()) ||
    !delivery.postcode?.trim()
  ) {
    return block("MISSING_DELIVERY", "Order is missing a required delivery address snapshot.");
  }

  const contact = parseContact(order.contactSnapshot);
  if (!contact?.email?.trim()) {
    return block("MISSING_DELIVERY", "Order is missing a snapshotted contact email.");
  }

  const subtotal = parseMoney(String(order.subtotal));
  const vatTotal = parseMoney(String(order.vatTotal));
  const deliveryTotal = parseMoney(String(order.deliveryTotal));
  const grandTotal = parseMoney(String(order.grandTotal));
  if (!subtotal || !vatTotal || !deliveryTotal || !grandTotal) {
    return block("INVALID_FINANCIALS", "Order financial snapshots are invalid.");
  }

  for (const item of order.items) {
    if (item.qty <= 0) {
      return block("INVALID_FINANCIALS", "Order has an invalid line quantity.");
    }
    if (!parseMoney(String(item.lineTotal)) || !parseMoney(String(item.customerUnitPrice))) {
      return block("INVALID_FINANCIALS", "Order has invalid line financial snapshots.");
    }
  }

  if (order.autopartExportStatus === "EXPORTED" && !opts.allowAlreadyExported) {
    return block(
      "ALREADY_EXPORTED",
      "Order was previously exported. Use re-export with explicit confirmation.",
    );
  }

  return {
    ...base,
    eligible: true,
    reason: null,
    message: null,
  };
}

function toExportInput(order: OrderForExport): AutopartExportOrderInput {
  const delivery = parseDelivery(order.deliveryAddress);
  const contact = parseContact(order.contactSnapshot);
  return {
    orderNumber: order.orderNumber,
    orderDate: order.placedAt ?? order.createdAt,
    companyName: order.company.name,
    deliveryAddress: delivery,
    contact,
    autopartCustomerCodeSnapshot: order.autopartCustomerCodeSnapshot!.trim(),
    subtotal: money2(order.subtotal),
    deliveryTotal: money2(order.deliveryTotal),
    vatTotal: money2(order.vatTotal),
    grandTotal: money2(order.grandTotal),
    items: order.items.map((it) => ({
      sku: it.sku,
      qty: it.qty,
      lineTotal: money2(it.lineTotal),
      customerUnitPrice: money2(it.customerUnitPrice),
    })),
  };
}

async function requireExportActor(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!hasPermission(profile, "orders.edit") && !hasPermission(profile, "admin.access")) {
    throw new AuthError("You do not have permission to export Autopart CSV", "FORBIDDEN", 403);
  }
  return profile;
}

async function loadAccessibleOrders(userId: string, orderIds: string[]): Promise<OrderForExport[]> {
  const profile = await requireExportActor(userId);
  const uniqueIds = [...new Set(orderIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const accessible = await getAccessibleCompanyIdsForSales(profile);
  const companyFilter =
    accessible === "all"
      ? {}
      : { companyId: { in: accessible } };

  return prisma.order.findMany({
    where: { id: { in: uniqueIds }, ...companyFilter },
    include: {
      items: { orderBy: { id: "asc" } },
      company: { select: { id: true, name: true } },
      autopartExportedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ placedAt: "asc" }, { createdAt: "asc" }],
  });
}

export async function previewAutopartOrderExport(
  userId: string,
  orderIds: string[],
  opts?: { allowAlreadyExported?: boolean },
): Promise<AutopartExportPreview> {
  const allowAlreadyExported = Boolean(opts?.allowAlreadyExported);
  const orders = await loadAccessibleOrders(userId, orderIds);
  const found = new Map(orders.map((o) => [o.id, o]));
  const items: AutopartExportEligibility[] = [];

  for (const id of [...new Set(orderIds.filter(Boolean))]) {
    const order = found.get(id);
    if (!order) {
      items.push({
        orderId: id,
        orderNumber: id,
        eligible: false,
        reason: "NOT_FOUND",
        message: "Order not found or not accessible.",
        exportStatus: "NOT_EXPORTED",
        previouslyExportedAt: null,
        previouslyExportedByName: null,
        autopartAccountLinked: false,
        autopartCustomerCodeSnapshot: null,
        lineCount: 0,
      });
      continue;
    }
    items.push(assessOrder(order, { allowAlreadyExported }));
  }

  const ready = items.filter((i) => i.eligible).length;
  const alreadyExported = items.filter((i) => i.reason === "ALREADY_EXPORTED").length;
  const blocked = items.length - ready;

  return {
    selected: items.length,
    ready,
    blocked,
    alreadyExported,
    items,
  };
}

async function allocateBatchReference(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$executeRaw`
    INSERT INTO "AutopartExportBatchSequence" ("id", "nextValue")
    VALUES ('default', 1)
    ON CONFLICT ("id") DO NOTHING
  `;
  const rows = await tx.$queryRaw<Array<{ nextValue: number }>>`
    UPDATE "AutopartExportBatchSequence"
    SET "nextValue" = "nextValue" + 1
    WHERE "id" = 'default'
    RETURNING ("nextValue" - 1) AS "nextValue"
  `;
  const n = rows[0]?.nextValue ?? 1;
  return `APX-${String(n).padStart(6, "0")}`;
}

export async function exportAutopartOrdersCsv(
  userId: string,
  orderIds: string[],
  opts?: { confirmReexport?: boolean },
): Promise<AutopartExportResult> {
  const confirmReexport = Boolean(opts?.confirmReexport);
  const preview = await previewAutopartOrderExport(userId, orderIds, {
    allowAlreadyExported: confirmReexport,
  });

  if (preview.selected === 0) {
    throw new AuthError("No orders selected for export", "EXPORT_EMPTY", 400);
  }

  if (preview.blocked > 0) {
    const details = preview.items
      .filter((i) => !i.eligible)
      .map((i) => `${i.orderNumber}: ${i.message}`)
      .slice(0, 20)
      .join(" | ");
    throw new AuthError(
      `Cannot export: Selected ${preview.selected}, Ready ${preview.ready}, Blocked ${preview.blocked}. ${details}`,
      "EXPORT_BLOCKED",
      400,
    );
  }

  const orders = await loadAccessibleOrders(userId, orderIds);
  const byId = new Map(orders.map((o) => [o.id, o]));
  const ordered = orderIds
    .map((id) => byId.get(id))
    .filter((o): o is OrderForExport => Boolean(o));

  // Stable unique order list preserving selection order
  const seen = new Set<string>();
  const uniqueOrders: OrderForExport[] = [];
  for (const o of ordered) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    uniqueOrders.push(o);
  }

  const isReexport = uniqueOrders.some((o) => o.autopartExportStatus === "EXPORTED");
  if (isReexport && !confirmReexport) {
    throw new AuthError(
      "One or more orders were previously exported. Confirm re-export to continue.",
      "REEXPORT_CONFIRMATION_REQUIRED",
      400,
    );
  }

  const inputs = uniqueOrders.map(toExportInput);
  const csv = buildAutopartOrdersCsv(inputs);
  const lineCount = inputs.reduce((n, o) => n + Math.max(1, o.items.length), 0);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const reference = await allocateBatchReference(tx);
    const filename =
      uniqueOrders.length === 1
        ? buildAutopartExportFilename({
            mode: "single",
            orderNumber: uniqueOrders[0]!.orderNumber,
            at: now,
          })
        : buildAutopartExportFilename({
            mode: "batch",
            batchReference: reference,
            at: now,
          });

    const batch = await tx.autopartOrderExportBatch.create({
      data: {
        reference,
        createdByUserId: userId,
        orderCount: uniqueOrders.length,
        lineCount,
        filename,
        orderIds: uniqueOrders.map((o) => o.id),
        isReexport,
      },
    });

    for (const order of uniqueOrders) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          autopartExportStatus: "EXPORTED",
          autopartExportedAt: now,
          autopartExportedByUserId: userId,
          autopartExportBatchId: batch.id,
          autopartExportCount: { increment: 1 },
          // Do NOT change Order.status / fulfilment — export ≠ despatched.
          // Do NOT touch OrderStockReservation — reservation unchanged.
        },
      });
    }

    return { batch, filename, reference };
  });

  const orderNumbers = uniqueOrders.map((o) => o.orderNumber);
  const action = isReexport ? "order.autopart_reexport" : "order.autopart_export";
  const batchAction = "order.autopart_batch_export";

  await recordAuditEvent({
    action: batchAction,
    entityType: "AutopartOrderExportBatch",
    entityId: result.batch.id,
    actorUserId: userId,
    metadata: {
      batchReference: result.reference,
      orderCount: uniqueOrders.length,
      lineCount,
      filename: result.filename,
      isReexport,
      // Avoid dumping full customer PII — order numbers only.
      orderNumbers,
    },
  });

  for (const order of uniqueOrders) {
    await recordAuditEvent({
      action,
      entityType: "Order",
      entityId: order.id,
      actorUserId: userId,
      companyId: order.companyId,
      metadata: {
        orderNumber: order.orderNumber,
        batchReference: result.reference,
        batchId: result.batch.id,
        isReexport: order.autopartExportStatus === "EXPORTED" || isReexport,
        exportCountAfter: order.autopartExportCount + 1,
        apcInvoked: false,
        reservationUnchanged: true,
        fulfilmentUnchanged: true,
      },
    });
  }

  return {
    csv,
    filename: result.filename,
    batchId: result.batch.id,
    batchReference: result.reference,
    orderCount: uniqueOrders.length,
    lineCount,
    orderNumbers,
    isReexport,
    headers: AUTOPART_ORDER_CSV_HEADERS,
  };
}

export async function getAutopartExportMetaForOrder(userId: string, orderId: string) {
  await requireSystemPermission(userId, "orders.view");
  const preview = await previewAutopartOrderExport(userId, [orderId], {
    allowAlreadyExported: true,
  });
  const item = preview.items[0]!;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      autopartExportStatus: true,
      autopartExportedAt: true,
      autopartExportCount: true,
      autopartCustomerCodeSnapshot: true,
      autopartAccountLinked: true,
      autopartExportBatch: { select: { id: true, reference: true, filename: true, createdAt: true } },
      autopartExportedBy: { select: { name: true, email: true } },
      status: true,
    },
  });
  return {
    eligibility: item,
    exportStatus: order?.autopartExportStatus ?? "NOT_EXPORTED",
    exportedAt: order?.autopartExportedAt?.toISOString() ?? null,
    exportedByName: order?.autopartExportedBy?.name ?? order?.autopartExportedBy?.email ?? null,
    exportCount: order?.autopartExportCount ?? 0,
    batch: order?.autopartExportBatch
      ? {
          id: order.autopartExportBatch.id,
          reference: order.autopartExportBatch.reference,
          filename: order.autopartExportBatch.filename,
          createdAt: order.autopartExportBatch.createdAt.toISOString(),
        }
      : null,
    autopartAccountLinked: Boolean(order?.autopartAccountLinked),
    autopartCustomerCodeSnapshot: order?.autopartCustomerCodeSnapshot ?? null,
    orderStatus: order?.status ?? null,
  };
}
