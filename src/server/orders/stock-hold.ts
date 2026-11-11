/**
 * Hold-until-complete stock workflow.
 *
 * Orders stay SUBMITTED with a normal AB order number. WAITING_STOCK blocks
 * Autopart CSV export until every line can be covered by confirmed sellable
 * stock plus the order's own ACTIVE reservations. Release reserves any shortfall
 * atomically, then emails staff via the transactional outbox.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants } from "@/server/rbac/access";
import { getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";
import { recordAuditEvent, recordAuditEventInTransaction } from "@/server/audit/record";
import { recordFulfilmentEvent } from "@/server/orders/fulfilment";
import { reserveStockForOrder } from "@/server/orders/reservations";
import {
  AUTOPART_WAREHOUSE_CODE,
  getEffectiveSellableQuantity,
} from "@/domain/stock";
import { stockFreshness } from "@/server/stock/service";
import {
  assessStockHoldLineCoverage,
  blocksAutopartExportForStockHold,
  isActiveStockHold,
  isVerifiedStockHoldRelease,
  staffStockHoldLabel,
  stockHoldCheckResultPayload,
  type StockHoldCoverageAssessment,
  type StockHoldLineCoverageInput,
} from "@/domain/order-stock-hold";
import { orderHasAutopartExportRecord } from "@/server/orders/stock-hold-export-filter";
import { assessSalesOrderEditEligibility } from "@/domain/order-edit";
import { sendOrderStockHoldReadyEmailsAfterCommit } from "@/server/email/stock-hold-ready";

export type StockHoldLineView = {
  orderItemId: string;
  variantId: string;
  sku: string;
  name: string;
  requiredQty: number;
  ownActiveReservedQty: number;
  freeConfirmedSellableQty: number;
  availableIncludingOwn: number;
  shortfallQty: number;
  remainingToReserve: number;
  stockConfirmed: boolean;
  fullyCovered: boolean;
};

export type StockHoldCheckResultView = {
  fullyCoverable: boolean;
  reason: string;
  blockingSkus: StockHoldCoverageAssessment["blockingSkus"];
  checkedAt?: string;
  trigger?: string;
  stockStale?: boolean;
  lastSuccessAt?: string | null;
  midReleaseShortage?: boolean;
  skipped?: string;
};

export type HeldOrderView = {
  orderId: string;
  orderNumber: string;
  status: string;
  companyId: string;
  companyName: string;
  stockHoldState: string;
  stockReleasePolicy: string;
  stockHeldAt: string | null;
  stockHeldByName: string | null;
  stockHoldLastCheckedAt: string | null;
  stockReleasedAt: string | null;
  stockReleaseReason: string | null;
  staffLabel: string | null;
  autopartCustomerCodeSnapshot: string | null;
  grandTotal: string;
  lines: StockHoldLineView[];
  blockingSkus: StockHoldCoverageAssessment["blockingSkus"];
  lastCheckResult: StockHoldCheckResultView | null;
};

function asCheckResultView(raw: unknown): StockHoldCheckResultView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const out: StockHoldCheckResultView = {
    fullyCoverable: Boolean(row["fullyCoverable"]),
    reason: typeof row["reason"] === "string" ? row["reason"] : "UNKNOWN",
    blockingSkus: Array.isArray(row["blockingSkus"])
      ? (row["blockingSkus"] as StockHoldCoverageAssessment["blockingSkus"])
      : [],
  };
  if (typeof row["checkedAt"] === "string") out.checkedAt = row["checkedAt"];
  if (typeof row["trigger"] === "string") out.trigger = row["trigger"];
  if (typeof row["stockStale"] === "boolean") out.stockStale = row["stockStale"];
  if (row["lastSuccessAt"] === null || typeof row["lastSuccessAt"] === "string") {
    out.lastSuccessAt = row["lastSuccessAt"] as string | null;
  }
  if (typeof row["midReleaseShortage"] === "boolean") {
    out.midReleaseShortage = row["midReleaseShortage"];
  }
  if (typeof row["skipped"] === "string") out.skipped = row["skipped"];
  return out;
}

function asMoney(value: unknown): string {
  return String(value);
}

async function requireHoldManager(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!grants(profile, "orders.edit", "admin.access")) {
    throw new AuthError(
      "You do not have permission to manage stock holds on orders",
      "FORBIDDEN",
      403,
    );
  }
  return profile;
}

async function loadWarehouseId(tx: Prisma.TransactionClient | typeof prisma): Promise<string | null> {
  const warehouse = await tx.warehouse.findUnique({
    where: { code: AUTOPART_WAREHOUSE_CODE },
    select: { id: true },
  });
  return warehouse?.id ?? null;
}

async function buildCoverageInputs(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    items: Array<{
      id: string;
      variantId: string | null;
      sku: string;
      name: string;
      qty: number;
    }>;
  },
  opts: { stale: boolean },
): Promise<StockHoldLineCoverageInput[]> {
  const warehouseId = await loadWarehouseId(tx);
  const active = await tx.orderStockReservation.findMany({
    where: { orderId: order.id, status: "ACTIVE" },
    select: { variantId: true, quantity: true, orderItemId: true },
  });
  /** Per line — never duplicate the full variant sum onto every sibling line. */
  const ownByItem = new Map<string, number>();
  for (const row of active) {
    if (!row.orderItemId) continue;
    ownByItem.set(row.orderItemId, (ownByItem.get(row.orderItemId) ?? 0) + row.quantity);
  }

  const variantIds = [
    ...new Set(
      order.items
        .map((item) => item.variantId)
        .filter((id): id is string => Boolean(id)),
    ),
  ].sort();

  const inventoryByVariant = new Map<
    string,
    { id: string; qtyOnHand: number; qtyReserved: number; manualOverrideQty: number | null }
  >();

  if (warehouseId) {
    for (const variantId of variantIds) {
      const inventory = await tx.inventory.findUnique({
        where: { variantId_warehouseId: { variantId, warehouseId } },
        select: {
          id: true,
          qtyOnHand: true,
          qtyReserved: true,
          manualOverrideQty: true,
        },
      });
      if (!inventory) continue;
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          qtyOnHand: number;
          qtyReserved: number;
          manualOverrideQty: number | null;
        }>
      >`
        SELECT id, "qtyOnHand", "qtyReserved", "manualOverrideQty"
        FROM "Inventory"
        WHERE id = ${inventory.id}
        FOR UPDATE
      `;
      const row = locked[0];
      if (row) inventoryByVariant.set(variantId, row);
    }
  }

  return order.items.map((item) => {
    const variantId = item.variantId ?? "";
    const inv = variantId ? inventoryByVariant.get(variantId) : undefined;
    const stockConfirmed = Boolean(inv) && !opts.stale;
    const free = inv
      ? getEffectiveSellableQuantity({
          autopartAvail: inv.qtyOnHand,
          reservedQty: inv.qtyReserved,
          manualOverrideQty: inv.manualOverrideQty,
        })
      : 0;
    return {
      orderItemId: item.id,
      variantId,
      sku: item.sku,
      name: item.name,
      requiredQty: item.qty,
      ownActiveReservedQty: ownByItem.get(item.id) ?? 0,
      freeConfirmedSellableQty: stockConfirmed ? free : 0,
      stockConfirmed,
    };
  });
}

async function evaluateAndMaybeReleaseOrder(
  orderId: string,
  opts: {
    actorUserId?: string | null;
    trigger: "STOCK_SYNC" | "MANUAL_RETRY" | "PLACE";
    allowStale?: boolean;
  },
): Promise<{
  orderId: string;
  outcome: "RELEASED" | "STILL_WAITING" | "SKIPPED" | "STALE" | "NOT_WAITING";
  assessment: StockHoldCoverageAssessment | null;
}> {
  const freshness = await stockFreshness();
  // Fail closed: no successful sync yet is not trustworthy for release.
  const stockUntrusted = freshness.stale || !freshness.lastSuccessAt;
  if (stockUntrusted && !opts.allowStale) {
    return { orderId, outcome: "STALE", assessment: null };
  }

  const released = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; stockHoldState: string }>>`
      SELECT id, "stockHoldState"
      FROM "Order"
      WHERE id = ${orderId}
      FOR UPDATE
    `;
    const lock = locked[0];
    if (!lock) {
      return { outcome: "SKIPPED" as const, assessment: null as StockHoldCoverageAssessment | null };
    }
    if (lock.stockHoldState !== "WAITING_STOCK") {
      return { outcome: "NOT_WAITING" as const, assessment: null };
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { orderBy: { id: "asc" } },
      },
    });

    if (order.status === "CANCELLED" || order.archivedAt) {
      const now = new Date();
      const assessment = assessStockHoldLineCoverage([]);
      await tx.order.update({
        where: { id: order.id },
        data: {
          stockHoldLastCheckedAt: now,
          stockHoldLastCheckResult: stockHoldCheckResultPayload(assessment, {
            trigger: opts.trigger,
            skipped: "ORDER_INACTIVE",
          }) as Prisma.InputJsonValue,
        },
      });
      return { outcome: "SKIPPED" as const, assessment };
    }

    const inputs = await buildCoverageInputs(tx, order, { stale: stockUntrusted });
    const assessment = assessStockHoldLineCoverage(inputs);
    const now = new Date();
    const checkPayload = stockHoldCheckResultPayload(assessment, {
      trigger: opts.trigger,
      stockStale: stockUntrusted,
      lastSuccessAt: freshness.lastSuccessAt?.toISOString() ?? null,
    });

    if (!assessment.fullyCoverable) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          stockHoldLastCheckedAt: now,
          stockHoldLastCheckResult: checkPayload as Prisma.InputJsonValue,
        },
      });
      return { outcome: "STILL_WAITING" as const, assessment };
    }

    // Atomically reserve remaining units so every line is fully covered.
    const reserveLines = assessment.lines
      .filter((line) => line.remainingToReserve > 0 && line.variantId)
      .map((line) => ({
        orderItemId: line.orderItemId,
        variantId: line.variantId,
        quantity: line.remainingToReserve,
      }));

    if (reserveLines.length > 0) {
      await reserveStockForOrder(tx, { orderId: order.id, lines: reserveLines });
    }

    // Recheck after reserve attempt (stock may have vanished under lock races).
    const recheckInputs = await buildCoverageInputs(tx, order, { stale: stockUntrusted });
    // Own reservations now include the just-created rows; free sellable dropped accordingly.
    // Full coverage means ACTIVE reservations for each variant cover the SUM of sibling line qtys.
    const postActive = await tx.orderStockReservation.findMany({
      where: { orderId: order.id, status: "ACTIVE" },
      select: { variantId: true, quantity: true },
    });
    const ownByVariant = new Map<string, number>();
    for (const row of postActive) {
      ownByVariant.set(row.variantId, (ownByVariant.get(row.variantId) ?? 0) + row.quantity);
    }
    const requiredByVariant = new Map<string, number>();
    for (const item of order.items) {
      if (!item.variantId) {
        requiredByVariant.set(`missing:${item.id}`, item.qty);
        continue;
      }
      requiredByVariant.set(
        item.variantId,
        (requiredByVariant.get(item.variantId) ?? 0) + item.qty,
      );
    }
    const stillShort = [...requiredByVariant.entries()].some(([variantKey, required]) => {
      if (variantKey.startsWith("missing:")) return true;
      return (ownByVariant.get(variantKey) ?? 0) < required;
    });
    if (stillShort) {
      const failed = assessStockHoldLineCoverage(recheckInputs);
      await tx.order.update({
        where: { id: order.id },
        data: {
          stockHoldLastCheckedAt: now,
          stockHoldLastCheckResult: stockHoldCheckResultPayload(failed, {
            trigger: opts.trigger,
            midReleaseShortage: true,
          }) as Prisma.InputJsonValue,
        },
      });
      return { outcome: "STILL_WAITING" as const, assessment: failed };
    }

    const releaseReason =
      opts.trigger === "MANUAL_RETRY"
        ? "MANUAL_RETRY_FULL_STOCK"
        : opts.trigger === "PLACE"
          ? "PLACED_WITH_FULL_STOCK"
          : "STOCK_SYNC_FULL_COVERAGE";

    await tx.order.update({
      where: { id: order.id },
      data: {
        stockHoldState: "READY_TO_EXPORT",
        stockReleasedAt: now,
        stockReleaseReason: releaseReason,
        stockHoldLastCheckedAt: now,
        stockHoldLastCheckResult: checkPayload as Prisma.InputJsonValue,
      },
    });

    await recordFulfilmentEvent(tx, {
      orderId: order.id,
      kind: "NOTE",
      summary: "Stock hold released — order ready for Autopart export",
      source: "MANUAL",
      lineQuantitiesKnown: true,
      metadata: {
        stockHold: true,
        releaseReason,
        trigger: opts.trigger,
      },
    });

    await recordAuditEventInTransaction(tx, {
      action: "order.stock_hold.released",
      entityType: "Order",
      entityId: order.id,
      actorUserId: opts.actorUserId ?? null,
      companyId: order.companyId,
      after: {
        orderNumber: order.orderNumber,
        stockHoldState: "READY_TO_EXPORT",
        releaseReason,
        trigger: opts.trigger,
        reservedLines: reserveLines,
      },
    });

    return { outcome: "RELEASED" as const, assessment };
  });

  if (released.outcome === "RELEASED") {
    // Email after commit — failure must not reverse the release.
    try {
      await sendOrderStockHoldReadyEmailsAfterCommit(orderId);
    } catch (error) {
      console.error("[ab:stock-hold] release email failed", {
        orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { orderId, ...released };
}

/**
 * After a trusted live 231PO3NEW apply, evaluate held orders FIFO by heldAt.
 * Idempotent: READY / CANCELLED / NONE orders are skipped.
 */
export async function evaluateHeldOrdersAfterStockSync(input?: {
  actorUserId?: string | null;
  trigger?: "STOCK_SYNC" | "MANUAL_RETRY";
}): Promise<{
  considered: number;
  released: number;
  stillWaiting: number;
  skipped: number;
  stale: boolean;
  results: Array<{ orderId: string; outcome: string }>;
}> {
  const freshness = await stockFreshness();
  if (freshness.stale) {
    return {
      considered: 0,
      released: 0,
      stillWaiting: 0,
      skipped: 0,
      stale: true,
      results: [],
    };
  }

  const waiting = await prisma.order.findMany({
    where: {
      stockHoldState: "WAITING_STOCK",
      stockReleasePolicy: "HOLD_UNTIL_COMPLETE",
      status: { notIn: ["CANCELLED", "DRAFT"] },
      archivedAt: null,
    },
    select: { id: true },
    orderBy: [{ stockHeldAt: "asc" }, { placedAt: "asc" }, { id: "asc" }],
  });

  const results: Array<{ orderId: string; outcome: string }> = [];
  let released = 0;
  let stillWaiting = 0;
  let skipped = 0;

  for (const row of waiting) {
    const result = await evaluateAndMaybeReleaseOrder(row.id, {
      actorUserId: input?.actorUserId ?? null,
      trigger: input?.trigger ?? "STOCK_SYNC",
    });
    results.push({ orderId: result.orderId, outcome: result.outcome });
    if (result.outcome === "RELEASED") released += 1;
    else if (result.outcome === "STILL_WAITING") stillWaiting += 1;
    else skipped += 1;
  }

  return {
    considered: waiting.length,
    released,
    stillWaiting,
    skipped,
    stale: false,
    results,
  };
}

export async function retryHeldOrderEvaluation(
  actorUserId: string,
  orderId: string,
): Promise<{ outcome: string; assessment: StockHoldCoverageAssessment | null }> {
  await requireHoldManager(actorUserId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, stockHoldState: true, companyId: true },
  });
  if (!order) throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  if (!isActiveStockHold(order.stockHoldState)) {
    throw new AuthError("Order is not waiting on stock", "NOT_WAITING", 409);
  }
  const result = await evaluateAndMaybeReleaseOrder(orderId, {
    actorUserId,
    trigger: "MANUAL_RETRY",
  });
  await recordAuditEvent({
    action: "order.stock_hold.retry",
    entityType: "Order",
    entityId: orderId,
    actorUserId,
    companyId: order.companyId,
    after: { outcome: result.outcome },
  });
  return { outcome: result.outcome, assessment: result.assessment };
}

export async function cancelOrderStockHold(
  actorUserId: string,
  raw: { orderId: string; reason: string; cancelOrder?: boolean },
): Promise<{ orderId: string; stockHoldState: string; orderStatus: string }> {
  const profile = await requireHoldManager(actorUserId);
  const reason = raw.reason?.trim();
  if (!reason || reason.length < 3) {
    throw new AuthError("A cancellation reason is required", "VALIDATION", 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Order" WHERE id = ${raw.orderId} FOR UPDATE
    `;
    if (!locked[0]) throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);

    const order = await tx.order.findUniqueOrThrow({
      where: { id: raw.orderId },
      select: {
        id: true,
        companyId: true,
        orderNumber: true,
        status: true,
        stockHoldState: true,
        stockReleasePolicy: true,
        autopartExportStatus: true,
        autopartExportCount: true,
        autopartExportedAt: true,
        autopartExportBatchId: true,
        archivedAt: true,
        externalRef: true,
      },
    });

    if (!grants(profile, "admin.access", "sales.view_all_accounts")) {
      const accessible = await getAccessibleCompanyIdsForSales(profile);
      if (accessible !== "all" && !accessible.includes(order.companyId)) {
        throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
      }
    }

    if (!isActiveStockHold(order.stockHoldState)) {
      throw new AuthError("Order is not on an active stock hold", "NOT_WAITING", 409);
    }
    if (await orderHasAutopartExportRecord(tx, order)) {
      throw new AuthError("Exported orders cannot have their stock hold cancelled", "ORDER_LOCKED", 409);
    }

    const now = new Date();
    const cancelOrder = Boolean(raw.cancelOrder);

    if (cancelOrder) {
      const { releaseStockForOrder } = await import("@/server/orders/reservations");
      await releaseStockForOrder(tx, { orderId: order.id });
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        stockHoldState: "CANCELLED_HOLD",
        // Policy must leave HOLD_UNTIL_COMPLETE. CANCELLED_HOLD with that policy stays unexportable.
        stockReleasePolicy: "SHIP_AS_AVAILABLE",
        stockHoldCancelledAt: now,
        stockHoldCancelReason: reason.slice(0, 500),
        stockHoldCancelledByUserId: actorUserId,
        stockHoldLastCheckedAt: now,
        ...(cancelOrder
          ? {
              status: "CANCELLED",
            }
          : {}),
      },
      select: { id: true, stockHoldState: true, status: true, orderNumber: true, companyId: true },
    });

    await recordFulfilmentEvent(tx, {
      orderId: order.id,
      kind: "NOTE",
      summary: cancelOrder
        ? "Stock hold cancelled and order cancelled"
        : "Stock hold cancelled — order may export with available stock",
      source: "MANUAL",
      metadata: { stockHold: true, reason, cancelOrder },
    });

    await recordAuditEventInTransaction(tx, {
      action: cancelOrder ? "order.stock_hold.cancelled_with_order" : "order.stock_hold.cancelled",
      entityType: "Order",
      entityId: order.id,
      actorUserId,
      companyId: order.companyId,
      after: {
        orderNumber: order.orderNumber,
        reason,
        cancelOrder,
        stockHoldState: "CANCELLED_HOLD",
        stockReleasePolicy: "SHIP_AS_AVAILABLE",
        status: updated.status,
      },
    });

    return updated;
  });

  return {
    orderId: result.id,
    stockHoldState: result.stockHoldState,
    orderStatus: result.status,
  };
}

export async function listHeldOrders(
  actorUserId: string,
  raw?: { page?: number; pageSize?: number; q?: string },
): Promise<{ items: HeldOrderView[]; total: number; page: number; pageSize: number }> {
  const profile = await requireSystemPermission(actorUserId, "orders.view");
  const page = Math.max(1, raw?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, raw?.pageSize ?? 25));
  const accessible = await getAccessibleCompanyIdsForSales(profile);
  const q = raw?.q?.trim();

  const where: Prisma.OrderWhereInput = {
    stockHoldState: "WAITING_STOCK",
    archivedAt: null,
    status: { notIn: ["DRAFT", "CANCELLED"] },
    ...(accessible === "all" ? {} : { companyId: { in: accessible } }),
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q, mode: "insensitive" } },
            { company: { name: { contains: q, mode: "insensitive" } } },
            { autopartCustomerCodeSnapshot: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ stockHeldAt: "asc" }, { placedAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        items: { orderBy: { id: "asc" } },
        company: { select: { id: true, name: true } },
        stockHeldBy: { select: { name: true, email: true } },
        reservations: {
          where: { status: "ACTIVE" },
          select: { variantId: true, quantity: true },
        },
      },
    }),
  ]);

  const freshness = await stockFreshness();
  const warehouseId = await loadWarehouseId(prisma);
  const variantIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.items.map((item) => item.variantId).filter((id): id is string => Boolean(id)),
      ),
    ),
  ];
  const inventories =
    warehouseId && variantIds.length > 0
      ? await prisma.inventory.findMany({
          where: { warehouseId, variantId: { in: variantIds } },
          select: {
            variantId: true,
            qtyOnHand: true,
            qtyReserved: true,
            manualOverrideQty: true,
          },
        })
      : [];
  const invByVariant = new Map(inventories.map((row) => [row.variantId, row]));

  const items: HeldOrderView[] = rows.map((row) => {
    const ownByVariant = new Map<string, number>();
    for (const res of row.reservations) {
      ownByVariant.set(res.variantId, (ownByVariant.get(res.variantId) ?? 0) + res.quantity);
    }
    const inputs: StockHoldLineCoverageInput[] = row.items.map((item) => {
      const inv = item.variantId ? invByVariant.get(item.variantId) : undefined;
      const stockConfirmed = Boolean(inv) && !freshness.stale;
      const free = inv
        ? getEffectiveSellableQuantity({
            autopartAvail: inv.qtyOnHand,
            reservedQty: inv.qtyReserved,
            manualOverrideQty: inv.manualOverrideQty,
          })
        : 0;
      return {
        orderItemId: item.id,
        variantId: item.variantId ?? "",
        sku: item.sku,
        name: item.name,
        requiredQty: item.qty,
        ownActiveReservedQty: item.variantId ? (ownByVariant.get(item.variantId) ?? 0) : 0,
        freeConfirmedSellableQty: stockConfirmed ? free : 0,
        stockConfirmed,
      };
    });
    const assessment = assessStockHoldLineCoverage(inputs);
    return {
      orderId: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      companyId: row.companyId,
      companyName: row.company.name,
      stockHoldState: row.stockHoldState,
      stockReleasePolicy: row.stockReleasePolicy,
      stockHeldAt: row.stockHeldAt?.toISOString() ?? null,
      stockHeldByName: row.stockHeldBy?.name ?? row.stockHeldBy?.email ?? null,
      stockHoldLastCheckedAt: row.stockHoldLastCheckedAt?.toISOString() ?? null,
      stockReleasedAt: row.stockReleasedAt?.toISOString() ?? null,
      stockReleaseReason: row.stockReleaseReason,
      staffLabel: staffStockHoldLabel(row.stockHoldState),
      autopartCustomerCodeSnapshot: row.autopartCustomerCodeSnapshot,
      grandTotal: asMoney(row.grandTotal),
      lines: assessment.lines.map((line) => ({
        orderItemId: line.orderItemId,
        variantId: line.variantId,
        sku: line.sku,
        name: line.name,
        requiredQty: line.requiredQty,
        ownActiveReservedQty: line.ownActiveReservedQty,
        freeConfirmedSellableQty: line.freeConfirmedSellableQty,
        availableIncludingOwn: line.availableIncludingOwn,
        shortfallQty: line.shortfallQty,
        remainingToReserve: line.remainingToReserve,
        stockConfirmed: line.stockConfirmed,
        fullyCovered: line.fullyCovered,
      })),
      blockingSkus: assessment.blockingSkus,
      lastCheckResult: asCheckResultView(row.stockHoldLastCheckResult),
    };
  });

  return { items, total, page, pageSize };
}

export async function getOrderStockHoldDetail(
  actorUserId: string,
  orderId: string,
): Promise<HeldOrderView | null> {
  const profile = await requireSystemPermission(actorUserId, "orders.view");
  const accessible = await getAccessibleCompanyIdsForSales(profile);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { id: "asc" } },
      company: { select: { id: true, name: true } },
      stockHeldBy: { select: { name: true, email: true } },
      reservations: {
        where: { status: "ACTIVE" },
        select: { variantId: true, quantity: true },
      },
    },
  });
  if (!order) return null;
  if (accessible !== "all" && !accessible.includes(order.companyId)) return null;
  if (order.stockHoldState === "NONE") return null;

  const freshness = await stockFreshness();
  const warehouseId = await loadWarehouseId(prisma);
  const ownByVariant = new Map<string, number>();
  for (const res of order.reservations) {
    ownByVariant.set(res.variantId, (ownByVariant.get(res.variantId) ?? 0) + res.quantity);
  }
  const inputs: StockHoldLineCoverageInput[] = [];
  for (const item of order.items) {
    const inv =
      warehouseId && item.variantId
        ? await prisma.inventory.findUnique({
            where: {
              variantId_warehouseId: { variantId: item.variantId, warehouseId },
            },
            select: {
              qtyOnHand: true,
              qtyReserved: true,
              manualOverrideQty: true,
            },
          })
        : null;
    const stockConfirmed = Boolean(inv) && !freshness.stale;
    const free = inv
      ? getEffectiveSellableQuantity({
          autopartAvail: inv.qtyOnHand,
          reservedQty: inv.qtyReserved,
          manualOverrideQty: inv.manualOverrideQty,
        })
      : 0;
    inputs.push({
      orderItemId: item.id,
      variantId: item.variantId ?? "",
      sku: item.sku,
      name: item.name,
      requiredQty: item.qty,
      ownActiveReservedQty: item.variantId ? (ownByVariant.get(item.variantId) ?? 0) : 0,
      freeConfirmedSellableQty: stockConfirmed ? free : 0,
      stockConfirmed,
    });
  }
  const assessment = assessStockHoldLineCoverage(inputs);
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    companyId: order.companyId,
    companyName: order.company.name,
    stockHoldState: order.stockHoldState,
    stockReleasePolicy: order.stockReleasePolicy,
    stockHeldAt: order.stockHeldAt?.toISOString() ?? null,
    stockHeldByName: order.stockHeldBy?.name ?? order.stockHeldBy?.email ?? null,
    stockHoldLastCheckedAt: order.stockHoldLastCheckedAt?.toISOString() ?? null,
    stockReleasedAt: order.stockReleasedAt?.toISOString() ?? null,
    stockReleaseReason: order.stockReleaseReason,
    staffLabel: staffStockHoldLabel(order.stockHoldState),
    autopartCustomerCodeSnapshot: order.autopartCustomerCodeSnapshot,
    grandTotal: asMoney(order.grandTotal),
    lines: assessment.lines.map((line) => ({
      orderItemId: line.orderItemId,
      variantId: line.variantId,
      sku: line.sku,
      name: line.name,
      requiredQty: line.requiredQty,
      ownActiveReservedQty: line.ownActiveReservedQty,
      freeConfirmedSellableQty: line.freeConfirmedSellableQty,
      availableIncludingOwn: line.availableIncludingOwn,
      shortfallQty: line.shortfallQty,
      remainingToReserve: line.remainingToReserve,
      stockConfirmed: line.stockConfirmed,
      fullyCovered: line.fullyCovered,
    })),
    blockingSkus: assessment.blockingSkus,
    lastCheckResult: asCheckResultView(order.stockHoldLastCheckResult),
  };
}

/**
 * Operator remediation for a submitted order whose hold was not persisted.
 * Does not change the order number, customer, prices, lines, or reservations.
 * Does not export the order. Refuses exported, invoiced, dispatched, and
 * already verified-released orders.
 */
export async function applyHoldUntilCompleteToSubmittedOrder(
  actorUserId: string,
  raw: { orderId: string; reason: string },
): Promise<{
  orderId: string;
  orderNumber: string;
  stockHoldState: string;
  stockReleasePolicy: string;
  alreadyHeld: boolean;
}> {
  const profile = await requireHoldManager(actorUserId);
  const reason = raw.reason?.trim();
  if (!reason || reason.length < 3) {
    throw new AuthError("A reason is required to apply a stock hold", "VALIDATION", 400);
  }

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Order" WHERE id = ${raw.orderId} FOR UPDATE
    `;
    if (!locked[0]) throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);

    const order = await tx.order.findUniqueOrThrow({
      where: { id: raw.orderId },
      include: {
        items: { select: { backorderQtyAtOrder: true } },
        invoices: { select: { id: true }, take: 1 },
        fulfilmentEvents: { select: { kind: true } },
        reservations: { where: { status: "CONSUMED" }, select: { id: true }, take: 1 },
      },
    });

    if (!grants(profile, "admin.access", "sales.view_all_accounts")) {
      const accessible = await getAccessibleCompanyIdsForSales(profile);
      if (accessible !== "all" && !accessible.includes(order.companyId)) {
        throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
      }
    }

    if (
      order.stockReleasePolicy === "HOLD_UNTIL_COMPLETE" &&
      order.stockHoldState === "WAITING_STOCK"
    ) {
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        stockHoldState: order.stockHoldState,
        stockReleasePolicy: order.stockReleasePolicy,
        alreadyHeld: true,
      };
    }

    if (
      isVerifiedStockHoldRelease(order.stockHoldState, order.stockReleasePolicy, {
        stockReleasedAt: order.stockReleasedAt,
        stockReleaseReason: order.stockReleaseReason,
      })
    ) {
      throw new AuthError(
        "This order was released by a verified stock check. Applying a new hold is a separate edit, not this remediation.",
        "ORDER_LOCKED",
        409,
      );
    }

    if (await orderHasAutopartExportRecord(tx, order)) {
      throw new AuthError(
        "This order already has an Autopart export record and cannot be held.",
        "ORDER_LOCKED",
        409,
      );
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
      throw new AuthError(eligibility.reason ?? "This order can no longer be held.", "ORDER_LOCKED", 409);
    }

    const outstanding = order.items.reduce((sum, item) => sum + (item.backorderQtyAtOrder ?? 0), 0);
    if (outstanding <= 0) {
      throw new AuthError(
        "Hold until complete needs confirmed outstanding quantities on this order.",
        "HOLD_REQUIRES_BACKORDER",
        400,
      );
    }

    const now = new Date();
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        stockReleasePolicy: "HOLD_UNTIL_COMPLETE",
        stockHoldState: "WAITING_STOCK",
        stockHeldAt: now,
        stockHeldByUserId: actorUserId,
        stockReleasedAt: null,
        stockReleaseReason: null,
        stockHoldCancelledAt: null,
        stockHoldCancelReason: null,
        stockHoldCancelledByUserId: null,
        stockHoldLastCheckedAt: null,
        stockHoldLastCheckResult: Prisma.JsonNull,
      },
      select: { id: true, orderNumber: true, stockHoldState: true, stockReleasePolicy: true },
    });

    await recordFulfilmentEvent(tx, {
      orderId: order.id,
      kind: "NOTE",
      summary: "HELD — AWAITING STOCK until every line can be fulfilled",
      source: "MANUAL",
      lineQuantitiesKnown: true,
      metadata: {
        stockHold: true,
        remediation: true,
        reason,
        outstandingBackorderUnits: outstanding,
      },
    });

    await recordAuditEventInTransaction(tx, {
      action: "order.stock_hold.remediation_applied",
      entityType: "Order",
      entityId: order.id,
      actorUserId,
      companyId: order.companyId,
      before: {
        stockHoldState: order.stockHoldState,
        stockReleasePolicy: order.stockReleasePolicy,
      },
      after: {
        orderNumber: order.orderNumber,
        stockHoldState: "WAITING_STOCK",
        stockReleasePolicy: "HOLD_UNTIL_COMPLETE",
        reason,
        outstandingBackorderUnits: outstanding,
        linesUnchanged: true,
        reservationsUnchanged: true,
      },
    });

    return {
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      stockHoldState: updated.stockHoldState,
      stockReleasePolicy: updated.stockReleasePolicy,
      alreadyHeld: false,
    };
  });
}

export type StockHoldExportDiagnostic = {
  matched: number;
  ambiguousPo: boolean;
  orders: Array<{
    orderId: string;
    orderNumber: string;
    companyName: string;
    poNumber: string | null;
    status: string;
    stockReleasePolicy: string;
    stockHoldState: string;
    stockHoldLabel: string | null;
    stockHeldAt: string | null;
    stockReleasedAt: string | null;
    stockReleaseReason: string | null;
    autopartExportStatus: string;
    autopartExportCount: number;
    autopartExportedAt: string | null;
    autopartExportBatchId: string | null;
    outstandingBackorderUnits: number;
    exportEligible: boolean;
    exportBlockReason: string | null;
    exportBlockMessage: string | null;
    exportRecords: Array<{
      id: string;
      reference: string;
      filename: string;
      createdAt: string;
      isReexport: boolean;
    }>;
    holdPersisted: boolean;
    /** Backordered and still exportable because no active hold is stored. */
    holdNotPersisted: boolean;
  }>;
};

/**
 * Read-only. Looks up by order id, order number, or customer PO.
 * PO values are not unique — every match is returned and nothing is updated.
 */
export async function diagnoseStockHoldExport(
  actorUserId: string,
  raw: { orderId?: string; orderNumber?: string; poNumber?: string },
): Promise<StockHoldExportDiagnostic> {
  const profile = await requireHoldManager(actorUserId);
  const orderId = raw.orderId?.trim() || "";
  const orderNumber = raw.orderNumber?.trim() || "";
  const poNumber = raw.poNumber?.trim() || "";
  if (!orderId && !orderNumber && !poNumber) {
    throw new AuthError("Provide an order id, order number, or PO reference", "VALIDATION", 400);
  }

  const accessible = await getAccessibleCompanyIdsForSales(profile);
  const companyFilter = accessible === "all" ? {} : { companyId: { in: accessible } };
  const orders = await prisma.order.findMany({
    where: {
      ...companyFilter,
      ...(orderId
        ? { id: orderId }
        : orderNumber
          ? { orderNumber }
          : { poNumber }),
    },
    include: {
      items: { select: { backorderQtyAtOrder: true } },
      company: { select: { name: true } },
    },
    orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
    take: 25,
  });

  const { previewAutopartOrderExport } = await import("@/server/orders/autopart-export");
  const preview =
    orders.length > 0
      ? await previewAutopartOrderExport(
          actorUserId,
          orders.map((order) => order.id),
        )
      : null;
  const eligibilityById = new Map(preview?.items.map((item) => [item.orderId, item]) ?? []);

  const rows = [];
  for (const order of orders) {
    const batches = await prisma.autopartOrderExportBatch.findMany({
      where: {
        OR: [
          ...(order.autopartExportBatchId ? [{ id: order.autopartExportBatchId }] : []),
          { orderIds: { array_contains: order.id } },
        ],
      },
      select: {
        id: true,
        reference: true,
        filename: true,
        createdAt: true,
        isReexport: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const eligibility = eligibilityById.get(order.id);
    const outstanding = order.items.reduce((sum, item) => sum + (item.backorderQtyAtOrder ?? 0), 0);
    const holdPersisted =
      order.stockReleasePolicy === "HOLD_UNTIL_COMPLETE" && order.stockHoldState === "WAITING_STOCK";
    const exportEligible = Boolean(eligibility?.eligible);
    rows.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      companyName: order.company.name,
      poNumber: order.poNumber,
      status: order.status,
      stockReleasePolicy: order.stockReleasePolicy,
      stockHoldState: order.stockHoldState,
      stockHoldLabel: staffStockHoldLabel(order.stockHoldState),
      stockHeldAt: order.stockHeldAt?.toISOString() ?? null,
      stockReleasedAt: order.stockReleasedAt?.toISOString() ?? null,
      stockReleaseReason: order.stockReleaseReason,
      autopartExportStatus: order.autopartExportStatus,
      autopartExportCount: order.autopartExportCount,
      autopartExportedAt: order.autopartExportedAt?.toISOString() ?? null,
      autopartExportBatchId: order.autopartExportBatchId,
      outstandingBackorderUnits: outstanding,
      exportEligible,
      exportBlockReason: eligibility?.reason ?? null,
      exportBlockMessage: eligibility?.message ?? null,
      exportRecords: batches.map((batch) => ({
        id: batch.id,
        reference: batch.reference,
        filename: batch.filename,
        createdAt: batch.createdAt.toISOString(),
        isReexport: batch.isReexport,
      })),
      holdPersisted,
      holdNotPersisted: outstanding > 0 && !holdPersisted && exportEligible,
    });
  }

  return {
    matched: rows.length,
    ambiguousPo: !orderId && !orderNumber && rows.length > 1,
    orders: rows,
  };
}

export { blocksAutopartExportForStockHold, isActiveStockHold, staffStockHoldLabel };
