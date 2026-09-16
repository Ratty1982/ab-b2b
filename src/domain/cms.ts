import { z } from "zod";

export const CMS_SECTION_TYPES = [
  "HERO",
  "BRAND_LOGO_STRIP",
  "FEATURED_BRANDS",
  "CATEGORY_GRID",
  "FEATURED_PRODUCTS",
  "TEXT_IMAGE",
  "IMAGE_TEXT",
  "BENEFITS_GRID",
  "TRADE_CTA",
  "BANNER",
  "RICH_TEXT",
  "SPACER",
] as const;

export type CmsSectionTypeKey = (typeof CMS_SECTION_TYPES)[number];

const alignment = z.enum(["left", "center", "right"]).default("left");
const spacing = z.enum(["compact", "standard", "relaxed"]).default("standard");
const variant = z.enum(["standard", "wide", "split", "dark", "light"]).default("standard");

const mediaRef = z
  .object({
    mediaId: z.string().optional(),
    src: z.string().max(500).optional(),
    alt: z.string().max(300).default(""),
  })
  .optional()
  .nullable();

export const sectionConfigSchemas: Record<CmsSectionTypeKey, z.ZodType> = {
  HERO: z.object({
    headline: z.string().max(200),
    supporting: z.string().max(500).default(""),
    ctaLabel: z.string().max(80).default("Open a trade account"),
    ctaHref: z.string().max(300).default("/register"),
    secondaryCtaLabel: z.string().max(80).optional(),
    secondaryCtaHref: z.string().max(300).optional(),
    alignment,
    variant,
    spacing,
    media: mediaRef,
  }),
  BRAND_LOGO_STRIP: z.object({
    heading: z.string().max(120).optional(),
    brandSlugs: z.array(z.string().max(80)).max(20).default([]),
    spacing,
  }),
  FEATURED_BRANDS: z.object({
    heading: z.string().max(120).default("Our brands"),
    supporting: z.string().max(400).default(""),
    brandSlugs: z.array(z.string().max(80)).max(12).default([]),
    displayCount: z.number().int().min(1).max(12).default(5),
    variant,
    spacing,
  }),
  CATEGORY_GRID: z.object({
    heading: z.string().max(120).default("Shop by category"),
    categories: z
      .array(
        z.object({
          name: z.string().max(80),
          href: z.string().max(300),
          imageSrc: z.string().max(500).optional(),
          imageAlt: z.string().max(200).default(""),
        }),
      )
      .max(12)
      .default([]),
    spacing,
  }),
  FEATURED_PRODUCTS: z.object({
    heading: z.string().max(120).default("Featured products"),
    supporting: z.string().max(400).default(""),
    productSkus: z.array(z.string().max(80)).max(24).default([]),
    layout: z.enum(["grid", "carousel"]).default("grid"),
    spacing,
  }),
  TEXT_IMAGE: z.object({
    heading: z.string().max(160),
    body: z.string().max(4000),
    ctaLabel: z.string().max(80).optional(),
    ctaHref: z.string().max(300).optional(),
    media: mediaRef,
    alignment,
    spacing,
  }),
  IMAGE_TEXT: z.object({
    heading: z.string().max(160),
    body: z.string().max(4000),
    ctaLabel: z.string().max(80).optional(),
    ctaHref: z.string().max(300).optional(),
    media: mediaRef,
    alignment,
    spacing,
  }),
  BENEFITS_GRID: z.object({
    heading: z.string().max(120).optional(),
    items: z
      .array(
        z.object({
          title: z.string().max(80),
          body: z.string().max(300),
          icon: z.enum(["warehouse", "truck", "clipboard", "headphones"]).default("warehouse"),
        }),
      )
      .max(8)
      .default([]),
    spacing,
  }),
  TRADE_CTA: z.object({
    headline: z.string().max(200),
    supporting: z.string().max(400).default(""),
    ctaLabel: z.string().max(80).default("Apply for a trade account"),
    ctaHref: z.string().max(300).default("/register"),
    variant,
    spacing,
  }),
  BANNER: z.object({
    text: z.string().max(300),
    href: z.string().max(300).optional(),
    tone: z.enum(["brand", "neutral", "warn"]).default("brand"),
    spacing,
  }),
  RICH_TEXT: z.object({
    /** Plain text / markdown-lite — no HTML */
    content: z.string().max(20000),
    spacing,
  }),
  SPACER: z.object({
    size: z.enum(["sm", "md", "lg"]).default("md"),
  }),
};

export function validateSectionConfig(type: CmsSectionTypeKey, config: unknown) {
  const schema = sectionConfigSchemas[type];
  if (!schema) throw new Error(`Unknown section type: ${type}`);
  return schema.parse(config);
}

export const cmsPageUpdateSchema = z.object({
  slug: z.string().min(1).max(120),
  title: z.string().trim().min(1).max(200).optional(),
  seoTitle: z.string().trim().max(200).optional().nullable(),
  metaDescription: z.string().trim().max(400).optional().nullable(),
});

export const cmsSectionInputSchema = z.object({
  type: z.enum(CMS_SECTION_TYPES),
  config: z.unknown(),
  enabled: z.boolean().default(true),
});
