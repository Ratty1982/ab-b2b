/**
 * Automotive Brands stock reservations at order creation.
 *
 * Basket / checkout preview does NOT reserve. Only placeOrder (inside the
 * order transaction) calls reserveStockForOrder.
 *
 * qtyOnHand = latest Autopart Avail (unchanged by reservation).
 * qtyReserved = sum of ACTIVE AB OrderStockReservation quantities.
 * effective sellable = max(0, qtyOnHand - qtyReserved).
 *
 * Phase 6C will reconcile RELEASED / CONSUMED against Autopart handoff.
 */

import type { Prisma } from "@prisma/client";
import { AUTOPART_WAREHOUSE_CODE, getEffectiveSellableQuantity } from "@/domain/stock";
import { AuthError } from "@/server/rbac/guards";

export type ReserveStockLine = {
  orderItemId: string;
  variantId: string;
  quantity: number;
};

/**
 * Lock AUTOPART inventory rows and hold stock for a newly created order.
 * Must run inside the same interactive transaction as order+item create,
 * before basket conversion.
 */
export async function reserveStockForOrder(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    lines: ReserveStockLine[];
  },
): Promise<void> {
  if (!input.lines.length) {
    throw new AuthError("Order has no lines to reserve", "RESERVE_EMPTY", 400);
  }

  const warehouse = await tx.warehouse.findUnique({
    where: { code: AUTOPART_WAREHOUSE_CODE },
    select: { id: true },
  });
  if (!warehouse) {
    throw new AuthError(
      "Autopart warehouse is not configured",
      "WAREHOUSE_MISSING",
      500,
    );
  }

  // Stable lock order avoids deadlocks when concurrent placeOrders share variants.
  const lines = [...input.lines].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  );

  for (const line of lines) {
    const qty = Math.trunc(line.quantity);
    if (!Number.isFinite(qty) || qty < 1) {
      throw new AuthError("Invalid reservation quantity", "RESERVE_QTY_INVALID", 400);
    }
    if (!line.variantId) {
      throw new AuthError("Variant required for stock reservation", "RESERVE_VARIANT", 400);
    }

    const inventory = await tx.inventory.findUnique({
      where: {
        variantId_warehouseId: {
          variantId: line.variantId,
          warehouseId: warehouse.id,
        },
      },
      select: { id: true },
    });
    if (!inventory) {
      throw new AuthError(
        "Insufficient stock for one or more lines",
        "INSUFFICIENT_STOCK",
        409,
      );
    }

    const locked = await tx.$queryRaw<
      Array<{ id: string; qtyOnHand: number; qtyReserved: number }>
    >`
      SELECT id, "qtyOnHand", "qtyReserved"
      FROM "Inventory"
      WHERE id = ${inventory.id}
      FOR UPDATE
    `;
    const row = locked[0];
    if (!row) {
      throw new AuthError(
        "Insufficient stock for one or more lines",
        "INSUFFICIENT_STOCK",
        409,
      );
    }

    const effective = getEffectiveSellableQuantity({
      autopartAvail: row.qtyOnHand,
      reservedQty: row.qtyReserved,
    });
    if (qty > effective) {
      throw new AuthError(
        "Insufficient stock for one or more lines",
        "INSUFFICIENT_STOCK",
        409,
      );
    }

    await tx.inventory.update({
      where: { id: row.id },
      data: { qtyReserved: row.qtyReserved + qty },
    });

    await tx.orderStockReservation.create({
      data: {
        orderId: input.orderId,
        orderItemId: line.orderItemId,
        variantId: line.variantId,
        inventoryId: row.id,
        quantity: qty,
        status: "ACTIVE",
      },
    });
  }
}

/**
 * Release ACTIVE AB stock holds for an order (cancel / admin delete).
 * Decrements Inventory.qtyReserved so effective sellable rises.
 * Does NOT change qtyOnHand — Autopart Avail remains authoritative physical stock.
 * Idempotent when no ACTIVE rows remain.
 */
export async function releaseStockForOrder(
  tx: Prisma.TransactionClient,
  input: { orderId: string },
): Promise<{ releasedQuantity: number; reservationCount: number }> {
  const active = await tx.orderStockReservation.findMany({
    where: { orderId: input.orderId, status: "ACTIVE" },
    orderBy: { inventoryId: "asc" },
  });

  let releasedQuantity = 0;
  const now = new Date();

  for (const res of active) {
    await tx.orderStockReservation.update({
      where: { id: res.id },
      data: { status: "RELEASED", releasedAt: now },
    });
    await tx.inventory.update({
      where: { id: res.inventoryId },
      data: { qtyReserved: { decrement: res.quantity } },
    });
    releasedQuantity += res.quantity;
  }

  return { releasedQuantity, reservationCount: active.length };
}
