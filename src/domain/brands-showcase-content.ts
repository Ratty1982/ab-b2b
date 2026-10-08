/**
 * CMS content for the public /brands showcase.
 * Steel Seal and Power Maxed are fixed fields, in that order.
 * Editors cannot add a third public brand or swap the sequence by reordering an array.
 */
import { validateSectionConfig } from "@/domain/cms";

export const BRANDS_SHOWCASE_CONTENT_KEY = "brands-showcase-v1";

/** Disconnected Website → Pages seed. It was not the live /brands design. */
export const LEGACY_BRANDS_PAGE_SEO = {
  seoTitle: "Our Brands — Automotive Brands",
  metaDescription:
    "Power Maxed and Steel Seal — trade brands supplied through one Automotive Brands account.",
} as const;

const LEGACY_BRANDS_HEADLINE = "Two brands. One trade supplier.";
const LEGACY_BRANDS_DESCRIPTION_PREFIX =
  "Power Maxed and Steel Seal are available through a single Automotive Brands trade account";
const LEGACY_STEEL_SEAL_DESCRIPTION = "Head gasket repair and cooling-system repair products.";
const LEGACY_POWER_MAXED_DESCRIPTION =
  "Professional valeting, cleaning, workshop and vehicle maintenance products.";

export const BRAND_SHOWCASE_SHOP_HREF = {
  "steel-seal": "/brands/steel-seal",
  "power-maxed": "/brands/power-maxed",
} as const;

export type BrandsShowcaseMedia = {
  mediaId?: string;
  src?: string;
  alt: string;
  fit?: "fill" | "contain" | "content";
  focalX?: number;
  focalY?: number;
};

export type BrandsShowcasePanel = {
  kicker: string;
  heading: string;
  description: string;
  points: string[];
  ctaLabel: string;
  ctaHref: string;
  media: BrandsShowcaseMedia;
};

export type BrandsShowcaseContent = {
  contentKey: string;
  hero: {
    eyebrow: string;
    headline: string;
    description: string;
    ctaLabel: string;
    ctaHref: string;
    secondaryCtaLabel: string;
    secondaryCtaHref: string;
    media: BrandsShowcaseMedia;
  };
  steelSeal: BrandsShowcasePanel;
  powerMaxed: BrandsShowcasePanel;
  close: {
    headline: string;
    description: string;
    ctaLabel: string;
    ctaHref: string;
    secondaryCtaLabel: string;
    secondaryCtaHref: string;
  };
};

const emptyMedia = (): BrandsShowcaseMedia => ({ alt: "" });

export function defaultBrandsShowcaseContent(): BrandsShowcaseContent {
  return {
    contentKey: BRANDS_SHOWCASE_CONTENT_KEY,
    hero: {
      eyebrow: "Our Brands",
      headline: "Two specialist brands.\nOne trade account.",
      description:
        "Professional vehicle care, workshop and engine repair products from Steel Seal and Power Maxed, available through one Automotive Brands trade account.",
      ctaLabel: "Shop Products",
      ctaHref: "/products",
      secondaryCtaLabel: "Open a Trade Account",
      secondaryCtaHref: "/register",
      media: emptyMedia(),
    },
    steelSeal: {
      kicker: "Head Gasket & Cooling Repair",
      heading: "Steel Seal",
      description:
        "Specialist head gasket and cooling-system repair products for workshops and trade counters. Trusted by professionals across the automotive aftermarket.",
      points: ["Head gasket repair", "Cooling-system repair", "Workshop and trade use"],
      ctaLabel: "Shop Steel Seal",
      ctaHref: BRAND_SHOWCASE_SHOP_HREF["steel-seal"],
      media: { alt: "Steel Seal engine and head gasket photography" },
    },
    powerMaxed: {
      kicker: "Vehicle Care & Workshop",
      heading: "Power Maxed",
      description:
        "Professional vehicle care, detailing, maintenance and workshop products for the trade. High-performance solutions for cars, commercial vehicles and workshops.",
      points: ["Valeting and detailing", "Vehicle maintenance", "Workshop products"],
      ctaLabel: "Shop Power Maxed",
      ctaHref: BRAND_SHOWCASE_SHOP_HREF["power-maxed"],
      media: { alt: "Power Maxed vehicle care and workshop photography" },
    },
    close: {
      headline: "One account.\nBoth brands.",
      description:
        "Access Steel Seal and Power Maxed trade products through one Automotive Brands account.",
      ctaLabel: "Open a Trade Account",
      ctaHref: "/register",
      secondaryCtaLabel: "Shop Products",
      secondaryCtaHref: "/products",
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mediaFrom(value: unknown, fallback: BrandsShowcaseMedia): BrandsShowcaseMedia {
  const record = asRecord(value);
  if (!record) return { ...fallback };
  return {
    ...fallback,
    ...(typeof record["mediaId"] === "string" && record["mediaId"] ? { mediaId: record["mediaId"] } : {}),
    ...(typeof record["src"] === "string" && record["src"] ? { src: record["src"] } : {}),
    alt: text(record["alt"]) || fallback.alt,
    ...(record["fit"] === "fill" || record["fit"] === "contain" || record["fit"] === "content"
      ? { fit: record["fit"] }
      : {}),
    ...(typeof record["focalX"] === "number" ? { focalX: record["focalX"] } : {}),
    ...(typeof record["focalY"] === "number" ? { focalY: record["focalY"] } : {}),
  };
}

function panelCopy(
  cards: unknown,
  slug: "steel-seal" | "power-maxed",
  fallback: BrandsShowcasePanel,
): BrandsShowcasePanel {
  if (!Array.isArray(cards)) return fallback;
  const card = cards.find((item) => asRecord(item)?.["slug"] === slug);
  const record = asRecord(card);
  if (!record) return fallback;
  const heading = text(record["heading"]).trim();
  const description = text(record["description"]).trim();
  return {
    ...fallback,
    ...(heading ? { heading } : {}),
    ...(description ? { description } : {}),
  };
}

/**
 * Build the new section from an existing brands page version.
 * Keeps hero and the two brand descriptions. Ignores every other brand card.
 */
export function brandsShowcaseContentFromLegacy(
  sections: readonly { type: string; config: unknown; enabled?: boolean }[],
): BrandsShowcaseContent {
  const next = defaultBrandsShowcaseContent();
  const hero = sections.find((section) => section.type === "HERO" && section.enabled !== false);
  const heroConfig = asRecord(hero?.config);
  if (heroConfig) {
    const eyebrow = text(heroConfig["eyebrow"]).trim();
    const headline = text(heroConfig["headline"]).trim();
    const supporting = text(heroConfig["supporting"]).trim();
    const ctaLabel = text(heroConfig["ctaLabel"]).trim();
    const ctaHref = text(heroConfig["ctaHref"]).trim();
    const secondaryCtaLabel = text(heroConfig["secondaryCtaLabel"]).trim();
    const secondaryCtaHref = text(heroConfig["secondaryCtaHref"]).trim();
    if (eyebrow) next.hero.eyebrow = eyebrow;
    if (headline) next.hero.headline = headline;
    if (supporting) next.hero.description = supporting;
    if (ctaLabel) next.hero.ctaLabel = ctaLabel;
    if (ctaHref) next.hero.ctaHref = ctaHref;
    if (secondaryCtaLabel) next.hero.secondaryCtaLabel = secondaryCtaLabel;
    if (secondaryCtaHref) next.hero.secondaryCtaHref = secondaryCtaHref;
    next.hero.media = mediaFrom(heroConfig["media"], next.hero.media);
  }

  const featured = sections.find((section) => section.type === "FEATURED_BRANDS");
  const featuredConfig = asRecord(featured?.config);
  if (featuredConfig) {
    next.steelSeal = panelCopy(featuredConfig["brandCards"], "steel-seal", next.steelSeal);
    next.powerMaxed = panelCopy(featuredConfig["brandCards"], "power-maxed", next.powerMaxed);
  }

  const trade = sections.find((section) => section.type === "TRADE_CTA" && section.enabled !== false);
  const tradeConfig = asRecord(trade?.config);
  if (tradeConfig) {
    const headline = text(tradeConfig["headline"]).trim();
    const supporting = text(tradeConfig["supporting"]).trim();
    const ctaLabel = text(tradeConfig["ctaLabel"]).trim();
    const ctaHref = text(tradeConfig["ctaHref"]).trim();
    const secondaryCtaLabel = text(tradeConfig["secondaryCtaLabel"]).trim();
    const secondaryCtaHref = text(tradeConfig["secondaryCtaHref"]).trim();
    if (headline) next.close.headline = headline;
    if (supporting) next.close.description = supporting;
    if (ctaLabel) next.close.ctaLabel = ctaLabel;
    if (ctaHref) next.close.ctaHref = ctaHref;
    if (secondaryCtaLabel) next.close.secondaryCtaLabel = secondaryCtaLabel;
    if (secondaryCtaHref) next.close.secondaryCtaHref = secondaryCtaHref;
  }

  return parseBrandsShowcaseContent(next);
}

/**
 * Replace the old disconnected brands seed with the approved showcase copy.
 * Custom headlines, descriptions, and uploaded images are left in place.
 */
export function upgradeLegacyBrandsShowcaseContent(content: BrandsShowcaseContent): {
  content: BrandsShowcaseContent;
  changed: boolean;
} {
  const next: BrandsShowcaseContent = {
    ...content,
    hero: { ...content.hero, media: { ...content.hero.media } },
    steelSeal: { ...content.steelSeal, media: { ...content.steelSeal.media }, points: [...content.steelSeal.points] },
    powerMaxed: {
      ...content.powerMaxed,
      media: { ...content.powerMaxed.media },
      points: [...content.powerMaxed.points],
    },
    close: { ...content.close },
  };
  const defaults = defaultBrandsShowcaseContent();
  let changed = false;
  const legacyHero =
    next.hero.headline.trim() === LEGACY_BRANDS_HEADLINE ||
    next.hero.description.trim().startsWith(LEGACY_BRANDS_DESCRIPTION_PREFIX);
  if (legacyHero) {
    const media = next.hero.media;
    const keepMedia = Boolean(media.src || media.mediaId);
    next.hero = { ...defaults.hero, media: keepMedia ? media : { ...defaults.hero.media } };
    changed = true;
  }
  if (next.steelSeal.description.trim() === LEGACY_STEEL_SEAL_DESCRIPTION) {
    next.steelSeal.description = defaults.steelSeal.description;
    changed = true;
  }
  if (next.powerMaxed.description.trim() === LEGACY_POWER_MAXED_DESCRIPTION) {
    next.powerMaxed.description = defaults.powerMaxed.description;
    changed = true;
  }
  return { content: next, changed };
}

export function parseBrandsShowcaseContent(config: unknown): BrandsShowcaseContent {
  try {
    const parsed = validateSectionConfig("BRANDS_SHOWCASE", config ?? {}) as BrandsShowcaseContent;
    return {
      ...defaultBrandsShowcaseContent(),
      ...parsed,
      hero: {
        ...defaultBrandsShowcaseContent().hero,
        ...parsed.hero,
        media: mediaFrom(parsed.hero?.media, emptyMedia()),
      },
      steelSeal: {
        ...defaultBrandsShowcaseContent().steelSeal,
        ...parsed.steelSeal,
        points: cleanPoints(parsed.steelSeal?.points, defaultBrandsShowcaseContent().steelSeal.points),
        ctaHref: BRAND_SHOWCASE_SHOP_HREF["steel-seal"],
        media: mediaFrom(parsed.steelSeal?.media, defaultBrandsShowcaseContent().steelSeal.media),
      },
      powerMaxed: {
        ...defaultBrandsShowcaseContent().powerMaxed,
        ...parsed.powerMaxed,
        points: cleanPoints(parsed.powerMaxed?.points, defaultBrandsShowcaseContent().powerMaxed.points),
        ctaHref: BRAND_SHOWCASE_SHOP_HREF["power-maxed"],
        media: mediaFrom(parsed.powerMaxed?.media, defaultBrandsShowcaseContent().powerMaxed.media),
      },
      close: {
        ...defaultBrandsShowcaseContent().close,
        ...parsed.close,
      },
      contentKey: parsed.contentKey || BRANDS_SHOWCASE_CONTENT_KEY,
    };
  } catch {
    return defaultBrandsShowcaseContent();
  }
}

function cleanPoints(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const points = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
  return points.length ? points : fallback;
}
