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
});

export const categoryCreateSchema = categoryWriteSchema;

export const categoryUpdateSchema = categoryWriteSchema.extend({
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
});

export const brandCreateSchema = brandWriteSchema;

export const brandUpdateSchema = brandWriteSchema.extend({
  id: z.string().cuid(),
});

export const productDraftSchema = z.object({
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
});

export type CategoryWriteInput = z.infer<typeof categoryWriteSchema>;
export type BrandWriteInput = z.infer<typeof brandWriteSchema>;
export type ProductDraftInput = z.infer<typeof productDraftSchema>;

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

export const DEFAULT_BRANDS: Array<{
  slug: string;
  name: string;
  tagline: string;
  description: string;
  sortOrder: number;
}> = [
  {
    slug: "power-maxed",
    name: "Power Maxed",
    tagline: "Performance Parts",
    description: "Braking, clutch and drivetrain components engineered for the UK aftermarket.",
    sortOrder: 1,
  },
  {
    slug: "steel-seal",
    name: "Steel Seal",
    tagline: "Gaskets & Seals",
    description: "Sealants, gaskets and chemical repair products trusted by workshops.",
    sortOrder: 2,
  },
  {
    slug: "street-rhino",
    name: "Street Rhino",
    tagline: "Off-Road & 4x4",
    description: "Wheels, lighting and protection for the 4x4 and light commercial market.",
    sortOrder: 3,
  },
  {
    slug: "bramley-power",
    name: "Bramley Power",
    tagline: "Electrical & Battery",
    description: "Batteries, charging and starting components with full UK warranty support.",
    sortOrder: 4,
  },
  {
    slug: "kidzmotion",
    name: "Kidzmotion",
    tagline: "Child Safety",
    description: "Child seats, boosters and in-car safety accessories for retail ranges.",
    sortOrder: 5,
  },
];
