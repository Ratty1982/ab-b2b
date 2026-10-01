/**
 * Autopart ongoing 504 / TRM21QC import diagnostic reason codes.
 * Codes map to real importer behaviour — not a speculative wishlist.
 */

export const AUTOPART_IMPORT_DIAGNOSTIC_STATUSES = [
  "INSERTED",
  "UPDATED",
  "UNCHANGED",
  "SKIPPED",
  "WARNING",
  "ERROR",
] as const;

export type AutopartImportDiagnosticStatus =
  (typeof AUTOPART_IMPORT_DIAGNOSTIC_STATUSES)[number];

/** Machine-readable codes used by the ongoing sales importers. */
export const AUTOPART_IMPORT_REASON_CODES = [
  "INSERTED",
  "UPDATED",
  "ALREADY_IMPORTED",
  "BLANK_ROW",
  "PARSE_ERROR",
  "MISSING_DOCUMENT",
  "UNMAPPED_CUSTOMER",
  "NOT_IN_AB_CATALOGUE",
  "MALFORMED_ROW",
] as const;

export type AutopartImportReasonCode = (typeof AUTOPART_IMPORT_REASON_CODES)[number];

export const AUTOPART_IMPORT_REASON_LABELS: Record<AutopartImportReasonCode, string> = {
  INSERTED: "New financial row created.",
  UPDATED: "Existing financial row enriched or refreshed from this feed.",
  ALREADY_IMPORTED: "Identical data already present — no financial change.",
  BLANK_ROW: "Empty or header-only source row ignored.",
  PARSE_ERROR: "Row could not be parsed into a valid document or line.",
  MISSING_DOCUMENT: "Document number missing from the source row.",
  UNMAPPED_CUSTOMER:
    "Autopart customer account is not linked to an AB company. Lines require a mapped company and were not imported.",
  NOT_IN_AB_CATALOGUE:
    "SKU not found in the AB catalogue (exact trim / case-insensitive match). Line was still imported with unmatched status.",
  MALFORMED_ROW: "Required monetary or identity fields were missing or invalid.",
};

export type AutopartImportDiagnosticDraft = {
  status: AutopartImportDiagnosticStatus;
  reasonCode: AutopartImportReasonCode;
  reason: string;
  rowNumber?: number | null;
  customerAccount?: string | null;
  documentReference?: string | null;
  documentDate?: string | null;
  sku?: string | null;
  description?: string | null;
  quantity?: string | null;
  salesNet?: string | null;
  abOrderReference?: string | null;
  customerOrderNumber?: string | null;
  companyId?: string | null;
  abOrderId?: string | null;
  isWarning?: boolean;
};

export type AutopartImportDiagnosticCounts = {
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  warnings: number;
  errors: number;
};

export function emptyDiagnosticCounts(): AutopartImportDiagnosticCounts {
  return {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    warnings: 0,
    errors: 0,
  };
}

export function explainReason(code: AutopartImportReasonCode): string {
  return AUTOPART_IMPORT_REASON_LABELS[code];
}

export function makeDiagnostic(
  partial: Omit<AutopartImportDiagnosticDraft, "reason"> & { reason?: string },
): AutopartImportDiagnosticDraft {
  return {
    ...partial,
    reason: partial.reason ?? explainReason(partial.reasonCode),
    isWarning:
      partial.isWarning ??
      (partial.status === "WARNING" || partial.reasonCode === "NOT_IN_AB_CATALOGUE"),
  };
}

export function tallyDiagnostic(counts: AutopartImportDiagnosticCounts, d: AutopartImportDiagnosticDraft) {
  switch (d.status) {
    case "INSERTED":
      counts.inserted += 1;
      break;
    case "UPDATED":
      counts.updated += 1;
      break;
    case "UNCHANGED":
      counts.unchanged += 1;
      break;
    case "SKIPPED":
      counts.skipped += 1;
      break;
    case "ERROR":
      counts.errors += 1;
      break;
    case "WARNING":
      counts.warnings += 1;
      break;
  }
  if (d.isWarning && d.status !== "WARNING" && d.status !== "ERROR") {
    counts.warnings += 1;
  }
}

/** Historic runs before row diagnostics — never invent row-level history. */
export function historicSkipAggregateMessage(input: {
  type: "ONGOING_504" | "ONGOING_TRM21QC";
  rowsSkipped: number;
  rowsUnmatched: number;
  hasRowDiagnostics: boolean;
}): string | null {
  if (input.hasRowDiagnostics) return null;
  if (input.rowsSkipped <= 0) {
    return "Detailed row diagnostics were not recorded for this import.";
  }
  if (input.type === "ONGOING_TRM21QC") {
    return (
      `Detailed row diagnostics were not recorded for this import. ` +
      `From importer behaviour at the time: all ${input.rowsSkipped} skipped line(s) were for ` +
      `documents whose Autopart customer account could not be mapped to an AB company` +
      (input.rowsUnmatched > 0 ? ` (${input.rowsUnmatched} unmapped account group(s))` : "") +
      `. Document headers may have been retained; product lines require a mapped company and were not written.`
    );
  }
  return (
    `Detailed row diagnostics were not recorded for this import. ` +
    `${input.rowsSkipped} source row(s) were counted as skipped (blank, malformed, or missing document number).`
  );
}

export function sourceLabel(source: unknown): string {
  if (source === "EMAIL" || source === "EMAIL_POLL") return "EMAIL_POLL";
  if (source === "SCHEDULE" || source === "SCHEDULED_POLL") return "SCHEDULED_POLL";
  if (source === "MANUAL" || source === "MANUAL_UPLOAD") return "MANUAL_UPLOAD";
  if (typeof source === "string" && source.trim()) return source;
  return "MANUAL_UPLOAD";
}

export function decimalStringsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a) === String(b);
  return Math.abs(na - nb) < 0.000_000_1;
}
