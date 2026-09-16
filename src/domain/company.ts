import { z } from "zod";

/** Product-facing status labels; DB uses PENDING_APPROVAL for Pending. */
export const COMPANY_STATUSES = [
  "PROSPECT",
  "PENDING_APPROVAL",
  "ACTIVE",
  "ON_HOLD",
  "SUSPENDED",
  "CLOSED",
] as const;

export type CompanyStatusKey = (typeof COMPANY_STATUSES)[number];

export const COMPANY_STATUS_LABEL: Record<CompanyStatusKey, string> = {
  PROSPECT: "Prospect",
  PENDING_APPROVAL: "Pending",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  SUSPENDED: "Suspended",
  CLOSED: "Closed",
};

export const TAX_STATUSES = ["STANDARD", "ZERO_RATED", "EXEMPT", "OUTSIDE_SCOPE"] as const;

export const companyCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  tradingName: z.string().trim().max(200).optional().nullable(),
  companyNumber: z.string().trim().max(40).optional().nullable(),
  vatNumber: z.string().trim().max(40).optional().nullable(),
  accountNumber: z.string().trim().max(40).optional().nullable(),
  status: z.enum(COMPANY_STATUSES).default("PROSPECT"),
  taxStatus: z.enum(TAX_STATUSES).default("STANDARD"),
  website: z.string().trim().url().max(300).optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
  primaryEmail: z.string().trim().email().max(320).optional().nullable().or(z.literal("")),
  notes: z.string().trim().max(5000).optional().nullable(),
  paymentTerms: z.string().trim().max(120).optional().nullable(),
  creditLimit: z.number().nonnegative().max(99_999_999).optional().nullable(),
  priceListId: z.string().cuid().optional().nullable(),
  salesRepId: z.string().cuid().optional().nullable(),
  externalRef: z.string().trim().max(120).optional().nullable(),
});

export const companyUpdateSchema = companyCreateSchema.partial().extend({
  id: z.string().cuid(),
});

export const companyListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(COMPANY_STATUSES).optional(),
  salesRepId: z.string().cuid().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export const contactSchema = z.object({
  companyId: z.string().cuid(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320).optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
  mobile: z.string().trim().max(40).optional().nullable(),
  jobTitle: z.string().trim().max(120).optional().nullable(),
  isPrimary: z.boolean().default(false),
  isPurchasing: z.boolean().default(false),
  isAccounts: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const contactUpdateSchema = contactSchema.partial().extend({
  id: z.string().cuid(),
  companyId: z.string().cuid(),
});

export const ADDRESS_TYPES = ["TRADING", "DELIVERY", "BILLING", "REGISTERED"] as const;

export const addressSchema = z.object({
  companyId: z.string().cuid(),
  type: z.enum(ADDRESS_TYPES).default("DELIVERY"),
  label: z.string().trim().max(120).optional().nullable(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  town: z.string().trim().min(1).max(120),
  county: z.string().trim().max(120).optional().nullable(),
  postcode: z.string().trim().min(1).max(20),
  country: z.string().trim().length(2).default("GB"),
  isDefaultBilling: z.boolean().default(false),
  isDefaultDelivery: z.boolean().default(false),
  contactName: z.string().trim().max(160).optional().nullable(),
  contactPhone: z.string().trim().max(40).optional().nullable(),
});

export const addressUpdateSchema = addressSchema.partial().extend({
  id: z.string().cuid(),
  companyId: z.string().cuid(),
});

export function emptyToNull<T extends string | null | undefined>(v: T): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}
