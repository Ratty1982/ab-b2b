/**
 * Shared Europe/London date-only period helpers for historic Autopart sales.
 *
 * Authoritative for:
 * - Purchase History purchased windows
 * - Sales Intelligence enquiry periods
 * - Customer Group / business reporting periods (`resolveBusinessPeriod`)
 *
 * Semantics:
 * - Civil calendar days in Europe/London (not hardcoded UTC offsets)
 * - Display ranges are inclusive [displayFrom, displayTo]
 * - Database queries prefer half-open [start, endExclusive) to avoid end-of-day bugs
 * - Bounded periods exclude undated documents
 * - LAST_N days includes today (from = today − (N − 1))
 * - In-progress calendar periods (This Month / Quarter / Year) end on London today
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
 * Used for rolling windows and custom ranges.
 * Example: 01/01/2026–30/06/2026 → 04/07/2025–31/12/2025 (181 inclusive days).
 *
 * For calendar presets (This Month / Quarter / Year), prefer
 * {@link previousComparableBusinessPeriod} so “This Month” on 1 Oct compares
 * 1 Oct vs 1 Sep — not a one-day window ending 30 Sep.
 */
export function previousEquivalentPeriod(primary: DateOnlyRange): DateOnlyRange {
  const len = daysInclusive(primary);
  const to = addDaysIso(primary.from, -1);
  const from = addDaysIso(to, -(len - 1));
  return { from, to };
}

function minIsoDate(a: string, b: string): string {
  return a <= b ? a : b;
}

/**
 * Commercially meaningful previous period for a business/reporting preset.
 *
 * Calendar in-progress (THIS_*): same ordinal elapsed portion of the previous
 * calendar period (day-of-month / days-into-quarter / YTD dates), with safe
 * month-length clamping.
 *
 * Calendar complete (LAST_*): immediately preceding complete calendar period.
 *
 * Rolling / CUSTOM / unknown: {@link previousEquivalentPeriod} length window.
 */
export function previousComparableBusinessPeriod(
  primary: DateOnlyRange,
  period: string | null | undefined,
): DateOnlyRange {
  const p = (period ?? "").trim().toUpperCase();

  if (p === "THIS_MONTH") {
    const fromY = Number(primary.from.slice(0, 4));
    const fromM = Number(primary.from.slice(5, 7));
    const day = Number(primary.to.slice(8, 10));
    const py = fromM === 1 ? fromY - 1 : fromY;
    const pm = fromM === 1 ? 12 : fromM - 1;
    const from = `${py}-${String(pm).padStart(2, "0")}-01`;
    const last = Number(lastDayOfMonth(py, pm).slice(8, 10));
    const toDay = Math.min(day, last);
    return {
      from,
      to: `${py}-${String(pm).padStart(2, "0")}-${String(toDay).padStart(2, "0")}`,
    };
  }

  if (p === "LAST_MONTH") {
    const fromY = Number(primary.from.slice(0, 4));
    const fromM = Number(primary.from.slice(5, 7));
    const py = fromM === 1 ? fromY - 1 : fromY;
    const pm = fromM === 1 ? 12 : fromM - 1;
    return {
      from: `${py}-${String(pm).padStart(2, "0")}-01`,
      to: lastDayOfMonth(py, pm),
    };
  }

  if (p === "THIS_QUARTER") {
    const elapsed = daysInclusive(primary);
    const prevQ = previousCalendarQuarterRange(primary.from);
    const rawTo = addDaysIso(prevQ.from, elapsed - 1);
    return { from: prevQ.from, to: minIsoDate(rawTo, prevQ.to) };
  }

  if (p === "LAST_QUARTER" || p === "PREVIOUS_QUARTER") {
    return previousCalendarQuarterRange(primary.from);
  }

  if (p === "THIS_YEAR" || p === "YTD") {
    return samePeriodPreviousYear(primary);
  }

  if (p === "LAST_YEAR") {
    const y = Number(primary.from.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }

  // Rolling, CUSTOM, ALL callers should not use this for ALL — length-based default.
  return previousEquivalentPeriod(primary);
}

/**
 * Same calendar dates one year earlier.
 * Leap-day rule: 29 Feb in a leap year → 28 Feb in the prior non-leap year.
 * Example: 01/01/2026–30/06/2026 → 01/01/2025–30/06/2025.
 */
export function samePeriodPreviousYear(primary: DateOnlyRange): DateOnlyRange {
  return {
    from: shiftYearIso(primary.from, -1),
    to: shiftYearIso(primary.to, -1),
  };
}

function shiftYearIso(iso: string, deltaYears: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const year = y! + deltaYears;
  const month = m!;
  const day = d!;
  // Clamp day to last day of target month (handles 29 Feb → 28 Feb).
  const last = Number(lastDayOfMonth(year, month).slice(8, 10));
  const safeDay = Math.min(day, last);
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
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

/**
 * Calendar-quarter presets for Rebate / Net Spend Analysis (Jan–Mar … Oct–Dec),
 * plus unbounded All history (`ALL`).
 */
export type RebatePeriodPreset =
  | "ALL"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_QUARTER"
  | "PREVIOUS_QUARTER"
  | "YTD"
  | "LAST_YEAR"
  | "LAST_90"
  | "LAST_180"
  | "LAST_365"
  | "CUSTOM";

/**
 * Internal query window that preserves historic “all dated documents” semantics
 * (excludes null documentDate via Prisma gte/lte). Never expose in UI/CSV/URL.
 */
export const ALL_DATED_HISTORY_QUERY_RANGE: DateOnlyRange = {
  from: "0001-01-01",
  to: "9999-12-31",
};

export function isSentinelDateOnly(value: string | null | undefined): boolean {
  return value === "0001-01-01" || value === "9999-12-31";
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function lastDayOfMonth(year: number, month1: number): string {
  const dt = new Date(Date.UTC(year, month1, 0));
  return dateOnlyIsoFromDate(dt);
}

/**
 * Calendar quarter containing `today` (Q1=Jan–Mar … Q4=Oct–Dec).
 * Not financial-year quarters.
 */
export function calendarQuarterRange(today: string): DateOnlyRange {
  const [y, m] = today.split("-").map(Number);
  const q = Math.floor((m! - 1) / 3); // 0..3
  const startMonth = q * 3 + 1;
  const endMonth = startMonth + 2;
  const from = `${y}-${String(startMonth).padStart(2, "0")}-01`;
  return { from, to: lastDayOfMonth(y!, endMonth) };
}

/** Previous calendar quarter relative to `today`. */
export function previousCalendarQuarterRange(today: string): DateOnlyRange {
  const [y, m] = today.split("-").map(Number);
  const q = Math.floor((m! - 1) / 3);
  let pq = q - 1;
  let py = y!;
  if (pq < 0) {
    pq = 3;
    py = y! - 1;
  }
  const startMonth = pq * 3 + 1;
  const endMonth = startMonth + 2;
  const from = `${py}-${String(startMonth).padStart(2, "0")}-01`;
  return { from, to: lastDayOfMonth(py, endMonth) };
}

/**
 * Resolve Rebate Analysis period presets.
 * `ALL` returns null (unbounded dated history — caller uses ALL_DATED_HISTORY_QUERY_RANGE).
 * `CUSTOM` requires both from and to; incomplete blank Custom is handled by rebate domain as ALL.
 */
export function resolveRebatePeriod(
  preset: RebatePeriodPreset,
  from: string | null | undefined,
  to: string | null | undefined,
  today: string,
): DateOnlyRange | null {
  if (preset === "ALL") return null;
  if (preset === "THIS_QUARTER") return calendarQuarterRange(today);
  if (preset === "PREVIOUS_QUARTER") return previousCalendarQuarterRange(today);
  if (preset === "LAST_365") return lastNDaysRange(today, 365);
  if (preset === "CUSTOM") {
    if (!from || !to) return null;
    if (!isDateOnlyIso(from) || !isDateOnlyIso(to)) return null;
    return { from, to };
  }
  if (
    preset === "THIS_MONTH" ||
    preset === "LAST_MONTH" ||
    preset === "LAST_90" ||
    preset === "LAST_180" ||
    preset === "YTD" ||
    preset === "LAST_YEAR"
  ) {
    return resolveSalesEnquiryPeriod(preset, from, to, today);
  }
  return null;
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

/**
 * Half-open Prisma bounds: documentDate >= start AND documentDate < endExclusive.
 * Preferred for calendar reporting; equivalent to inclusive date-only for UTC-noon storage.
 */
export function documentDatePrismaHalfOpenBounds(range: DateOnlyRange): {
  gte: Date;
  lt: Date;
} {
  return {
    gte: new Date(`${range.from}T00:00:00.000Z`),
    lt: new Date(`${addDaysIso(range.to, 1)}T00:00:00.000Z`),
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

// ─── Shared business / Customer Group period resolver ────────────────────────

/**
 * Canonical reporting presets for Customer Groups (and future SI reuse).
 * Calendar “this” periods end on London today; completed periods are full ranges.
 */
export type BusinessPeriodPreset =
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_QUARTER"
  | "LAST_QUARTER"
  | "THIS_YEAR"
  | "LAST_YEAR"
  | "LAST_7"
  | "LAST_30"
  | "LAST_90"
  | "LAST_365"
  | "ALL"
  | "CUSTOM";

export const BUSINESS_PERIOD_PRESETS: readonly BusinessPeriodPreset[] = [
  "THIS_MONTH",
  "LAST_MONTH",
  "THIS_QUARTER",
  "LAST_QUARTER",
  "THIS_YEAR",
  "LAST_YEAR",
  "LAST_7",
  "LAST_30",
  "LAST_90",
  "LAST_365",
  "ALL",
  "CUSTOM",
] as const;

export type ResolvedBusinessPeriod = {
  period: BusinessPeriodPreset;
  /** Inclusive London date-only start (YYYY-MM-DD). */
  displayFrom: string;
  /** Inclusive London date-only end (YYYY-MM-DD). */
  displayTo: string;
  /** Half-open DB lower bound (UTC instant). */
  start: Date;
  /** Half-open DB upper bound exclusive (UTC instant). */
  endExclusive: Date;
  /** Human label, e.g. "This Month". */
  label: string;
  /** Short UK display range, e.g. "1 Oct – 1 Oct 2026". */
  displayRangeLabel: string;
  /** Inclusive date-only range (for helpers that still use [from, to]). */
  range: DateOnlyRange;
};

export function businessPeriodLabel(period: BusinessPeriodPreset): string {
  switch (period) {
    case "THIS_MONTH":
      return "This Month";
    case "LAST_MONTH":
      return "Last Month";
    case "THIS_QUARTER":
      return "This Quarter";
    case "LAST_QUARTER":
      return "Last Quarter";
    case "THIS_YEAR":
      return "This Year";
    case "LAST_YEAR":
      return "Last Year";
    case "LAST_7":
      return "Last 7 Days";
    case "LAST_30":
      return "Last 30 Days";
    case "LAST_90":
      return "Last 90 Days";
    case "LAST_365":
      return "Last 12 Months";
    case "ALL":
      return "All Time";
    case "CUSTOM":
      return "Custom";
    default:
      return period;
  }
}

/** Format YYYY-MM-DD as UK short date (1 Oct 2026). Uses UTC civil day. */
export function formatUkDateOnly(iso: string): string {
  if (!isDateOnlyIso(iso) || isSentinelDateOnly(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

export function formatUkDateRangeLabel(from: string, to: string): string {
  if (isSentinelDateOnly(from) && isSentinelDateOnly(to)) return "All dated history";
  const a = formatUkDateOnly(from);
  const b = formatUkDateOnly(to);
  if (a === b) return a;
  // Collapse year when both ends share it: "1 Sep – 30 Sep 2026"
  const fromYear = from.slice(0, 4);
  const toYear = to.slice(0, 4);
  if (fromYear === toYear && isDateOnlyIso(from) && isDateOnlyIso(to)) {
    const fromNoYear = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${from}T12:00:00.000Z`));
    return `${fromNoYear} – ${b}`;
  }
  return `${a} – ${b}`;
}

/** Parse UK DD/MM/YYYY (or ISO YYYY-MM-DD) into YYYY-MM-DD. */
export function parseUkOrIsoDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (isDateOnlyIso(trimmed)) return trimmed;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Reject impossible calendar days (e.g. 31/02/2026).
  const [yy, mm, dd] = iso.split("-").map(Number);
  const check = new Date(Date.UTC(yy!, mm! - 1, dd!));
  if (
    check.getUTCFullYear() !== yy ||
    check.getUTCMonth() !== mm! - 1 ||
    check.getUTCDate() !== dd
  ) {
    return null;
  }
  return iso;
}

export type ResolveBusinessPeriodError = {
  ok: false;
  code: "INVALID_PERIOD" | "CUSTOM_REQUIRED" | "CUSTOM_ORDER";
  message: string;
};

export type ResolveBusinessPeriodOk = { ok: true; value: ResolvedBusinessPeriod };

/**
 * Canonical business reporting period resolver (Europe/London civil calendar).
 * Use for Customer Groups now; reuse later in Sales Enquiry / Gap / Rebate UIs.
 */
export function resolveBusinessPeriod(input: {
  period?: string | null | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
  now?: Date | undefined;
  /** Defaults to THIS_MONTH for Customer Group management views. */
  defaultPeriod?: BusinessPeriodPreset | undefined;
}): ResolveBusinessPeriodOk | ResolveBusinessPeriodError {
  const today = todayLondonDateOnly(input.now ?? new Date());
  const fallback = input.defaultPeriod ?? "THIS_MONTH";
  const raw = (input.period ?? fallback).trim().toUpperCase();
  // Accept rebate alias
  const normalised =
    raw === "PREVIOUS_QUARTER"
      ? "LAST_QUARTER"
      : raw === "YTD"
        ? "THIS_YEAR"
        : raw;
  const period = (BUSINESS_PERIOD_PRESETS as readonly string[]).includes(normalised)
    ? (normalised as BusinessPeriodPreset)
    : fallback;

  let range: DateOnlyRange;

  if (period === "ALL") {
    range = ALL_DATED_HISTORY_QUERY_RANGE;
  } else if (period === "CUSTOM") {
    const from = parseUkOrIsoDateOnly(input.from);
    const to = parseUkOrIsoDateOnly(input.to);
    if (!from || !to) {
      return {
        ok: false,
        code: "CUSTOM_REQUIRED",
        message: "Custom period requires both From and To dates (DD/MM/YYYY).",
      };
    }
    if (to < from) {
      return {
        ok: false,
        code: "CUSTOM_ORDER",
        message: "Custom period To date must be on or after From date.",
      };
    }
    range = { from, to };
  } else if (period === "THIS_MONTH") {
    range = { from: monthStart(today), to: today };
  } else if (period === "LAST_MONTH") {
    const [y, m] = today.split("-").map(Number);
    const prevMonth = m === 1 ? 12 : m! - 1;
    const prevYear = m === 1 ? y! - 1 : y!;
    const from = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
    range = { from, to: lastDayOfMonth(prevYear, prevMonth) };
  } else if (period === "THIS_QUARTER") {
    const q = calendarQuarterRange(today);
    range = { from: q.from, to: today };
  } else if (period === "LAST_QUARTER") {
    range = previousCalendarQuarterRange(today);
  } else if (period === "THIS_YEAR") {
    range = { from: `${today.slice(0, 4)}-01-01`, to: today };
  } else if (period === "LAST_YEAR") {
    const y = Number(today.slice(0, 4)) - 1;
    range = { from: `${y}-01-01`, to: `${y}-12-31` };
  } else if (period === "LAST_7") {
    range = lastNDaysRange(today, 7);
  } else if (period === "LAST_30") {
    range = lastNDaysRange(today, 30);
  } else if (period === "LAST_90") {
    range = lastNDaysRange(today, 90);
  } else if (period === "LAST_365") {
    range = lastNDaysRange(today, 365);
  } else {
    return {
      ok: false,
      code: "INVALID_PERIOD",
      message: `Unsupported reporting period: ${input.period}`,
    };
  }

  const half = documentDatePrismaHalfOpenBounds(range);
  return {
    ok: true,
    value: {
      period,
      displayFrom: range.from,
      displayTo: range.to,
      start: half.gte,
      endExclusive: half.lt,
      label: businessPeriodLabel(period),
      displayRangeLabel: formatUkDateRangeLabel(range.from, range.to),
      range,
    },
  };
}
