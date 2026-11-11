/**
 * Admin Back in Stock listing — durable StockBackInStockEvent rows.
 *
 * Display uses getEffectiveSellableQuantity for current sellable (overrides +
 * reservations). Transition history itself is feed Avail only.
 */
import { prisma } from "@/infra/database/client";
import { AuthError, requireAnySystemPermission } from "@/server/rbac/guards";
import {
  AUTOPART_WAREHOUSE_CODE,
  getEffectiveSellableQuantity,
} from "@/domain/stock";
import {
  BACK_IN_STOCK_DASHBOARD_DEFAULT_LIMIT,
  BACK_IN_STOCK_PAGE_DEFAULT_SIZE,
  isBackInStockEventStillInStock,
} from "@/domain/stock-back-in-stock";
import { cmsMediaPublicPath } from "@/lib/cms-media";
import { formatDateTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/app-nav";
import { stockFreshness } from "@/server/stock/service";

export type BackInStockEventDto = {
  id: string;
  runId: string;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  previousQty: number;
  /** Feed Avail at the transition (newQty from the event). */
  transitionQty: number;
  /** Current effective sellable (override − reserved when applicable). */
  currentSellableQty: number;
  /** Current Autopart Avail (qtyOnHand). */
  currentAvailQty: number;
  reservedQty: number;
  manualOverrideQty: number | null;
  imageSrc: string | null;
  observedAt: string;
  observedAtLabel: string;
  href: string;
  stockHref: string;
};

async function requireInternalStockView(actorUserId: string) {
  const profile = await requireAnySystemPermission(actorUserId, [
    "inventory.view",
    "products.view",
    "admin.access",
  ]);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot inspect internal stock administration", "FORBIDDEN", 403);
  }
  return profile;
}

export async function listBackInStockEvents(
  actorUserId: string,
  input?: { limit?: number; page?: number; pageSize?: number; forDashboard?: boolean },
): Promise<{
  totalMatching: number;
  page: number;
  pageSize: number;
  items: BackInStockEventDto[];
  viewAllHref: string;
}> {
  await requireInternalStockView(actorUserId);
  const forDashboard = Boolean(input?.forDashboard);
  const pageSize = forDashboard
    ? Math.min(24, Math.max(1, input?.limit ?? BACK_IN_STOCK_DASHBOARD_DEFAULT_LIMIT))
    : Math.min(100, Math.max(6, input?.pageSize ?? BACK_IN_STOCK_PAGE_DEFAULT_SIZE));
  const page = forDashboard ? 1 : Math.max(1, input?.page ?? 1);
  const freshness = await stockFreshness();
  const warehouse = await prisma.warehouse.findUnique({
    where: { code: AUTOPART_WAREHOUSE_CODE },
    select: { id: true },
  });

  // Over-fetch then filter for still-in-stock / trade-visible.
  // Scan from newest so pagination skips filtered-out rows correctly.
  const need = forDashboard ? pageSize : page * pageSize;
  const fetchTake = Math.min(500, Math.max(need * 6, 48));

  const candidates = await prisma.stockBackInStockEvent.findMany({
    orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    take: fetchTake,
    select: {
      id: true,
      runId: true,
      variantId: true,
      productId: true,
      skuSnapshot: true,
      productNameSnapshot: true,
      previousQty: true,
      newQty: true,
      observedAt: true,
      variant: {
        select: {
          sku: true,
          product: {
            select: {
              id: true,
              name: true,
              isActive: true,
              isTradeVisible: true,
              status: true,
              media: {
                where: { isPrimary: true },
                take: 1,
                orderBy: [{ sortOrder: "asc" }],
                select: { mediaId: true },
              },
            },
          },
          inventory: warehouse
            ? {
                where: { warehouseId: warehouse.id },
                take: 1,
                select: {
                  qtyOnHand: true,
                  qtyReserved: true,
                  manualOverrideQty: true,
                },
              }
            : false,
        },
      },
    },
  });

  const items: BackInStockEventDto[] = [];
  for (const row of candidates) {
    const product = row.variant.product;
    const inv = Array.isArray(row.variant.inventory) ? row.variant.inventory[0] : null;
    const currentAvail = inv?.qtyOnHand ?? 0;
    if (
      !isBackInStockEventStillInStock({
        hasInventoryRow: Boolean(inv),
        currentQtyOnHand: currentAvail,
        stale: freshness.stale,
        productIsActive: product.isActive,
        productIsTradeVisible: product.isTradeVisible,
        productStatus: product.status,
      })
    ) {
      continue;
    }
    const reservedQty = inv?.qtyReserved ?? 0;
    const manualOverrideQty = inv?.manualOverrideQty ?? null;
    const currentSellableQty = getEffectiveSellableQuantity({
      autopartAvail: currentAvail,
      reservedQty,
      manualOverrideQty,
    });
    // Still require confirmed Autopart Avail > 0; sellable may be 0 when fully reserved —
    // still show with reserved context so ops can see stock returned.
    const primaryMediaId = product.media[0]?.mediaId ?? null;
    items.push({
      id: row.id,
      runId: row.runId,
      variantId: row.variantId,
      productId: row.productId,
      sku: row.skuSnapshot || row.variant.sku,
      productName: row.productNameSnapshot || product.name,
      previousQty: row.previousQty,
      transitionQty: row.newQty,
      currentSellableQty,
      currentAvailQty: currentAvail,
      reservedQty,
      manualOverrideQty,
      imageSrc: primaryMediaId ? cmsMediaPublicPath(primaryMediaId) : null,
      observedAt: row.observedAt.toISOString(),
      observedAtLabel: formatDateTime(row.observedAt, { seconds: false }) ?? "—",
      href: ROUTES.adminProduct(row.productId),
      stockHref: `/admin/products/stock/product/${encodeURIComponent(row.skuSnapshot || row.variant.sku)}`,
    });
    if (items.length >= need) break;
  }

  const pageItems = forDashboard
    ? items.slice(0, pageSize)
    : items.slice((page - 1) * pageSize, page * pageSize);

  // Approximate total for pagination: trade-active products still with confirmed Avail > 0.
  const totalMatching = forDashboard
    ? pageItems.length
    : await prisma.stockBackInStockEvent.count({
        where: {
          variant: {
            product: { isActive: true, isTradeVisible: true, status: "ACTIVE" },
            ...(warehouse
              ? {
                  inventory: {
                    some: { warehouseId: warehouse.id, qtyOnHand: { gt: 0 } },
                  },
                }
              : {}),
          },
        },
      });

  return {
    totalMatching,
    page,
    pageSize,
    items: pageItems,
    viewAllHref: ROUTES.adminBackInStock,
  };
}

/** Compact payload for the main admin dashboard (canSeeStock gated by caller). */
export async function getDashboardBackInStock(actorUserId: string) {
  const listed = await listBackInStockEvents(actorUserId, {
    forDashboard: true,
    limit: BACK_IN_STOCK_DASHBOARD_DEFAULT_LIMIT,
  });
  return {
    items: listed.items,
    viewAllHref: listed.viewAllHref,
    empty: listed.items.length === 0,
  };
}
