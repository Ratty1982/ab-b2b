import type { CmsSectionTypeKey } from "@/domain/cms";
import { defaultFeaturedBrandsConfig } from "@/domain/featured-brands";

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
  "TRADE_CTA",
];

export function defaultHomepageSections(): Array<{
  type: CmsSectionTypeKey;
  config: Record<string, unknown>;
}> {
  return [
    {
      type: "HERO",
      config: {
        eyebrow: "UK Automotive Aftermarket Supply",
        headline: "The brands behind the automotive aftermarket.",
        supporting:
          "Automotive Brands supplies trusted automotive products to motor factors, retailers, workshops and distributors throughout the UK — one trade account, every brand.",
        ctaLabel: "Open a Trade Account",
        ctaHref: "/register",
        secondaryCtaLabel: "Explore Our Brands",
        secondaryCtaHref: "/brands",
        loginCtaLabel: "Trade Login",
        loginCtaHref: "/login",
        calloutSku: "",
        alignment: "left",
        contentPosition: "middle",
        variant: "split",
        spacing: "relaxed",
        overlayStrength: 0,
        media: {
          alt: "Brake discs and alloy wheels under studio lighting",
          fit: "fill",
          focalX: 50,
          focalY: 50,
        },
      },
    },
    {
      type: "FEATURED_BRANDS",
      config: defaultFeaturedBrandsConfig(),
    },
    {
      type: "CATEGORY_GRID",
      config: {
        eyebrow: "Product categories",
        heading: "Everything a trade counter turns over",
        categorySlugs: [],
        categories: [],
        spacing: "standard",
      },
    },
    {
      type: "FEATURED_PRODUCTS",
      config: {
        eyebrow: "Featured ranges",
        heading: "Ranges moving this quarter",
        supporting: "",
        productSkus: [],
        layout: "grid",
        spacing: "standard",
      },
    },
    {
      type: "NEW_PRODUCTS",
      config: {
        eyebrow: "New products",
        heading: "Recently added lines",
        limit: 3,
        spacing: "standard",
      },
    },
    {
      type: "POPULAR_PRODUCTS",
      config: {
        eyebrow: "Popular trade lines",
        heading: "Popular trade lines",
        supporting: "Manually featured lines — not ranked by order volume.",
        productSkus: [],
        spacing: "standard",
      },
    },
    {
      type: "BENEFITS_GRID",
      config: {
        eyebrow: "Why Automotive Brands",
        heading: "One trade account. Every brand.",
        supporting:
          "Buying the group rather than five separate suppliers means one order, one delivery, one invoice and one representative who knows your business.",
        ctaLabel: "See how it works",
        ctaHref: "/why-automotive-brands",
        items: [
          {
            title: "UK stockholding",
            body: "Five brands picked from one warehouse and consolidated onto one delivery.",
            icon: "warehouse",
          },
          {
            title: "Same-day despatch",
            body: "Orders placed before 3pm leave the same working day on next-day or pallet service.",
            icon: "truck",
          },
          {
            title: "Account ordering",
            body: "Purchase order references, agreed terms and full order history on every account.",
            icon: "clipboard",
          },
          {
            title: "Named representative",
            body: "A dedicated account manager, not a general enquiry queue.",
            icon: "headphones",
          },
        ],
        customerTypes: [
          { name: "Motor factors", detail: "Counter and van stock across five brands on one delivery." },
          { name: "Workshops & garages", detail: "Fast reordering of the consumables you fit every day." },
          { name: "Retailers", detail: "Retail-ready packaging with approved imagery and POS." },
          { name: "Distributors", detail: "Contract pricing, call-off volume and pallet despatch." },
          { name: "Buying groups", detail: "Group terms applied automatically at the point of ordering." },
          { name: "Fleet & commercial", detail: "Consolidated ordering across multiple sites and depots." },
        ],
        spacing: "standard",
        media: {
          alt: "Automotive Brands distribution warehouse with racked parts and palletised despatch",
          fit: "fill",
        },
      },
    },
    {
      type: "RESOURCES",
      config: {
        eyebrow: "Trade resources",
        heading: "Documentation your counter needs",
        items: [
          { label: "Trade catalogue", meta: "PDF", href: "/resources" },
          { label: "Safety data sheets", meta: "Per product", href: "/resources" },
          { label: "Fitment & technical guides", meta: "PDF", href: "/resources" },
          { label: "Approved marketing imagery", meta: "Media library", href: "/resources" },
        ],
        spacing: "standard",
      },
    },
    {
      type: "NEWS",
      config: {
        eyebrow: "Latest from Automotive Brands",
        heading: "Range updates and trade notices",
        items: [],
        spacing: "standard",
      },
    },
    {
      type: "TRADE_CTA",
      config: {
        eyebrow: "Open a trade account",
        headline: "Trade pricing, live stock and one account across every brand.",
        supporting:
          "Applications are reviewed by our trade team. Once approved, your account is activated with your pricing, catalogues and payment terms already in place.",
        ctaLabel: "Open a Trade Account",
        ctaHref: "/register",
        secondaryCtaLabel: "Trade Login",
        secondaryCtaHref: "/login",
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
