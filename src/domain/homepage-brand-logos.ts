/**
 * Homepage-only primary brand presentation helpers.
 * Does not change catalogue Brand.sortOrder or global product sorting.
 */

export const HOMEPAGE_PRIMARY_BRAND_ORDER = ["steel-seal", "power-maxed"] as const;

export type HomepagePrimaryBrandSlug = (typeof HOMEPAGE_PRIMARY_BRAND_ORDER)[number];

/** Transparent static brand marks under /public/brand (homepage fallback). */
export const HOMEPAGE_BRAND_LOGO_FALLBACK: Record<HomepagePrimaryBrandSlug, string> = {
  "steel-seal": "/brand/steel-seal-logo.png",
  "power-maxed": "/brand/power-maxed-logo.png",
};

export function isHomepagePrimaryBrandSlug(slug: string): slug is HomepagePrimaryBrandSlug {
  return (HOMEPAGE_PRIMARY_BRAND_ORDER as readonly string[]).includes(slug);
}

export function homepageBrandLogoSrc(slug: string, preferred: string | null | undefined): string | null {
  if (preferred && preferred.trim()) return preferred;
  if (isHomepagePrimaryBrandSlug(slug)) return HOMEPAGE_BRAND_LOGO_FALLBACK[slug];
  return null;
}

/** Order known primary brands Steel Seal → Power Maxed; append any others unchanged. */
export function orderHomepageBrandPresentation<T extends { slug: string }>(brands: T[]): T[] {
  const bySlug = new Map(brands.map((brand) => [brand.slug, brand]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const slug of HOMEPAGE_PRIMARY_BRAND_ORDER) {
    const brand = bySlug.get(slug);
    if (brand) {
      ordered.push(brand);
      seen.add(slug);
    }
  }
  for (const brand of brands) {
    if (!seen.has(brand.slug)) ordered.push(brand);
  }
  return ordered;
}
