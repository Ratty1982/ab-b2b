/**
 * Unified customer sales enquiry — pure rules shared by server and UI.
 *
 * Sources:
 * - HISTORICAL_561L: global AutopartInvoiceLine rows (undated).
 * - COMPANY_561L_SLRB: per-company 561L + SLRB import (AutopartSalesLine, dated when SLRB matched).
 * - TRM21QC_FEED: ongoing TRM21QC lines (AutopartSalesLine, dated from 504 / TRM).
 *
 * A document (company + reference) present in more than one source is counted once only when every
 * source agrees on every line (type, SKU, signed qty, signed net). The copy counted is the TRM21QC
 * feed, then the company 561L/SLRB import, then global 561L history. Any other overlap is
 * UNRECONCILED and is excluded from certified totals.
 *
 * A 504 document is a goods header, not another product-line copy. Its goods total is never added
 * on top of the lines. When it disagrees with those lines by more than 1p, or it has no lines, the
 * document stays unreconciled.
 *
 * Repeated identical 561L rows are the rows the importer actually stored. Inside each 200-row
 * import chunk a second identical natural key is stored and then held back here, so it is not
 * added to certified sales. The same natural key in a later chunk shares the first row's identity
 * and does not create another stored row. Those extra occurrences are not reconstructed.
 */

export const UNIFIED_SOURCES = ["HISTORICAL_561L", "COMPANY_561L_SLRB", "TRM21QC_FEED", "ONGOING_504"] as const;

/** Importer chunk size that resets 561L occurrence numbering. Reporting does not change it. */
export const SOURCE_IDENTITY_CHUNK = 200;
export type UnifiedSource = (typeof UNIFIED_SOURCES)[number];

export const UNIFIED_LINE_STATUSES = [
  "HISTORICAL",
  "DATED",
  "MATCHED",
  "DUPLICATE",
  "UNRECONCILED",
] as const;
export type UnifiedLineStatus = (typeof UNIFIED_LINE_STATUSES)[number];

export const UNIFIED_UNRECONCILED_REASONS = [
  "REPEATED_SOURCE_ROW",
  "NO_DOCUMENT_REFERENCE",
  "UNKNOWN_DOCUMENT_TYPE",
  "CONFLICTING_OVERLAP",
  "DOCUMENT_GOODS_MISMATCH",
] as const;
export type UnifiedUnreconciledReason = (typeof UNIFIED_UNRECONCILED_REASONS)[number];

export const COUNTED_STATUSES: readonly UnifiedLineStatus[] = ["HISTORICAL", "DATED", "MATCHED"];

export function isCountedStatus(status: string): boolean {
  return (COUNTED_STATUSES as readonly string[]).includes(status);
}

export const UNIFIED_SOURCE_LABELS: Record<UnifiedSource, string> = {
  HISTORICAL_561L: "561L history (undated)",
  COMPANY_561L_SLRB: "561L + SLRB import",
  TRM21QC_FEED: "TRM21QC feed",
  ONGOING_504: "504 goods header",
};

export const UNIFIED_STATUS_LABELS: Record<UnifiedLineStatus, string> = {
  HISTORICAL: "Historical only",
  DATED: "Dated source",
  MATCHED: "Reconciled across sources",
  DUPLICATE: "Duplicate suppressed",
  UNRECONCILED: "Unreconciled",
};

export const UNIFIED_REASON_LABELS: Record<UnifiedUnreconciledReason, string> = {
  REPEATED_SOURCE_ROW:
    "Repeats an identical 561L row (same account, Inv & Ln, part, qty and sales). Kept for review, not counted.",
  NO_DOCUMENT_REFERENCE:
    "The 561L Inv & Ln has no usable document reference, so overlap cannot be checked.",
  UNKNOWN_DOCUMENT_TYPE:
    "The 561L Inv & Ln does not show invoice or credit, so the sign cannot be proven.",
  CONFLICTING_OVERLAP:
    "The same document is in more than one source but the lines do not agree. Every copy is held back.",
  DOCUMENT_GOODS_MISMATCH:
    "The 504 goods total does not agree with the product lines, or the 504 document has no product lines. The 504 amount is not added to certified sales.",
};

export function unifiedSourceLabel(source: string): string {
  return (UNIFIED_SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

export function unifiedStatusLabel(status: string): string {
  return (UNIFIED_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

export function unifiedReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (UNIFIED_REASON_LABELS as Record<string, string>)[reason] ?? reason;
}

export const DATE_UNAVAILABLE = "Date unavailable";

export type UnifiedCertification = "COMPLETE" | "INCOMPLETE";

/** A combined figure is only stated when nothing is held back for reconciliation. */
export function certifyUnifiedTotals(input: { certifiedNet: string; unreconciledLines: number }): {
  status: UnifiedCertification;
  combinedNet: string | null;
} {
  if (input.unreconciledLines > 0) return { status: "INCOMPLETE", combinedNet: null };
  return { status: "COMPLETE", combinedNet: input.certifiedNet };
}

const DAY_MS = 86_400_000;

/**
 * Average days between distinct dated invoices. Needs at least two dated invoices on
 * different days. Undated 561L lines never contribute.
 */
export function purchaseFrequencyDays(input: {
  datedInvoiceCount: number;
  firstDated: Date | string | null;
  lastDated: Date | string | null;
}): number | null {
  if (input.datedInvoiceCount < 2 || !input.firstDated || !input.lastDated) return null;
  const first = new Date(input.firstDated).getTime();
  const last = new Date(input.lastDated).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
  return Math.max(1, Math.round((last - first) / DAY_MS / (input.datedInvoiceCount - 1)));
}

export function purchaseFrequencyLabel(days: number | null): string {
  if (days == null) return "Not enough dated invoices";
  if (days <= 10) return `About every ${days} day${days === 1 ? "" : "s"}`;
  if (days <= 60) return `About every ${Math.round(days / 7)} weeks`;
  return `About every ${Math.round(days / 30)} months`;
}

export const UNIFIED_TX_TYPES = ["ALL", "INVOICE", "CREDIT"] as const;
export const UNIFIED_TX_DATING = ["ALL", "DATED", "UNDATED"] as const;
export const UNIFIED_TX_STATUS = ["COUNTED", "UNRECONCILED", "SUPPRESSED", "ALL"] as const;

export type UnifiedTxFilters = {
  type: (typeof UNIFIED_TX_TYPES)[number];
  dating: (typeof UNIFIED_TX_DATING)[number];
  status: (typeof UNIFIED_TX_STATUS)[number];
  from: string | null;
  to: string | null;
};

/**
 * A date range only selects genuinely dated rows. Asking for undated rows inside a date range
 * returns nothing rather than mixing undated history into a dated view.
 */
export function effectiveDating(filters: Pick<UnifiedTxFilters, "dating" | "from" | "to">): {
  dating: UnifiedTxFilters["dating"];
  contradiction: boolean;
} {
  const ranged = Boolean(filters.from || filters.to);
  if (!ranged) return { dating: filters.dating, contradiction: false };
  if (filters.dating === "UNDATED") return { dating: "UNDATED", contradiction: true };
  return { dating: "DATED", contradiction: false };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type SalesEnquirySurface = "unified-customer" | "unified-product" | "dated-group" | "picker";

/**
 * A selected customer or product is one unified enquiry. Dated period analysis stays available
 * for customer groups, which are not an Autopart account.
 */
export function salesEnquirySurface(input: {
  mode: "customers" | "products";
  companyId?: string | null;
  customerGroupId?: string | null;
  sku?: string | null;
}): SalesEnquirySurface {
  if (input.mode === "customers" && input.customerGroupId) return "dated-group";
  if (input.mode === "customers" && input.companyId) return "unified-customer";
  if (input.mode === "products" && input.sku) return "unified-product";
  return "picker";
}

export function parseIsoDay(value: string | null | undefined): Date | null {
  if (!value || !ISO_DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

/** Exclusive upper bound for an inclusive "to" day. */
export function dayAfter(value: Date): Date {
  return new Date(value.getTime() + DAY_MS);
}
