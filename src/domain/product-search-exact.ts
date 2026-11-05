/**
 * Exact product-code / SKU match before fuzzy contains search.
 * Case and surrounding whitespace are normalised.
 */

export function normaliseProductSearchQuery(q: string | null | undefined): string {
  return String(q ?? "").trim();
}

/**
 * Prefer exact SKU hits (case-insensitive). When any exact hit exists, return only those
 * (caller should still enforce auth/visibility filters before querying).
 * When none exist, return null so callers keep existing contains behaviour.
 */
export function exactSkuMatchFilter(q: string): { equals: string; mode: "insensitive" } | null {
  const normalised = normaliseProductSearchQuery(q);
  if (!normalised) return null;
  return { equals: normalised, mode: "insensitive" };
}

/** Stable merge: exact SKU rows first, then remaining without duplicates. */
export function preferExactSkuRows<T extends { sku: string }>(
  q: string,
  exactRows: T[],
  fallbackRows: T[],
): T[] {
  const normalised = normaliseProductSearchQuery(q).toUpperCase();
  if (!normalised) return fallbackRows;
  if (exactRows.length > 0) return exactRows;
  return fallbackRows;
}
