import { z } from "zod";
import { slugifyCatalogue } from "@/domain/catalogue";

export const priceListWriteSchema = z.object({
  id: z.string().cuid().optional(),
  code: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(120),
  currency: z.string().trim().min(3).max(3).optional(),
  isDefault: z.boolean().optional(),
});

export const priceListItemWriteSchema = z.object({
  priceListId: z.string().cuid(),
  variantId: z.string().cuid(),
  unitPrice: z.number().positive().max(1_000_000),
});

export const customerPriceWriteSchema = z.object({
  id: z.string().cuid().optional(),
  companyId: z.string().cuid(),
  variantId: z.string().cuid(),
  unitPrice: z.number().positive().max(1_000_000),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
});

export const quantityBreakWriteSchema = z.object({
  variantId: z.string().cuid(),
  minQty: z.number().int().min(2).max(1_000_000),
  unitPrice: z.number().positive().max(1_000_000),
});

export const promotionWriteSchema = z.object({
  id: z.string().cuid().optional(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  type: z.enum(["PERCENT", "FIXED", "QUANTITY_DEAL"]),
  value: z.number().min(0).max(1_000_000),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  variantIds: z.array(z.string().cuid()).optional(),
  skus: z.array(z.string().min(1)).optional(),
});

export const priceAsCustomerSchema = z.object({
  variantId: z.string().cuid(),
  companyId: z.string().cuid(),
  quantity: z.number().int().min(1).max(1_000_000).optional(),
});

export function priceListCodeFromName(name: string, code?: string) {
  return (code?.trim() || slugifyCatalogue(name)).slice(0, 40).toUpperCase();
}
