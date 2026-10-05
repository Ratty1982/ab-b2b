/**
 * Purchasing Intelligence — deterministic demand, cover, reorder and suggested qty.
 *
 * Decision support only. Never places purchase orders or writes Autopart.
 * Incoming is on-order quantity with no ETA unless a source provides one.
 */

import { addDaysIso } from "@/domain/sales-history-period";
import { mulQty, parseMoney, roundGbpDisplay, moneyToString, type Money } from "@/domain/money";

export const PURCHASING_STATUSES = [
  "CRITICAL",
  "REORDER",
  "WATCH",
  "HEALTHY",
  "INCOMING_COVERS_REQUIREMENT",
  "OVERSTOCK",
  "NO_RECENT_DEMAND",
  "INSUFFICIENT_DATA",
  "DATA_STALE",
] as const;

export type PurchasingStatus = (typeof PURCHASING_STATUSES)[number];

export const DEMAND_TRENDS = [
  "STRONGLY_INCREASING",
  "INCREASING",
  "STABLE",
  "DECREASING",
  "STRONGLY_DECREASING",
  "INSUFFICIENT_DATA",
] as const;

export type DemandTrend = (typeof DEMAND_TRENDS)[number];

export type PurchasingSystemSettings = {
  defaultTargetCoverWeeks: number;
  defaultSafetyStockQty: number;
  criticalCoverWeeks: number;
  watchCoverWeeks: number;
  overstockCoverWeeks: number;
};

export const DEFAULT_PURCHASING_SETTINGS: PurchasingSystemSettings = {
  defaultTargetCoverWeeks: 8,
  defaultSafetyStockQty: 0,
  criticalCoverWeeks: 1,
  watchCoverWeeks: 3,
  overstockCoverWeeks: 26,
};

export type VariantPurchasingParams = {
  supplierName: string | null;
  supplierSku: string | null;
  leadTimeDays: number | null;
  minimumOrderQty: number | null;
  orderMultiple: number | null;
  safetyStockQty: number | null;
  targetCoverWeeks: number | null;
};

export const EMPTY_VARIANT_PURCHASING: VariantPurchasingParams = {
  supplierName: null,
  supplierSku: null,
  leadTimeDays: null,
  minimumOrderQty: null,
  orderMultiple: null,
  safetyStockQty: null,
  targetCoverWeeks: null,
};

export type PeriodDemand = {
  requestedDays: number;
  coverageDays: number;
  netUnits: number;
  weeklyRate: number | null;
  complete: boolean;
};

export type DemandRates = {
  last7: PeriodDemand;
  last30: PeriodDemand;
  last90: PeriodDemand;
  last365: PeriodDemand;
  previous30: PeriodDemand;
  previous90: PeriodDemand;
  samePeriodLastYear: PeriodDemand | null;
};

const MIN_COVERAGE_DAYS_FOR_RATE = 7;
/** Absolute unit change required before calling a move INCREASING/DECREASING. */
export const TREND_MIN_ABS_UNITS = 8;
/** Larger period must have at least this many units before % trend is used. */
export const TREND_MIN_BASE_UNITS = 10;
export const TREND_INCREASE_PCT = 0.15;
export const TREND_STRONG_PCT = 0.4;
export const ANOMALY_MIN_7D_UNITS = 20;
export const ANOMALY_MIN_ABS_ABOVE_90D_WEEKLY = 15;
export const ANOMALY_MIN_MULTIPLE_OF_90D = 2.5;

export function periodDemand(netUnits: number, requestedDays: number, coverageDays: number): PeriodDemand {
  const covered = Math.max(0, Math.min(requestedDays, coverageDays));
  const complete = coverageDays >= requestedDays;
  const weeklyRate =
    covered >= MIN_COVERAGE_DAYS_FOR_RATE ? (netUnits / covered) * 7 : null;
  return { requestedDays, coverageDays: covered, netUnits, weeklyRate, complete };
}

/**
 * Recommended weekly demand.
 *
 * Weights (when each rate exists):
 * - 30-day 50%, 90-day 30%, 365-day 20%
 * - drop missing longer windows and renormalise
 * - if same-period-last-year weekly rate exists with ≥80% coverage, blend 15% seasonal
 *
 * Negative net (credits > invoices) is floored at 0 for ordering, but the
 * raw period nets remain visible to the purchaser.
 */
export function resolveRecommendedWeeklyDemand(rates: DemandRates): {
  recommendedWeekly: number | null;
  basis: Array<{ label: string; weeklyRate: number | null; weight: number }>;
  seasonalBlendApplied: boolean;
  reason: string;
} {
  const parts: Array<{ label: string; weeklyRate: number; weight: number }> = [];
  if (rates.last30.weeklyRate != null) parts.push({ label: "30-day rate", weeklyRate: rates.last30.weeklyRate, weight: 0.5 });
  if (rates.last90.weeklyRate != null) parts.push({ label: "90-day rate", weeklyRate: rates.last90.weeklyRate, weight: 0.3 });
  if (rates.last365.weeklyRate != null) parts.push({ label: "365-day rate", weeklyRate: rates.last365.weeklyRate, weight: 0.2 });

  if (!parts.length) {
    return {
      recommendedWeekly: null,
      basis: [
        { label: "30-day rate", weeklyRate: rates.last30.weeklyRate, weight: 0 },
        { label: "90-day rate", weeklyRate: rates.last90.weeklyRate, weight: 0 },
        { label: "365-day rate", weeklyRate: rates.last365.weeklyRate, weight: 0 },
      ],
      seasonalBlendApplied: false,
      reason: "Not enough dated sales history to compute a weekly demand rate.",
    };
  }

  const weightSum = parts.reduce((s, p) => s + p.weight, 0);
  const normalised = parts.map((p) => ({ ...p, weight: p.weight / weightSum }));
  let base = normalised.reduce((s, p) => s + p.weeklyRate * p.weight, 0);

  let seasonalBlendApplied = false;
  const spy = rates.samePeriodLastYear;
  if (spy && spy.weeklyRate != null && spy.coverageDays / spy.requestedDays >= 0.8) {
    base = 0.85 * base + 0.15 * spy.weeklyRate;
    seasonalBlendApplied = true;
  }

  const recommendedWeekly = Math.max(0, round1(base));
  return {
    recommendedWeekly,
    basis: [
      { label: "30-day rate", weeklyRate: rates.last30.weeklyRate, weight: normalised.find((p) => p.label === "30-day rate")?.weight ?? 0 },
      { label: "90-day rate", weeklyRate: rates.last90.weeklyRate, weight: normalised.find((p) => p.label === "90-day rate")?.weight ?? 0 },
      { label: "365-day rate", weeklyRate: rates.last365.weeklyRate, weight: normalised.find((p) => p.label === "365-day rate")?.weight ?? 0 },
      ...(seasonalBlendApplied && spy
        ? [{ label: "Comparable last year", weeklyRate: spy.weeklyRate, weight: 0.15 }]
        : []),
    ],
    seasonalBlendApplied,
    reason: seasonalBlendApplied
      ? "Weighted 30 / 90 / 365-day weekly rates, with a 15% seasonal blend from the same period last year."
      : "Weighted 30 / 90 / 365-day weekly rates (missing windows dropped and remaining weights renormalised).",
  };
}

export function resolveDemandTrend(current30: PeriodDemand, previous30: PeriodDemand): {
  trend: DemandTrend;
  pct: number | null;
  absDiff: number;
  reason: string;
} {
  const curr = current30.netUnits;
  const prev = previous30.netUnits;
  const absDiff = Math.abs(curr - prev);
  const base = Math.max(Math.abs(curr), Math.abs(prev));
  if (
    current30.coverageDays < MIN_COVERAGE_DAYS_FOR_RATE ||
    previous30.coverageDays < MIN_COVERAGE_DAYS_FOR_RATE ||
    base < TREND_MIN_BASE_UNITS
  ) {
    return {
      trend: "INSUFFICIENT_DATA",
      pct: null,
      absDiff,
      reason: "Not enough volume or history to call a demand trend (avoids 1→2 false alarms).",
    };
  }
  const pct = prev === 0 ? (curr === 0 ? 0 : 1) : (curr - prev) / Math.abs(prev);
  if (absDiff < TREND_MIN_ABS_UNITS) {
    return { trend: "STABLE", pct, absDiff, reason: `Change of ${absDiff} units is below the ${TREND_MIN_ABS_UNITS}-unit materiality threshold.` };
  }
  if (pct >= TREND_STRONG_PCT) {
    return { trend: "STRONGLY_INCREASING", pct, absDiff, reason: `30-day net is ${Math.round(pct * 100)}% above the previous 30 days.` };
  }
  if (pct >= TREND_INCREASE_PCT) {
    return { trend: "INCREASING", pct, absDiff, reason: `30-day net is ${Math.round(pct * 100)}% above the previous 30 days.` };
  }
  if (pct <= -TREND_STRONG_PCT) {
    return { trend: "STRONGLY_DECREASING", pct, absDiff, reason: `30-day net is ${Math.round(Math.abs(pct) * 100)}% below the previous 30 days.` };
  }
  if (pct <= -TREND_INCREASE_PCT) {
    return { trend: "DECREASING", pct, absDiff, reason: `30-day net is ${Math.round(Math.abs(pct) * 100)}% below the previous 30 days.` };
  }
  return { trend: "STABLE", pct, absDiff, reason: "30-day net is within the stable band versus the previous 30 days." };
}

export function detectUnusualDemand(last7Units: number, weekly90: number | null): {
  unusual: boolean;
  last7Units: number;
  normalWeekly: number | null;
  pctAbove: number | null;
  reason: string;
} {
  if (weekly90 == null || last7Units < ANOMALY_MIN_7D_UNITS) {
    return {
      unusual: false,
      last7Units,
      normalWeekly: weekly90,
      pctAbove: null,
      reason: "No unusual-demand flag (needs ≥20 units in 7 days and a 90-day weekly rate).",
    };
  }
  const absAbove = last7Units - weekly90;
  const multiple = weekly90 <= 0 ? Infinity : last7Units / weekly90;
  if (absAbove >= ANOMALY_MIN_ABS_ABOVE_90D_WEEKLY && multiple >= ANOMALY_MIN_MULTIPLE_OF_90D) {
    const pctAbove = weekly90 <= 0 ? null : (last7Units - weekly90) / weekly90;
    return {
      unusual: true,
      last7Units,
      normalWeekly: weekly90,
      pctAbove,
      reason: `${last7Units} sold in the last 7 days versus a 90-day weekly rate of ${round1(weekly90)}.`,
    };
  }
  return {
    unusual: false,
    last7Units,
    normalWeekly: weekly90,
    pctAbove: weekly90 <= 0 ? null : (last7Units - weekly90) / weekly90,
    reason: "Last 7 days are not materially above the 90-day weekly rate.",
  };
}

export function weeksOfCover(availableQty: number, recommendedWeekly: number | null): number | null {
  if (recommendedWeekly == null || recommendedWeekly <= 0) return null;
  return round1(availableQty / recommendedWeekly);
}

export function projectedWeeksOfCover(
  availableQty: number,
  incomingQty: number,
  recommendedWeekly: number | null,
): number | null {
  if (recommendedWeekly == null || recommendedWeekly <= 0) return null;
  return round1((availableQty + Math.max(0, incomingQty)) / recommendedWeekly);
}

export function estimatedStockoutDate(input: {
  today: string;
  availableQty: number;
  recommendedWeekly: number | null;
}): string | null {
  if (input.recommendedWeekly == null || input.recommendedWeekly <= 0) return null;
  if (input.availableQty <= 0) return input.today;
  const daily = input.recommendedWeekly / 7;
  if (daily <= 0) return null;
  const days = Math.floor(input.availableQty / daily);
  return addDaysIso(input.today, days);
}

export function leadTimeDemandUnits(recommendedWeekly: number | null, leadTimeDays: number | null): number | null {
  if (recommendedWeekly == null || recommendedWeekly <= 0) return null;
  if (leadTimeDays == null || leadTimeDays <= 0) return null;
  return Math.ceil((recommendedWeekly / 7) * leadTimeDays);
}

export function reorderPointUnits(leadTimeDemand: number | null, safetyStockQty: number): number | null {
  if (leadTimeDemand == null) return null;
  return leadTimeDemand + Math.max(0, safetyStockQty);
}

/**
 * Suggested additional purchase.
 *
 * targetStock = ceil(recommendedWeekly × targetCoverWeeks) + safetyStock
 * netRequirement = max(0, targetStock − available − incoming)
 * if MOQ set and net > 0: net = max(net, MOQ)
 * if orderMultiple set and net > 0: net = ceil(net / multiple) × multiple  (round UP)
 */
export function suggestedPurchaseQty(input: {
  availableQty: number;
  incomingQty: number;
  recommendedWeekly: number | null;
  targetCoverWeeks: number;
  safetyStockQty: number;
  minimumOrderQty: number | null;
  orderMultiple: number | null;
}): {
  targetStock: number | null;
  rawRequirement: number;
  afterMoq: number;
  suggestedQty: number;
  explanation: string[];
} {
  const steps: string[] = [];
  if (input.recommendedWeekly == null || input.recommendedWeekly <= 0) {
    return {
      targetStock: null,
      rawRequirement: 0,
      afterMoq: 0,
      suggestedQty: 0,
      explanation: ["No recommended weekly demand, so no additional purchase is suggested."],
    };
  }
  const coverStock = Math.ceil(input.recommendedWeekly * input.targetCoverWeeks);
  const targetStock = coverStock + Math.max(0, input.safetyStockQty);
  steps.push(
    `Target stock = ceil(${round1(input.recommendedWeekly)}/week × ${input.targetCoverWeeks} weeks) + safety ${input.safetyStockQty} = ${targetStock}.`,
  );
  const raw = Math.max(0, targetStock - input.availableQty - Math.max(0, input.incomingQty));
  steps.push(
    `Raw additional requirement = max(0, ${targetStock} − avail ${input.availableQty} − incoming ${Math.max(0, input.incomingQty)}) = ${raw}.`,
  );
  let qty = raw;
  if (qty > 0 && input.minimumOrderQty != null && input.minimumOrderQty > 0) {
    qty = Math.max(qty, input.minimumOrderQty);
    steps.push(`MOQ ${input.minimumOrderQty} applied → ${qty}.`);
  }
  const afterMoq = qty;
  if (qty > 0 && input.orderMultiple != null && input.orderMultiple > 1) {
    qty = Math.ceil(qty / input.orderMultiple) * input.orderMultiple;
    steps.push(`Order multiple ${input.orderMultiple} rounds up → ${qty}.`);
  }
  if (qty === 0) {
    steps.push("No additional order suggested based on the current forecast.");
  }
  return { targetStock, rawRequirement: raw, afterMoq, suggestedQty: qty, explanation: steps };
}

export function resolvePurchasingStatus(input: {
  availableQty: number;
  incomingQty: number;
  weeksCover: number | null;
  suggestedQty: number;
  reorderPoint: number | null;
  settings: PurchasingSystemSettings;
  recommendedWeekly: number | null;
  stockStale: boolean;
  estimatedStockoutDate: string | null;
  today: string;
}): { status: PurchasingStatus; reason: string } {
  if (input.stockStale) {
    return {
      status: "DATA_STALE",
      reason: "Autopart stock is stale under the existing freshness policy. Treat any recommendation as out of date until the next 231PO3NEW import.",
    };
  }
  if (input.recommendedWeekly == null) {
    return { status: "INSUFFICIENT_DATA", reason: "Not enough sales history to make a useful forecast." };
  }
  if (input.recommendedWeekly <= 0) {
    return {
      status: input.availableQty > 0 ? "NO_RECENT_DEMAND" : "INSUFFICIENT_DATA",
      reason:
        input.availableQty > 0
          ? "Stock is on hand but there is no meaningful recent net demand."
          : "No recommended demand and no current stock.",
    };
  }
  const cover = input.weeksCover;
  const daysToStockout =
    input.estimatedStockoutDate != null
      ? diffDays(input.today, input.estimatedStockoutDate)
      : null;
  const belowReorder =
    input.reorderPoint != null ? input.availableQty <= input.reorderPoint : cover != null && cover <= input.settings.watchCoverWeeks;

  if (
    (cover != null && cover < input.settings.criticalCoverWeeks) ||
    (daysToStockout != null && daysToStockout <= 7)
  ) {
    if (input.suggestedQty === 0 && input.incomingQty > 0) {
      return {
        status: "INCOMING_COVERS_REQUIREMENT",
        reason: "Current cover is critical, but incoming on-order quantity already covers the forecast target. Arrival date is not available.",
      };
    }
    return { status: "CRITICAL", reason: "Current cover is below the critical threshold or runout is within 7 days." };
  }
  if (cover != null && cover >= input.settings.overstockCoverWeeks) {
    return { status: "OVERSTOCK", reason: `Current cover is at or above the overstock threshold of ${input.settings.overstockCoverWeeks} weeks.` };
  }
  if (belowReorder && input.suggestedQty === 0 && input.incomingQty > 0) {
    return {
      status: "INCOMING_COVERS_REQUIREMENT",
      reason: "Current stock is at or below reorder point, but incoming supply covers the additional requirement. Arrival date is not available.",
    };
  }
  if (input.suggestedQty > 0 && belowReorder) {
    return { status: "REORDER", reason: "Below reorder point after considering incoming — additional purchase suggested." };
  }
  if (cover != null && cover < input.settings.watchCoverWeeks) {
    return { status: "WATCH", reason: `Cover is below the watch threshold of ${input.settings.watchCoverWeeks} weeks.` };
  }
  return { status: "HEALTHY", reason: "Adequate current cover relative to configured thresholds." };
}

export function suggestedPurchaseValue(qty: number, latestCost: string | null): {
  value: Money | null;
  costAvailable: boolean;
} {
  if (qty <= 0) return { value: null, costAvailable: latestCost != null && parseMoney(latestCost) != null };
  const cost = latestCost ? parseMoney(latestCost) : null;
  if (!cost) return { value: null, costAvailable: false };
  return { value: roundGbpDisplay(mulQty(cost, qty)), costAvailable: true };
}

export function stockValueAtLatestCost(qty: number, latestCost: string | null): Money | null {
  if (qty <= 0) return null;
  const cost = latestCost ? parseMoney(latestCost) : null;
  if (!cost) return null;
  return roundGbpDisplay(mulQty(cost, qty));
}

export function formatPurchasingGbp(value: Money | null): string {
  if (!value) return "—";
  const n = Number(moneyToString(value, 2));
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export const PURCHASING_STATUS_LABEL: Record<PurchasingStatus, string> = {
  CRITICAL: "Critical",
  REORDER: "Reorder",
  WATCH: "Watch",
  HEALTHY: "Healthy",
  INCOMING_COVERS_REQUIREMENT: "Incoming covers",
  OVERSTOCK: "Overstock",
  NO_RECENT_DEMAND: "No recent demand",
  INSUFFICIENT_DATA: "Insufficient data",
  DATA_STALE: "Data stale",
};

export const DEMAND_TREND_LABEL: Record<DemandTrend, string> = {
  STRONGLY_INCREASING: "Strongly increasing",
  INCREASING: "Increasing",
  STABLE: "Stable",
  DECREASING: "Decreasing",
  STRONGLY_DECREASING: "Strongly decreasing",
  INSUFFICIENT_DATA: "Insufficient data",
};

export function buildWhyCopy(input: {
  weeksCover: number | null;
  incomingQty: number;
  suggestedQty: number;
  targetCoverWeeks: number;
}): string {
  const cover = input.weeksCover == null ? "no measurable weeks of cover (no recommended demand)" : `approximately ${input.weeksCover} weeks of demand`;
  if (input.suggestedQty <= 0 && input.incomingQty > 0) {
    return `Current stock represents ${cover}. ${input.incomingQty} units are already on order. Based on the current demand rate and the configured ${input.targetCoverWeeks}-week target cover, no additional purchase is currently suggested. Arrival date is not available.`;
  }
  if (input.suggestedQty <= 0) {
    return `Current stock represents ${cover}. No additional purchase is currently suggested against the configured ${input.targetCoverWeeks}-week target.`;
  }
  if (input.incomingQty > 0) {
    return `Even after the ${input.incomingQty} units currently on order, forecast stock is below the configured ${input.targetCoverWeeks}-week target. An additional ${input.suggestedQty} units is suggested. Arrival date is not available.`;
  }
  return `Current stock represents ${cover}. An additional ${input.suggestedQty} units is suggested to reach the configured ${input.targetCoverWeeks}-week target.`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function diffDays(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const a = Date.UTC(y1!, m1! - 1, d1!);
  const b = Date.UTC(y2!, m2! - 1, d2!);
  return Math.floor((b - a) / 86_400_000);
}
