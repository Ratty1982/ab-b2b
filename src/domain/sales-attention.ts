/**
 * Sales Intelligence — deterministic “Needs Attention” / growth classification.
 *
 * Attention ≠ Opportunity.
 * - Attention: evidence the account may need investigation/contact.
 * - Opportunity: positive commercial selling evidence (never alone → Needs Attention).
 *
 * No opaque scores or fabricated opportunity values.
 */

import {
  evaluateCadenceAttention,
  formatCadenceSummary,
  type PurchaseCadence,
} from "@/domain/sales-cadence";
import { percentChangeMinor } from "@/domain/sales-intelligence";

/**
 * Money uses 4 decimal places (parseMoney): £1.00 = 10_000 minor.
 * Growth: material absolute movement (≥ £50) and ≥ 15% when previous ≠ 0.
 */
export const MATERIAL_NET_SALES_MINOR = 500_000n; // £50.00
export const MATERIAL_PERCENT_THRESHOLD = 15;

/**
 * Decline for Needs Attention: both absolute and percentage must clear.
 * Prevents £20 → £16.66 (−16.7%) noise on daily retail accounts.
 */
export const MATERIAL_DECLINE_ABS_MINOR = 1_000_000n; // £100.00
export const MATERIAL_DECLINE_PERCENT_THRESHOLD = 20;

/**
 * Significant stopped-buying for attention (not mere opportunity).
 * Gap STOPPED SKUs remain opportunities regardless.
 */
export const ATTENTION_STOPPED_MIN_COUNT = 3;
export const ATTENTION_STOPPED_MIN_SHARE = 0.25;
export const ATTENTION_STOPPED_ABSOLUTE_COUNT = 5;
/** On very short current periods, daily buyers who purchased today are not flagged for mix differences. */
export const ATTENTION_STOPPED_SHORT_PERIOD_DAYS = 3;

export type AttentionReasonCode =
  | "PURCHASE_GAP"
  | "DORMANT"
  | "DECLINING"
  | "STOPPED_BUYING";

/** Deterministic UI/sort priority (lower = more severe). No 0–100 score. */
export const ATTENTION_REASON_PRIORITY: Record<AttentionReasonCode, number> = {
  DORMANT: 0,
  PURCHASE_GAP: 1,
  DECLINING: 2,
  STOPPED_BUYING: 3,
};

export type AttentionReason = {
  code: AttentionReasonCode;
  label: string;
  explanation: string;
};

export type PeriodMovement = {
  currentMinor: bigint;
  previousMinor: bigint;
  movementMinor: bigint;
  percentChange: number | null;
  declining: boolean;
  growing: boolean;
};

export function classifyPeriodMovement(
  currentMinor: bigint,
  previousMinor: bigint,
): PeriodMovement {
  const movementMinor = currentMinor - previousMinor;
  const pct = percentChangeMinor(currentMinor, previousMinor);
  const absMove = movementMinor < 0n ? -movementMinor : movementMinor;

  let declining = false;
  let growing = false;
  if (previousMinor === 0n) {
    growing = currentMinor >= MATERIAL_NET_SALES_MINOR;
    declining = false;
  } else {
    if (
      movementMinor < 0n &&
      absMove >= MATERIAL_DECLINE_ABS_MINOR &&
      pct != null &&
      pct <= -MATERIAL_DECLINE_PERCENT_THRESHOLD
    ) {
      declining = true;
    }
    if (
      movementMinor > 0n &&
      absMove >= MATERIAL_NET_SALES_MINOR &&
      (pct == null || pct >= MATERIAL_PERCENT_THRESHOLD)
    ) {
      growing = true;
    }
  }

  return {
    currentMinor,
    previousMinor,
    movementMinor,
    percentChange: pct,
    declining,
    growing,
  };
}

/**
 * Whether Gap STOPPED SKUs are severe enough for Needs Attention.
 * Opportunity list may still show milder “not bought this period” items.
 */
export function isSignificantStoppedBuying(input: {
  stoppedCount: number;
  previousSkuCount: number;
  daysSinceLastPurchase: number | null;
  growing: boolean;
  currentPeriodDays: number;
}): boolean {
  if (input.stoppedCount <= 0) return false;

  // Healthy daily/recent buyers on a short “This Month” window: mix ≠ dormant.
  if (
    input.daysSinceLastPurchase === 0 &&
    input.currentPeriodDays <= ATTENTION_STOPPED_SHORT_PERIOD_DAYS
  ) {
    return false;
  }
  if (input.growing && input.daysSinceLastPurchase === 0) {
    return false;
  }

  if (input.stoppedCount >= ATTENTION_STOPPED_ABSOLUTE_COUNT) return true;
  if (input.stoppedCount < ATTENTION_STOPPED_MIN_COUNT) return false;
  const share =
    input.previousSkuCount > 0 ? input.stoppedCount / input.previousSkuCount : 0;
  return share >= ATTENTION_STOPPED_MIN_SHARE;
}

export function buildAttentionReasons(input: {
  cadence: PurchaseCadence;
  movement: PeriodMovement;
  stoppedProductCount: number;
  previousSkuCount: number;
  currentPeriodDays: number;
}): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  const cadenceAttn = evaluateCadenceAttention(input.cadence);

  if (cadenceAttn.dormant && cadenceAttn.dormantExplanation) {
    reasons.push({
      code: "DORMANT",
      label: "Dormant",
      explanation: cadenceAttn.dormantExplanation,
    });
  } else if (cadenceAttn.purchaseGap && cadenceAttn.purchaseGapExplanation) {
    reasons.push({
      code: "PURCHASE_GAP",
      label: "Purchase gap",
      explanation: cadenceAttn.purchaseGapExplanation,
    });
  }

  if (input.movement.declining) {
    const pct =
      input.movement.percentChange != null
        ? `${input.movement.percentChange.toFixed(1)}%`
        : "n/a";
    reasons.push({
      code: "DECLINING",
      label: "Declining",
      explanation: `Material sales decline vs comparable period (${pct}; ≥ £100 and ≥ 20%)`,
    });
  }

  if (
    isSignificantStoppedBuying({
      stoppedCount: input.stoppedProductCount,
      previousSkuCount: input.previousSkuCount,
      daysSinceLastPurchase: input.cadence.daysSinceLastPurchase,
      growing: input.movement.growing,
      currentPeriodDays: input.currentPeriodDays,
    })
  ) {
    reasons.push({
      code: "STOPPED_BUYING",
      label: "Stopped buying",
      explanation: `${input.stoppedProductCount} previously purchased product${
        input.stoppedProductCount === 1 ? "" : "s"
      } missing this period — enough volume/share to investigate`,
    });
  }

  return reasons.sort(
    (a, b) => ATTENTION_REASON_PRIORITY[a.code] - ATTENTION_REASON_PRIORITY[b.code],
  );
}

export function needsAttention(reasons: AttentionReason[]): boolean {
  return reasons.length > 0;
}

/** Sort key for Needs Attention lists (lower first). */
export function attentionSortKey(reasons: AttentionReason[]): number {
  if (reasons.length === 0) return 999;
  return Math.min(...reasons.map((r) => ATTENTION_REASON_PRIORITY[r.code]));
}

export function cadenceLineForCard(cadence: PurchaseCadence): string {
  return formatCadenceSummary(cadence);
}
