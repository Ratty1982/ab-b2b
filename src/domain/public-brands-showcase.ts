/**
 * Public /brands presentation.
 * Catalogue launch slugs and Brand.sortOrder stay unchanged.
 * This page always presents Steel Seal, then Power Maxed.
 */
import { DEFAULT_BRANDS } from "@/domain/catalogue";
import {
  defaultBrandsShowcaseContent,
  type BrandsShowcaseContent,
} from "@/domain/brands-showcase-content";
import { homepageBrandLogoSrc } from "@/domain/homepage-brand-logos";
import { cmsMediaDisplaySrc } from "@/lib/cms-media";
import { publicHeaderAccountLinks } from "@/lib/public-header-account";
import type { ClientSession } from "@/server/auth/session";

export const PUBLIC_BRAND_SHOWCASE_ORDER = ["steel-seal", "power-maxed"] as const;

export type PublicBrandShowcaseSlug = (typeof PUBLIC_BRAND_SHOWCASE_ORDER)[number];

export const PUBLIC_BRANDS_PAGE_TITLE = "Steel Seal & Power Maxed Trade Products | Automotive Brands";

export const PUBLIC_BRANDS_PAGE_DESCRIPTION =
  "Explore Steel Seal and Power Maxed trade automotive products from Automotive Brands, with professional products for workshops, vehicle care and repair.";

export const PUBLIC_BRANDS_HERO = {
  eyebrow: "Our Brands",
  headline: "Two specialist brands.\nOne trade account.",
  supporting:
    "Professional vehicle care, workshop and engine repair products from Steel Seal and Power Maxed, available through one Automotive Brands trade account.",
} as const;

export const PUBLIC_BRANDS_CLOSE = {
  headline: "One account.\nBoth brands.",
  supporting:
    "Access Steel Seal and Power Maxed trade products through one Automotive Brands account.",
} as const;

const PROPOSITION_BY_SLUG: Record<
  PublicBrandShowcaseSlug,
  { name: string; kicker: string; body: string }
> = {
  "steel-seal": {
    name: "Steel Seal",
    kicker: "Head Gasket & Cooling Repair",
    body: "Specialist repair solutions for workshops and automotive professionals.",
  },
  "power-maxed": {
    name: "Power Maxed",
    kicker: "Vehicle Care & Workshop",
    body: "Professional vehicle care, detailing, maintenance and workshop products.",
  },
};

export const PUBLIC_BRANDS_PROPOSITION = {
  eyebrow: "Together",
  headline: "Two brands. One trade partner.",
  supporting:
    "Steel Seal covers specialist engine repair. Power Maxed covers vehicle care and workshop demand. Both are supplied through one Automotive Brands trade account.",
} as const;

const SHOWCASE_POINTS: Record<PublicBrandShowcaseSlug, readonly string[]> = {
  "steel-seal": ["Head gasket repair", "Cooling-system repair", "Workshop and trade use"],
  "power-maxed": ["Vehicle care", "Valeting and detailing", "Workshop and maintenance"],
};

const SHOWCASE_KICKER: Record<PublicBrandShowcaseSlug, string> = {
  "steel-seal": "Head Gasket & Cooling Repair",
  "power-maxed": "Vehicle Care & Workshop",
};

export type PublicCatalogueBrandCard = {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logoSrc: string | null;
  lines: number;
};

export type PublicBrandShowcase = {
  slug: PublicBrandShowcaseSlug;
  name: string;
  kicker: string;
  description: string;
  points: readonly string[];
  logoSrc: string;
  logoAlt: string;
  tradeProductCount: number;
  tradeProductCountLabel: string;
  shopHref: string;
  shopLabel: string;
  emphasis: "primary" | "secondary";
  coverSrc: string | null;
  coverAlt: string;
};

export type ShowcaseCta = {
  label: string;
  href: string;
};

export type BrandsShowcaseCtas = {
  heroPrimary: ShowcaseCta;
  heroSecondary: ShowcaseCta | null;
  closePrimary: ShowcaseCta;
  closeSecondary: ShowcaseCta | null;
  /** Anonymous visitors can open an account. Signed-in visitors cannot. */
  offerTradeAccount: boolean;
};

const SHOP_PRODUCTS: ShowcaseCta = { label: "Shop Products", href: "/products" };
const OPEN_TRADE_ACCOUNT: ShowcaseCta = { label: "Open a Trade Account", href: "/register" };

function isShowcaseSlug(slug: string): slug is PublicBrandShowcaseSlug {
  return (PUBLIC_BRAND_SHOWCASE_ORDER as readonly string[]).includes(slug);
}

export function tradeProductCountLabel(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const formatted = safe.toLocaleString("en-GB");
  return `${formatted} trade product${safe === 1 ? "" : "s"}`;
}

function catalogueDefault(slug: PublicBrandShowcaseSlug) {
  return DEFAULT_BRANDS.find((brand) => brand.slug === slug);
}

/**
 * Keep only Steel Seal and Power Maxed, in that order.
 * Database sortOrder, alphabetical order, and any other catalogue brand are ignored.
 */
export function orderPublicBrandShowcase(brands: readonly PublicCatalogueBrandCard[]): PublicBrandShowcase[] {
  const bySlug = new Map(brands.map((brand) => [brand.slug, brand]));
  const ordered: PublicBrandShowcase[] = [];
  for (const slug of PUBLIC_BRAND_SHOWCASE_ORDER) {
    const brand = bySlug.get(slug);
    if (!brand || !isShowcaseSlug(brand.slug)) continue;
    const fallback = catalogueDefault(slug);
    const name = brand.name.trim() || fallback?.name || slug;
    const description =
      brand.description?.trim() ||
      fallback?.description ||
      `${name} products supplied to Automotive Brands trade customers.`;
    const logoSrc = homepageBrandLogoSrc(slug, brand.logoSrc);
    if (!logoSrc) continue;
    ordered.push({
      slug,
      name,
      kicker: SHOWCASE_KICKER[slug],
      description,
      points: SHOWCASE_POINTS[slug],
      logoSrc,
      logoAlt: `${name} logo`,
      tradeProductCount: Math.max(0, Math.floor(brand.lines)),
      tradeProductCountLabel: tradeProductCountLabel(brand.lines),
      shopHref: `/brands/${slug}`,
      shopLabel: `Shop ${name}`,
      emphasis: slug === "steel-seal" ? "primary" : "secondary",
      coverSrc: null,
      coverAlt: "",
    });
  }
  return ordered;
}

/**
 * Apply CMS copy onto the fixed Steel Seal → Power Maxed catalogue order.
 * Shop links stay on the brand catalogue routes. Product counts stay on the catalogue cards.
 */
export function presentPublicBrandShowcase(
  brands: readonly PublicCatalogueBrandCard[],
  content: BrandsShowcaseContent = defaultBrandsShowcaseContent(),
): PublicBrandShowcase[] {
  return orderPublicBrandShowcase(brands).map((brand) => {
    const panel = brand.slug === "steel-seal" ? content.steelSeal : content.powerMaxed;
    const coverSrc = cmsMediaDisplaySrc(panel.media) ?? null;
    return {
      ...brand,
      name: panel.heading.trim() || brand.name,
      kicker: panel.kicker.trim() || brand.kicker,
      description: panel.description.trim() || brand.description,
      points: panel.points.length ? panel.points : brand.points,
      shopLabel: panel.ctaLabel.trim() || brand.shopLabel,
      shopHref: brand.shopHref,
      coverSrc,
      coverAlt: panel.media.alt.trim() || `${brand.name} photography`,
    };
  });
}

export function brandsPageCtas(session: ClientSession, content: BrandsShowcaseContent): BrandsShowcaseCtas {
  const sessionCtas = brandsShowcaseCtas(session);
  if (session.signedIn) return sessionCtas;
  return {
    heroPrimary: { label: content.hero.ctaLabel, href: content.hero.ctaHref },
    heroSecondary: content.hero.secondaryCtaLabel.trim()
      ? { label: content.hero.secondaryCtaLabel, href: content.hero.secondaryCtaHref }
      : null,
    closePrimary: { label: content.close.ctaLabel, href: content.close.ctaHref },
    closeSecondary: content.close.secondaryCtaLabel.trim()
      ? { label: content.close.secondaryCtaLabel, href: content.close.secondaryCtaHref }
      : null,
    offerTradeAccount: [content.hero.ctaHref, content.hero.secondaryCtaHref, content.close.ctaHref, content.close.secondaryCtaHref].includes(
      "/register",
    ),
  };
}

export function publicBrandPropositionCards(brands: readonly { slug: string }[]) {
  return PUBLIC_BRAND_SHOWCASE_ORDER.flatMap((slug) => {
    if (!brands.some((brand) => brand.slug === slug)) return [];
    return [{ slug, ...PROPOSITION_BY_SLUG[slug] }];
  });
}

export function brandsShowcaseCtas(session: ClientSession): BrandsShowcaseCtas {
  if (!session.signedIn) {
    return {
      heroPrimary: SHOP_PRODUCTS,
      heroSecondary: OPEN_TRADE_ACCOUNT,
      closePrimary: OPEN_TRADE_ACCOUNT,
      closeSecondary: SHOP_PRODUCTS,
      offerTradeAccount: true,
    };
  }

  const account = publicHeaderAccountLinks(session)[0];
  const secondary =
    account && account.to !== SHOP_PRODUCTS.href ? { label: account.label, href: account.to } : null;

  return {
    heroPrimary: SHOP_PRODUCTS,
    heroSecondary: secondary,
    closePrimary: SHOP_PRODUCTS,
    closeSecondary: secondary,
    offerTradeAccount: false,
  };
}
