import type { CmsSectionTypeKey } from "@/domain/cms";
import { defaultFeaturedBrandsConfig } from "@/domain/featured-brands";

export function defaultHomepageSections(): Array<{
  type: CmsSectionTypeKey;
  config: Record<string, unknown>;
}> {
  return [
    {
      type: "HERO",
      config: {
        headline: "The brands behind the automotive aftermarket.",
        supporting:
          "Automotive Brands supplies trusted automotive products to motor factors, retailers, workshops and distributors throughout the UK — one trade account, every brand.",
        ctaLabel: "Open a Trade Account",
        ctaHref: "/register",
        secondaryCtaLabel: "Explore Our Brands",
        secondaryCtaHref: "/brands",
        alignment: "left",
        variant: "split",
        spacing: "relaxed",
        media: {
          alt: "Brake discs and alloy wheels under studio lighting",
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
        heading: "Everything a trade counter turns over",
        categories: [
          { name: "Braking", href: "/products", imageAlt: "Braking" },
          { name: "Chemicals", href: "/products", imageAlt: "Chemicals" },
          { name: "Batteries", href: "/products", imageAlt: "Batteries" },
          { name: "4x4 & LCV", href: "/products", imageAlt: "4x4" },
        ],
        spacing: "standard",
      },
    },
    {
      type: "FEATURED_PRODUCTS",
      config: {
        heading: "Ranges moving this quarter",
        supporting: "Featured ranges",
        productSkus: [],
        layout: "grid",
        spacing: "standard",
      },
    },
    {
      type: "BENEFITS_GRID",
      config: {
        heading: "Why trade with Automotive Brands",
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
        spacing: "standard",
      },
    },
    {
      type: "TRADE_CTA",
      config: {
        headline: "Ready to open a trade account?",
        supporting:
          "Apply online. Our credit team reviews applications within two working days.",
        ctaLabel: "Apply for a trade account",
        ctaHref: "/register",
        variant: "dark",
        spacing: "relaxed",
      },
    },
  ];
}
