import { publicAvailabilityFromQty, publicAvailabilityFromStock, type PublicAvailability } from "@/domain/availability";

export const AUTOPART_WAREHOUSE_CODE = "AUTOPART";
export const AUTOPART_WAREHOUSE_NAME = "Autopart";
export const AUTOPART_FEED_SOURCE = "231PO3NEW";
export const STOCK_SYNC_MUTEX_ID = "autopart-231po3new";
export const DEFAULT_STALE_HOURS = 36;
export const DEFAULT_SCHEDULE_MINUTES = 15;

export type InternalStockStatus = "IN_STOCK" | "LOW" | "OUT_OF_STOCK";

export function sellableQuantityFromAvail(avail: number): number {
  if (!Number.isFinite(avail)) return 0;
  return avail < 0 ? 0 : Math.trunc(avail);
}

export function internalStatusFromSellable(qty: number): InternalStockStatus {
  const band = publicAvailabilityFromQty(qty);
  if (band === "in") return "IN_STOCK";
  if (band === "low") return "LOW";
  return "OUT_OF_STOCK";
}

export function normalizeStockSku(raw: string): string {
  return raw.trim();
}

export function skuMatchKey(raw: string): string {
  return normalizeStockSku(raw).toUpperCase();
}

export type VariantStock = {
  variantId: string;
  sku: string;
  /** Authoritative sellable units from Autopart Avail (not case-rounded). */
  sellableQty: number;
  reservedQty: number;
  availability: PublicAvailability | null;
  stale: boolean;
  syncedAt: string | null;
  source: typeof AUTOPART_FEED_SOURCE;
  sourceAvailRaw: string | null;
};

/** Phase 6 will call this. Does not enforce case multiples. */
export function getSellableQuantity(stock: Pick<VariantStock, "sellableQty">): number {
  return Math.max(0, stock.sellableQty);
}

export function customerAvailabilityForStock(input: {
  sellableQty: number | null;
  stale: boolean;
  unknown?: boolean;
}): PublicAvailability | null {
  return publicAvailabilityFromStock({
    sellableQty: input.sellableQty,
    stale: input.stale,
    unknown: input.unknown ?? false,
  });
}

export function isStockStale(lastSuccessAt: Date | null, now: Date, staleHours: number): boolean {
  if (!lastSuccessAt) return false;
  if (!Number.isFinite(staleHours) || staleHours <= 0) return false;
  return now.getTime() - lastSuccessAt.getTime() > staleHours * 60 * 60 * 1000;
}
