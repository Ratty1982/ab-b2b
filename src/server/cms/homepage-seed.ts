import type { CmsSectionTypeKey } from "@/domain/cms";
import { ACCOUNT_MANAGER_HOURS } from "@/domain/account-manager-hours";
import { defaultFeaturedBrandsConfig } from "@/domain/featured-brands";
import { HOMEPAGE_MOTORSPORT_DEFAULTS } from "@/domain/motorsport";

/** Bumps when launch marketing copy must refresh published CMS seed content. */
export const HOMEPAGE_LAUNCH_CONTENT_KEY = "motorsport-feature-v1";

export const CANONICAL_HOMEPAGE_SECTION_TYPES: CmsSectionTypeKey[] = [
  "HERO",
  "FEATURED_BRANDS",
  "CATEGORY_GRID",
  "FEATURED_PRODUCTS",
  "NEW_PRODUCTS",
  "POPULAR_PRODUCTS",
  "BENEFITS_GRID",
  "RESOURCES",
  "NEWS",
  "MOTORSPORT_FEATURE",
  "TRADE_CTA",
];

export function defaultHomepageSections(): Array<{
  type: CmsSectionTypeKey;
  config: Record<string, unknown>;
  enabled?: boolean;
}> {
  return [
    {
      type: "HERO",
      config: {
        contentKey: HOMEPAGE_LAUNCH_CONTENT_KEY,
        eyebrow: "POWER MAXED + STEEL SEAL",
        headline: "AUTOMOTIVE PRODUCTS\nBUILT FOR THE TRADE",
        supporting:
          "Professional automotive products supplied to trade customers across the UK.",
        ctaLabel: "Shop Products",
        ctaHref: "/products",
        secondaryCtaLabel: "Open a Trade Account",
        secondaryCtaHref: "/register",
        loginCtaLabel: "Trade Login",
        loginCtaHref: "/login",
        calloutSku: "",
        alignment: "left",
        contentPosition: "middle",
        variant: "split",
        spacing: "relaxed",
        overlayStrength: 0,
        media: {
          alt: "Automotive Brands trade product photography",
          fit: "contain",
          focalX: 50,
          focalY: 50,
        },
      },
    },
    {
      type: "FEATURED_BRANDS",
      config: {
        ...defaultFeaturedBrandsConfig(),
        contentKey: HOMEPAGE_LAUNCH_CONTENT_KEY,
      },
    },
    {
      type: "CATEGORY_GRID",
      config: {
        contentKey: HOMEPAGE_LAUNCH_CONTENT_KEY,
        eyebrow: "Shop by category",
        heading: "Browse the trade catalogue",
        supporting: "Categories with live trade-visible products.",
        categorySlugs: [],
        categories: [],
        ctaLabel: "View all products",
        ctaHref: "/products",
        spacing: "standard",
      },
    },
    {
      type: "FEATURED_PRODUCTS",
      config: {
        contentKey: HOMEPAGE_LAUNCH_CONTENT_KEY,
        eyebrow: "Catalogue",
        heading: "Featured products",
        supporting: "Selected lines from the live trade catalogue.",
        productSkus: [],
        layout: "grid",
        spacing: "standard",
      },
    },
    {
      type: "NEW_PRODUCTS",
      config: {
        contentKey: HOMEPAGE_LAUNCH_CONTENT_KEY,
        eyebrow: "New products",
        heading: "Recently added lines",
        limit: 4,
        spacing: "standard",
      },
      enabled: true,
    },
    {
      type: "POPULAR_PRODUCTS",
      config: {
        contentKey: HOMEPAGE_LAUNCH_CONTENT_KEY,
        eyebrow: "Featured lines",
        heading: "Featured products",
        supporting: "Manually featured catalogue lines — not ranked by order volume.",
        productSkus: [],
        spacing: "standard",
      },
      // Hidden until SKUs are configured in Website Builder — avoids empty "popular" claims.
      enabled: false,
    },
    {
      type: "BENEFITS_GRID",
      config: {
        contentKey: HOMEPAGE_LAUNCH_CONTENT_KEY,
        eyebrow: "Why buy from Automotive Brands?",
        heading: "Trade supply built for repeat ordering",
        supporting:
          "Approved trade accounts get account pricing, live availability and dedicated support for Power Maxed and Steel Seal.",
        ctaLabel: "Why Automotive Brands",
        ctaHref: "/why-automotive-brands",
        items: [
          {
            title: "Trade pricing",
            body: "Pricing for approved trade accounts.",
            icon: "clipboard",
          },
          {
            title: "UK stock",
            body: "Products stocked for trade supply.",
            icon: "warehouse",
          },
          {
            title: "Dedicated account support",
            body: `Account manager support for trade customers. ${ACCOUNT_MANAGER_HOURS.weekdayLine}.`,
            icon: "headphones",
          },
          {
            title: "Quick ordering",
            body: "Fast catalogue browsing and case-quantity ordering.",
            icon: "truck",
          },
          {
            title: "Same-day order cut-off",
            body: ACCOUNT_MANAGER_HOURS.orderCutoffLine,
            icon: "clipboard",
          },
        ],
        customerTypes: [
          { name: "Motor factors", detail: "Counter and van stock from Power Maxed and Steel Seal." },
          { name: "Workshops & garages", detail: "Reorder consumables and repair products used every day." },
          { name: "Retailers", detail: "Trade catalogue with account pricing once approved." },
          { name: "Distributors", detail: "Account pricing and dedicated account support." },
        ],
        spacing: "standard",
        media: {
          alt: "Automotive Brands distribution warehouse",
          fit: "fill",
        },
      },
    },
    {
      type: "RESOURCES",
      config: {
        contentKey: HOMEPAGE_LAUNCH_CONTENT_KEY,
        eyebrow: "Trade resources",
        heading: "Documentation your counter needs",
        items: [],
        spacing: "standard",
      },
      enabled: false,
    },
    {
      type: "NEWS",
      config: {
        contentKey: HOMEPAGE_LAUNCH_CONTENT_KEY,
        eyebrow: "Latest from Automotive Brands",
        heading: "Range updates and trade notices",
        items: [],
        spacing: "standard",
      },
      enabled: false,
    },
    {
      type: "MOTORSPORT_FEATURE",
      config: {
        contentKey: HOMEPAGE_LAUNCH_CONTENT_KEY,
        ...HOMEPAGE_MOTORSPORT_DEFAULTS,
        spacing: "relaxed",
        media: {
          alt: "Power Maxed Racing Steel Seal race car on track — upload licensed photography in Media",
          fit: "fill",
          focalX: 72,
          focalY: 42,
        },
      },
      enabled: true,
    },
    {
      type: "TRADE_CTA",
      config: {
        contentKey: HOMEPAGE_LAUNCH_CONTENT_KEY,
        eyebrow: "Built for trade",
        headline: "Ready to order with trade pricing?",
        supporting:
          "Existing customers: access your trade pricing, basket and trade portal. New customers: apply for an Automotive Brands trade account.",
        ctaLabel: "Open a Trade Account",
        ctaHref: "/register",
        secondaryCtaLabel: "Trade Login",
        secondaryCtaHref: "/login",
        signedInCtaLabel: "Trade Portal",
        signedInCtaHref: "/portal",
        signedInSecondaryCtaLabel: "Shop Products",
        signedInSecondaryCtaHref: "/products",
        variant: "dark",
        spacing: "relaxed",
        media: {
          alt: "",
          fit: "fill",
        },
      },
    },
  ];
}
