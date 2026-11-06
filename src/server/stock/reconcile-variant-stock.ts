/**
 * When a catalogue ProductVariant is created or its SKU changes, initialise
 * Inventory from a trusted AutopartProduct master observation when available.
 *
 * Idempotent. Never invents quantities. Never publishes products.
 * Does not rewrite ACTIVE reservations or create fake stock movements.
 */

import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import {
  AUTOPART_FEED_SOURCE,
  DEFAULT_STALE_HOURS,
  getEffectiveSellableQuantity,
  internalStatusFromSellable,
  sellableQuantityFromAvail,
  skuMatchKey,
} from "@/domain/stock";
import { isTrustedAutopartMasterForReconcile } from "@/domain/stock-confirmation";
import { ensureAutopartWarehouse } from "@/server/stock/service";
import type { StockStatus } from "@prisma/client";

export type VariantStockReconcileResult =
  | {
      status: "linked_and_confirmed";
      autopartProductId: string;
      availQty: number;
      inventoryCreated: boolean;
      inventoryUpdated: boolean;
    }
  | {
      status: "linked_only";
      autopartProductId: string;
      reason: string;
    }
  | {
      status: "no_master";
      reason: string;
    }
  | {
      status: "ambiguous_or_conflict";
      reason: string;
    }
  | {
      status: "skipped";
      reason: string;
    };

export async function reconcileVariantStockFromAutopartMaster(input: {
  variantId: string;
  sku: string;
  actorUserId?: string | null;
  now?: Date;
  staleHours?: number;
}): Promise<VariantStockReconcileResult> {
  const sku = input.sku.trim();
  if (!sku) return { status: "skipped", reason: "Empty SKU" };
  const key = skuMatchKey(sku);
  const now = input.now ?? new Date();
  const staleHours = input.staleHours ?? DEFAULT_STALE_HOURS;

  const masters = await prisma.autopartProduct.findMany({
    where: { matchKey: key },
    take: 2,
  });
  if (masters.length === 0) {
    return { status: "no_master", reason: "No AutopartProduct master for this SKU" };
  }
  if (masters.length > 1) {
    return {
      status: "ambiguous_or_conflict",
      reason: "Multiple AutopartProduct rows share this match key",
    };
  }
  const master = masters[0]!;

  if (master.catalogueVariantId && master.catalogueVariantId !== input.variantId) {
    return {
      status: "ambiguous_or_conflict",
      reason: "Autopart master is already linked to a different catalogue variant",
    };
  }

  const otherLink = await prisma.autopartProduct.findFirst({
    where: { catalogueVariantId: input.variantId, NOT: { id: master.id } },
    select: { id: true },
  });
  if (otherLink) {
    return {
      status: "ambiguous_or_conflict",
      reason: "Catalogue variant is already linked to another Autopart product",
    };
  }

  if (!master.catalogueVariantId) {
    await prisma.autopartProduct.update({
      where: { id: master.id },
      data: { catalogueVariantId: input.variantId },
    });
  }

  const trusted = isTrustedAutopartMasterForReconcile({
    presentInLatestFeed: master.presentInLatestFeed,
    lastSeenAt: master.lastSeenAt,
    now,
    staleHours,
  });
  if (!trusted) {
    await recordAuditEvent({
      action: "stock.variant_reconcile.deferred",
      entityType: "ProductVariant",
      entityId: input.variantId,
      actorUserId: input.actorUserId ?? null,
      metadata: {
        sku,
        autopartProductId: master.id,
        reason: "Autopart master is stale or absent from the latest feed",
        presentInLatestFeed: master.presentInLatestFeed,
        lastSeenAt: master.lastSeenAt?.toISOString() ?? null,
        availQty: master.availQty,
      },
    });
    return {
      status: "linked_only",
      autopartProductId: master.id,
      reason: "Master linked; stock left unconfirmed because source is not current",
    };
  }

  const warehouse = await ensureAutopartWarehouse();
  const sellable = sellableQuantityFromAvail(master.availQty);
  const status = internalStatusFromSellable(sellable) as StockStatus;
  const existing = await prisma.inventory.findUnique({
    where: {
      variantId_warehouseId: { variantId: input.variantId, warehouseId: warehouse.id },
    },
  });

  // Do not overwrite an existing confirmed inventory / manual override with older master data.
  if (existing) {
    if (existing.manualOverrideQty != null) {
      return {
        status: "linked_only",
        autopartProductId: master.id,
        reason: "Inventory already has a manual override; left unchanged",
      };
    }
    await recordAuditEvent({
      action: "stock.variant_reconcile.skipped_existing",
      entityType: "ProductVariant",
      entityId: input.variantId,
      actorUserId: input.actorUserId ?? null,
      metadata: {
        sku,
        autopartProductId: master.id,
        existingQtyOnHand: existing.qtyOnHand,
        masterAvailQty: master.availQty,
      },
    });
    return {
      status: "linked_only",
      autopartProductId: master.id,
      reason: "Inventory row already exists; existing confirmed quantity preserved",
    };
  }

  await prisma.inventory.create({
    data: {
      variantId: input.variantId,
      warehouseId: warehouse.id,
      qtyOnHand: sellable,
      qtyReserved: 0,
      status,
      externalSyncedAt: master.lastSeenAt ?? master.sourceUpdatedAt ?? now,
      sourceAvailRaw: master.sourceAvailRaw ?? String(master.availQty),
      incomingQty: master.incomingQty,
      sourceIncomingRaw: master.sourceIncomingRaw,
    },
  });

  await recordAuditEvent({
    action: "stock.variant_reconcile.confirmed",
    entityType: "ProductVariant",
    entityId: input.variantId,
    actorUserId: input.actorUserId ?? null,
    metadata: {
      sku,
      autopartProductId: master.id,
      availQty: sellable,
      source: AUTOPART_FEED_SOURCE,
      presentInLatestFeed: master.presentInLatestFeed,
      lastSeenAt: master.lastSeenAt?.toISOString() ?? null,
      effectiveSellable: getEffectiveSellableQuantity({
        autopartAvail: sellable,
        reservedQty: 0,
      }),
    },
  });

  return {
    status: "linked_and_confirmed",
    autopartProductId: master.id,
    availQty: sellable,
    inventoryCreated: true,
    inventoryUpdated: false,
  };
}
