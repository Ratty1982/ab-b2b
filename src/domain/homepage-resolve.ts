import type { HomepageBrand, HomepageCategory, HomepageProduct } from "@/domain/homepage";
import { resolveFeaturedBrandCards, type FeaturedBrandCard } from "@/domain/featured-brands";
import { cmsMediaDisplaySrc } from "@/lib/cms-media";

export type ResolvedHomepageBrand = FeaturedBrandCard & {
  name: string;
  logoSrc: string | null;
  publicDescription: string | null;
};

export function skuKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sku = value.trim().toUpperCase();
  return sku || null;
}

export function lookupProduct(
  bySku: Record<string, HomepageProduct>,
  sku: unknown,
): HomepageProduct | null {
  const key = skuKey(sku);
  if (!key) return null;
  return bySku[key] ?? null;
}

export function productsForSkus(
  skus: unknown,
  bySku: Record<string, HomepageProduct>,
): HomepageProduct[] {
  if (!Array.isArray(skus)) return [];
  const out: HomepageProduct[] = [];
  for (const item of skus) {
    const product = lookupProduct(bySku, item);
    if (product && !out.some((row) => row.sku === product.sku)) out.push(product);
  }
  return out;
}

export function productHref(product: HomepageProduct): string {
  return `/products/${encodeURIComponent(product.slug || product.sku)}`;
}

export function resolveHomepageBrands(
  config: Record<string, unknown>,
  brands: HomepageBrand[],
): ResolvedHomepageBrand[] {
  const cards = resolveFeaturedBrandCards(config);
  const bySlug = new Map(brands.map((brand) => [brand.slug, brand]));
  // Only surface brands that are currently public/trade-visible in the catalogue.
  const resolved = cards
    .filter((card) => bySlug.has(card.slug))
    .map((card) => {
      const db = bySlug.get(card.slug)!;
      return {
        ...card,
        heading: card.heading || db.name || card.slug,
        name: db.name || card.heading || card.slug,
        description: card.description || db.description || db.tagline || "",
        publicDescription: db.description ?? db.tagline ?? null,
        logoSrc: cmsMediaDisplaySrc(card.logo) ?? db.logoSrc ?? null,
        href: card.href || `/brands/${db.slug}`,
      };
    });
  if (resolved.length) return resolved;
  return brands.map((brand) => ({
    slug: brand.slug,
    heading: brand.name,
    name: brand.name,
    description: brand.description || brand.tagline || "",
    publicDescription: brand.description ?? brand.tagline ?? null,
    href: `/brands/${brand.slug}`,
    enabled: true,
    logoSrc: brand.logoSrc,
  }));
}

function slugFromHref(href: string): string | null {
  const match = href.match(/\/products\/category\/([^/?#]+)/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return null;
}

export function resolveHomepageCategories(
  config: Record<string, unknown>,
  categories: HomepageCategory[],
): HomepageCategory[] {
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const byName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));
  const slugs = Array.isArray(config["categorySlugs"])
    ? config["categorySlugs"].filter((slug): slug is string => typeof slug === "string" && slug.trim() !== "")
    : [];
  if (slugs.length) {
    return slugs.map((slug) => bySlug.get(slug.trim())).filter((row): row is HomepageCategory => Boolean(row));
  }
  const legacy = Array.isArray(config["categories"]) ? config["categories"] : [];
  const fromLegacy: HomepageCategory[] = [];
  for (const item of legacy) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const href = typeof row["href"] === "string" ? row["href"] : "";
    const name = typeof row["name"] === "string" ? row["name"] : "";
    const slug = slugFromHref(href) || (typeof row["slug"] === "string" ? row["slug"] : "");
    const match = (slug && bySlug.get(slug)) || (name && byName.get(name.toLowerCase()));
    if (match && !fromLegacy.some((c) => c.slug === match.slug)) fromLegacy.push(match);
  }
  if (fromLegacy.length) return fromLegacy;
  return categories.filter((category) => !category.parentId).slice(0, 8);
}
