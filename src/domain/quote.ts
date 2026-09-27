/**
 * Production B2B quote domain — validation and status labels.
 */
import { z } from "zod";

export const QUOTE_STATUSES = [
  "DRAFT",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "DECLINED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "CONVERTED",
] as const;

export type QuoteStatusKey = (typeof QUOTE_STATUSES)[number];

/** Default validity when sending (calendar days). */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

export const QUOTE_STATUS_LABEL: Record<QuoteStatusKey, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Viewed",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  REJECTED: "Declined",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
  CONVERTED: "Converted",
};

export const QUOTE_CUSTOMER_STATUS_LABEL: Record<QuoteStatusKey, string> = {
  DRAFT: "Draft",
  SENT: "Awaiting your response",
  VIEWED: "Viewed",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  REJECTED: "Declined",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
  CONVERTED: "Converted to order",
};

const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d+(\.\d{1,4})?$/.test(v), "Invalid money amount");

export const quoteCreateSchema = z.object({
  companyId: z.string().cuid(),
  contactId: z.string().cuid().optional().nullable(),
  deliveryAddressId: z.string().cuid().optional().nullable(),
  poNumber: z.string().trim().max(80).optional().nullable(),
  customerNotes: z.string().trim().max(4000).optional().nullable(),
  internalNotes: z.string().trim().max(4000).optional().nullable(),
  /** Calendar days from send (or explicit ISO date YYYY-MM-DD). */
  validityDays: z.number().int().min(1).max(365).optional(),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});

export const quoteLineInputSchema = z.object({
  variantId: z.string().cuid(),
  qty: z.number().int().min(1).max(999_999),
  /** Optional quote-specific override (ex VAT). Requires quotes.override_price. */
  quotedUnitPrice: moneyString.optional().nullable(),
});

export const quoteUpdateDraftSchema = z.object({
  id: z.string().cuid(),
  contactId: z.string().cuid().optional().nullable(),
  deliveryAddressId: z.string().cuid().optional().nullable(),
  poNumber: z.string().trim().max(80).optional().nullable(),
  customerNotes: z.string().trim().max(4000).optional().nullable(),
  internalNotes: z.string().trim().max(4000).optional().nullable(),
  validityDays: z.number().int().min(1).max(365).optional().nullable(),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  /** Explicit delivery override net ex VAT — requires override permission. */
  deliveryTotalOverride: moneyString.optional().nullable(),
  clearDeliveryOverride: z.boolean().optional(),
  lines: z.array(quoteLineInputSchema).max(200).optional(),
});

export const quoteIdSchema = z.object({
  id: z.string().cuid(),
});

export const quoteSendSchema = z.object({
  id: z.string().cuid(),
  /** Optional recipient override — defaults to contact / company primary email. */
  toEmail: z.string().trim().email().optional().nullable(),
});

export const quoteDeclineSchema = z.object({
  id: z.string().cuid(),
  reason: z.string().trim().max(2000).optional().nullable(),
});

export const quoteAcceptSchema = z.object({
  id: z.string().cuid(),
  idempotencyKey: z.string().trim().min(8).max(120),
  note: z.string().trim().max(2000).optional().nullable(),
});

export const quoteAcceptOnBehalfSchema = quoteAcceptSchema.extend({
  note: z.string().trim().min(1).max(2000),
});

export const quoteListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(QUOTE_STATUSES).optional(),
  companyId: z.string().cuid().optional(),
  salesRepId: z.string().cuid().optional(),
  expiringSoon: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

/** UTC noon for a YYYY-MM-DD calendar date — avoids timezone day-shift. */
export function validUntilFromDateOnly(dateOnly: string): Date {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0, 0));
}

export function dateOnlyFromValidUntil(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addCalendarDaysDateOnly(from: Date, days: number): string {
  const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12));
  base.setUTCDate(base.getUTCDate() + days);
  return dateOnlyFromValidUntil(base);
}

export function isQuoteExpired(expiresAt: Date | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  const end = new Date(
    Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth(), expiresAt.getUTCDate(), 23, 59, 59, 999),
  );
  return now.getTime() > end.getTime();
}

export function customerCanRespond(status: string, expiresAt: Date | null | undefined): boolean {
  if (status !== "SENT" && status !== "VIEWED") return false;
  return !isQuoteExpired(expiresAt);
}

/** Display a YYYY-MM-DD validity date as DD/MM/YYYY (no timezone shift). */
export function formatQuoteDateOnlyUk(dateOnly: string | null | undefined): string {
  if (!dateOnly) return "—";
  const [y, m, d] = dateOnly.split("-");
  if (!y || !m || !d) return dateOnly;
  return `${d}/${m}/${y}`;
}
