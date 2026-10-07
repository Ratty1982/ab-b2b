/**
 * Supplier master validation. Supplier relationships are manual — never inferred from brand,
 * Sub Group, GROUP, SKU prefix or description.
 */
import { z } from "zod";

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());

const optionalInt = (max: number) =>
  z.preprocess(blankToNull, z.coerce.number().int().min(0).max(max).nullable().optional());

const optionalMoney = z.preprocess(
  blankToNull,
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), "Enter an amount such as 1000 or 12.50")
    .nullable()
    .optional(),
);

export function normalizeSupplierCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const code = raw.trim().toUpperCase().replace(/\s+/g, "-");
  return code || null;
}

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, "Supplier name is required").max(160),
  code: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/, "Code may contain letters, numbers, space, dash, dot or underscore")
      .nullable()
      .optional(),
  ),
  accountNumber: optionalText(80),
  contactName: optionalText(120),
  email: z.preprocess(blankToNull, z.string().trim().email("Enter a valid email").max(200).nullable().optional()),
  telephone: optionalText(60),
  website: optionalText(300),
  notes: optionalText(4000),
  defaultLeadTimeDays: optionalInt(365),
  defaultMinimumOrderValue: optionalMoney,
  currency: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .length(3, "Currency must be a 3-letter code")
      .transform((v) => v.toUpperCase())
      .nullable()
      .optional(),
  ),
});

export type SupplierInput = z.infer<typeof supplierInputSchema>;

export const productSupplierConstraintsSchema = z.object({
  supplierSku: optionalText(80),
  leadTimeDays: optionalInt(365),
  minimumOrderQty: optionalInt(1_000_000),
  orderMultiple: optionalInt(1_000_000),
  unitCost: optionalMoney,
});

export type ProductSupplierConstraints = z.infer<typeof productSupplierConstraintsSchema>;

/** Effective purchasing constraints: relationship → supplier default → SKU settings. */
export function resolveSupplierConstraints(input: {
  relation: { leadTimeDays: number | null; minimumOrderQty: number | null; orderMultiple: number | null } | null;
  supplierDefaultLeadTimeDays: number | null;
  sku: { leadTimeDays: number | null; minimumOrderQty: number | null; orderMultiple: number | null };
}): {
  leadTimeDays: number | null;
  leadTimeSource: "RELATIONSHIP" | "SUPPLIER_DEFAULT" | "SKU_SETTINGS" | "NONE";
  minimumOrderQty: number | null;
  orderMultiple: number | null;
} {
  const rel = input.relation;
  let leadTimeDays: number | null = null;
  let leadTimeSource: "RELATIONSHIP" | "SUPPLIER_DEFAULT" | "SKU_SETTINGS" | "NONE" = "NONE";
  if (rel?.leadTimeDays != null) {
    leadTimeDays = rel.leadTimeDays;
    leadTimeSource = "RELATIONSHIP";
  } else if (rel && input.supplierDefaultLeadTimeDays != null) {
    leadTimeDays = input.supplierDefaultLeadTimeDays;
    leadTimeSource = "SUPPLIER_DEFAULT";
  } else if (input.sku.leadTimeDays != null) {
    leadTimeDays = input.sku.leadTimeDays;
    leadTimeSource = "SKU_SETTINGS";
  }
  return {
    leadTimeDays,
    leadTimeSource,
    minimumOrderQty: rel?.minimumOrderQty ?? input.sku.minimumOrderQty,
    orderMultiple: rel?.orderMultiple ?? input.sku.orderMultiple,
  };
}
