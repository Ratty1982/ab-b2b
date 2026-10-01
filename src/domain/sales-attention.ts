/**
 * Sales Intelligence — deterministic “Needs Attention” / growth classification.
 *
 * All rules are factual comparisons against Autopart realised sales.
 * No opaque scores or fabricated opportunity values.
 */

import {
  evaluateCadenceAttention,
  formatCadenceSummary,
  type PurchaseCadence,
} from "@/domain/sales-cadence";
import { percentChangeMinor } from "@/domain/sales-intelligence";

/** Absolute net-sales movement (minor units, 4dp Money scale = pence×100) threshold for decline/growth. */
export const MATERIAL_MOVEMENT_MINOR = 50_00n; // £50.00 at 2dp → Money uses 4dp: £50 = 500000 minor? 

/**
 * Money in this codebase uses 4 decimal places (see parseMoney).
 * £1.00 = 10000 minor. £50.00 = 500_000 minor.
 */
export const MATERIAL_NET_SALES_MINOR = 500_000n; // £50.00

/** Percentage threshold for declining / growing (when previous ≠ 0). */
export const MATERIAL_PERCENT_THRESHOLD = 15;

export type AttentionReasonCode =
  | "PURCHASE_GAP"
  | "DORMANT"
  | "DECLINING"
  | "STOPPED_PRODUCTS"
  | "HAS_OPPORTUNITIES";

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
  const materialAbs = absMove >= MATERIAL_NET_SALES_MINOR;

  let declining = false;
  let growing = false;
  if (previousMinor === 0n) {
    // Avoid misleading % — growth only when current is materially positive from a zero base.
    growing = currentMinor >= MATERIAL_NET_SALES_MINOR;
    declining = false;
  } else if (materialAbs) {
    if (movementMinor < 0n && (pct == null || pct <= -MATERIAL_PERCENT_THRESHOLD)) {
      declining = true;
    }
    if (movementMinor > 0n && (pct == null || pct >= MATERIAL_PERCENT_THRESHOLD)) {
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

export function buildAttentionReasons(input: {
  cadence: PurchaseCadence;
  movement: PeriodMovement;
  stoppedProductCount: number;
  opportunityCount: number;
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
      explanation: `Net sales below comparable period (${pct})`,
    });
  }

  if (input.stoppedProductCount > 0) {
    reasons.push({
      code: "STOPPED_PRODUCTS",
      label: "Stopped products",
      explanation: `${input.stoppedProductCount} previously purchased product${
        input.stoppedProductCount === 1 ? "" : "s"
      } not bought this period`,
    });
  }

  if (input.opportunityCount > 0) {
    reasons.push({
      code: "HAS_OPPORTUNITIES",
      label: "Opportunities",
      explanation: `${input.opportunityCount} range/cross-sell opportunity${
        input.opportunityCount === 1 ? "" : "ies"
      }`,
    });
  }

  return reasons;
}

export function needsAttention(reasons: AttentionReason[]): boolean {
  return reasons.some((r) =>
    r.code === "PURCHASE_GAP" ||
    r.code === "DORMANT" ||
    r.code === "DECLINING" ||
    r.code === "STOPPED_PRODUCTS",
  );
}

export function cadenceLineForCard(cadence: PurchaseCadence): string {
  return formatCadenceSummary(cadence);
}
