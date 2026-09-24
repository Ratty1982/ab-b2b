/**
 * Phase 6B B2B checkout — delivery/contact snapshots and place-order input.
 * Browser never supplies companyId, prices, stock, or Autopart codes as authority.
 */

import { z } from "zod";

/** Light UK postcode check (allows common formats; not full Royal Mail validation). */
export function validateUkPostcode(raw: string): boolean {
  const normalised = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (!normalised || normalised.length > 8) return false;
  return /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(normalised);
}

/** Strip HTML tags and collapse control characters for plain-text fields. */
export function sanitizePlainText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
}

const plainText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => sanitizePlainText(v))
    .refine((v) => v.length > 0, { message: "Required" });

const optionalPlainText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null || v === "") return null;
      const cleaned = sanitizePlainText(v);
      return cleaned.length > 0 ? cleaned : null;
    });

export const deliveryAddressSnapshotSchema = z.object({
  line1: plainText(200),
  line2: optionalPlainText(200),
  town: plainText(120),
  county: optionalPlainText(120),
  postcode: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((v) => v.trim().toUpperCase().replace(/\s+/g, " "))
    .refine(validateUkPostcode, { message: "Invalid UK postcode" }),
  country: z
    .string()
    .trim()
    .length(2)
    .default("GB")
    .transform((v) => v.toUpperCase()),
  label: optionalPlainText(120),
  contactName: optionalPlainText(160),
  contactPhone: optionalPlainText(40),
});

export type DeliveryAddressSnapshot = z.infer<typeof deliveryAddressSnapshotSchema>;

export const contactSnapshotSchema = z.object({
  name: plainText(160),
  email: z.string().trim().email().max(320).toLowerCase(),
  phone: optionalPlainText(40),
});

export type ContactSnapshot = z.infer<typeof contactSnapshotSchema>;

export const contactOverridesSchema = z
  .object({
    name: optionalPlainText(160),
    phone: optionalPlainText(40),
  })
  .optional()
  .nullable();

export const expectedLinePriceSchema = z.object({
  variantId: z.string().cuid(),
  /** Customer sell unit price ex VAT at 2dp — compared to live resolution. */
  customerUnitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Expected 2dp unit price"),
});

export const placeOrderInputSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(128),
    addressId: z.string().cuid().optional().nullable(),
    oneOffAddress: deliveryAddressSnapshotSchema.optional().nullable(),
    contact: contactOverridesSchema,
    /** Customer PO / YOUR REFERENCE. */
    poNumber: optionalPlainText(80),
    customerReference: optionalPlainText(80),
    deliveryInstructions: optionalPlainText(500),
    expectedLinePrices: z.array(expectedLinePriceSchema).max(500).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    const hasAddressId = Boolean(val.addressId);
    const hasOneOff = Boolean(val.oneOffAddress);
    if (hasAddressId && hasOneOff) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either addressId or oneOffAddress, not both",
        path: ["addressId"],
      });
    }
  });

export type PlaceOrderInput = z.infer<typeof placeOrderInputSchema>;

/** Preview draft — same commercial fields without idempotency. */
export const previewCheckoutDraftSchema = z
  .object({
    addressId: z.string().cuid().optional().nullable(),
    oneOffAddress: deliveryAddressSnapshotSchema.optional().nullable(),
    contact: contactOverridesSchema,
    poNumber: optionalPlainText(80),
    customerReference: optionalPlainText(80),
    deliveryInstructions: optionalPlainText(500),
    expectedLinePrices: z.array(expectedLinePriceSchema).max(500).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.addressId && val.oneOffAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either addressId or oneOffAddress, not both",
        path: ["addressId"],
      });
    }
  });

export type PreviewCheckoutDraft = z.infer<typeof previewCheckoutDraftSchema>;

export const CHECKOUT_LINE_ISSUES = [
  "VALID",
  "PRICE_UPDATED",
  "STOCK_CHANGED",
  "QUANTITY_INVALID",
  "PRODUCT_UNAVAILABLE",
  "PRICE_UNAVAILABLE",
  "CASE_CONFIGURATION_CHANGED",
  "INSUFFICIENT_FULL_CASE",
] as const;

export type CheckoutLineIssue = (typeof CHECKOUT_LINE_ISSUES)[number];
