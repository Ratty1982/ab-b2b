/**
 * Shared Europe/London date-only period helpers for historic Autopart sales.
 *
 * Authoritative for:
 * - Purchase History purchased windows
 * - Sales Intelligence enquiry periods
 *
 * Semantics:
 * - Compare calendar YYYY-MM-DD strings (no UTC wall-clock shift of date-only values)
 * - Inclusive [from, to] bounds
 * - Bounded periods exclude undated documents
 * - LAST_N days includes today (from = today − (N − 1))
 */

export type DateOnlyRange = { from: string; to: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnlyIso(value: string): boolean {
  return YMD.test(value);
}

/** Prisma/Date → YYYY-MM-DD from the stored UTC calendar day (date-only convention). */
export function dateOnlyIsoFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, day] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, day!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dateOnlyIsoFromDate(dt);
}

/** Europe/London civil calendar date for an instant. */
export function todayLondonDateOnly(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

/** Inclusive last N London days ending today. */
export function lastNDaysRange(today: string, days: number): DateOnlyRange {
  return { from: addDaysIso(today, -(days - 1)), to: today };
}

export function daysInclusive(range: DateOnlyRange): number {
  const [y1, m1, d1] = range.from.split("-").map(Number);
  const [y2, m2, d2] = range.to.split("-").map(Number);
  const a = Date.UTC(y1!, m1! - 1, d1!);
  const b = Date.UTC(y2!, m2! - 1, d2!);
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * Previous equivalent period: same length, ending the day before primary.from.
 * Example: 01/01/2026–30/06/2026 → 02/07/2025–31/12/2025.
 */
export function previousEquivalentPeriod(primary: DateOnlyRange): DateOnlyRange {
  const len = daysInclusive(primary);
  const to = addDaysIso(primary.from, -1);
  const from = addDaysIso(to, -(len - 1));
  return { from, to };
}

export type SalesEnquiryPeriodPreset =
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "LAST_30"
  | "LAST_90"
  | "LAST_180"
  | "YTD"
  | "LAST_YEAR"
  | "CUSTOM";

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function lastDayOfMonth(year: number, month1: number): string {
  const dt = new Date(Date.UTC(year, month1, 0));
  return dateOnlyIsoFromDate(dt);
}

/** Resolve a Sales Enquiry preset to an inclusive London date-only range. */
export function resolveSalesEnquiryPeriod(
  preset: SalesEnquiryPeriodPreset,
  from: string | null | undefined,
  to: string | null | undefined,
  today: string,
): DateOnlyRange | null {
  if (preset === "CUSTOM") {
    if (!from && !to) return null;
    return { from: from && isDateOnlyIso(from) ? from : "0001-01-01", to: to && isDateOnlyIso(to) ? to : "9999-12-31" };
  }
  if (preset === "LAST_30") return lastNDaysRange(today, 30);
  if (preset === "LAST_90") return lastNDaysRange(today, 90);
  if (preset === "LAST_180") return lastNDaysRange(today, 180);
  if (preset === "THIS_MONTH") {
    return { from: monthStart(today), to: today };
  }
  if (preset === "LAST_MONTH") {
    const [y, m] = today.split("-").map(Number);
    const prevMonth = m === 1 ? 12 : m! - 1;
    const prevYear = m === 1 ? y! - 1 : y!;
    const from = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
    return { from, to: lastDayOfMonth(prevYear, prevMonth) };
  }
  if (preset === "YTD") {
    return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
  if (preset === "LAST_YEAR") {
    const y = Number(today.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return null;
}

/** Prisma DateTime bounds for a date-only inclusive window (UTC noon storage friendly). */
export function documentDatePrismaBounds(range: DateOnlyRange): { gte: Date; lte: Date } {
  return {
    gte: new Date(`${range.from}T00:00:00.000Z`),
    lte: new Date(`${range.to}T23:59:59.999Z`),
  };
}

export function isDocumentDateInRange(
  documentDate: Date | null | undefined,
  range: DateOnlyRange | null,
): boolean {
  if (!range) return true;
  if (!documentDate) return false;
  const iso = dateOnlyIsoFromDate(documentDate);
  return iso >= range.from && iso <= range.to;
}
