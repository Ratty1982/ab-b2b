/**
 * Historical sales trends from monthly aggregates.
 *
 * Direction compares the latest 3 complete calendar months with the 3 complete
 * months before them. A move under 10% or under 1 unit per month stays Stable,
 * so 10.0 → 10.1 is not Growing.
 *
 * This does not change suggested quantity, cover, or demand rates.
 * FBA stock and FBA report usage are not inputs.
 */

import { addMonths } from "@/domain/sales-history-coverage";

/** Relative change required before Growing or Declining. */
export const SALES_TREND_RELATIVE_THRESHOLD = 0.1;
/** Absolute units-per-month change required. Blocks tiny decimal swings. */
export const SALES_TREND_MIN_MONTHLY_DELTA = 1;

export const SALES_TREND_RANGES = ["12", "24", "all"] as const;
export type SalesTrendRange = (typeof SALES_TREND_RANGES)[number];

export const SALES_TREND_DIRECTIONS = ["GROWING", "STABLE", "DECLINING", "INSUFFICIENT_HISTORY"] as const;
export type SalesTrendDirection = (typeof SALES_TREND_DIRECTIONS)[number];

export const SALES_TREND_DIRECTION_LABEL: Record<SalesTrendDirection, string> = {
  GROWING: "Growing",
  STABLE: "Stable",
  DECLINING: "Declining",
  INSUFFICIENT_HISTORY: "Insufficient history",
};

export type MonthlyObservation = { month: string; units: number; netSales?: number };

export type SalesTrendPoint = {
  month: string;
  units: number;
  netSales: number;
  /** False for the in-progress calendar month. */
  complete: boolean;
};

export type SalesTrendSummary = {
  range: SalesTrendRange;
  points: SalesTrendPoint[];
  historyFrom: string | null;
  direction: SalesTrendDirection;
  directionReason: string;
  average3: number | null;
  average6: number | null;
  average12: number | null;
  last12Units: number | null;
  previous12Units: number | null;
  peakMonth: string | null;
  peakUnits: number | null;
  lowestCompleteMonth: string | null;
  lowestCompleteUnits: number | null;
  yoy: { label: string; recentUnits: number; priorUnits: number; pct: number | null } | null;
};

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function salesTrendDirection(completeMonthlyUnits: number[]): {
  direction: SalesTrendDirection;
  reason: string;
} {
  if (completeMonthlyUnits.length < 6) {
    return {
      direction: "INSUFFICIENT_HISTORY",
      reason: "Trend direction needs six complete calendar months.",
    };
  }
  const recent = completeMonthlyUnits.slice(-3);
  const previous = completeMonthlyUnits.slice(-6, -3);
  const recentAvg = average(recent);
  const previousAvg = average(previous);
  const delta = recentAvg - previousAvg;
  if (Math.abs(delta) < SALES_TREND_MIN_MONTHLY_DELTA) {
    return {
      direction: "STABLE",
      reason: `Recent 3-month average ${round1(recentAvg)} is within ${SALES_TREND_MIN_MONTHLY_DELTA} unit per month of the previous 3-month average ${round1(previousAvg)}.`,
    };
  }
  const base = Math.max(Math.abs(previousAvg), SALES_TREND_MIN_MONTHLY_DELTA);
  const relative = delta / base;
  if (relative >= SALES_TREND_RELATIVE_THRESHOLD) {
    return {
      direction: "GROWING",
      reason: `Recent 3-month average ${round1(recentAvg)} is at least 10% and ${SALES_TREND_MIN_MONTHLY_DELTA} unit per month above the previous 3-month average ${round1(previousAvg)}.`,
    };
  }
  if (relative <= -SALES_TREND_RELATIVE_THRESHOLD) {
    return {
      direction: "DECLINING",
      reason: `Recent 3-month average ${round1(recentAvg)} is at least 10% and ${SALES_TREND_MIN_MONTHLY_DELTA} unit per month below the previous 3-month average ${round1(previousAvg)}.`,
    };
  }
  return {
    direction: "STABLE",
    reason: `Recent 3-month average ${round1(recentAvg)} is within 10% of the previous 3-month average ${round1(previousAvg)}.`,
  };
}

function sumByMonth(observed: MonthlyObservation[]): Map<string, { units: number; netSales: number }> {
  const map = new Map<string, { units: number; netSales: number }>();
  for (const row of observed) {
    if (!/^\d{4}-\d{2}$/.test(row.month)) continue;
    const current = map.get(row.month) ?? { units: 0, netSales: 0 };
    current.units += row.units;
    current.netSales += row.netSales ?? 0;
    map.set(row.month, current);
  }
  return map;
}

function meanOrNull(values: number[], count: number): number | null {
  if (values.length < count) return null;
  return round1(average(values.slice(-count)));
}

function sumMonthUnits(
  observed: Map<string, { units: number; netSales: number }>,
  from: string,
  to: string,
): number {
  let sum = 0;
  let cursor = from;
  while (cursor <= to) {
    sum += observed.get(cursor)?.units ?? 0;
    cursor = addMonths(cursor, 1);
  }
  return sum;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const name = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year!, (mon ?? 1) - 1, 1)),
  );
  return name;
}

/**
 * Build a monthly series. Months before the first observed sale are omitted.
 * Months after that, through the current month and inside the selected window, are 0 when unsold.
 */
export function buildSalesTrend(input: {
  observed: MonthlyObservation[];
  range: SalesTrendRange;
  today: string;
}): SalesTrendSummary {
  const todayMonth = input.today.slice(0, 7);
  const observed = sumByMonth(input.observed);
  const known = [...observed.keys()].sort();
  const empty: SalesTrendSummary = {
    range: input.range,
    points: [],
    historyFrom: null,
    direction: "INSUFFICIENT_HISTORY",
    directionReason: "No imported sales in this range.",
    average3: null,
    average6: null,
    average12: null,
    last12Units: null,
    previous12Units: null,
    peakMonth: null,
    peakUnits: null,
    lowestCompleteMonth: null,
    lowestCompleteUnits: null,
    yoy: null,
  };
  if (!known.length || !/^\d{4}-\d{2}$/.test(todayMonth)) return empty;
  const firstKnown = known[0]!;
  const windowStart =
    input.range === "12" ? addMonths(todayMonth, -11) : input.range === "24" ? addMonths(todayMonth, -23) : firstKnown;
  const start = windowStart > firstKnown ? windowStart : firstKnown;
  const points: SalesTrendPoint[] = [];
  let cursor = start;
  while (cursor <= todayMonth && points.length < 600) {
    const value = observed.get(cursor);
    points.push({
      month: cursor,
      units: value?.units ?? 0,
      netSales: value?.netSales ?? 0,
      complete: cursor < todayMonth,
    });
    cursor = addMonths(cursor, 1);
  }
  const completeUnits: number[] = [];
  let completeCursor = firstKnown;
  const lastComplete = addMonths(todayMonth, -1);
  while (completeCursor <= lastComplete && completeUnits.length < 600) {
    completeUnits.push(observed.get(completeCursor)?.units ?? 0);
    completeCursor = addMonths(completeCursor, 1);
  }
  const direction = salesTrendDirection(completeUnits);
  const last12Start = addMonths(todayMonth, -11);
  const prev12Start = addMonths(todayMonth, -23);
  const prev12End = addMonths(todayMonth, -12);
  const last12From = last12Start > firstKnown ? last12Start : firstKnown;
  const last12Units = sumMonthUnits(observed, last12From, todayMonth);
  const previous12Units = firstKnown <= prev12Start ? sumMonthUnits(observed, prev12Start, prev12End) : null;
  const peakPool = points.filter((point) => point.complete);
  const peakSource = peakPool.length ? peakPool : points;
  const peak = peakSource.reduce((best, point) => (point.units >= best.units ? point : best), peakSource[0]!);
  const lowest = peakPool.length
    ? peakPool.reduce((best, point) => (point.units <= best.units ? point : best), peakPool[0]!)
    : null;
  const yoy = yearOnYear(observed, firstKnown, todayMonth);
  return {
    range: input.range,
    points,
    historyFrom: firstKnown,
    direction: direction.direction,
    directionReason: direction.reason,
    average3: meanOrNull(completeUnits, 3),
    average6: meanOrNull(completeUnits, 6),
    average12: meanOrNull(completeUnits, 12),
    last12Units,
    previous12Units,
    peakMonth: peak ? peak.month : null,
    peakUnits: peak ? peak.units : null,
    lowestCompleteMonth: lowest?.month ?? null,
    lowestCompleteUnits: lowest?.units ?? null,
    yoy,
  };
}

function yearOnYear(
  observed: Map<string, { units: number; netSales: number }>,
  firstKnown: string,
  todayMonth: string,
): SalesTrendSummary["yoy"] {
  const lastComplete = addMonths(todayMonth, -1);
  const recentMonths = [addMonths(lastComplete, -2), addMonths(lastComplete, -1), lastComplete];
  const priorMonths = recentMonths.map((month) => addMonths(month, -12));
  if (priorMonths.some((month) => month < firstKnown)) return null;
  if (recentMonths.some((month) => month >= todayMonth)) return null;
  const unitsOf = (month: string) => observed.get(month)?.units ?? 0;
  const recentUnits = recentMonths.reduce((sum, month) => sum + unitsOf(month), 0);
  const priorUnits = priorMonths.reduce((sum, month) => sum + unitsOf(month), 0);
  const pct = priorUnits === 0 ? null : round1(((recentUnits - priorUnits) / Math.abs(priorUnits)) * 100);
  return {
    label: `${monthLabel(recentMonths[0]!)} – ${monthLabel(recentMonths[2]!)} vs ${monthLabel(priorMonths[0]!)} – ${monthLabel(priorMonths[2]!)}`,
    recentUnits,
    priorUnits,
    pct,
  };
}

export function salesTrendFilenameMonth(month: string | null): string {
  return month ? monthLabel(month) : "—";
}
