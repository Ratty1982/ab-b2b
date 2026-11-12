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
  qty: z
    .number()
    .int(
      "Enter a whole quantity from 1 to 999999. The quantity is saved exactly as entered and is not rounded to a case.",
    )
    .min(
      1,
      "Enter a whole quantity from 1 to 999999. The quantity is saved exactly as entered and is not rounded to a case.",
    )
    .max(999_999),
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
  /**
   * Customer orders must be full cases. Set after the buyer confirms the
   * proposed order quantities. The saved quotation quantity is not changed.
   */
  confirmOrderQuantityChanges: z.boolean().optional(),
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

/**
 * Quotes store the quantity the salesperson entered.
 * Case size and minimum order quantity are customer-order rules, not quote rules.
 */
export function quoteQuantityMessage(quantity: number): string | null {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999_999) {
    return "Enter a whole quantity from 1 to 999999. The quantity is saved exactly as entered and is not rounded to a case.";
  }
  return null;
}

export type QuoteOrderQuantityProposal = {
  quotedQty: number;
  orderQty: number;
  changed: boolean;
  reason: string | null;
};

/**
 * Customer checkout requires a full case. This proposes the next valid case
 * quantity and does not apply it until the buyer confirms.
 * A missing or single-unit case size accepts the quoted quantity.
 */
export function proposeCustomerOrderQuantity(input: {
  quotedQty: number;
  caseQty: number | null | undefined;
  minimumOrderQty?: number | null;
}): QuoteOrderQuantityProposal {
  const caseQty =
    input.caseQty != null && Number.isInteger(input.caseQty) && input.caseQty > 1
      ? input.caseQty
      : 1;
  const minimum =
    input.minimumOrderQty != null &&
    Number.isInteger(input.minimumOrderQty) &&
    input.minimumOrderQty > 1
      ? input.minimumOrderQty
      : caseQty;
  const floor = Math.max(minimum, caseQty);
  const alreadyValid =
    input.quotedQty >= floor && (caseQty <= 1 || input.quotedQty % caseQty === 0);
  if (alreadyValid) {
    return {
      quotedQty: input.quotedQty,
      orderQty: input.quotedQty,
      changed: false,
      reason: null,
    };
  }
  const target = Math.max(input.quotedQty, floor);
  const orderQty = Math.ceil(target / caseQty) * caseQty;
  return {
    quotedQty: input.quotedQty,
    orderQty,
    changed: true,
    reason: `Quoted quantity ${input.quotedQty} is not a full case of ${caseQty}. Confirm to place the order for ${orderQty}. The quotation keeps ${input.quotedQty}.`,
  };
}

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
