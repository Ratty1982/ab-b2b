export const PUBLIC_STOCK_IN_THRESHOLD = 21;

export type PublicAvailability = "in" | "low" | "out";

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
};
