/**
 * Back-in-stock transition detection for Autopart Avail → Inventory.qtyOnHand.
 *
 * Detection uses trustworthy feed Avail transitions only (confirmed Inventory
 * qtyOnHand before the apply → new Avail). Manual overrides and AB reservations
 * do not create or suppress transition events; they only affect displayed
 * current sellable quantity via getEffectiveSellableQuantity.
 *
 * UNKNOWN / first confirmation (no prior Inventory row) is never a BIS event.
 * Physical Stk / Stk / Pick Qty are never used.
 */

export type BackInStockTransitionInput = {
  /** True when an Inventory row already existed for this variant+warehouse before the apply. */
  hasPriorInventory: boolean;
  /** Trusted Autopart Avail stored as Inventory.qtyOnHand before this apply. */
  previousQtyOnHand: number;
  /** New Avail after sellableQuantityFromAvail. */
  newQtyOnHand: number;
  /** Catalogue product must be ACTIVE + trade-visible at record time. */
  productIsActive: boolean;
  productIsTradeVisible: boolean;
  productStatus: string;
};

/**
 * True when this live apply should persist a StockBackInStockEvent.
 * 10→20 is false. UNKNOWN→10 is false. 0→5 is true when prior Inventory confirmed 0.
 */
export function isBackInStockTransition(input: BackInStockTransitionInput): boolean {
  if (!input.hasPriorInventory) return false;
  if (!Number.isFinite(input.previousQtyOnHand) || !Number.isFinite(input.newQtyOnHand)) return false;
  if (Math.trunc(input.previousQtyOnHand) !== 0) return false;
  if (Math.trunc(input.newQtyOnHand) <= 0) return false;
  if (!input.productIsActive) return false;
  if (!input.productIsTradeVisible) return false;
  if (input.productStatus !== "ACTIVE") return false;
  return true;
}

/** Dashboard listing: still show only when current Autopart Avail remains confirmed positive. */
export function isBackInStockEventStillInStock(input: {
  hasInventoryRow: boolean;
  /** Current Inventory.qtyOnHand (Autopart Avail). Not Physical Stk. */
  currentQtyOnHand: number;
  /** Feed freshness — stale positive stock is not "confirmed" for display. */
  stale: boolean;
  productIsActive: boolean;
  productIsTradeVisible: boolean;
  productStatus: string;
}): boolean {
  if (!input.hasInventoryRow) return false;
  if (!input.productIsActive || !input.productIsTradeVisible || input.productStatus !== "ACTIVE") {
    return false;
  }
  if (input.stale) return false;
  return Math.trunc(input.currentQtyOnHand) > 0;
}

export const BACK_IN_STOCK_DASHBOARD_DEFAULT_LIMIT = 6;
export const BACK_IN_STOCK_PAGE_DEFAULT_SIZE = 24;
