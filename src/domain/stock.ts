import { publicAvailabilityFromQty, publicAvailabilityFromStock, type PublicAvailability } from "@/domain/availability";

export const AUTOPART_WAREHOUSE_CODE = "AUTOPART";
export const AUTOPART_WAREHOUSE_NAME = "Autopart";
export const AUTOPART_FEED_SOURCE = "231PO3NEW";
export const STOCK_SYNC_MUTEX_ID = "autopart-231po3new";
export const DEFAULT_STALE_HOURS = 36;

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
  /**
   * Effective B2B sellable = max(0, Autopart Avail − ACTIVE AB reservations).
   * Not raw Autopart Avail; see getEffectiveSellableQuantity.
   */
  sellableQty: number;
  reservedQty: number;
  availability: PublicAvailability | null;
  stale: boolean;
  syncedAt: string | null;
  source: typeof AUTOPART_FEED_SOURCE;
  sourceAvailRaw: string | null;
};

/**
 * Effective sellable for B2B ordering under AB reservations.
 * qtyOnHand / autopartAvail stays as latest Autopart Avail; reserved is AB-only.
 */
export function getEffectiveSellableQuantity(input: {
  autopartAvail: number; // qtyOnHand / trusted Avail
  reservedQty: number;
}): number {
  return Math.max(0, Math.trunc(input.autopartAvail) - Math.max(0, Math.trunc(input.reservedQty)));
}

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

export const NOT_IN_AB_CATALOGUE_REASON = "Not in AB catalogue";

/** Unmatched/non-catalogued Autopart SKUs are expected and never PARTIAL on their own. */
export function stockSyncOutcome(input: {
  rowsRead: number;
  invalid: number;
  duplicates: number;
}): "SUCCESS" | "PARTIAL" | "FAILED" {
  if (input.rowsRead === 0) return "FAILED";
  if (input.invalid + input.duplicates > 0) return "PARTIAL";
  return "SUCCESS";
}

export function catalogueMatchSummary(input: {
  matched: number;
  unmatched: number;
  invalid: number;
  duplicates?: number;
}): string {
  const parts = [
    `Matched AB SKUs: ${input.matched}`,
    `Not in AB catalogue: ${input.unmatched}`,
    `Invalid: ${input.invalid}`,
  ];
  if (input.duplicates) parts.push(`Duplicates: ${input.duplicates}`);
  return parts.join(". ");
}

export function stockAttentionSummary(invalid: number, duplicates: number): string | null {
  const n = invalid + duplicates;
  if (!n) return null;
  return `${n} row(s) need attention`;
}

/** Customer band from sellable qty at sync time (not stale-aware). Uses central thresholds. */
export function stockAvailabilityBand(qty: number): PublicAvailability {
  return publicAvailabilityFromQty(qty) ?? "out";
}

export function stockAvailabilityBandLabel(band: PublicAvailability): string {
  if (band === "in") return "IN STOCK";
  if (band === "low") return "LOW STOCK";
  return "OUT OF STOCK";
}

export function stockAvailabilityTransitionLabel(previous: PublicAvailability, next: PublicAvailability): string {
  const from = stockAvailabilityBandLabel(previous);
  const to = stockAvailabilityBandLabel(next);
  return from === to ? from : `${from} → ${to}`;
}

export type StockQtyChange = {
  previousQty: number;
  newQty: number;
  delta: number;
  previousAvailability: PublicAvailability;
  newAvailability: PublicAvailability;
};

/** Null when authoritative sellable quantity did not change (no history row). */
export function describeStockQtyChange(previousQty: number, newQty: number): StockQtyChange | null {
  if (previousQty === newQty) return null;
  return {
    previousQty,
    newQty,
    delta: newQty - previousQty,
    previousAvailability: stockAvailabilityBand(previousQty),
    newAvailability: stockAvailabilityBand(newQty),
  };
}

export function summariseStockQtyChanges(
  rows: Array<Pick<StockQtyChange, "previousQty" | "newQty" | "previousAvailability" | "newAvailability">>,
) {
  let increased = 0;
  let decreased = 0;
  let becameInStock = 0;
  let becameLowStock = 0;
  let becameOutOfStock = 0;
  for (const row of rows) {
    if (row.newQty > row.previousQty) increased += 1;
    else if (row.newQty < row.previousQty) decreased += 1;
    if (row.previousAvailability !== "in" && row.newAvailability === "in") becameInStock += 1;
    if (row.previousAvailability !== "low" && row.newAvailability === "low") becameLowStock += 1;
    if (row.previousAvailability !== "out" && row.newAvailability === "out") becameOutOfStock += 1;
  }
  return { increased, decreased, becameInStock, becameLowStock, becameOutOfStock };
}
