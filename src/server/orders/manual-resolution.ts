/**
 * Staff resolution for old B2B orders whose Autopart invoice evidence is missing.
 * Does not create invoices, send despatch email, or change qtyOnHand.
 */

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import {
  assessAdministrativeClose,
  assessManualFulfilment,
  manualFulfilmentFingerprint,
  planReservationConsumption,
  type InvoiceEvidenceChoice,
} from "@/domain/manual-order-resolution";
import { applyAuthoritativeLineDespatch, recordFulfilmentEvent } from "@/server/orders/fulfilment";
import { recordAuditEventInTransaction } from "@/server/audit/record";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";
import { grants } from "@/server/rbac/access";
import { getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";

const evidenceSchema = z.enum(["OUTSTANDING", "UNAVAILABLE"]);

const fulfilSchema = z.object({
  orderId: z.string().cuid(),
  reason: z.string().trim().min(8).max(2000),
  invoiceEvidence: evidenceSchema,
  lines: z
    .array(
      z.object({
        orderItemId: z.string().cuid(),
        despatchedQty: z.number().int().min(0).max(100000),
      }),
    )
    .min(1)
    .max(500),
});

const closeSchema = z.object({
  orderId: z.string().cuid(),
  reason: z.string().trim().min(8).max(2000),
  invoiceEvidence: evidenceSchema,
});

const evidenceNote: Record<InvoiceEvidenceChoice, string> = {
  OUTSTANDING: "Invoice evidence is outstanding.",
  UNAVAILABLE: "Invoice evidence is unavailable.",
};

async function loadEditableOrder(actorUserId: string, orderId: string) {
  const profile = await requireAuthenticatedUser(actorUserId);
  if (!grants(profile, "orders.edit", "admin.access")) {
    throw new AuthError("You do not have permission to resolve orders", "FORBIDDEN", 403);
  }
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { select: { id: true, sku: true, qty: true, despatchedQty: true, variantId: true } },
      manualResolvedBy: { select: { name: true, email: true } },
    },
  });
  if (!order || order.archivedAt) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }
  if (!grants(profile, "admin.access", "sales.view_all_accounts")) {
    const accessible = await getAccessibleCompanyIdsForSales(profile);
    if (accessible !== "all" && !accessible.includes(order.companyId)) {
      throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
    }
  }
  return order;
}

const RESERVED_STOCK_MISMATCH =
  "Reserved stock does not match the active hold. The order was not changed.";

const OVER_CONSUMPTION =
  "Reservation consumption exceeded the despatched quantity. The order was not changed.";

async function lockInventoriesInOrder(tx: Prisma.TransactionClient, inventoryIds: Iterable<string>) {
  for (const inventoryId of [...new Set(inventoryIds)].sort()) {
    await tx.$queryRaw`SELECT id FROM "Inventory" WHERE id = ${inventoryId} FOR UPDATE`;
  }
}

/**
 * Remove `quantity` from the reserved balance.
 * qtyReserved must equal the active holds on that stock row and cover `quantity`.
 * A mismatch throws, and the surrounding transaction rolls back.
 */
async function decrementReservedStock(tx: Prisma.TransactionClient, inventoryId: string, quantity: number) {
  if (quantity <= 0) return 0;
  const locked = await tx.$queryRaw<Array<{ qtyReserved: number }>>`
    SELECT "qtyReserved" FROM "Inventory" WHERE id = ${inventoryId} FOR UPDATE
  `;
  const stock = locked[0];
  if (!stock) {
    throw new AuthError(RESERVED_STOCK_MISMATCH, "RESERVED_STOCK_MISMATCH", 409);
  }
  await tx.$queryRaw`
    SELECT id FROM "OrderStockReservation"
    WHERE "inventoryId" = ${inventoryId}
      AND status = CAST('ACTIVE' AS "StockReservationStatus")
    ORDER BY id
    FOR UPDATE
  `;
  const active = await tx.orderStockReservation.aggregate({
    where: { inventoryId, status: "ACTIVE" },
    _sum: { quantity: true },
  });
  const activeQuantity = active._sum.quantity ?? 0;
  const qtyReserved = Number(stock.qtyReserved);
  if (qtyReserved !== activeQuantity || qtyReserved < quantity) {
    throw new AuthError(RESERVED_STOCK_MISMATCH, "RESERVED_STOCK_MISMATCH", 409);
  }
  const updated = await tx.inventory.updateMany({
    where: { id: inventoryId, qtyReserved: { gte: quantity } },
    data: { qtyReserved: { decrement: quantity } },
  });
  if (updated.count !== 1) {
    throw new AuthError(RESERVED_STOCK_MISMATCH, "RESERVED_STOCK_MISMATCH", 409);
  }
  return quantity;
}

async function lockActiveOrderReservations(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$queryRaw`
    SELECT id FROM "OrderStockReservation"
    WHERE "orderId" = ${orderId}
      AND status = CAST('ACTIVE' AS "StockReservationStatus")
    ORDER BY id
    FOR UPDATE
  `;
}

async function consumeReservationsForDespatch(
  tx: Prisma.TransactionClient,
  orderId: string,
  deltas: Array<{ orderItemId: string; variantId: string | null; quantity: number }>,
) {
  const increaseTotal = deltas.reduce((sum, delta) => sum + Math.max(0, delta.quantity), 0);
  const preview = await tx.orderStockReservation.findMany({
    where: { orderId, status: "ACTIVE" },
    select: { inventoryId: true },
  });
  await lockInventoriesInOrder(
    tx,
    preview.map((row) => row.inventoryId),
  );
  await lockActiveOrderReservations(tx, orderId);
  const reservations = await tx.orderStockReservation.findMany({
    where: { orderId, status: "ACTIVE" },
    orderBy: { id: "asc" },
    select: { id: true, orderItemId: true, variantId: true, inventoryId: true, quantity: true },
  });
  const taken = planReservationConsumption(reservations, deltas);
  let units = 0;
  const now = new Date();
  for (const reservation of reservations) {
    const take = taken.get(reservation.id) ?? 0;
    if (take <= 0) continue;
    units += take;
    await decrementReservedStock(tx, reservation.inventoryId, take);
    if (take >= reservation.quantity) {
      await tx.orderStockReservation.update({
        where: { id: reservation.id },
        data: { status: "CONSUMED", consumedAt: now },
      });
    } else {
      await tx.orderStockReservation.update({
        where: { id: reservation.id },
        data: { quantity: reservation.quantity - take },
      });
      await tx.orderStockReservation.create({
        data: {
          orderId,
          orderItemId: reservation.orderItemId,
          variantId: reservation.variantId,
          inventoryId: reservation.inventoryId,
          quantity: take,
          status: "CONSUMED",
          consumedAt: now,
        },
      });
    }
  }
  if (units > increaseTotal) {
    throw new AuthError(OVER_CONSUMPTION, "RESERVATION_OVER_CONSUMPTION", 409);
  }
  return units;
}

async function releaseActiveReservations(tx: Prisma.TransactionClient, orderId: string) {
  const preview = await tx.orderStockReservation.findMany({
    where: { orderId, status: "ACTIVE" },
    select: { inventoryId: true },
  });
  await lockInventoriesInOrder(
    tx,
    preview.map((row) => row.inventoryId),
  );
  await lockActiveOrderReservations(tx, orderId);
  const reservations = await tx.orderStockReservation.findMany({
    where: { orderId, status: "ACTIVE" },
    orderBy: { id: "asc" },
    select: { id: true, inventoryId: true, quantity: true },
  });
  for (const reservation of reservations) {
    await decrementReservedStock(tx, reservation.inventoryId, reservation.quantity);
    await tx.orderStockReservation.update({
      where: { id: reservation.id },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
  }
  return reservations.length;
}

function present(order: {
  id: string;
  orderNumber: string;
  status: string;
  manualResolutionKind: string;
  manualResolutionReason: string | null;
  manualResolvedAt: Date | null;
  invoiceEvidence: string;
  manualResolvedBy: { name: string | null; email: string } | null;
  items: Array<{ id: string; sku: string; qty: number; despatchedQty: number }>;
}) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    manualResolutionKind: order.manualResolutionKind,
    manualResolutionReason: order.manualResolutionReason,
    manualResolvedAt: order.manualResolvedAt?.toISOString() ?? null,
    manualResolvedByName: order.manualResolvedBy?.name ?? order.manualResolvedBy?.email ?? null,
    invoiceEvidence: order.invoiceEvidence,
    lines: order.items.map((item) => ({
      orderItemId: item.id,
      sku: item.sku,
      orderedQty: item.qty,
      despatchedQty: item.despatchedQty,
      outstandingQty: Math.max(0, item.qty - item.despatchedQty),
    })),
  };
}

async function lockOrderForResolution(tx: Prisma.TransactionClient, orderId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE
  `;
  if (locked.length !== 1) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }
  await tx.$queryRaw`
    SELECT id FROM "OrderItem" WHERE "orderId" = ${orderId} ORDER BY id FOR UPDATE
  `;
}

export async function fulfilOrderManually(actorUserId: string, raw: unknown) {
  const input = fulfilSchema.parse(raw);
  const order = await loadEditableOrder(actorUserId, input.orderId);
  const preliminary = assessManualFulfilment({
    status: order.status,
    resolutionKind: order.manualResolutionKind,
    storedFingerprint: order.manualResolutionFingerprint,
    lines: order.items.map((item) => ({
      orderItemId: item.id,
      qty: item.qty,
      despatchedQty: item.despatchedQty,
    })),
    requested: input.lines,
  });
  if (!preliminary.ok) throw new AuthError(preliminary.message, "VALIDATION", 400);
  if (preliminary.idempotent) return { ...present(order), idempotent: true as const };

  const fingerprint = manualFulfilmentFingerprint(input.lines);
  const updated = await prisma.$transaction(async (tx) => {
    await lockOrderForResolution(tx, order.id);
    const fresh = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        items: { select: { id: true, sku: true, qty: true, despatchedQty: true, variantId: true } },
        manualResolvedBy: { select: { name: true, email: true } },
      },
    });
    if (fresh.archivedAt) throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
    const decision = assessManualFulfilment({
      status: fresh.status,
      resolutionKind: fresh.manualResolutionKind,
      storedFingerprint: fresh.manualResolutionFingerprint,
      lines: fresh.items.map((item) => ({
        orderItemId: item.id,
        qty: item.qty,
        despatchedQty: item.despatchedQty,
      })),
      requested: input.lines,
    });
    if (!decision.ok) throw new AuthError(decision.message, "VALIDATION", 400);
    if (decision.idempotent) return { idempotent: true as const, row: fresh };

    const summary = decision.fullyComplete
      ? `Marked fulfilled manually. ${evidenceNote[input.invoiceEvidence]} ${input.reason}`
      : `Marked partially fulfilled manually. ${evidenceNote[input.invoiceEvidence]} ${input.reason}`;
    const applied = await applyAuthoritativeLineDespatch(tx, {
      orderId: order.id,
      lines: input.lines,
      source: "MANUAL",
      summary,
      limitation: evidenceNote[input.invoiceEvidence],
      metadata: {
        actorUserId,
        reason: input.reason,
        invoiceEvidence: input.invoiceEvidence,
        manual: true,
      },
    });
    const variantByItem = new Map(fresh.items.map((item) => [item.id, item.variantId]));
    const deltas = applied.increases.map((increase) => ({
      orderItemId: increase.orderItemId,
      variantId: variantByItem.get(increase.orderItemId) ?? null,
      quantity: increase.quantity,
    }));
    const reservationsConsumed = await consumeReservationsForDespatch(tx, order.id, deltas);
    const row = await tx.order.update({
      where: { id: order.id },
      data: {
        manualResolutionKind: "FULFILLED_MANUALLY",
        manualResolutionReason: input.reason,
        manualResolvedAt: new Date(),
        manualResolvedByUserId: actorUserId,
        manualResolutionFingerprint: fingerprint,
        invoiceEvidence: input.invoiceEvidence,
      },
      include: {
        items: { select: { id: true, sku: true, qty: true, despatchedQty: true } },
        manualResolvedBy: { select: { name: true, email: true } },
      },
    });
    await recordAuditEventInTransaction(tx, {
      action: decision.fullyComplete ? "order.fulfilled_manually" : "order.partially_fulfilled_manually",
      entityType: "Order",
      entityId: order.id,
      actorUserId,
      companyId: order.companyId,
      before: { status: fresh.status, manualResolutionKind: fresh.manualResolutionKind },
      after: {
        status: row.status,
        manualResolutionKind: "FULFILLED_MANUALLY",
        invoiceEvidence: input.invoiceEvidence,
        reason: input.reason,
        reservationsConsumed,
        lines: input.lines,
      },
    });
    return { idempotent: false as const, row };
  }, { timeout: 15_000 });

  return { ...present(updated.row), idempotent: updated.idempotent };
}

export async function closeOrderAdministratively(actorUserId: string, raw: unknown) {
  const input = closeSchema.parse(raw);
  const order = await loadEditableOrder(actorUserId, input.orderId);
  const decision = assessAdministrativeClose({
    status: order.status,
    resolutionKind: order.manualResolutionKind,
  });
  if (!decision.ok) throw new AuthError(decision.message, "VALIDATION", 400);
  if (decision.idempotent) return { ...present(order), idempotent: true as const };

  const updated = await prisma.$transaction(async (tx) => {
    await lockOrderForResolution(tx, order.id);
    const fresh = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        items: { select: { id: true, sku: true, qty: true, despatchedQty: true } },
        manualResolvedBy: { select: { name: true, email: true } },
      },
    });
    if (fresh.archivedAt) throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
    const locked = assessAdministrativeClose({
      status: fresh.status,
      resolutionKind: fresh.manualResolutionKind,
    });
    if (!locked.ok) throw new AuthError(locked.message, "VALIDATION", 400);
    if (locked.idempotent) return { idempotent: true as const, row: fresh };

    const reservationsReleased = await releaseActiveReservations(tx, order.id);
    await recordFulfilmentEvent(tx, {
      orderId: order.id,
      kind: "ADMINISTRATIVELY_CLOSED",
      summary: `Closed administratively. Goods were not recorded as despatched. ${input.reason}`,
      source: "MANUAL",
      lineQuantitiesKnown: false,
      limitation: evidenceNote[input.invoiceEvidence],
      metadata: {
        actorUserId,
        reason: input.reason,
        invoiceEvidence: input.invoiceEvidence,
        despatchedQuantitiesUnchanged: true,
      },
    });
    const row = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "ADMINISTRATIVELY_CLOSED",
        manualResolutionKind: "CLOSED_ADMINISTRATIVELY",
        manualResolutionReason: input.reason,
        manualResolvedAt: new Date(),
        manualResolvedByUserId: actorUserId,
        invoiceEvidence: input.invoiceEvidence,
      },
      include: {
        items: { select: { id: true, sku: true, qty: true, despatchedQty: true } },
        manualResolvedBy: { select: { name: true, email: true } },
      },
    });
    await recordAuditEventInTransaction(tx, {
      action: "order.closed_administratively",
      entityType: "Order",
      entityId: order.id,
      actorUserId,
      companyId: order.companyId,
      before: { status: fresh.status, despatched: fresh.items.map((item) => item.despatchedQty) },
      after: {
        status: "ADMINISTRATIVELY_CLOSED",
        reason: input.reason,
        invoiceEvidence: input.invoiceEvidence,
        reservationsReleased,
        despatchUnchanged: true,
      },
    });
    return { idempotent: false as const, row };
  }, { timeout: 15_000 });

  return { ...present(updated.row), idempotent: updated.idempotent };
}
