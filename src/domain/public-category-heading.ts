/**
 * Customer-facing category heading helpers for the public catalogue.
 * Avoids internal wording such as "active trade-visible lines".
 */

const SEO_DESCRIPTION_MAX = 160;

export function publicProductCountLabel(total: number): string {
  const n = Math.max(0, Math.floor(total));
  return `${n.toLocaleString("en-GB")} product${n === 1 ? "" : "s"}`;
}

/** Trimmed category description for the H1 subtitle, or null when absent. */
export function publicCategorySubtitle(description: string | null | undefined): string | null {
  const trimmed = description?.trim() ?? "";
  return trimmed ? trimmed : null;
}

/**
 * SEO meta description from the stored category description.
 * Falls back to a neutral category browse line when description is empty —
 * no invented product claims.
 */
export function publicCategoryMetaDescription(input: {
  name: string;
  description?: string | null | undefined;
}): string {
  const fromDb = input.description?.trim() ?? "";
  if (fromDb) {
    if (fromDb.length <= SEO_DESCRIPTION_MAX) return fromDb;
    const sliced = fromDb.slice(0, SEO_DESCRIPTION_MAX - 1);
    const boundary = sliced.lastIndexOf(" ");
    const base = boundary > 80 ? sliced.slice(0, boundary) : sliced;
    return `${base.trimEnd()}…`;
  }
  return `Browse ${input.name} products from Automotive Brands. Trade customers sign in to see account pricing.`;
}
