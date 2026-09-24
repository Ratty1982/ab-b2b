import { z } from "zod";
import { MEDIA_UPLOAD_USAGES } from "@/domain/media-usage";

export const CMS_SECTION_TYPES = [
  "HERO",
  "BRAND_LOGO_STRIP",
  "FEATURED_BRANDS",
  "CATEGORY_GRID",
  "FEATURED_PRODUCTS",
  "NEW_PRODUCTS",
  "POPULAR_PRODUCTS",
  "RESOURCES",
  "NEWS",
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
const contentPosition = z.enum(["top", "middle", "bottom"]).default("middle");

/** Fill Area = cover/crop, Show Whole Image = contain (cutouts), Standard Content Image = controlled crop. */
export const CMS_IMAGE_FITS = ["fill", "contain", "content"] as const;
export type CmsImageFit = (typeof CMS_IMAGE_FITS)[number];
export const CMS_IMAGE_FIT_LABELS: Record<CmsImageFit, string> = {
  fill: "Fill Area",
  contain: "Show Whole Image",
  content: "Standard Content Image",
};

const percent = z.preprocess((value) => {
  if (value === "" || value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}, z.number().min(0).max(100).optional());

const overlayStrength = z.preprocess((value) => {
  if (value === "" || value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}, z.number().min(0).max(80).default(0));

/** Number inputs and JSON often send counts as strings; empty values fall back to default. */
const displayCount = z.preprocess((value) => {
  if (value === "" || value == null) return 5;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}, z.number().int().min(1).max(12).default(5));

const mediaRef = z
  .object({
    mediaId: z.string().optional(),
    src: z.string().max(2048).optional(),
    alt: z.string().max(300).default(""),
    fit: z.enum(CMS_IMAGE_FITS).optional(),
    focalX: percent,
    focalY: percent,
  })
  .optional()
  .nullable();

/** Launch / seed revision marker — preserved through Website Builder saves. */
const contentKey = z.string().max(80).optional();

export const sectionConfigSchemas: Record<CmsSectionTypeKey, z.ZodType> = {
  HERO: z.object({
    contentKey,
    eyebrow: z.string().max(80).optional().default(""),
    headline: z.string().max(400),
    supporting: z.string().max(2000).default(""),
    ctaLabel: z.string().max(80).default("Open a trade account"),
    ctaHref: z.string().max(300).default("/register"),
    secondaryCtaLabel: z.string().max(80).optional(),
    secondaryCtaHref: z.string().max(300).optional(),
    loginCtaLabel: z.string().max(80).optional().default("Trade Login"),
    loginCtaHref: z.string().max(300).optional().default("/login"),
    calloutSku: z.string().max(80).optional().default(""),
    alignment,
    contentPosition,
    variant,
    spacing,
    overlayStrength,
    media: mediaRef,
  }),
  BRAND_LOGO_STRIP: z.object({
    contentKey,
    heading: z.string().max(120).optional(),
    brandSlugs: z.array(z.string().max(80)).max(20).default([]),
    spacing,
  }),
  FEATURED_BRANDS: z.object({
    contentKey,
    eyebrow: z.string().max(80).optional().default("Our brands"),
    heading: z.string().max(120).default("TWO BRANDS. ONE TRADE SUPPLIER."),
    intro: z.string().max(800).optional().default(""),
    supporting: z.string().max(400).optional().default(""),
    brandSlugs: z.array(z.string().max(80)).max(12).default([]),
    brandCards: z
      .array(
        z.object({
          slug: z.string().max(80),
          heading: z.string().max(120).default(""),
          description: z.string().max(400).default(""),
          href: z.string().max(300).default(""),
          enabled: z.boolean().default(true),
          logo: z
            .object({
              mediaId: z.string().optional(),
              src: z.string().max(2048).optional(),
              alt: z.string().max(300).default(""),
            })
            .optional()
            .nullable(),
        }),
      )
      .max(12)
      .default([]),
    displayCount,
    variant,
    spacing,
    logos: z
      .record(
        z.string().max(80),
        z
          .object({
            mediaId: z.string().optional(),
            src: z.string().max(2048).optional(),
            alt: z.string().max(300).default(""),
          })
          .optional()
          .nullable(),
      )
      .default({}),
  }),
  CATEGORY_GRID: z.object({
    contentKey,
    eyebrow: z.string().max(80).optional().default("Product categories"),
    heading: z.string().max(120).default("Shop by category"),
    supporting: z.string().max(400).optional().default(""),
    ctaLabel: z.string().max(80).optional().default("View all products"),
    ctaHref: z.string().max(300).optional().default("/products"),
    categorySlugs: z.array(z.string().max(80)).max(16).default([]),
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
    contentKey,
    eyebrow: z.string().max(80).optional().default("Featured ranges"),
    heading: z.string().max(120).default("Featured products"),
    supporting: z.string().max(400).default(""),
    productSkus: z.array(z.string().max(80)).max(24).default([]),
    layout: z.enum(["grid", "carousel"]).default("grid"),
    spacing,
  }),
  NEW_PRODUCTS: z.object({
    contentKey,
    eyebrow: z.string().max(80).optional().default("New products"),
    heading: z.string().max(120).default("Recently added lines"),
    limit: z.number().int().min(1).max(12).default(3),
    spacing,
  }),
  POPULAR_PRODUCTS: z.object({
    contentKey,
    eyebrow: z.string().max(80).optional().default("Popular trade lines"),
    heading: z.string().max(120).default("Popular trade lines"),
    supporting: z.string().max(400).default(""),
    productSkus: z.array(z.string().max(80)).max(12).default([]),
    spacing,
  }),
  RESOURCES: z.object({
    contentKey,
    eyebrow: z.string().max(80).optional().default("Trade resources"),
    heading: z.string().max(160).default("Documentation your counter needs"),
    items: z
      .array(
        z.object({
          label: z.string().max(120),
          meta: z.string().max(80).default(""),
          href: z.string().max(300).default("/resources"),
        }),
      )
      .max(12)
      .default([]),
    spacing,
  }),
  NEWS: z.object({
    contentKey,
    eyebrow: z.string().max(80).optional().default("Latest from Automotive Brands"),
    heading: z.string().max(160).default("Range updates and trade notices"),
    items: z
      .array(
        z.object({
          kind: z.string().max(40).default("Update"),
          date: z.string().max(40).default(""),
          title: z.string().max(200),
          summary: z.string().max(600).default(""),
        }),
      )
      .max(12)
      .default([]),
    spacing,
  }),
  TEXT_IMAGE: z.object({
    contentKey,
    heading: z.string().max(160),
    body: z.string().max(4000),
    ctaLabel: z.string().max(80).optional(),
    ctaHref: z.string().max(300).optional(),
    media: mediaRef,
    alignment,
    spacing,
  }),
  IMAGE_TEXT: z.object({
    contentKey,
    heading: z.string().max(160),
    body: z.string().max(4000),
    ctaLabel: z.string().max(80).optional(),
    ctaHref: z.string().max(300).optional(),
    media: mediaRef,
    alignment,
    spacing,
  }),
  BENEFITS_GRID: z.object({
    contentKey,
    eyebrow: z.string().max(80).optional().default("Why Automotive Brands"),
    heading: z.string().max(120).optional(),
    supporting: z.string().max(2000).optional().default(""),
    ctaLabel: z.string().max(80).optional().default(""),
    ctaHref: z.string().max(300).optional().default("/why-automotive-brands"),
    items: z
      .array(
        z.object({
          title: z.string().max(80),
          body: z.string().max(400),
          icon: z.enum(["warehouse", "truck", "clipboard", "headphones"]).default("warehouse"),
        }),
      )
      .max(8)
      .default([]),
    customerTypes: z
      .array(
        z.object({
          name: z.string().max(80),
          detail: z.string().max(200),
        }),
      )
      .max(8)
      .default([]),
    media: mediaRef,
    spacing,
  }),
  TRADE_CTA: z.object({
    contentKey,
    eyebrow: z.string().max(80).optional().default("Open a trade account"),
    headline: z.string().max(400),
    supporting: z.string().max(2000).default(""),
    ctaLabel: z.string().max(80).default("Apply for a trade account"),
    ctaHref: z.string().max(300).default("/register"),
    secondaryCtaLabel: z.string().max(80).optional().default("Trade Login"),
    secondaryCtaHref: z.string().max(300).optional().default("/login"),
    signedInCtaLabel: z.string().max(80).optional(),
    signedInCtaHref: z.string().max(300).optional(),
    signedInSecondaryCtaLabel: z.string().max(80).optional(),
    signedInSecondaryCtaHref: z.string().max(300).optional(),
    variant,
    spacing,
    media: mediaRef,
  }),
  BANNER: z.object({
    contentKey,
    text: z.string().max(300),
    href: z.string().max(300).optional(),
    tone: z.enum(["brand", "neutral", "warn"]).default("brand"),
    spacing,
  }),
  RICH_TEXT: z.object({
    contentKey,
    /** Plain text / markdown-lite — no HTML */
    content: z.string().max(20000),
    spacing,
  }),
  SPACER: z.object({
    contentKey,
    size: z.enum(["sm", "md", "lg"]).default("md"),
  }),
};

export function formatZodError(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("issues" in error)) return null;
  const issues = (error as { issues: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const parts = issues.map((issue) => {
    if (!issue || typeof issue !== "object") return "Invalid value";
    const row = issue as { path?: unknown; message?: unknown };
    const path = Array.isArray(row.path)
      ? row.path.filter((p) => p !== undefined && p !== null && `${p}` !== "").join(".")
      : "";
    const message = typeof row.message === "string" ? row.message : "Invalid value";
    return path ? `${path}: ${message}` : message;
  });
  return parts.join("; ");
}

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
  ogImageMediaId: z.string().cuid().optional().nullable(),
});

export const cmsSectionInputSchema = z.object({
  type: z.enum(CMS_SECTION_TYPES),
  config: z.unknown(),
  enabled: z.boolean().default(true),
});

export const CMS_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const CMS_MEDIA_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const cmsMediaUploadSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(CMS_MEDIA_CONTENT_TYPES),
  /** Raw or data-URL base64 of the file body */
  base64: z.string().min(8).max(Math.ceil((CMS_MEDIA_MAX_BYTES * 4) / 3) + 64),
  altText: z.string().trim().max(300).optional().nullable(),
  /** Processing policy. Defaults to CMS_GENERAL so heroes/banners are not resized. */
  usage: z.enum(MEDIA_UPLOAD_USAGES).default("CMS_GENERAL"),
});

export const cmsMediaUpdateSchema = z.object({
  id: z.string().cuid(),
  altText: z.string().trim().max(300).optional().nullable(),
});

export const cmsMediaDeleteSchema = z.object({
  id: z.string().cuid(),
});

export type CmsMediaUploadInput = z.infer<typeof cmsMediaUploadSchema>;
