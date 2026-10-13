/**
 * Sales order entry — staff draft input.
 * Prices, stock, VAT, and delivery are never accepted from the browser.
 */

import { z } from "zod";
import {
  deliveryAddressSnapshotSchema,
  expectedLinePriceSchema,
  type ContactSnapshot,
} from "@/domain/checkout";

export const SALES_ORDER_ENTRY_SOURCES = ["TELEPHONE", "EMAIL", "CUSTOMER_VISIT"] as const;
export type SalesOrderEntrySource = (typeof SALES_ORDER_ENTRY_SOURCES)[number];

export const SALES_ORDER_SOURCE_LABEL: Record<SalesOrderEntrySource, string> = {
  TELEPHONE: "Telephone",
  EMAIL: "Email",
  CUSTOMER_VISIT: "Customer visit",
};

const optionalPlain = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value == null) return null;
      const cleaned = value.replace(/<[^>]*>/g, "").trim();
      return cleaned.length > 0 ? cleaned : null;
    });

export const salesOrderLineInputSchema = z.object({
  variantId: z.string().cuid(),
  qty: z.number().int().min(1).max(99999),
});

export const salesOrderDraftHeaderSchema = z
  .object({
    draftId: z.string().cuid(),
    source: z.enum(SALES_ORDER_ENTRY_SOURCES).optional().nullable(),
    contactId: z.string().cuid().optional().nullable(),
    addressId: z.string().cuid().optional().nullable(),
    oneOffAddress: deliveryAddressSnapshotSchema.optional().nullable(),
    poNumber: optionalPlain(80),
    deliveryInstructions: optionalPlain(500),
    internalNote: optionalPlain(2000),
    lines: z.array(salesOrderLineInputSchema).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.addressId && value.oneOffAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either a saved address or a one-off address",
        path: ["addressId"],
      });
    }
  });

export const openSalesOrderDraftSchema = z.object({
  companyId: z.string().cuid(),
  /** When true, always create a new draft instead of resuming the latest open one. */
  fresh: z.boolean().optional(),
});

export const salesOrderDraftIdSchema = z.object({
  draftId: z.string().cuid(),
});

export const salesOrderProductSearchSchema = z.object({
  companyId: z.string().cuid(),
  q: z.string().trim().min(1).max(80),
});

export const placeSalesOrderSchema = z
  .object({
    draftId: z.string().cuid(),
    confirmAuthorised: z
      .boolean()
      .refine((value) => value === true, {
        message: "Confirm you are authorised to place this order for the customer",
      }),
    idempotencyKey: z.string().trim().min(8).max(128),
    source: z.enum(SALES_ORDER_ENTRY_SOURCES),
    contactId: z.string().cuid().optional().nullable(),
    addressId: z.string().cuid().optional().nullable(),
    oneOffAddress: deliveryAddressSnapshotSchema.optional().nullable(),
    poNumber: optionalPlain(80),
    deliveryInstructions: optionalPlain(500),
    internalNote: optionalPlain(2000),
    lines: z.array(salesOrderLineInputSchema).max(100).optional(),
    expectedLinePrices: z.array(expectedLinePriceSchema).max(100).optional().nullable(),
    /** When set, the existing quotation is accepted instead of pricing a new order. */
    quoteId: z.string().cuid().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.quoteId) return;
    if (!value.contactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose the customer contact for this order",
        path: ["contactId"],
      });
    }
    if (value.addressId && value.oneOffAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either a saved address or a one-off address",
        path: ["addressId"],
      });
    }
    if (!value.addressId && !value.oneOffAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A delivery address is required",
        path: ["addressId"],
      });
    }
  });

export type PlaceSalesOrderInput = z.infer<typeof placeSalesOrderSchema>;

export type SalesOrderContactChoice = ContactSnapshot & { id: string };
