import type { CmsSectionTypeKey } from "@/domain/cms";
import { ACCOUNT_MANAGER_HOURS } from "@/domain/account-manager-hours";
import { defaultFeaturedBrandsConfig } from "@/domain/featured-brands";
import { MOTORSPORT_PAGE_DEFAULTS } from "@/domain/motorsport";

export type MarketingPageSeed = {
  slug: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  blurb: string;
  /** When false, page is still CMS-editable but kept off primary public nav. */
  primaryNav: boolean;
  sections: Array<{
    type: CmsSectionTypeKey;
    config: Record<string, unknown>;
    enabled?: boolean;
  }>;
};

function pageHero(input: {
  eyebrow: string;
  headline: string;
  supporting: string;
  ctaLabel?: string;
  ctaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
}): MarketingPageSeed["sections"][number] {
  return {
    type: "HERO",
    config: {
      eyebrow: input.eyebrow,
      headline: input.headline,
      supporting: input.supporting,
      ctaLabel: input.ctaLabel ?? "Open a Trade Account",
      ctaHref: input.ctaHref ?? "/register",
      secondaryCtaLabel: input.secondaryCtaLabel ?? "Shop Products",
      secondaryCtaHref: input.secondaryCtaHref ?? "/products",
      loginCtaLabel: "Trade Login",
      loginCtaHref: "/login",
      calloutSku: "",
      alignment: "left",
      contentPosition: "middle",
      // dark/light = compact page header (no full-bleed hero image) in CmsSectionRenderer
      variant: "dark",
      spacing: "standard",
      overlayStrength: 0,
      media: { alt: "", fit: "fill", focalX: 50, focalY: 50 },
    },
  };
}

/**
 * Canonical marketing CMS pages for the public website (excluding homepage).
 * Homepage remains seeded by homepage-seed.ts / bootstrapHomepageCms.
 */
export const MARKETING_CMS_PAGES: MarketingPageSeed[] = [
  {
    slug: "brands",
    title: "Brands",
    seoTitle: "Our Brands — Automotive Brands",
    metaDescription:
      "Power Maxed and Steel Seal — trade brands supplied through one Automotive Brands account.",
    blurb: "Brand portfolio introduction (catalogue cards load live)",
    primaryNav: true,
    sections: [
      pageHero({
        eyebrow: "Brands",
        headline: "Two brands. One trade supplier.",
        supporting:
          "Power Maxed and Steel Seal are available through a single Automotive Brands trade account — browse the range, then order with account pricing once approved.",
        ctaLabel: "Shop Products",
        ctaHref: "/products",
        secondaryCtaLabel: "Open a Trade Account",
        secondaryCtaHref: "/register",
      }),
      {
        type: "FEATURED_BRANDS",
        config: {
          ...defaultFeaturedBrandsConfig(),
          eyebrow: "",
          heading: "",
          intro: "",
        },
        // Catalogue brand cards are rendered by the /brands route; keep CMS brand strip off by default.
        enabled: false,
      },
    ],
  },
  {
    slug: "trade-solutions",
    title: "Trade Solutions",
    seoTitle: "Trade Solutions — Automotive Brands",
    metaDescription:
      "Trade pricing, case ordering, live availability and account support for Power Maxed and Steel Seal customers.",
    blurb: "Trade platform capabilities",
    primaryNav: true,
    sections: [
      pageHero({
        eyebrow: "Trade solutions",
        headline: "Built for trade ordering",
        supporting:
          "Practical capabilities for approved Automotive Brands trade accounts ordering Power Maxed and Steel Seal.",
      }),
      {
        type: "BENEFITS_GRID",
        config: {
          eyebrow: "",
          heading: "",
          supporting: "",
          ctaLabel: "",
          ctaHref: "/register",
          items: [
            {
              title: "Trade pricing",
              body: "Approved customers see their account pricing on the catalogue and product pages.",
              icon: "clipboard",
            },
            {
              title: "Customer-specific pricing",
              body: "Negotiated product prices can be applied to individual trade accounts.",
              icon: "clipboard",
            },
            {
              title: "Case ordering",
              body: "Products can be ordered in the correct trade case quantities where case packs apply.",
              icon: "truck",
            },
            {
              title: "Live availability",
              body: "Customer-safe availability is derived from current stock data at the point of browsing and ordering.",
              icon: "warehouse",
            },
            {
              title: "Account support",
              body: `Dedicated account manager details are available in the trade portal. ${ACCOUNT_MANAGER_HOURS.weekdayLine}. ${ACCOUNT_MANAGER_HOURS.orderCutoffLine}.`,
              icon: "headphones",
            },
            {
              title: "Quick ordering",
              body: "Trade catalogue designed for rapid repeat purchasing of Power Maxed and Steel Seal lines.",
              icon: "truck",
            },
          ],
          customerTypes: [],
          spacing: "standard",
          media: { alt: "", fit: "fill" },
        },
      },
      {
        type: "TRADE_CTA",
        config: {
          eyebrow: "Ready to trade",
          headline: "Open a trade account",
          supporting: "Apply for account pricing on Power Maxed and Steel Seal.",
          ctaLabel: "Open a Trade Account",
          ctaHref: "/register",
          secondaryCtaLabel: "Shop Products",
          secondaryCtaHref: "/products",
          variant: "dark",
          spacing: "standard",
          media: { alt: "", fit: "fill" },
        },
      },
    ],
  },
  {
    slug: "why-automotive-brands",
    title: "Why Automotive Brands",
    seoTitle: "Why Automotive Brands — Trade Supplier for Power Maxed & Steel Seal",
    metaDescription:
      "Automotive Brands supplies Power Maxed and Steel Seal to UK trade customers with account pricing, live availability and dedicated support.",
    blurb: "Credibility and trade proposition",
    primaryNav: true,
    sections: [
      pageHero({
        eyebrow: "Why Automotive Brands",
        headline: "Trade supply, without the noise",
        supporting:
          "A concise proposition for trade customers who need Power Maxed and Steel Seal from one supplier.",
        secondaryCtaLabel: "View Brands",
        secondaryCtaHref: "/brands",
      }),
      {
        type: "BENEFITS_GRID",
        config: {
          eyebrow: "",
          heading: "",
          supporting: "",
          ctaLabel: "",
          ctaHref: "/register",
          items: [
            {
              title: "Trade supplier for Power Maxed & Steel Seal",
              body: "Browse both brands in one catalogue and order through a single Automotive Brands trade account.",
              icon: "warehouse",
            },
            {
              title: "Commercial pricing for approved accounts",
              body: "Approved trade customers see their account pricing on products and in the basket.",
              icon: "clipboard",
            },
            {
              title: "Ordering convenience",
              body: "Catalogue browsing with case quantities and customer-safe availability for trade supply.",
              icon: "truck",
            },
            {
              title: "Account support",
              body: `Dedicated account manager support for trade customers. ${ACCOUNT_MANAGER_HOURS.weekdayLine}. ${ACCOUNT_MANAGER_HOURS.orderCutoffLine}.`,
              icon: "headphones",
            },
          ],
          customerTypes: [],
          spacing: "standard",
          media: { alt: "", fit: "fill" },
        },
      },
      {
        type: "TRADE_CTA",
        config: {
          eyebrow: "Next step",
          headline: "Open a trade account",
          supporting: "Apply to access trade pricing and the trade portal.",
          ctaLabel: "Open a Trade Account",
          ctaHref: "/register",
          secondaryCtaLabel: "View Brands",
          secondaryCtaHref: "/brands",
          variant: "dark",
          spacing: "standard",
          media: { alt: "", fit: "fill" },
        },
      },
    ],
  },
  {
    slug: "about",
    title: "About",
    seoTitle: "About Automotive Brands — UK Trade Supplier",
    metaDescription:
      "Automotive Brands supplies Power Maxed and Steel Seal to UK motor factors, workshops, retailers and distributors.",
    blurb: "Company introduction",
    primaryNav: false,
    sections: [
      pageHero({
        eyebrow: "About us",
        headline: "Automotive Brands",
        supporting: "The trade supplier behind Power Maxed and Steel Seal.",
      }),
      {
        type: "RICH_TEXT",
        config: {
          content:
            "Automotive Brands supplies professional automotive products to trade customers across the UK. At launch, the public catalogue focuses on Power Maxed and Steel Seal — available through one trade account with account pricing once approved.\n\nTrade customers can browse the live catalogue, see customer-safe availability, and order in trade case quantities where applicable. Dedicated account manager support is available through the trade portal.",
          spacing: "standard",
        },
      },
      {
        type: "TRADE_CTA",
        config: {
          eyebrow: "Trade with us",
          headline: "Open a trade account",
          supporting: "Browse Power Maxed and Steel Seal, then apply for account pricing.",
          ctaLabel: "Open a Trade Account",
          ctaHref: "/register",
          secondaryCtaLabel: "Shop Products",
          secondaryCtaHref: "/products",
          variant: "dark",
          spacing: "standard",
          media: { alt: "", fit: "fill" },
        },
      },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    seoTitle: "Contact Automotive Brands — Trade Sales & Support",
    metaDescription:
      "Contact the Automotive Brands trade sales, customer service and accounts teams, or ask your account manager to call you back.",
    blurb: "Contact introduction (callback form stays on the route)",
    primaryNav: false,
    sections: [
      pageHero({
        eyebrow: "Contact",
        headline: "Talk to the trade team",
        supporting:
          "Reach your account manager through the trade portal once your account is active, or use the callback form on this page.",
        ctaLabel: "Trade Login",
        ctaHref: "/login",
        secondaryCtaLabel: "Open a Trade Account",
        secondaryCtaHref: "/register",
      }),
      {
        type: "BENEFITS_GRID",
        config: {
          eyebrow: "Teams",
          heading: "Who to speak to",
          supporting: "",
          ctaLabel: "",
          ctaHref: "/contact",
          items: [
            {
              title: "Trade sales",
              body: `New accounts, pricing and brand enquiries. ${ACCOUNT_MANAGER_HOURS.weekdayCompact}.`,
              icon: "headphones",
            },
            {
              title: "Customer service",
              body: `Orders, deliveries, returns and stock. ${ACCOUNT_MANAGER_HOURS.weekdayCompact}.`,
              icon: "clipboard",
            },
            {
              title: "Accounts",
              body: "Invoices, statements and credit terms. Mon–Fri 09:00–17:00.",
              icon: "clipboard",
            },
            {
              title: "Order cut-off",
              body: ACCOUNT_MANAGER_HOURS.orderCutoffLine,
              icon: "truck",
            },
          ],
          customerTypes: [],
          spacing: "standard",
          media: { alt: "", fit: "fill" },
        },
      },
      {
        type: "RICH_TEXT",
        config: {
          content:
            "Contact phone numbers will be published here once confirmed. Existing trade customers should use the trade portal for account manager details.",
          spacing: "standard",
        },
      },
    ],
  },
  {
    slug: "resources",
    title: "Resources",
    seoTitle: "Trade Resources — Automotive Brands",
    metaDescription: "Trade documentation and downloads for Automotive Brands customers.",
    blurb: "Resources (kept off primary nav until content is ready)",
    primaryNav: false,
    sections: [
      pageHero({
        eyebrow: "Resources",
        headline: "Trade documentation",
        supporting:
          "Catalogues, data sheets and marketing assets will be published here when ready. Existing account holders can request documents via their account manager.",
        ctaLabel: "Contact Support",
        ctaHref: "/contact",
        secondaryCtaLabel: "Trade Portal",
        secondaryCtaHref: "/portal",
      }),
      {
        type: "RICH_TEXT",
        config: {
          content:
            "Downloadable resources are not published on the public website yet. This page is editable in Website Builder so finished assets can be added without a code change.",
          spacing: "standard",
        },
      },
    ],
  },
  {
    slug: "motorsport",
    title: "Motorsport",
    seoTitle: MOTORSPORT_PAGE_DEFAULTS.seoTitle,
    metaDescription: MOTORSPORT_PAGE_DEFAULTS.metaDescription,
    blurb: "Power Maxed Racing showcase and commercial partnership enquiries",
    primaryNav: true,
    sections: [
      {
        type: "MOTORSPORT_FEATURE",
        config: {
          eyebrow: MOTORSPORT_PAGE_DEFAULTS.hero.eyebrow,
          headline: MOTORSPORT_PAGE_DEFAULTS.hero.headline,
          supporting: MOTORSPORT_PAGE_DEFAULTS.hero.supporting,
          ctaLabel: MOTORSPORT_PAGE_DEFAULTS.hero.ctaLabel,
          ctaHref: MOTORSPORT_PAGE_DEFAULTS.hero.ctaHref,
          secondaryCtaLabel: MOTORSPORT_PAGE_DEFAULTS.hero.secondaryCtaLabel,
          secondaryCtaHref: MOTORSPORT_PAGE_DEFAULTS.hero.externalRacingUrl || "",
          features: [],
          spacing: "relaxed",
          media: {
            alt: "Power Maxed Racing Steel Seal race action — upload licensed photography in Media",
            fit: "fill",
            focalX: 68,
            focalY: 40,
          },
        },
      },
      {
        type: "IMAGE_TEXT",
        config: {
          heading: MOTORSPORT_PAGE_DEFAULTS.about.heading,
          body: MOTORSPORT_PAGE_DEFAULTS.about.body,
          spacing: "standard",
          media: {
            alt: "Power Maxed Racing team and cars — upload licensed photography in Media",
            fit: "fill",
            focalX: 50,
            focalY: 50,
          },
        },
      },
      {
        type: "TEXT_IMAGE",
        config: {
          heading: MOTORSPORT_PAGE_DEFAULTS.brandsOnTrack.heading,
          body: MOTORSPORT_PAGE_DEFAULTS.brandsOnTrack.body,
          ctaLabel: MOTORSPORT_PAGE_DEFAULTS.brandsOnTrack.powerMaxedLabel,
          ctaHref: MOTORSPORT_PAGE_DEFAULTS.brandsOnTrack.powerMaxedHref,
          spacing: "standard",
          media: {
            alt: "Steel Seal and Power Maxed branding on track — upload licensed photography in Media",
            fit: "fill",
            focalX: 55,
            focalY: 45,
          },
        },
      },
      {
        type: "MEDIA_GALLERY",
        config: {
          eyebrow: "Gallery",
          heading: "Power Maxed Racing",
          supporting:
            "Genuine motorsport photography. Watermarked preview files must not be altered — replace with licensed originals in Media before public launch.",
          items: [],
          spacing: "standard",
        },
      },
      {
        type: "BENEFITS_GRID",
        config: {
          eyebrow: MOTORSPORT_PAGE_DEFAULTS.partnerships.eyebrow,
          heading: MOTORSPORT_PAGE_DEFAULTS.partnerships.headline,
          supporting: MOTORSPORT_PAGE_DEFAULTS.partnerships.body,
          ctaLabel: "",
          ctaHref: "#partnerships",
          items: MOTORSPORT_PAGE_DEFAULTS.partnerships.opportunities.map((item) => ({
            title: item.title,
            body: item.body,
            icon: "clipboard" as const,
          })),
          customerTypes: [],
          spacing: "standard",
          media: { alt: "", fit: "fill" },
        },
      },
    ],
  },
];

export function marketingCmsPageBySlug(slug: string): MarketingPageSeed | undefined {
  return MARKETING_CMS_PAGES.find((page) => page.slug === slug);
}

export const MARKETING_CMS_SLUGS = MARKETING_CMS_PAGES.map((page) => page.slug);
