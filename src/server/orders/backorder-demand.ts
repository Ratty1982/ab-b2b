/**
 * Outstanding AB backorder demand by SKU — internal / admin replenishment signal.
 * Does NOT create purchase orders. Historical OrderItem.backorderQtyAtOrder is the source.
 */

import { prisma } from "@/infra/database/client";
import { OUTSTANDING_BACKORDER_ORDER_STATUSES, resolveBackorderPolicy } from "@/domain/backorder";
import { getGlobalBackorderPolicy } from "@/server/ordering/settings";
import { AUTOPART_WAREHOUSE_CODE, getEffectiveSellableQuantity } from "@/domain/stock";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";

export type OutstandingBackorderDemandRow = {
  variantId: string;
  sku: string;
  productName: string;
  outstandingBackorderQty: number;
  autopartAvail: number | null;
  abReserved: number | null;
  effectiveAvailable: number | null;
  backorderPolicy: "DENY" | "ALLOW";
  openOrderLineCount: number;
};

/**
 * Sum of backorderQtyAtOrder on open/processing orders for one variant (or all with demand).
 */
export async function getOutstandingBackorderDemand(input?: {
  variantId?: string;
  sku?: string;
}): Promise<OutstandingBackorderDemandRow[]> {
  const statusFilter = [...OUTSTANDING_BACKORDER_ORDER_STATUSES];

  const groups = await prisma.orderItem.groupBy({
    by: ["variantId", "sku"],
    where: {
      backorderQtyAtOrder: { gt: 0 },
      ...(input?.variantId ? { variantId: input.variantId } : {}),
      ...(input?.sku ? { sku: input.sku } : {}),
      order: {
        status: { in: statusFilter as Array<"SUBMITTED" | "CONFIRMED" | "PICKING" | "PARTIALLY_DESPATCHED" | "ON_HOLD"> },
      },
      variantId: { not: null },
    },
    _sum: { backorderQtyAtOrder: true },
    _count: { _all: true },
  });

  if (!groups.length) return [];

  const variantIds = groups.map((g) => g.variantId!).filter(Boolean);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      sku: true,
      backorderPolicy: true,
      product: { select: { name: true } },
      inventory: {
        where: { warehouse: { code: AUTOPART_WAREHOUSE_CODE } },
        select: { qtyOnHand: true, qtyReserved: true },
        take: 1,
      },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const globalBackorderPolicy = await getGlobalBackorderPolicy();

  return groups
    .map((g) => {
      const v = byId.get(g.variantId!);
      const inv = v?.inventory[0];
      const effective =
        inv != null
          ? getEffectiveSellableQuantity({
              autopartAvail: inv.qtyOnHand,
              reservedQty: inv.qtyReserved,
            })
          : null;
      return {
        variantId: g.variantId!,
        sku: g.sku,
        productName: v?.product.name ?? g.sku,
        outstandingBackorderQty: g._sum.backorderQtyAtOrder ?? 0,
        autopartAvail: inv?.qtyOnHand ?? null,
        abReserved: inv?.qtyReserved ?? null,
        effectiveAvailable: effective,
        backorderPolicy: resolveBackorderPolicy({
          globalPolicy: globalBackorderPolicy,
          variantPolicy: v?.backorderPolicy,
        }),
        openOrderLineCount: g._count._all,
      };
    })
    .sort((a, b) => b.outstandingBackorderQty - a.outstandingBackorderQty);
}

export async function getOutstandingBackorderDemandForVariant(
  actorUserId: string,
  variantId: string,
): Promise<OutstandingBackorderDemandRow | null> {
  const profile = await requireSystemPermission(actorUserId, "products.view");
  if (
    !hasPermission(profile, "inventory.view") &&
    !hasPermission(profile, "admin.access") &&
    !hasPermission(profile, "products.view")
  ) {
    throw new AuthError("Forbidden", "FORBIDDEN", 403);
  }
  const rows = await getOutstandingBackorderDemand({ variantId });
  return rows[0] ?? null;
}
