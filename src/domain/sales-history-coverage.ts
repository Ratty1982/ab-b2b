/**
 * Explicit sales-history coverage verification.
 *
 * A sales record proves that invoice exists. It does not prove the import is
 * complete. Coverage is date-aware and is not a permanent verified flag.
 *
 * The forecast demand engine still uses PurchasingSettings.verifiedSalesHistoryFrom.
 * This module only classifies visibility: Verified, Partially verified, Unverified.
 *
 * Required window: the inclusive last 365 London days ending today. That is the
 * longest window Stock Forecast uses. Shorter windows sit inside it.
 */

import { addDaysIso, daysInclusive, isDateOnlyIso, lastNDaysRange } from "@/domain/sales-history-period";

export const SALES_HISTORY_VERIFICATION_STATUSES = ["VERIFIED", "PARTIAL", "UNVERIFIED"] as const;
export type SalesHistoryVerificationStatus = (typeof SALES_HISTORY_VERIFICATION_STATUSES)[number];

export const SALES_HISTORY_VERIFICATION_LABEL: Record<SalesHistoryVerificationStatus, string> = {
  VERIFIED: "Verified",
  PARTIAL: "Partially verified",
  UNVERIFIED: "Unverified",
};

/** Shown on Stock Forecast. This is coverage confirmation, not stock accuracy or suggested quantity. */
export const SALES_HISTORY_CONFIDENCE_HELP =
  "Verified means the last 365 days of sales history for that brand sit entirely inside a period an authorised user has confirmed as complete. Partially verified means only some of that period is confirmed, so a gap stays unverified. Unverified means coverage has not been confirmed. Imported invoices show that those records exist; they do not prove the history is complete. This measures sales-history coverage, not stock accuracy. Warehouse and FBA stock freshness stay separate. Confirming coverage does not change suggested order, cover, or runout.";

export type CoverageInterval = { from: string; to: string };

/** Last 365 inclusive days ending on today. */
export function requiredForecastCoverageWindow(today: string): CoverageInterval {
  return lastNDaysRange(today, 365);
}

/** Merge overlaps and ranges that touch on the next calendar day. Gaps stay open. */
export function mergeCoverageIntervals(ranges: CoverageInterval[]): CoverageInterval[] {
  const sorted = ranges
    .filter((range) => isDateOnlyIso(range.from) && isDateOnlyIso(range.to) && range.from <= range.to)
    .map((range) => ({ from: range.from, to: range.to }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const merged: CoverageInterval[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...range });
      continue;
    }
    const touch = addDaysIso(last.to, 1);
    if (range.from <= touch) {
      if (range.to > last.to) last.to = range.to;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function clip(range: CoverageInterval, window: CoverageInterval): CoverageInterval | null {
  const from = range.from > window.from ? range.from : window.from;
  const to = range.to < window.to ? range.to : window.to;
  if (from > to) return null;
  return { from, to };
}

export function classifySalesHistoryVerification(
  ranges: CoverageInterval[],
  required: CoverageInterval,
): {
  status: SalesHistoryVerificationStatus;
  coveredFrom: string | null;
  coveredTo: string | null;
  coveredDays: number;
  requiredDays: number;
} {
  const requiredDays = daysInclusive(required);
  const covered = mergeCoverageIntervals(ranges)
    .map((range) => clip(range, required))
    .filter((range): range is CoverageInterval => Boolean(range));
  const merged = mergeCoverageIntervals(covered);
  const coveredDays = merged.reduce((sum, range) => sum + daysInclusive(range), 0);
  const coveredFrom = merged[0]?.from ?? null;
  const coveredTo = merged[merged.length - 1]?.to ?? null;
  if (coveredDays <= 0 || requiredDays <= 0) {
    return { status: "UNVERIFIED", coveredFrom: null, coveredTo: null, coveredDays: 0, requiredDays };
  }
  if (coveredDays >= requiredDays) {
    return { status: "VERIFIED", coveredFrom: required.from, coveredTo: required.to, coveredDays: requiredDays, requiredDays };
  }
  return { status: "PARTIAL", coveredFrom, coveredTo, coveredDays, requiredDays };
}

export function validateCoverageDates(input: {
  from: string;
  to: string;
  earliestSale: string | null;
  latestSale: string | null;
}): { ok: true } | { ok: false; message: string } {
  if (!isDateOnlyIso(input.from) || !isDateOnlyIso(input.to)) {
    return { ok: false, message: "Coverage dates must be calendar dates." };
  }
  if (input.from > input.to) {
    return { ok: false, message: "Coverage end must be on or after the start date." };
  }
  if (!input.earliestSale || !input.latestSale) {
    return { ok: false, message: "This scope has no imported sales to verify." };
  }
  if (input.from < input.earliestSale || input.to > input.latestSale) {
    return {
      ok: false,
      message: "Coverage cannot extend beyond the imported sales dates for this scope.",
    };
  }
  return { ok: true };
}

/** Calendar months from earliest through latest that have no recorded sales. Not proof of a missing file. */
export function monthsWithNoRecordedSales(represented: string[], earliest: string, latest: string): string[] {
  if (!isDateOnlyIso(earliest) || !isDateOnlyIso(latest) || earliest > latest) return [];
  const have = new Set(represented);
  const missing: string[] = [];
  let cursor = earliest.slice(0, 7);
  const end = latest.slice(0, 7);
  while (cursor <= end && missing.length < 240) {
    if (!have.has(cursor)) missing.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return missing;
}

export function addMonths(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, (mon ?? 1) - 1 + delta, 1));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
