/**
 * Sales Intelligence — deterministic purchasing cadence & dormancy.
 *
 * Purchase events = distinct Europe/London invoice document dates
 * (documentType = INVOICE). Credits never create cadence events.
 *
 * Typical interval = median of gaps (days) between consecutive sorted
 * invoice purchase dates. Requires MIN_PURCHASE_EVENTS dates.
 */

import { addDaysIso, daysInclusive, todayLondonDateOnly } from "@/domain/sales-history-period";

/** Minimum distinct invoice purchase dates before a cadence is derived. */
export const CADENCE_MIN_PURCHASE_EVENTS = 3;

/**
 * Lookback for cadence derivation (inclusive London days ending today).
 * Older history still informs first/last purchase displays, but cadence
 * uses this window so ancient gaps do not dominate the median.
 */
export const CADENCE_LOOKBACK_DAYS = 730;

/**
 * Soft attention: days since last purchase ≥ typicalInterval × this factor
 * (and at least CADENCE_GAP_MIN_DAYS).
 */
export const CADENCE_GAP_MULTIPLIER = 1.5;
export const CADENCE_GAP_MIN_DAYS = 14;

/**
 * Dormant: daysSinceLastPurchase ≥ max(typicalInterval × DORMANT_MULTIPLIER, DORMANT_MIN_DAYS).
 */
export const DORMANT_MULTIPLIER = 2;
export const DORMANT_MIN_DAYS = 45;

export type PurchaseCadence = {
  /** Distinct invoice purchase dates used (after lookback filter when applied). */
  purchaseEventCount: number;
  /** Sorted unique invoice purchase dates (YYYY-MM-DD). */
  purchaseDates: string[];
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
  /** Median gap in whole days between consecutive events; null if insufficient history. */
  typicalIntervalDays: number | null;
  /** Days from last purchase to `asOf` (London today by default); null if never purchased. */
  daysSinceLastPurchase: number | null;
  /** True when typicalIntervalDays was derived. */
  hasCadence: boolean;
  insufficientHistoryReason: string | null;
};

export type CadenceAttention = {
  purchaseGap: boolean;
  dormant: boolean;
  purchaseGapExplanation: string | null;
  dormantExplanation: string | null;
};

/** Median of a non-empty numeric array (average of two middle values when even). */
export function medianNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Build cadence from distinct invoice purchase dates (YYYY-MM-DD).
 * Credits must already be excluded by the caller.
 */
export function derivePurchaseCadence(
  invoicePurchaseDates: Iterable<string>,
  opts?: { asOf?: string; lookbackDays?: number },
): PurchaseCadence {
  const asOf = opts?.asOf ?? todayLondonDateOnly();
  const lookbackDays = opts?.lookbackDays ?? CADENCE_LOOKBACK_DAYS;
  const lookbackFrom = addDaysIso(asOf, -(lookbackDays - 1));

  const allUnique = [
    ...new Set(
      [...invoicePurchaseDates].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  ].sort();

  const inWindow = allUnique.filter((d) => d >= lookbackFrom && d <= asOf);
  const datesForCadence = inWindow.length >= CADENCE_MIN_PURCHASE_EVENTS ? inWindow : allUnique;

  const firstPurchaseDate = allUnique[0] ?? null;
  const lastPurchaseDate = allUnique[allUnique.length - 1] ?? null;
  const daysSinceLastPurchase =
    lastPurchaseDate != null
      ? Math.max(0, daysInclusive({ from: lastPurchaseDate, to: asOf }) - 1)
      : null;

  if (datesForCadence.length < CADENCE_MIN_PURCHASE_EVENTS) {
    return {
      purchaseEventCount: allUnique.length,
      purchaseDates: allUnique,
      firstPurchaseDate,
      lastPurchaseDate,
      typicalIntervalDays: null,
      daysSinceLastPurchase,
      hasCadence: false,
      insufficientHistoryReason:
        "Insufficient history to determine purchasing cadence (need at least 3 invoice purchase dates).",
    };
  }

  const gaps: number[] = [];
  for (let i = 1; i < datesForCadence.length; i++) {
    const gap = daysInclusive({ from: datesForCadence[i - 1]!, to: datesForCadence[i]! }) - 1;
    if (gap > 0) gaps.push(gap);
  }
  const median = medianNumber(gaps);
  const typicalIntervalDays = median != null ? Math.max(1, Math.round(median)) : null;

  return {
    purchaseEventCount: allUnique.length,
    purchaseDates: allUnique,
    firstPurchaseDate,
    lastPurchaseDate,
    typicalIntervalDays,
    daysSinceLastPurchase,
    hasCadence: typicalIntervalDays != null,
    insufficientHistoryReason:
      typicalIntervalDays == null
        ? "Insufficient history to determine purchasing cadence (need at least 3 invoice purchase dates)."
        : null,
  };
}

export function formatTypicalIntervalLabel(typicalIntervalDays: number | null | undefined): string {
  if (typicalIntervalDays == null || typicalIntervalDays < 1) return "Insufficient history";
  if (typicalIntervalDays === 1) return "Every ~1 day";
  return `Every ~${typicalIntervalDays} days`;
}

export function formatLastPurchasedLabel(
  daysSinceLastPurchase: number | null | undefined,
  hasPurchaseDate: boolean,
): string {
  if (!hasPurchaseDate || daysSinceLastPurchase == null) return "No purchase history";
  if (daysSinceLastPurchase === 0) return "Purchased today";
  if (daysSinceLastPurchase === 1) return "Last purchased yesterday";
  return `Last purchased ${daysSinceLastPurchase} days ago`;
}

/** Compact two-line table wording (no “0d / ~1d” shorthand). */
export function formatCadenceTableLines(cadence: PurchaseCadence): {
  interval: string;
  last: string;
} {
  if (!cadence.hasCadence || cadence.typicalIntervalDays == null) {
    return { interval: "Insufficient history", last: formatLastPurchasedLabel(cadence.daysSinceLastPurchase, Boolean(cadence.lastPurchaseDate)) };
  }
  return {
    interval: formatTypicalIntervalLabel(cadence.typicalIntervalDays),
    last: formatLastPurchasedLabel(cadence.daysSinceLastPurchase, Boolean(cadence.lastPurchaseDate)),
  };
}

export function evaluateCadenceAttention(cadence: PurchaseCadence): CadenceAttention {
  if (!cadence.hasCadence || cadence.typicalIntervalDays == null || cadence.daysSinceLastPurchase == null) {
    return {
      purchaseGap: false,
      dormant: false,
      purchaseGapExplanation: null,
      dormantExplanation: null,
    };
  }
  const typical = cadence.typicalIntervalDays;
  const since = cadence.daysSinceLastPurchase;
  const gapThreshold = Math.max(CADENCE_GAP_MIN_DAYS, Math.ceil(typical * CADENCE_GAP_MULTIPLIER));
  const dormantThreshold = Math.max(DORMANT_MIN_DAYS, Math.ceil(typical * DORMANT_MULTIPLIER));

  const purchaseGap = since >= gapThreshold;
  const dormant = since >= dormantThreshold;
  const human = `${formatTypicalIntervalLabel(typical).replace(/^Every /, "Usually orders every ")} · ${formatLastPurchasedLabel(since, true)}`;

  return {
    purchaseGap,
    dormant,
    purchaseGapExplanation: purchaseGap ? human : null,
    dormantExplanation: dormant
      ? `Dormant — ${human} (threshold ${dormantThreshold} days)`
      : null,
  };
}

export function formatCadenceSummary(cadence: PurchaseCadence): string {
  if (!cadence.hasCadence || cadence.typicalIntervalDays == null) {
    return cadence.insufficientHistoryReason ?? "Insufficient history to determine purchasing cadence";
  }
  const interval = formatTypicalIntervalLabel(cadence.typicalIntervalDays).replace(
    /^Every /,
    "Usually orders every ",
  );
  const last = formatLastPurchasedLabel(
    cadence.daysSinceLastPurchase,
    Boolean(cadence.lastPurchaseDate),
  );
  return `${interval} · ${last}`;
}
