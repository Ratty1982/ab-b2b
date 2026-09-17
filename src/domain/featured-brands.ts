import {
  cmsMediaDisplaySrc,
  mergeBrandLogoMaps,
  readBrandLogos,
  type BrandLogoRef,
} from "@/lib/cms-media";

export const DEFAULT_FEATURED_BRANDS_HEADING = "FIVE BRANDS. ONE SUPPLY PARTNER.";

export const DEFAULT_FEATURED_BRANDS_INTRO =
  "Trusted automotive brands, supplied to the trade from one place. From vehicle care and repair to accessories, power and child safety.";

export type FeaturedBrandCard = {
  slug: string;
  heading: string;
  description: string;
  href: string;
  enabled: boolean;
  logo?: BrandLogoRef | null;
};

/** Initial homepage marketing copy. Stored in CMS config so it can be edited later. */
export const DEFAULT_FEATURED_BRAND_CARDS: FeaturedBrandCard[] = [
  {
    slug: "power-maxed",
    heading: "Power Maxed",
    description:
      "Professional automotive cleaning, detailing, workshop chemicals and vehicle care products.",
    href: "/brands/power-maxed",
    enabled: true,
  },
  {
    slug: "steel-seal",
    heading: "Steel Seal",
    description:
      "Professional head gasket repair trusted by motorists, workshops and the automotive trade.",
    href: "/brands/steel-seal",
    enabled: true,
  },
  {
    slug: "street-rhino",
    heading: "Street Rhino",
    description: "Vehicle accessories, security, lighting and practical solutions for cars, vans and 4x4s.",
    href: "/brands/street-rhino",
    enabled: true,
  },
  {
    slug: "bramley-power",
    heading: "Bramley Power",
    description: "Reliable batteries, charging and power solutions for automotive and leisure applications.",
    href: "/brands/bramley-power",
    enabled: true,
  },
  {
    slug: "kidzmotion",
    heading: "KidZmotion",
    description: "Child car seats, boosters and travel safety products for babies and children.",
    href: "/brands/kidzmotion",
    enabled: true,
  },
];

const DEFAULT_BY_SLUG = new Map(DEFAULT_FEATURED_BRAND_CARDS.map((card) => [card.slug, card]));

export function featuredBrandsIntro(config: Record<string, unknown>): string {
  if (typeof config["intro"] === "string") return config["intro"];
  return DEFAULT_FEATURED_BRANDS_INTRO;
}

export function featuredBrandHref(slug: string): string {
  return `/brands/${slug}`;
}

export function defaultFeaturedBrandCard(slug: string, catalogueName?: string): FeaturedBrandCard {
  const seeded = DEFAULT_BY_SLUG.get(slug);
  if (seeded) return { ...seeded };
  return {
    slug,
    heading: catalogueName || slug,
    description: "",
    href: featuredBrandHref(slug),
    enabled: true,
  };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asLogo(value: unknown): BrandLogoRef | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  return {
    mediaId: typeof row["mediaId"] === "string" ? row["mediaId"] : undefined,
    src: typeof row["src"] === "string" ? row["src"] : undefined,
    alt: typeof row["alt"] === "string" ? row["alt"] : undefined,
  };
}

export function parseFeaturedBrandCards(raw: unknown): FeaturedBrandCard[] {
  if (!Array.isArray(raw)) return [];
  const cards: FeaturedBrandCard[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const slug = asString(row["slug"]).trim();
    if (!slug) continue;
    const seeded = defaultFeaturedBrandCard(slug);
    cards.push({
      slug,
      heading: asString(row["heading"], seeded.heading),
      description: asString(row["description"], seeded.description),
      href: asString(row["href"], seeded.href || featuredBrandHref(slug)),
      enabled: row["enabled"] !== false,
      logo: asLogo(row["logo"]),
    });
  }
  return cards;
}

export function logosRecordFromCards(cards: FeaturedBrandCard[]): Record<string, BrandLogoRef> {
  const logos: Record<string, BrandLogoRef> = {};
  for (const card of cards) {
    if (card.logo && typeof card.logo === "object") logos[card.slug] = card.logo;
  }
  return logos;
}

function displayCountFrom(config: Record<string, unknown>): number {
  const value = config["displayCount"];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 5;
}

function brandSlugsFrom(config: Record<string, unknown>): string[] {
  const raw = config["brandSlugs"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((slug): slug is string => typeof slug === "string" && slug.trim() !== "");
}

function cardLogoOrMap(card: FeaturedBrandCard, logos: Record<string, BrandLogoRef>): BrandLogoRef | null | undefined {
  if (cmsMediaDisplaySrc(card.logo)) return card.logo;
  if (logos[card.slug]) return logos[card.slug];
  return card.logo;
}

/**
 * Editor list: every known brand as a card, using CMS marketing copy (not catalogue blurbs).
 * Legacy drafts without `brandCards` are hydrated from defaults + brandSlugs/logos.
 */
export function hydrateFeaturedBrandCards(
  config: Record<string, unknown>,
  catalogue: Array<{ slug: string; name: string }>,
): FeaturedBrandCard[] {
  const stored = parseFeaturedBrandCards(config["brandCards"]);
  const bySlug = new Map(stored.map((card) => [card.slug, card]));
  const logos = readBrandLogos(config);
  const selected = brandSlugsFrom(config);
  const order: string[] = [];
  for (const card of stored) {
    if (!order.includes(card.slug)) order.push(card.slug);
  }
  for (const slug of selected) {
    if (!order.includes(slug)) order.push(slug);
  }
  for (const brand of catalogue) {
    if (!order.includes(brand.slug)) order.push(brand.slug);
  }
  if (order.length === 0) {
    for (const card of DEFAULT_FEATURED_BRAND_CARDS) order.push(card.slug);
  }

  const hasStoredCards = stored.length > 0;
  const hasSelected = selected.length > 0;

  return order.map((slug) => {
    const existing = bySlug.get(slug);
    const cat = catalogue.find((brand) => brand.slug === slug);
    const base = existing ?? defaultFeaturedBrandCard(slug, cat?.name);
    let enabled = base.enabled;
    if (existing) enabled = existing.enabled;
    else if (hasStoredCards) enabled = false;
    else if (hasSelected) enabled = selected.includes(slug);
    else enabled = DEFAULT_BY_SLUG.has(slug);
    return {
      ...base,
      enabled,
      logo: cardLogoOrMap(base, logos),
    };
  });
}

/** Live/preview cards from draft or published config. Does not read catalogue descriptions. */
export function resolveFeaturedBrandCards(config: Record<string, unknown>): FeaturedBrandCard[] {
  const logos = readBrandLogos(config);
  const stored = parseFeaturedBrandCards(config["brandCards"]);
  const slugs = brandSlugsFrom(config);
  const limit = displayCountFrom(config);

  const resolved: FeaturedBrandCard[] = stored.length
    ? stored.map((card) => ({ ...card, logo: cardLogoOrMap(card, logos) }))
    : (slugs.length ? slugs : DEFAULT_FEATURED_BRAND_CARDS.map((card) => card.slug)).map((slug) => {
        const base = defaultFeaturedBrandCard(slug);
        return { ...base, enabled: true, logo: logos[slug] ?? base.logo };
      });

  return resolved.filter((card) => card.enabled).slice(0, limit);
}

export function featuredBrandsSyncFields(cards: FeaturedBrandCard[]): {
  brandCards: FeaturedBrandCard[];
  brandSlugs: string[];
  logos: Record<string, BrandLogoRef>;
} {
  return {
    brandCards: cards,
    brandSlugs: cards.filter((card) => card.enabled).map((card) => card.slug),
    logos: logosRecordFromCards(cards),
  };
}

export function attachFeaturedBrandLogos(
  config: Record<string, unknown>,
  catalogueLogos: Record<string, BrandLogoRef>,
): Record<string, unknown> {
  const cards = parseFeaturedBrandCards(config["brandCards"]);
  const fromCards: Record<string, BrandLogoRef> = {};
  for (const card of cards) {
    if (cmsMediaDisplaySrc(card.logo) && card.logo) fromCards[card.slug] = card.logo;
  }
  const sectionLogos = { ...readBrandLogos(config), ...fromCards };
  const logos = mergeBrandLogoMaps(sectionLogos, catalogueLogos);
  const brandCards = cards.map((card) => ({
    ...card,
    logo: cardLogoOrMap(card, logos),
  }));
  return {
    ...config,
    logos,
    ...(brandCards.length ? { brandCards } : {}),
  };
}

export function defaultFeaturedBrandsConfig(): Record<string, unknown> {
  const cards = DEFAULT_FEATURED_BRAND_CARDS.map((card) => ({ ...card }));
  return {
    heading: DEFAULT_FEATURED_BRANDS_HEADING,
    intro: DEFAULT_FEATURED_BRANDS_INTRO,
    supporting: "",
    brandSlugs: cards.filter((card) => card.enabled).map((card) => card.slug),
    brandCards: cards,
    displayCount: 5,
    variant: "standard",
    spacing: "standard",
    logos: {},
  };
}
