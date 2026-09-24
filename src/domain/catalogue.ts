import { z } from "zod";

export function slugifyCatalogue(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "item";
}

const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v === "" ? null : v));

export const categoryWriteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens")
    .optional()
    .or(z.literal("")),
  description: optionalText,
  parentId: z.string().cuid().optional().nullable().or(z.literal("")),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  imageMediaId: z.string().cuid().optional().nullable().or(z.literal("")),
  imageAlt: z
    .string()
    .trim()
    .max(300)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
});

export const categoryCreateSchema = categoryWriteSchema;

export const categoryUpdateSchema = categoryWriteSchema.extend({
  id: z.string().cuid(),
});

export const categoryDeleteSchema = z.object({
  id: z.string().cuid(),
});

export const brandWriteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens")
    .optional()
    .or(z.literal("")),
  tagline: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  description: optionalText,
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  logoMediaId: z.string().cuid().optional().nullable().or(z.literal("")),
  logoAlt: z
    .string()
    .trim()
    .max(300)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
});

export const brandCreateSchema = brandWriteSchema;

export const brandUpdateSchema = brandWriteSchema.extend({
  id: z.string().cuid(),
});

export const productDraftSchema = z.object({
  id: z.string().cuid().optional(),
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(120),
  subcategory: z.string().trim().max(120).optional().nullable(),
  trade: z.coerce.number().nonnegative().max(99_999_999),
  rrp: z.coerce.number().nonnegative().max(99_999_999),
  packQty: z.coerce.number().int().min(1).max(10_000),
  caseQty: z.coerce.number().int().min(1).max(10_000),
  description: z.string().trim().max(4000).default(""),
  vat: z.enum(["standard", "zero", "STANDARD", "ZERO_RATED", "ZERO"]).default("standard"),
  active: z.coerce.boolean().default(true),
});

export function normalizeVatCode(vat: string | undefined): "STANDARD" | "ZERO_RATED" {
  const v = (vat ?? "standard").toLowerCase();
  return v === "zero" || v === "zero_rated" ? "ZERO_RATED" : "STANDARD";
}

export const PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "DISCONTINUED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const productCreateSchema = z.object({
  sku: z.string().trim().min(1, "Enter a SKU").max(40),
  name: z.string().trim().min(1, "Enter a product name").max(200),
  brandId: z.string().cuid("Choose a brand"),
  categoryId: z.string().cuid("Choose a category"),
});

export const productSpecSchema = z.object({
  name: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(240),
});

export const productWorkspaceSchema = z.object({
  id: z.string().cuid(),
  sku: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  brandId: z.string().cuid().optional(),
  categoryId: z.string().cuid().optional().nullable(),
  ean: z.string().trim().max(32).optional().nullable(),
  mpn: z.string().trim().max(64).optional().nullable(),
  externalRef: z.string().trim().max(80).optional().nullable(),
  shortDescription: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(20000).optional().nullable(),
  specifications: z.array(productSpecSchema).max(40).optional(),
  selling: z
    .object({
      keyBenefits: z.array(z.string().max(240)).max(40).optional(),
      features: z.array(z.string().max(240)).max(40).optional(),
      applications: z.array(z.string().max(240)).max(40).optional(),
      directions: z.string().max(4000).optional().nullable(),
      warnings: z.string().max(4000).optional().nullable(),
    })
    .optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  isTradeVisible: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isNew: z.boolean().optional(),
  tradePrice: z.coerce.number().nonnegative().max(99_999_999).optional().nullable(),
  rrp: z.coerce.number().nonnegative().max(99_999_999).optional().nullable(),
  vat: z.enum(["standard", "zero", "STANDARD", "ZERO_RATED", "ZERO"]).optional(),
  packQty: z.coerce.number().int().min(1).max(10_000).optional(),
  caseQty: z.coerce.number().int().min(1).max(10_000).optional().nullable(),
  minimumOrderQty: z.coerce.number().int().min(1).max(10_000).optional(),
  orderIncrement: z.coerce.number().int().min(1).max(10_000).optional(),
  unit: z.string().trim().min(1).max(16).optional(),
  weightKg: z.coerce.number().nonnegative().max(10_000).optional().nullable(),
  lengthMm: z.coerce.number().nonnegative().max(100_000).optional().nullable(),
  widthMm: z.coerce.number().nonnegative().max(100_000).optional().nullable(),
  heightMm: z.coerce.number().nonnegative().max(100_000).optional().nullable(),
  slug: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional()
    .or(z.literal("")),
  metaTitle: z.string().trim().max(80).optional().nullable(),
  metaDescription: z.string().trim().max(300).optional().nullable(),
});

export const productVariantWriteSchema = z.object({
  productId: z.string().cuid(),
  id: z.string().cuid().optional(),
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().max(120).optional().nullable(),
  barcode: z.string().trim().max(32).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const productMediaWriteSchema = z.object({
  productId: z.string().cuid(),
  mediaId: z.string().cuid(),
  altText: z.string().trim().max(300).optional().nullable(),
  isPrimary: z.boolean().optional(),
});

export const productMediaReorderSchema = z.object({
  productId: z.string().cuid(),
  orderedIds: z.array(z.string().cuid()).min(1).max(40),
  primaryId: z.string().cuid().optional(),
});

export type CategoryWriteInput = z.infer<typeof categoryWriteSchema>;
export type BrandWriteInput = z.infer<typeof brandWriteSchema>;
export type ProductDraftInput = z.infer<typeof productDraftSchema>;

/** First-install only. Never backfill brands or categories after either side already exists. */
export function shouldSeedDefaultCatalogue(categoryCount: number, brandCount: number): boolean {
  return categoryCount === 0 && brandCount === 0;
}

export const DEFAULT_CATEGORY_TREE: Array<{
  name: string;
  description: string;
  children: Array<{ name: string; description: string }>;
}> = [
  {
    name: "Braking",
    description: "Discs, pads, calipers, fluid",
    children: [
      { name: "Brake Discs", description: "Disc kits and rotors" },
      { name: "Brake Pads", description: "Pad sets and wear parts" },
      { name: "Calipers & Fluid", description: "Calipers, hoses and brake fluid" },
    ],
  },
  {
    name: "Engine Chemicals",
    description: "Sealants, additives, cleaners",
    children: [
      { name: "Gaskets", description: "Head gasket and sealing compounds" },
      { name: "Sealants", description: "RTV, thread seal and workshop chemicals" },
    ],
  },
  {
    name: "Wheels & Tyres",
    description: "Alloys, spacers, fixings",
    children: [{ name: "Alloy Wheels", description: "4x4 and LCV alloy wheels" }],
  },
  {
    name: "Batteries & Electrical",
    description: "Batteries, chargers, alternators",
    children: [{ name: "Batteries", description: "AGM, EFB and leisure batteries" }],
  },
  {
    name: "Lighting",
    description: "LED bars, bulbs, work lamps",
    children: [{ name: "Auxiliary Lighting", description: "LED bars and work lamps" }],
  },
  {
    name: "Servicing & Consumables",
    description: "Filters, oils, workshop supplies",
    children: [],
  },
  {
    name: "Child Safety",
    description: "Seats, boosters, mirrors",
    children: [{ name: "Car Seats", description: "Boosters and child seats" }],
  },
  {
    name: "Body & Protection",
    description: "Bars, steps, arch kits",
    children: [],
  },
];

/**
 * Brands exposed on the public / trade-visible storefront at launch.
 * Other catalogue brands remain in the database with isActive=false until enabled.
 */
export const LAUNCH_PUBLIC_BRAND_SLUGS = ["power-maxed", "steel-seal"] as const;

export type LaunchPublicBrandSlug = (typeof LAUNCH_PUBLIC_BRAND_SLUGS)[number];

export function isLaunchPublicBrandSlug(slug: string): boolean {
  return (LAUNCH_PUBLIC_BRAND_SLUGS as readonly string[]).includes(slug);
}

export const DEFAULT_BRANDS: Array<{
  slug: string;
  name: string;
  tagline: string;
  description: string;
  sortOrder: number;
  /** Public storefront visibility. Non-launch brands seed inactive. */
  isActive: boolean;
}> = [
  {
    slug: "power-maxed",
    name: "Power Maxed",
    tagline: "Vehicle Care & Workshop",
    description:
      "Professional valeting, cleaning, workshop and vehicle maintenance products for the trade.",
    sortOrder: 1,
    isActive: true,
  },
  {
    slug: "steel-seal",
    name: "Steel Seal",
    tagline: "Head Gasket & Cooling Repair",
    description: "Head gasket repair and cooling-system repair products for workshops and trade counters.",
    sortOrder: 2,
    isActive: true,
  },
  {
    slug: "street-rhino",
    name: "Street Rhino",
    tagline: "Off-Road & 4x4",
    description: "Wheels, lighting and protection for the 4x4 and light commercial market.",
    sortOrder: 3,
    isActive: false,
  },
  {
    slug: "bramley-power",
    name: "Bramley Power",
    tagline: "Electrical & Battery",
    description: "Batteries, charging and starting components with full UK warranty support.",
    sortOrder: 4,
    isActive: false,
  },
  {
    slug: "kidzmotion",
    name: "Kidzmotion",
    tagline: "Child Safety",
    description: "Child seats, boosters and in-car safety accessories for retail ranges.",
    sortOrder: 5,
    isActive: false,
  },
];
