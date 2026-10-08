/**
 * CMS content for the public /trade-solutions page.
 * One structured section. Steel Seal stays before Power Maxed.
 * Editable copy lives here so the route does not hardcode the page.
 */
import { z } from "zod";
import { ACCOUNT_MANAGER_HOURS } from "@/domain/account-manager-hours";
import { publicHeaderAccountLinks } from "@/lib/public-header-account";
import { isTradeCustomerSession } from "@/lib/session-guards";
import type { ClientSession } from "@/server/auth/session";

const IMAGE_FITS = ["fill", "contain", "content"] as const;

export const TRADE_SOLUTIONS_CONTENT_KEY = "trade-solutions-v1";

/** Seed that shipped before the structured template. Replaced only when it still matches. */
export const LEGACY_TRADE_SOLUTIONS_SEO = {
  seoTitle: "Trade Solutions — Automotive Brands",
  metaDescription:
    "Trade pricing, case ordering, live availability and account support for Power Maxed and Steel Seal customers.",
} as const;

export const TRADE_SOLUTIONS_PAGE_TITLE = "Trade Account — Steel Seal & Power Maxed | Automotive Brands";
export const TRADE_SOLUTIONS_PAGE_DESCRIPTION =
  "Open a trade account to order Steel Seal and Power Maxed with account pricing, stock availability and trade portal ordering.";

const LEGACY_HERO_HEADLINE = "Built for trade ordering";
const LEGACY_HERO_SUPPORTING =
  "Practical capabilities for approved Automotive Brands trade accounts ordering Power Maxed and Steel Seal.";

const percent = z.number().min(0).max(100).optional();

const mediaSchema = z
  .object({
    mediaId: z.string().optional(),
    src: z.string().max(2048).optional(),
    alt: z.string().max(300).default(""),
    fit: z.enum(IMAGE_FITS).optional(),
    focalX: percent,
    focalY: percent,
  })
  .default({ alt: "" });

const pointSchema = z.object({
  title: z.string().max(120).default(""),
  body: z.string().max(400).default(""),
});

const benefitSchema = pointSchema.extend({
  icon: z.string().max(40).default("pricing"),
});

const faqSchema = z.object({
  question: z.string().max(200).default(""),
  answer: z.string().max(2000).default(""),
  /** Shown to editors only. Never rendered on the public page. */
  reviewNote: z.string().max(300).default(""),
});

export const tradeSolutionsSectionSchema = z.object({
  contentKey: z.string().max(80).default(TRADE_SOLUTIONS_CONTENT_KEY),
  hero: z
    .object({
      eyebrow: z.string().max(80).default("Trade solutions"),
      headline: z.string().max(400).default("Your trade account.\nYour prices. Your orders."),
      highlight: z.string().max(80).default("Your prices."),
      description: z.string().max(2000).default(""),
      ctaLabel: z.string().max(80).default("Open a Trade Account"),
      ctaHref: z.string().max(300).default("/register"),
      secondaryCtaLabel: z.string().max(80).default("Explore the Benefits"),
      secondaryCtaHref: z.string().max(300).default("#trade-benefits"),
      media: mediaSchema,
      points: z.array(pointSchema).max(4).default([]),
    })
    .prefault({}),
  portal: z
    .object({
      eyebrow: z.string().max(80).default("Inside your trade portal"),
      headline: z.string().max(400).default("Simple, fast\ntrade ordering"),
      highlight: z.string().max(80).default("trade ordering"),
      description: z.string().max(2000).default(""),
      ctaLabel: z.string().max(80).default("Explore the Portal"),
      ctaHref: z.string().max(300).default("/portal"),
      media: mediaSchema,
    })
    .prefault({}),
  benefits: z
    .object({
      eyebrow: z.string().max(80).default("Why choose Automotive Brands?"),
      headline: z.string().max(400).default("Real benefits for your business"),
      highlight: z.string().max(80).default("your business"),
      items: z.array(benefitSchema).max(8).default([]),
    })
    .prefault({}),
  steps: z
    .object({
      eyebrow: z.string().max(80).default("Getting started"),
      headline: z.string().max(200).default("How it works"),
      description: z.string().max(500).default("Getting started with Automotive Brands is simple."),
      items: z.array(pointSchema).max(4).default([]),
    })
    .prefault({}),
  brands: z
    .object({
      eyebrow: z.string().max(80).default("Two specialist brands"),
      headline: z.string().max(200).default("One trade account"),
      description: z.string().max(2000).default(""),
      ctaLabel: z.string().max(80).default("Open a Trade Account"),
      ctaHref: z.string().max(300).default("/register"),
      secondaryCtaLabel: z.string().max(80).default("Shop Products"),
      secondaryCtaHref: z.string().max(300).default("/products"),
      steelSeal: z.object({ media: mediaSchema }).prefault({}),
      powerMaxed: z.object({ media: mediaSchema }).prefault({}),
    })
    .prefault({}),
  faq: z
    .object({
      eyebrow: z.string().max(80).default("Frequently asked questions"),
      headline: z.string().max(200).default("Your questions answered"),
      highlight: z.string().max(80).default("answered"),
    })
    .prefault({}),
  faqs: z.array(faqSchema).max(20).default([]),
  close: z
    .object({
      enabled: z.boolean().default(false),
      headline: z.string().max(400).default("Ready to open your trade account?"),
      description: z.string().max(2000).default(""),
      ctaLabel: z.string().max(80).default("Open a Trade Account"),
      ctaHref: z.string().max(300).default("/register"),
      secondaryCtaLabel: z.string().max(80).default("Browse Products"),
      secondaryCtaHref: z.string().max(300).default("/products"),
    })
    .prefault({}),
});

export type TradeSolutionsContent = z.infer<typeof tradeSolutionsSectionSchema>;
export type TradeSolutionsMedia = TradeSolutionsContent["hero"]["media"];

const hoursAnswer = `${ACCOUNT_MANAGER_HOURS.orderCutoffLine}. Account support is available ${ACCOUNT_MANAGER_HOURS.weekdayLine}. This is an order cut-off. It is not a promise that goods will leave the same day.`;

export function defaultTradeSolutionsContent(): TradeSolutionsContent {
  return tradeSolutionsSectionSchema.parse({
    contentKey: TRADE_SOLUTIONS_CONTENT_KEY,
    hero: {
      eyebrow: "Trade solutions",
      headline: "Your trade account.\nYour prices. Your orders.",
      highlight: "Your prices.",
      description:
        "Everything your business needs to order Steel Seal and Power Maxed products in one place. Professional pricing, stock availability, quick ordering and dedicated support.",
      ctaLabel: "Open a Trade Account",
      ctaHref: "/register",
      secondaryCtaLabel: "Explore the Benefits",
      secondaryCtaHref: "#trade-benefits",
      media: { alt: "Mechanic working on a laptop in an automotive workshop" },
      points: [
        { title: "Two specialist brands, one account", body: "" },
        { title: "Trade pricing and account support", body: "" },
        { title: "Fast ordering for workshops and trade", body: "" },
      ],
    },
    portal: {
      eyebrow: "Inside your trade portal",
      headline: "Simple, fast\ntrade ordering",
      highlight: "trade ordering",
      description:
        "Browse the Steel Seal and Power Maxed ranges, see your account pricing, check stock availability and place orders through your trade account.",
      ctaLabel: "Explore the Portal",
      ctaHref: "/portal",
      media: { alt: "Automotive Brands trade portal" },
    },
    benefits: {
      eyebrow: "Why choose Automotive Brands?",
      headline: "Real benefits for your business",
      highlight: "your business",
      items: [
        {
          icon: "pricing",
          title: "Trade pricing",
          body: "See your approved trade prices across the product range.",
        },
        {
          icon: "account",
          title: "Customer-specific pricing",
          body: "Agreed pricing can be applied to individual trade accounts.",
        },
        {
          icon: "case",
          title: "Case ordering",
          body: "Order in the correct case quantities where case packs apply.",
        },
        {
          icon: "stock",
          title: "Stock availability",
          body: "See customer-safe stock availability when browsing and ordering.",
        },
        {
          icon: "order",
          title: "Quick ordering",
          body: "Find products quickly and streamline repeat purchasing.",
        },
        {
          icon: "support",
          title: "Account support",
          body: `Access account support through your trade portal. ${ACCOUNT_MANAGER_HOURS.weekdayLine}. ${ACCOUNT_MANAGER_HOURS.orderCutoffLine}.`,
        },
      ],
    },
    steps: {
      eyebrow: "Getting started",
      headline: "How it works",
      description: "Getting started with Automotive Brands is simple.",
      items: [
        { title: "Apply for an account", body: "Complete our trade account application." },
        {
          title: "Get approved",
          body: "Our team reviews your application and confirms your trade account.",
        },
        {
          title: "Start ordering",
          body: "Log in to access your approved pricing and place orders online.",
        },
      ],
    },
    brands: {
      eyebrow: "Two specialist brands",
      headline: "One trade account",
      description:
        "Access the Steel Seal and Power Maxed ranges through one Automotive Brands trade account. Everything you need for workshops, vehicle care and engine repair.",
      ctaLabel: "Open a Trade Account",
      ctaHref: "/register",
      secondaryCtaLabel: "Shop Products",
      secondaryCtaHref: "/products",
      steelSeal: { media: { alt: "Steel Seal" } },
      powerMaxed: { media: { alt: "Power Maxed" } },
    },
    faq: {
      eyebrow: "Frequently asked questions",
      headline: "Your questions answered",
      highlight: "answered",
    },
    faqs: [
      {
        question: "Who can apply for a trade account?",
        answer:
          "Workshops, motor factors, retailers and other trade businesses can apply. Automotive Brands reviews each application.",
        reviewNote: "Confirm eligibility before publishing a stricter rule.",
      },
      {
        question: "How long does approval take?",
        answer:
          "Applications are reviewed by the Automotive Brands team. A fixed approval time is not published on this page.",
        reviewNote: "Add an approval time only after it is confirmed.",
      },
      {
        question: "How does trade pricing work?",
        answer:
          "Approved trade accounts see their account pricing on the catalogue and product pages. Agreed prices can be applied to an individual account.",
        reviewNote: "",
      },
      {
        question: "Can I order case quantities?",
        answer: "Where a product is sold as a case pack, the trade catalogue uses that case quantity.",
        reviewNote: "",
      },
      {
        question: "What delivery options are available?",
        answer: "Delivery is arranged through your trade account. Delivery charges are not published on this page.",
        reviewNote: "Confirm delivery options and charges before replacing this answer.",
      },
      {
        question: "What is the same-day order cut-off time?",
        answer: hoursAnswer,
        reviewNote: "",
      },
    ],
    close: {
      enabled: false,
      headline: "Ready to open your trade account?",
      description:
        "Join Automotive Brands and access Steel Seal and Power Maxed through one trade ordering portal.",
      ctaLabel: "Open a Trade Account",
      ctaHref: "/register",
      secondaryCtaLabel: "Browse Products",
      secondaryCtaHref: "/products",
    },
  });
}

export type TradeSolutionsLink = { label: string; href: string };

export type TradeSolutionsCtas = {
  offerTradeAccount: boolean;
  heroPrimary: TradeSolutionsLink;
  heroSecondary: TradeSolutionsLink;
  portal: TradeSolutionsLink;
  brandsPrimary: TradeSolutionsLink;
  brandsSecondary: TradeSolutionsLink;
  closePrimary: TradeSolutionsLink;
  closeSecondary: TradeSolutionsLink;
};

const PORTAL_LINK: TradeSolutionsLink = { label: "Go to Trade Portal", href: "/portal" };

/**
 * Anonymous visitors can apply. Approved trade customers go to the portal.
 * Other signed-in users follow the same account destination as the public header.
 */
export function tradeSolutionsCtas(session: ClientSession, content: TradeSolutionsContent): TradeSolutionsCtas {
  const anonymous: TradeSolutionsCtas = {
    offerTradeAccount: true,
    heroPrimary: { label: content.hero.ctaLabel, href: content.hero.ctaHref },
    heroSecondary: { label: content.hero.secondaryCtaLabel, href: content.hero.secondaryCtaHref },
    portal: { label: content.portal.ctaLabel, href: content.portal.ctaHref },
    brandsPrimary: { label: content.brands.ctaLabel, href: content.brands.ctaHref },
    brandsSecondary: { label: content.brands.secondaryCtaLabel, href: content.brands.secondaryCtaHref },
    closePrimary: { label: content.close.ctaLabel, href: content.close.ctaHref },
    closeSecondary: { label: content.close.secondaryCtaLabel, href: content.close.secondaryCtaHref },
  };
  if (!session.signedIn) return anonymous;
  if (isTradeCustomerSession(session)) {
    return {
      offerTradeAccount: false,
      heroPrimary: PORTAL_LINK,
      heroSecondary: anonymous.heroSecondary,
      portal: { label: content.portal.ctaLabel, href: "/portal" },
      brandsPrimary: PORTAL_LINK,
      brandsSecondary: anonymous.brandsSecondary,
      closePrimary: PORTAL_LINK,
      closeSecondary: anonymous.closeSecondary,
    };
  }
  const account = publicHeaderAccountLinks(session)[0];
  const home = account ?? { label: "Home", to: "/" };
  const signedInHome = { label: home.label, href: home.to };
  return {
    offerTradeAccount: false,
    heroPrimary: signedInHome,
    heroSecondary: anonymous.heroSecondary,
    portal: { label: content.portal.ctaLabel, href: "/portal" },
    brandsPrimary: signedInHome,
    brandsSecondary: anonymous.brandsSecondary,
    closePrimary: signedInHome,
    closeSecondary: anonymous.closeSecondary,
  };
}

const DEFAULT_HERO_HEADLINE = "Your trade account.\nYour prices. Your orders.";

/**
 * The first migration copied the old page-hero default secondary button.
 * Restore the benefits jump only when that pair is still untouched and the headline
 * is the approved default. Custom buttons and custom headlines stay as saved.
 */
export function upgradeMigratedTradeSolutions(content: TradeSolutionsContent): {
  content: TradeSolutionsContent;
  changed: boolean;
} {
  const next = parseTradeSolutionsContent(content);
  if (
    next.hero.headline === DEFAULT_HERO_HEADLINE &&
    next.hero.secondaryCtaLabel === "Shop Products" &&
    next.hero.secondaryCtaHref === "/products"
  ) {
    next.hero.secondaryCtaLabel = "Explore the Benefits";
    next.hero.secondaryCtaHref = "#trade-benefits";
    return { content: next, changed: true };
  }
  return { content: next, changed: false };
}

export function parseTradeSolutionsContent(config: unknown): TradeSolutionsContent {
  const record = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  return tradeSolutionsSectionSchema.parse(record);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const LEGACY_BENEFIT_BODIES: Record<string, string> = {
  "trade pricing": "Approved customers see their account pricing on the catalogue and product pages.",
  "customer-specific pricing": "Negotiated product prices can be applied to individual trade accounts.",
  "case ordering": "Products can be ordered in the correct trade case quantities where case packs apply.",
  "live availability":
    "Customer-safe availability is derived from current stock data at the point of browsing and ordering.",
  "account support": `Dedicated account manager details are available in the trade portal. ${ACCOUNT_MANAGER_HOURS.weekdayLine}. ${ACCOUNT_MANAGER_HOURS.orderCutoffLine}.`,
  "quick ordering": "Trade catalogue designed for rapid repeat purchasing of Power Maxed and Steel Seal lines.",
};

const LEGACY_BENEFIT_DEFAULT_INDEX: Record<string, number> = {
  "trade pricing": 0,
  "customer-specific pricing": 1,
  "case ordering": 2,
  "live availability": 3,
  "quick ordering": 4,
  "account support": 5,
};

/**
 * Build the template from the previous hero, benefits grid and trade CTA.
 * Custom headlines and benefit copy are kept. New sections use the approved defaults.
 */
export function tradeSolutionsContentFromLegacy(
  sections: readonly { type: string; config: unknown; enabled?: boolean }[],
): TradeSolutionsContent {
  const next = defaultTradeSolutionsContent();
  const hero = sections.find((section) => section.type === "HERO" && section.enabled !== false);
  const heroConfig = asRecord(hero?.config);
  if (heroConfig) {
    const headline = text(heroConfig["headline"]);
    const supporting = text(heroConfig["supporting"]);
    const eyebrow = text(heroConfig["eyebrow"]);
    const ctaLabel = text(heroConfig["ctaLabel"]);
    const ctaHref = text(heroConfig["ctaHref"]);
    const secondaryCtaLabel = text(heroConfig["secondaryCtaLabel"]);
    const secondaryCtaHref = text(heroConfig["secondaryCtaHref"]);
    if (eyebrow && eyebrow.toLowerCase() !== "trade solutions") next.hero.eyebrow = eyebrow;
    if (headline && headline !== LEGACY_HERO_HEADLINE) {
      next.hero.headline = headline;
      next.hero.highlight = "";
    }
    if (supporting && supporting !== LEGACY_HERO_SUPPORTING) next.hero.description = supporting;
    if (ctaLabel && ctaLabel !== "Open a Trade Account") next.hero.ctaLabel = ctaLabel;
    if (ctaHref && ctaHref !== "/register") next.hero.ctaHref = ctaHref;
    if (secondaryCtaLabel && secondaryCtaLabel !== "Shop Products") next.hero.secondaryCtaLabel = secondaryCtaLabel;
    if (secondaryCtaHref && secondaryCtaHref !== "/products") next.hero.secondaryCtaHref = secondaryCtaHref;
    const media = asRecord(heroConfig["media"]);
    if (media && (text(media["src"]) || text(media["mediaId"]))) {
      next.hero.media = {
        alt: text(media["alt"]) || next.hero.media.alt,
        ...(text(media["src"]) ? { src: text(media["src"]) } : {}),
        ...(text(media["mediaId"]) ? { mediaId: text(media["mediaId"]) } : {}),
        ...(typeof media["focalX"] === "number" ? { focalX: media["focalX"] } : {}),
        ...(typeof media["focalY"] === "number" ? { focalY: media["focalY"] } : {}),
      };
    }
  }

  const benefits = sections.find((section) => section.type === "BENEFITS_GRID");
  const benefitConfig = asRecord(benefits?.config);
  const items = Array.isArray(benefitConfig?.["items"]) ? benefitConfig["items"] : [];
  if (items.length) {
    const defaults = next.benefits.items;
    const mapped = items.slice(0, 8).map((item, index) => {
      const row = asRecord(item);
      const title = text(row?.["title"]);
      const body = text(row?.["body"]);
      const key = title.toLowerCase();
      const legacyBody = LEGACY_BENEFIT_BODIES[key];
      const unchanged = legacyBody !== undefined && (body === legacyBody || body === "");
      const fallback = defaults[LEGACY_BENEFIT_DEFAULT_INDEX[key] ?? index] ?? defaults[0]!;
      return {
        unchanged,
        icon: fallback.icon,
        title: unchanged || !title ? fallback.title : title,
        body: unchanged || !body ? fallback.body : body,
      };
    });
    const originalSeed = mapped.length === defaults.length && mapped.every((item) => item.unchanged);
    next.benefits.items = originalSeed
      ? defaults
      : mapped.map(({ icon, title, body }) => ({ icon, title, body }));
  }

  const trade = sections.find((section) => section.type === "TRADE_CTA" && section.enabled !== false);
  const tradeConfig = asRecord(trade?.config);
  if (tradeConfig) {
    const headline = text(tradeConfig["headline"]);
    const supporting = text(tradeConfig["supporting"]);
    if (headline && headline !== "Open a trade account") {
      next.close.headline = headline;
      next.close.enabled = true;
    }
    if (supporting && supporting !== "Apply for account pricing on Power Maxed and Steel Seal.") {
      next.close.description = supporting;
    }
  }

  return parseTradeSolutionsContent(next);
}

function mediaIsEmpty(media: { src?: string | undefined; mediaId?: string | undefined }): boolean {
  return !text(media.src) && !text(media.mediaId);
}

function mediaFromUnknown(source: Record<string, unknown> | null, fallbackAlt: string): TradeSolutionsMedia | null {
  if (!source) return null;
  const src = text(source["src"]);
  const mediaId = text(source["mediaId"]);
  if (!src && !mediaId) return null;
  const fit = text(source["fit"]);
  return {
    alt: text(source["alt"]) || fallbackAlt,
    ...(src ? { src } : {}),
    ...(mediaId ? { mediaId } : {}),
    ...(fit === "fill" || fit === "contain" || fit === "content" ? { fit } : {}),
    ...(typeof source["focalX"] === "number" ? { focalX: source["focalX"] } : {}),
    ...(typeof source["focalY"] === "number" ? { focalY: source["focalY"] } : {}),
  };
}

/**
 * Fill empty Steel Seal and Power Maxed photo slots from the published brands showcase.
 * Existing trade-page photos are left untouched.
 */
export function applyShowcaseBrandMedia(
  content: TradeSolutionsContent,
  showcaseConfig: unknown,
): TradeSolutionsContent {
  const showcase = asRecord(showcaseConfig);
  if (!showcase) return content;
  const next = parseTradeSolutionsContent(content);
  if (mediaIsEmpty(next.brands.steelSeal.media)) {
    const media = mediaFromUnknown(asRecord(asRecord(showcase["steelSeal"])?.["media"]), next.brands.steelSeal.media.alt);
    if (media) next.brands.steelSeal.media = media;
  }
  if (mediaIsEmpty(next.brands.powerMaxed.media)) {
    const media = mediaFromUnknown(
      asRecord(asRecord(showcase["powerMaxed"])?.["media"]),
      next.brands.powerMaxed.media.alt,
    );
    if (media) next.brands.powerMaxed.media = media;
  }
  return next;
}
