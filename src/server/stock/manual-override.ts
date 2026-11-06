/**
 * Authorised manual stock quantity overrides.
 * Autopart Avail (qtyOnHand) continues to update from feeds; overrides are never
 * silently cleared by polling.
 */

import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAnySystemPermission } from "@/server/rbac/guards";
import {
  AUTOPART_FEED_SOURCE,
  getEffectiveSellableQuantity,
  internalStatusFromSellable,
} from "@/domain/stock";
import { ensureAutopartWarehouse } from "@/server/stock/service";
import type { StockStatus } from "@prisma/client";

const setSchema = z.object({
  variantId: z.string().cuid(),
  quantity: z.number().int().min(0).max(1_000_000),
  reason: z.string().trim().min(3).max(500),
});

const clearSchema = z.object({
  variantId: z.string().cuid(),
  reason: z.string().trim().min(3).max(500),
});

async function requireManualStockActor(actorUserId: string) {
  const profile = await requireAnySystemPermission(actorUserId, [
    "purchasing.stock.manage",
    "products.edit",
    "admin.access",
  ]);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot set manual stock overrides", "FORBIDDEN", 403);
  }
  return profile;
}

export async function setManualStockOverride(actorUserId: string, raw: unknown) {
  await requireManualStockActor(actorUserId);
  const input = setSchema.parse(raw);
  const variant = await prisma.productVariant.findUnique({
    where: { id: input.variantId },
    select: { id: true, sku: true, productId: true },
  });
  if (!variant) throw new AuthError("Variant not found", "NOT_FOUND", 404);
  const warehouse = await ensureAutopartWarehouse();
  const existing = await prisma.inventory.findUnique({
    where: {
      variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id },
    },
  });
  const status = internalStatusFromSellable(
    getEffectiveSellableQuantity({
      autopartAvail: existing?.qtyOnHand ?? 0,
      reservedQty: existing?.qtyReserved ?? 0,
      manualOverrideQty: input.quantity,
    }),
  ) as StockStatus;

  const row = existing
    ? await prisma.inventory.update({
        where: { id: existing.id },
        data: {
          manualOverrideQty: input.quantity,
          manualOverrideReason: input.reason,
          manualOverrideAt: new Date(),
          manualOverrideByUserId: actorUserId,
          status,
        },
      })
    : await prisma.inventory.create({
        data: {
          variantId: variant.id,
          warehouseId: warehouse.id,
          qtyOnHand: 0,
          qtyReserved: 0,
          status,
          manualOverrideQty: input.quantity,
          manualOverrideReason: input.reason,
          manualOverrideAt: new Date(),
          manualOverrideByUserId: actorUserId,
          sourceAvailRaw: null,
        },
      });

  await recordAuditEvent({
    action: "stock.manual_override.set",
    entityType: "Inventory",
    entityId: row.id,
    actorUserId,
    metadata: {
      variantId: variant.id,
      sku: variant.sku,
      quantity: input.quantity,
      reason: input.reason,
      previousManualQty: existing?.manualOverrideQty ?? null,
      autopartAvail: row.qtyOnHand,
      source: AUTOPART_FEED_SOURCE,
    },
    before: { manualOverrideQty: existing?.manualOverrideQty ?? null },
    after: { manualOverrideQty: input.quantity },
  });

  return {
    variantId: variant.id,
    sku: variant.sku,
    manualOverrideQty: row.manualOverrideQty,
    autopartAvailQty: row.qtyOnHand,
    reservedQty: row.qtyReserved,
    sellableQty: getEffectiveSellableQuantity({
      autopartAvail: row.qtyOnHand,
      reservedQty: row.qtyReserved,
      manualOverrideQty: row.manualOverrideQty,
    }),
    reason: row.manualOverrideReason,
    updatedAt: row.manualOverrideAt?.toISOString() ?? null,
    updatedByUserId: row.manualOverrideByUserId,
  };
}

export async function clearManualStockOverride(actorUserId: string, raw: unknown) {
  await requireManualStockActor(actorUserId);
  const input = clearSchema.parse(raw);
  const warehouse = await ensureAutopartWarehouse();
  const existing = await prisma.inventory.findUnique({
    where: {
      variantId_warehouseId: { variantId: input.variantId, warehouseId: warehouse.id },
    },
    include: { variant: { select: { sku: true } } },
  });
  if (!existing) throw new AuthError("No inventory row for this variant", "NOT_FOUND", 404);
  if (existing.manualOverrideQty == null) {
    return {
      variantId: existing.variantId,
      sku: existing.variant.sku,
      cleared: false,
      message: "No manual override was set",
    };
  }

  const status = internalStatusFromSellable(
    getEffectiveSellableQuantity({
      autopartAvail: existing.qtyOnHand,
      reservedQty: existing.qtyReserved,
      manualOverrideQty: null,
    }),
  ) as StockStatus;

  const row = await prisma.inventory.update({
    where: { id: existing.id },
    data: {
      manualOverrideQty: null,
      manualOverrideReason: input.reason,
      manualOverrideAt: new Date(),
      manualOverrideByUserId: actorUserId,
      status,
    },
  });

  await recordAuditEvent({
    action: "stock.manual_override.cleared",
    entityType: "Inventory",
    entityId: row.id,
    actorUserId,
    metadata: {
      variantId: row.variantId,
      sku: existing.variant.sku,
      previousManualQty: existing.manualOverrideQty,
      reason: input.reason,
      autopartAvail: row.qtyOnHand,
    },
    before: { manualOverrideQty: existing.manualOverrideQty },
    after: { manualOverrideQty: null },
  });

  return {
    variantId: row.variantId,
    sku: existing.variant.sku,
    cleared: true,
    autopartAvailQty: row.qtyOnHand,
    reservedQty: row.qtyReserved,
    sellableQty: getEffectiveSellableQuantity({
      autopartAvail: row.qtyOnHand,
      reservedQty: row.qtyReserved,
      manualOverrideQty: null,
    }),
  };
}
