/**
 * Sales Enquiry dashboard periods and dated-vs-undated rules.
 * Undated 561L history is never placed in a calendar month.
 */
import {
  businessPeriodLabel,
  documentDatePrismaHalfOpenBounds,
  formatUkDateRangeLabel,
  lastNDaysRange,
  previousComparableBusinessPeriod,
  resolveBusinessPeriod,
  todayLondonDateOnly,
  type BusinessPeriodPreset,
  type DateOnlyRange,
} from "@/domain/sales-history-period";

export const SALES_ENQUIRY_DASHBOARD_PERIODS = [
  "THIS_MONTH",
  "LAST_MONTH",
  "THIS_QUARTER",
  "THIS_YEAR",
  "LAST_365",
  "ALL",
  "CUSTOM",
] as const;

export type SalesEnquiryDashboardPeriod = (typeof SALES_ENQUIRY_DASHBOARD_PERIODS)[number];

export type SalesEnquirySection = "overview" | "transactions" | "products" | "history";

const DASHBOARD_LABELS: Partial<Record<SalesEnquiryDashboardPeriod, string>> = {
  THIS_YEAR: "Year to Date",
  LAST_365: "Last 12 Months",
  ALL: "All Time",
  CUSTOM: "Custom Date Range",
};

export function salesEnquiryDashboardPeriodLabel(period: SalesEnquiryDashboardPeriod): string {
  return DASHBOARD_LABELS[period] ?? businessPeriodLabel(period as BusinessPeriodPreset);
}

export type ResolvedSalesEnquiryDashboard = {
  preset: SalesEnquiryDashboardPeriod;
  label: string;
  /** Inclusive display range. Null for All Time. */
  from: string | null;
  to: string | null;
  rangeLabel: string;
  /** Previous comparable period. Null for All Time. */
  comparison: { from: string; to: string; label: string } | null;
  /** Last 12 calendar months ending today. Chart only. Never receives undated rows. */
  chart: { from: string; to: string; months: string[] };
  /** Dated scan that covers the period, its comparison, and the chart. Null means full history. */
  scan: { from: string; to: string } | null;
  includesUndatedHistory: boolean;
};

export function last12CalendarMonths(today: string): { from: string; to: string; months: string[] } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const months: string[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const point = new Date(Date.UTC(year, month - 1 - offset, 1));
    months.push(point.toISOString().slice(0, 7));
  }
  return { from: `${months[0]}-01`, to: today, months };
}

function minIso(values: string[]): string {
  return values.reduce((best, value) => (value < best ? value : best));
}

function maxIso(values: string[]): string {
  return values.reduce((best, value) => (value > best ? value : best));
}

export function resolveSalesEnquiryDashboardPeriod(input: {
  period?: string | null | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
  now?: Date | undefined;
}): ResolvedSalesEnquiryDashboard {
  const today = todayLondonDateOnly(input.now ?? new Date());
  const requested = (input.period ?? "THIS_MONTH").trim().toUpperCase();
  const preset = (SALES_ENQUIRY_DASHBOARD_PERIODS as readonly string[]).includes(requested)
    ? (requested as SalesEnquiryDashboardPeriod)
    : "THIS_MONTH";
  const resolved = resolveBusinessPeriod({
    period: preset,
    from: input.from,
    to: input.to,
    now: input.now,
    defaultPeriod: "THIS_MONTH",
  });
  if (!resolved.ok) {
    const error = new Error(resolved.message);
    (error as Error & { code?: string }).code = resolved.code;
    throw error;
  }
  const chart = last12CalendarMonths(today);
  const allTime = preset === "ALL";
  const comparisonRange = allTime
    ? null
    : previousComparableBusinessPeriod(
        resolved.value.range,
        preset === "THIS_YEAR" ? "YTD" : preset,
      );
  const scan = allTime
    ? null
    : {
        from: minIso([resolved.value.displayFrom, comparisonRange?.from ?? resolved.value.displayFrom, chart.from]),
        to: maxIso([resolved.value.displayTo, comparisonRange?.to ?? resolved.value.displayTo, chart.to]),
      };
  return {
    preset,
    label: salesEnquiryDashboardPeriodLabel(preset),
    from: allTime ? null : resolved.value.displayFrom,
    to: allTime ? null : resolved.value.displayTo,
    rangeLabel: allTime ? "All Time" : resolved.value.displayRangeLabel,
    comparison: comparisonRange
      ? {
          from: comparisonRange.from,
          to: comparisonRange.to,
          label: formatUkDateRangeLabel(comparisonRange.from, comparisonRange.to),
        }
      : null,
    chart,
    scan,
    includesUndatedHistory: allTime,
  };
}

/** Half-open UTC bounds for a dated scan. Undated rows are not inside this window. */
export function dashboardScanBounds(scan: { from: string; to: string }): { from: Date; toExclusive: Date } {
  const range: DateOnlyRange = scan;
  const bounds = documentDatePrismaHalfOpenBounds(range);
  return { from: bounds.gte, toExclusive: bounds.lt };
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year!, month! - 1, 1)));
}

function toPence(value: string): number {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const [poundsRaw, fraction = ""] = trimmed.replace("-", "").split(".");
  const pounds = Number(poundsRaw || "0");
  const pence = Number((fraction + "00").slice(0, 2));
  const total = pounds * 100 + pence;
  return negative ? -total : total;
}

function fromPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  const pounds = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}${pounds}.${fraction}`;
}

/**
 * Place dated nets into calendar months. A null date stays in `undatedNet`
 * and is never added to a month.
 */
export function allocateMonthlyNet(
  rows: Array<{ date: string | null; net: string }>,
  months: string[],
): { months: Array<{ month: string; net: string }>; undatedNet: string } {
  const buckets = new Map(months.map((month) => [month, 0]));
  let undated = 0;
  for (const row of rows) {
    const pence = toPence(row.net);
    if (!row.date) {
      undated += pence;
      continue;
    }
    const key = row.date.slice(0, 7);
    if (!buckets.has(key)) continue;
    buckets.set(key, (buckets.get(key) ?? 0) + pence);
  }
  return {
    months: months.map((month) => ({ month, net: fromPence(buckets.get(month) ?? 0) })),
    undatedNet: fromPence(undated),
  };
}

/** Net sales after signed credits. Credits stay negative; they are not retimed. */
export function netAfterCredits(invoiceNet: string, creditNet: string): string {
  return fromPence(toPence(invoiceNet) + toPence(creditNet));
}

export function periodMovement(
  current: string,
  previous: string | null,
): { change: string; percent: number | null } {
  if (previous == null) return { change: current, percent: null };
  const currentPence = toPence(current);
  const previousPence = toPence(previous);
  const change = currentPence - previousPence;
  if (previousPence === 0) return { change: fromPence(change), percent: null };
  const percent = Math.round((change / Math.abs(previousPence)) * 1000) / 10;
  return { change: fromPence(change), percent };
}

/** Overview always loads. Detailed reports load only for their own section. */
export function salesEnquirySectionLoads(section: SalesEnquirySection): {
  transactions: boolean;
  products: boolean;
  history: boolean;
} {
  return {
    transactions: section === "transactions",
    products: section === "products",
    history: section === "history",
  };
}

export function salesEnquiryDashboardKey(
  companyId: string,
  preset: string,
  from: string | null,
  to: string | null,
): string {
  return `customer-dashboard:${companyId}:${preset}:${from ?? ""}:${to ?? ""}`;
}

/** Rolling 12-month helper retained for tests that describe the preset length. */
export function last12MonthRange(today: string): DateOnlyRange {
  return lastNDaysRange(today, 365);
}
