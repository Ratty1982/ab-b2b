/**
 * CMS content for the public Why Us page (/why-automotive-brands).
 * Facts and quotations are taken from https://automotivebrands.co.uk/
 * and https://automotivebrands.co.uk/our-story/ (reviewed 8 Oct 2026).
 * Editor review notes are never rendered on the public page.
 */
import { z } from "zod";
import { publicHeaderAccountLinks } from "@/lib/public-header-account";
import { isTradeCustomerSession } from "@/lib/session-guards";
import type { ClientSession } from "@/server/auth/session";

const IMAGE_FITS = ["fill", "contain", "content"] as const;

export const WHY_US_CONTENT_KEY = "why-us-v1";

export const LEGACY_WHY_US_SEO = {
  seoTitle: "Why Automotive Brands — Trade Supplier for Power Maxed & Steel Seal",
  metaDescription:
    "Automotive Brands supplies Power Maxed and Steel Seal to UK trade customers with account pricing, live availability and dedicated support.",
} as const;

export const WHY_US_PAGE_TITLE = "Why Automotive Brands | Steel Seal & Power Maxed";
export const WHY_US_PAGE_DESCRIPTION =
  "Automotive Brands owns and supplies Steel Seal and Power Maxed, with UK and international distribution, product development and trade support.";

const LEGACY_HERO_HEADLINE = "Trade supply, without the noise";
const LEGACY_HERO_SUPPORTING =
  "A concise proposition for trade customers who need Power Maxed and Steel Seal from one supplier.";

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

const statSchema = z.object({
  value: z.string().max(40).default(""),
  label: z.string().max(80).default(""),
  body: z.string().max(300).default(""),
  reviewNote: z.string().max(400).default(""),
});

const cardSchema = z.object({
  icon: z.string().max(40).default("distribution"),
  title: z.string().max(120).default(""),
  body: z.string().max(600).default(""),
});

const testimonialSchema = z.object({
  quote: z.string().max(2500).default(""),
  name: z.string().max(120).default(""),
  business: z.string().max(200).default(""),
  country: z.string().max(80).default(""),
  published: z.boolean().default(false),
  reviewNote: z.string().max(400).default(""),
});

const brandPanelSchema = z
  .object({
    heading: z.string().max(80).default(""),
    description: z.string().max(600).default(""),
    ctaLabel: z.string().max(80).default(""),
    ctaHref: z.string().max(300).default(""),
    media: mediaSchema,
  })
  .prefault({});

export const whyUsSectionSchema = z.object({
  contentKey: z.string().max(80).default(WHY_US_CONTENT_KEY),
  hero: z
    .object({
      enabled: z.boolean().default(true),
      eyebrow: z.string().max(80).default("Why Automotive Brands"),
      headline: z.string().max(400).default("More than a supplier.\nA partner in your success."),
      highlight: z.string().max(120).default("A partner in your success."),
      description: z.string().max(2000).default(""),
      ctaLabel: z.string().max(80).default("Open a Trade Account"),
      ctaHref: z.string().max(300).default("/register"),
      media: mediaSchema,
    })
    .prefault({}),
  stats: z
    .object({
      enabled: z.boolean().default(true),
      items: z.array(statSchema).max(6).default([]),
    })
    .prefault({}),
  story: z
    .object({
      enabled: z.boolean().default(true),
      eyebrow: z.string().max(80).default("Who we are"),
      headline: z.string().max(400).default("Automotive Brands\nbuilds brands that perform."),
      highlight: z.string().max(120).default("builds brands that perform."),
      body: z.string().max(3000).default(""),
      reviewNote: z.string().max(400).default(""),
      media: mediaSchema,
    })
    .prefault({}),
  support: z
    .object({
      enabled: z.boolean().default(true),
      eyebrow: z.string().max(80).default("How we support our trade partners"),
      headline: z.string().max(200).default("More than just a supply chain"),
      items: z.array(cardSchema).max(8).default([]),
    })
    .prefault({}),
  testimonials: z
    .object({
      enabled: z.boolean().default(true),
      eyebrow: z.string().max(80).default("What our trade partners say"),
      headline: z.string().max(200).default("Trusted by businesses like yours"),
      items: z.array(testimonialSchema).max(12).default([]),
    })
    .prefault({}),
  brands: z
    .object({
      enabled: z.boolean().default(true),
      steelSeal: brandPanelSchema,
      powerMaxed: brandPanelSchema,
    })
    .prefault({}),
  team: z
    .object({
      enabled: z.boolean().default(false),
    })
    .prefault({}),
  close: z
    .object({
      enabled: z.boolean().default(true),
      eyebrow: z.string().max(80).default("Partner with Automotive Brands"),
      headline: z.string().max(200).default("Ready to grow your business?"),
      highlight: z.string().max(80).default("your business?"),
      description: z.string().max(2000).default(""),
      ctaLabel: z.string().max(80).default("Open a Trade Account"),
      ctaHref: z.string().max(300).default("/register"),
    })
    .prefault({}),
});

export type WhyUsContent = z.infer<typeof whyUsSectionSchema>;
export type WhyUsMedia = WhyUsContent["hero"]["media"];

const PORTUGUESE_QUOTE =
  "I first contacted Automotive Brands at Automechanika Birmingham in 2018. I came across a young and motivated team and after spending time with them decided to invest the time and accept the challenge of taking Steel Seal to the Portuguese market. Prosper now has distributors throughout. The success I have had with Steel Seal and later with Power Maxed has been down to the support I have received from Automotive Brands, they have flown to Portugal on many occasions to help me at tradeshows and offer assistance in any training myself oy my staff have needed";

const GERMAN_QUOTE =
  "We have been happy to sell a fantastic and innovative product like Steel Seal for over 6 years now. But having a great product is only half of the story and not enough to succeed if you do not have a strong supplier behind the scenes who supports you. From the beginning we had a fabulous relationship with the Automotive Brands team. Our shared values and common understanding of how to grow a sustainable business, for example putting the customers experience with the products and the brands first, is what unites us and has made our relationship something special. We are looking forward to continue our common venture for many more years to come. Its is the lucky business partner who will be able to do business with the people in this company";

const LIVINGSTON_QUOTE =
  "Steel Seal and Power Maxed are brands our business has sold with great success for a number of years, the products are fantastic but it is the support from Automotive Brands to increase the sales together that has really put them on a pedestal when compared to working with many other suppliers";

export function defaultWhyUsContent(): WhyUsContent {
  return whyUsSectionSchema.parse({
    contentKey: WHY_US_CONTENT_KEY,
    hero: {
      enabled: true,
      eyebrow: "Why Automotive Brands",
      headline: "More than a supplier.\nA partner in your success.",
      highlight: "A partner in your success.",
      description:
        "We develop, market and supply specialist automotive brands, working with trade customers across the UK and internationally.",
      ctaLabel: "Open a Trade Account",
      ctaHref: "/register",
      media: { alt: "Warehouse aisle. This is not a photograph of a named Automotive Brands building." },
    },
    stats: {
      enabled: true,
      items: [
        {
          value: "40+",
          label: "Years combined experience",
          body: "Automotive expertise you can trust.",
          reviewNote:
            "Verified on automotivebrands.co.uk as collective industry experience, not the age of the company. Our Story says Automotive Brands was founded in 2013.",
        },
        {
          value: "3,000+",
          label: "Business relationships",
          body: "Supporting trade customers across the UK and internationally.",
          reviewNote:
            "Verified on automotivebrands.co.uk as over 3,000 businesses worldwide. The page does not define them all as trade accounts.",
        },
        {
          value: "UK & international",
          label: "Distribution",
          body: "Supplying automotive products to domestic and international markets.",
          reviewNote:
            "Verified as a capability: UK motor-factor supply and distributors across the globe. This is not a counted statistic.",
        },
      ],
    },
    story: {
      enabled: true,
      eyebrow: "Who we are",
      headline: "Automotive Brands\nbuilds brands that perform.",
      highlight: "builds brands that perform.",
      body: "Automotive Brands owns and supplies the Steel Seal and Power Maxed brands.\n\nFrom product development and manufacturing to distribution, marketing and customer support, the company works with trade partners in the UK and internationally.",
      reviewNote:
        "Ownership, on-site manufacturing and UK plus international distribution are stated on automotivebrands.co.uk and Our Story. Do not add awards unless a specific award is confirmed.",
      media: { alt: "Automotive product or warehouse photography" },
    },
    support: {
      enabled: true,
      eyebrow: "How we support our trade partners",
      headline: "More than just a supply chain",
      items: [
        {
          icon: "distribution",
          title: "Distribution",
          body: "Supply of Steel Seal and Power Maxed products to UK trade customers and international distributors.",
        },
        {
          icon: "development",
          title: "Product development",
          body: "Product development and on-site manufacturing, including vehicle-care and workshop products in the Power Maxed range.",
        },
        {
          icon: "marketing",
          title: "Marketing support",
          body: "Marketing, product information and sales support for trade partners, including point-of-sale material and training where agreed.",
        },
        {
          icon: "partnership",
          title: "Long-term partnerships",
          body: "Ongoing relationships with trade customers, combining the products with sales and customer support.",
        },
      ],
    },
    testimonials: {
      enabled: true,
      eyebrow: "What our trade partners say",
      headline: "Trusted by businesses like yours",
      items: [
        {
          quote: PORTUGUESE_QUOTE,
          name: "Filipe Barradas",
          business: "Prosper Popularity, Official Portuguese Distributor of Steel Seal and Power Maxed",
          country: "Portugal",
          published: true,
          reviewNote:
            "Exact wording from automotivebrands.co.uk, including the source phrase 'oy my staff'. Confirm before correcting it.",
        },
        {
          quote: GERMAN_QUOTE,
          name: "Oliver Taskin",
          business: "Steel Seal GMBH, Official German distributor of Steel Seal and Power Maxed",
          country: "Germany",
          published: true,
          reviewNote: "Exact wording from automotivebrands.co.uk, including 'Its is'. Business name uses the site spelling GMBH.",
        },
        {
          quote: LIVINGSTON_QUOTE,
          name: "Chris Burnside",
          business: "Livingston Auto Parts",
          country: "",
          published: true,
          reviewNote:
            "Exact wording from automotivebrands.co.uk. The page names the business but does not state a country, so none is shown.",
        },
      ],
    },
    brands: {
      enabled: true,
      steelSeal: {
        heading: "Steel Seal",
        description: "Specialist head gasket and cooling system repair products for the automotive aftermarket.",
        ctaLabel: "View Steel Seal range",
        ctaHref: "/brands/steel-seal",
        media: { alt: "Steel Seal" },
      },
      powerMaxed: {
        heading: "Power Maxed",
        description: "Professional vehicle care, detailing and workshop products for cars, commercial vehicles and workshops.",
        ctaLabel: "View Power Maxed range",
        ctaHref: "/brands/power-maxed",
        media: { alt: "Power Maxed" },
      },
    },
    team: { enabled: false },
    close: {
      enabled: true,
      eyebrow: "Partner with Automotive Brands",
      headline: "Ready to grow your business?",
      highlight: "your business?",
      description:
        "Open a trade account and access Steel Seal and Power Maxed through one convenient ordering portal.",
      ctaLabel: "Open a Trade Account",
      ctaHref: "/register",
    },
  });
}

export type WhyUsLink = { label: string; href: string };

export function whyUsPrimaryCta(session: ClientSession, content: WhyUsContent): WhyUsLink & { offerTradeAccount: boolean } {
  const configured = { label: content.hero.ctaLabel, href: content.hero.ctaHref, offerTradeAccount: true };
  if (!session.signedIn) return configured;
  if (isTradeCustomerSession(session)) {
    return { label: "Go to Trade Portal", href: "/portal", offerTradeAccount: false };
  }
  const account = publicHeaderAccountLinks(session)[0];
  return {
    label: account?.label ?? "Home",
    href: account?.to ?? "/",
    offerTradeAccount: false,
  };
}

export function parseWhyUsContent(config: unknown): WhyUsContent {
  const record = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  return whyUsSectionSchema.parse(record);
}

export function publishedTestimonials(content: WhyUsContent) {
  if (!content.testimonials.enabled) return [];
  return content.testimonials.items.filter((item) => item.published && item.quote.trim() && item.name.trim());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const LEGACY_BENEFIT_BODIES = new Set([
  "Browse both brands in one catalogue and order through a single Automotive Brands trade account.",
  "Approved trade customers see their account pricing on products and in the basket.",
  "Catalogue browsing with case quantities and customer-safe availability for trade supply.",
]);

/**
 * Build the template from the previous hero, benefits and trade CTA.
 * Custom headlines are kept. The new company page is used when the seed is unchanged.
 * Team records are not part of this section and are never deleted here.
 */
export function whyUsContentFromLegacy(
  sections: readonly { type: string; config: unknown; enabled?: boolean }[],
): WhyUsContent {
  const next = defaultWhyUsContent();
  const hero = sections.find((section) => section.type === "HERO" && section.enabled !== false);
  const heroConfig = asRecord(hero?.config);
  if (heroConfig) {
    const headline = text(heroConfig["headline"]);
    const supporting = text(heroConfig["supporting"]);
    if (headline && headline !== LEGACY_HERO_HEADLINE) {
      next.hero.headline = headline;
      next.hero.highlight = "";
    }
    if (supporting && supporting !== LEGACY_HERO_SUPPORTING) next.hero.description = supporting;
    const ctaLabel = text(heroConfig["ctaLabel"]);
    const ctaHref = text(heroConfig["ctaHref"]);
    if (ctaLabel && ctaLabel !== "Open a Trade Account") next.hero.ctaLabel = ctaLabel;
    if (ctaHref && ctaHref !== "/register") next.hero.ctaHref = ctaHref;
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
  const items = Array.isArray(asRecord(benefits?.config)?.["items"]) ? (asRecord(benefits?.config)?.["items"] as unknown[]) : [];
  const custom = items
    .map((item) => asRecord(item))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .filter((row) => {
      const body = text(row["body"]);
      return body && !LEGACY_BENEFIT_BODIES.has(body) && !body.startsWith("Dedicated account manager support");
    });
  if (custom.length) {
    next.support.items = custom.slice(0, 8).map((row) => ({
      icon: "partnership",
      title: text(row["title"]) || "Trade support",
      body: text(row["body"]),
    }));
  }

  const trade = sections.find((section) => section.type === "TRADE_CTA" && section.enabled !== false);
  const tradeConfig = asRecord(trade?.config);
  if (tradeConfig) {
    const headline = text(tradeConfig["headline"]);
    const supporting = text(tradeConfig["supporting"]);
    if (headline && headline !== "Open a trade account") next.close.headline = headline;
    if (supporting && supporting !== "Apply to access trade pricing and the trade portal.") {
      next.close.description = supporting;
    }
  }

  return parseWhyUsContent(next);
}

function mediaIsEmpty(media: { src?: string | undefined; mediaId?: string | undefined }): boolean {
  return !text(media.src) && !text(media.mediaId);
}

function mediaFromUnknown(source: Record<string, unknown> | null, fallbackAlt: string): WhyUsMedia | null {
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

/** Fill empty brand photos from the published brands showcase. Existing photos stay. */
export function applyWhyUsBrandMedia(content: WhyUsContent, showcaseConfig: unknown): WhyUsContent {
  const showcase = asRecord(showcaseConfig);
  if (!showcase) return content;
  const next = parseWhyUsContent(content);
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
