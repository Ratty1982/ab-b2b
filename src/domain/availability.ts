export const PUBLIC_STOCK_IN_THRESHOLD = 21;

/**
 * Customer-facing availability bands.
 * Extended in Phase 6C with backorder / partial states.
 * Never expose the raw quantity publicly except where authenticated
 * ordering rules legitimately require a split explanation.
 */
export type PublicAvailability = "in" | "low" | "out" | "backorder" | "partial";

/** Domain enum aliases used in docs / admin copy. */
export type AvailabilityState =
  | "IN_STOCK"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "AVAILABLE_TO_BACKORDER"
  | "PARTIALLY_AVAILABLE";

export function availabilityStateFromPublic(band: PublicAvailability): AvailabilityState {
  switch (band) {
    case "in":
      return "IN_STOCK";
    case "low":
      return "LOW_STOCK";
    case "out":
      return "OUT_OF_STOCK";
    case "backorder":
      return "AVAILABLE_TO_BACKORDER";
    case "partial":
      return "PARTIALLY_AVAILABLE";
  }
}

/**
 * Customer-facing stock contract. Never expose the raw quantity.
 * Returns null when there is no legitimate inventory row to report.
 */
export function publicAvailabilityFromQty(qty: number | null | undefined): PublicAvailability | null {
  if (qty == null || !Number.isFinite(qty)) return null;
  if (qty >= PUBLIC_STOCK_IN_THRESHOLD) return "in";
  if (qty >= 1) return "low";
  return "out";
}

export const PUBLIC_AVAILABILITY_LABEL: Record<PublicAvailability, string> = {
  in: "In Stock",
  low: "Low Stock",
  out: "Out of Stock",
  backorder: "Available to Backorder",
  partial: "Partially Available",
};

export const PUBLIC_AVAILABILITY_HELP: Partial<Record<PublicAvailability, string>> = {
  backorder: "Available to order. This item will be supplied when stock becomes available.",
  partial: "Some quantity is available from stock; the remainder will be backordered.",
};

export type StockAvailabilityFacts = {
  /** Authoritative sellable quantity (never negative). */
  sellableQty: number | null;
  /** True when the last successful Autopart sync exceeded the stale threshold. */
  stale: boolean;
  /** True when Avail was missing/non-numeric for this SKU (do not invent stock). */
  unknown: boolean;
  /** When ALLOW and sellable is 0, surface AVAILABLE_TO_BACKORDER instead of OUT_OF_STOCK. */
  backorderAllowed?: boolean;
};

/**
 * Public mapping from central stock facts. Stale positive stock is not shown as IN/LOW STOCK.
 * Zero stock with backorders allowed → AVAILABLE_TO_BACKORDER (never "Out of Stock").
 */
export function publicAvailabilityFromStock(facts: StockAvailabilityFacts): PublicAvailability | null {
  if (facts.unknown) return null;
  if (facts.sellableQty == null) return null;
  if (facts.stale && facts.sellableQty > 0) return null;
  if (facts.sellableQty <= 0) {
    return facts.backorderAllowed ? "backorder" : "out";
  }
  return publicAvailabilityFromQty(facts.sellableQty);
}

/**
 * Basket / checkout line availability given ordered qty vs current sellable.
 * Uses backorder policy so orderable zero-stock lines are not shown as Out of Stock.
 */
export function publicAvailabilityForOrderLine(input: {
  sellableQty: number;
  orderedQty: number;
  backorderAllowed: boolean;
  stale?: boolean;
  unknown?: boolean;
}): PublicAvailability | null {
  if (input.unknown) return null;
  const sellable = Math.max(0, Math.trunc(input.sellableQty));
  const ordered = Math.max(0, Math.trunc(input.orderedQty));
  if (input.stale && sellable > 0) return null;
  if (sellable <= 0) {
    return input.backorderAllowed ? "backorder" : "out";
  }
  if (ordered > sellable && input.backorderAllowed) {
    return "partial";
  }
  return publicAvailabilityFromQty(sellable);
}
