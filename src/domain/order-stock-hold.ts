/**
 * Hold-until-complete stock release — pure domain helpers.
 * Orthogonal to OrderStatus (order stays SUBMITTED while waiting).
 */

export type OrderStockReleasePolicy = "SHIP_AS_AVAILABLE" | "HOLD_UNTIL_COMPLETE";
export type OrderStockHoldState = "NONE" | "WAITING_STOCK" | "READY_TO_EXPORT" | "CANCELLED_HOLD";

export const STOCK_HOLD_STAFF_LABEL = "HELD — AWAITING STOCK";

/** Reasons written only by the trusted stock-hold release transaction. */
export const VERIFIED_STOCK_RELEASE_REASONS = [
  "MANUAL_RETRY_FULL_STOCK",
  "PLACED_WITH_FULL_STOCK",
  "STOCK_SYNC_FULL_COVERAGE",
] as const;

export type VerifiedStockReleaseReason = (typeof VERIFIED_STOCK_RELEASE_REASONS)[number];

export type StockHoldReleaseEvidence = {
  stockReleasedAt?: Date | string | null;
  stockReleaseReason?: string | null;
};

export function isVerifiedStockHoldRelease(
  state: OrderStockHoldState | string | null | undefined,
  policy: OrderStockReleasePolicy | string | null | undefined,
  release?: StockHoldReleaseEvidence | null,
): boolean {
  if (policy !== "HOLD_UNTIL_COMPLETE" || state !== "READY_TO_EXPORT") return false;
  if (!release?.stockReleasedAt) return false;
  return (VERIFIED_STOCK_RELEASE_REASONS as readonly string[]).includes(
    release.stockReleaseReason ?? "",
  );
}

export type StockHoldLineCoverageInput = {
  orderItemId: string;
  variantId: string;
  sku: string;
  name: string;
  requiredQty: number;
  /**
   * ACTIVE AB reservations already held by this order for this line
   * (prefer per-orderItemId qty; do not pass the full variant sum on every sibling line).
   */
  ownActiveReservedQty: number;
  /**
   * Free confirmed sellable after subtracting ALL ACTIVE reservations
   * (including this order's). Shared across sibling lines of the same variant.
   * Stale / unconfirmed stock must pass 0.
   */
  freeConfirmedSellableQty: number;
  stockConfirmed: boolean;
};

export type StockHoldLineCoverage = StockHoldLineCoverageInput & {
  coveredByOwnReservation: number;
  availableIncludingOwn: number;
  shortfallQty: number;
  remainingToReserve: number;
  fullyCovered: boolean;
};

export type StockHoldCoverageAssessment = {
  fullyCoverable: boolean;
  reason:
    | "OK"
    | "STOCK_STALE"
    | "STOCK_UNTRUSTED"
    | "INSUFFICIENT_STOCK"
    | "EMPTY_ORDER"
    | "NOT_WAITING";
  lines: StockHoldLineCoverage[];
  blockingSkus: Array<{
    sku: string;
    name: string;
    requiredQty: number;
    availableIncludingOwn: number;
    shortfallQty: number;
    stockConfirmed: boolean;
  }>;
};

export function isActiveStockHold(state: OrderStockHoldState | string | null | undefined): boolean {
  return state === "WAITING_STOCK";
}

/**
 * Fail-closed export gate.
 * - Explicit WAITING_STOCK always blocks, on any policy.
 * - HOLD_UNTIL_COMPLETE exports only after a verified release:
 *   state READY_TO_EXPORT, stockReleasedAt set, and a known release reason.
 * - WAITING_STOCK, NONE, CANCELLED_HOLD, and READY_TO_EXPORT without that
 *   evidence stay blocked while the hold policy is still active.
 * - Cancelling a hold must switch the policy back to SHIP_AS_AVAILABLE.
 *   CANCELLED_HOLD alone is not an export permission.
 */
export function blocksAutopartExportForStockHold(
  state: OrderStockHoldState | string | null | undefined,
  policy?: OrderStockReleasePolicy | string | null,
  release?: StockHoldReleaseEvidence | null,
): boolean {
  if (state === "WAITING_STOCK") return true;
  if (policy === "HOLD_UNTIL_COMPLETE") {
    return !isVerifiedStockHoldRelease(state, policy, release);
  }
  return false;
}

export function staffStockHoldLabel(
  state: OrderStockHoldState | string | null | undefined,
): string | null {
  if (state === "WAITING_STOCK") return STOCK_HOLD_STAFF_LABEL;
  if (state === "READY_TO_EXPORT") return "READY — STOCK COMPLETE";
  if (state === "CANCELLED_HOLD") return "HOLD CANCELLED";
  return null;
}

/**
 * Coverage for one held order.
 * Own ACTIVE reservations count toward lines without double-reserving free stock.
 * Sibling lines that share a variantId share one free pool and one own-reservation pool.
 */
export function assessStockHoldLineCoverage(
  lines: StockHoldLineCoverageInput[],
): StockHoldCoverageAssessment {
  if (lines.length === 0) {
    return {
      fullyCoverable: false,
      reason: "EMPTY_ORDER",
      lines: [],
      blockingSkus: [],
    };
  }

  const groups = new Map<string, StockHoldLineCoverageInput[]>();
  for (const line of lines) {
    const key = line.variantId || `item:${line.orderItemId}`;
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }

  const assessedByItem = new Map<string, StockHoldLineCoverage>();

  for (const groupLines of groups.values()) {
    const sorted = [...groupLines].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
    const stockConfirmed = sorted.every((line) => line.stockConfirmed);
    const freePool = stockConfirmed
      ? Math.max(0, Math.trunc(sorted[0]?.freeConfirmedSellableQty ?? 0))
      : 0;
    let ownPool = 0;
    for (const line of sorted) {
      ownPool += Math.max(0, Math.trunc(line.ownActiveReservedQty));
    }
    let remainingOwn = ownPool;
    let remainingFree = freePool;

    for (const line of sorted) {
      const required = Math.max(0, Math.trunc(line.requiredQty));
      const takeOwn = Math.min(required, remainingOwn);
      remainingOwn -= takeOwn;
      const needFromFree = required - takeOwn;
      const takeFree = Math.min(needFromFree, remainingFree);
      remainingFree -= takeFree;
      const shortfallQty = needFromFree - takeFree;
      const remainingToReserve = needFromFree;
      assessedByItem.set(line.orderItemId, {
        ...line,
        requiredQty: required,
        ownActiveReservedQty: Math.max(0, Math.trunc(line.ownActiveReservedQty)),
        freeConfirmedSellableQty: freePool,
        coveredByOwnReservation: takeOwn,
        availableIncludingOwn: takeOwn + takeFree,
        shortfallQty,
        remainingToReserve,
        fullyCovered:
          shortfallQty === 0 && (required === 0 || line.stockConfirmed || takeOwn >= required),
      });
    }
  }

  const assessed = lines.map((line) => assessedByItem.get(line.orderItemId)!);

  const blocking = assessed
    .filter((line) => !line.fullyCovered)
    .map((line) => ({
      sku: line.sku,
      name: line.name,
      requiredQty: line.requiredQty,
      availableIncludingOwn: line.availableIncludingOwn,
      shortfallQty: line.shortfallQty,
      stockConfirmed: line.stockConfirmed,
    }));

  const untrusted = assessed.some(
    (line) => line.requiredQty > line.coveredByOwnReservation && !line.stockConfirmed,
  );

  return {
    fullyCoverable: blocking.length === 0,
    reason: blocking.length === 0 ? "OK" : untrusted ? "STOCK_UNTRUSTED" : "INSUFFICIENT_STOCK",
    lines: assessed,
    blockingSkus: blocking,
  };
}

export function stockHoldCheckResultPayload(
  assessment: StockHoldCoverageAssessment,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    fullyCoverable: assessment.fullyCoverable,
    reason: assessment.reason,
    blockingSkus: assessment.blockingSkus,
    lines: assessment.lines.map((line) => ({
      orderItemId: line.orderItemId,
      variantId: line.variantId,
      sku: line.sku,
      requiredQty: line.requiredQty,
      ownActiveReservedQty: line.ownActiveReservedQty,
      freeConfirmedSellableQty: line.freeConfirmedSellableQty,
      availableIncludingOwn: line.availableIncludingOwn,
      remainingToReserve: line.remainingToReserve,
      shortfallQty: line.shortfallQty,
      stockConfirmed: line.stockConfirmed,
      fullyCovered: line.fullyCovered,
    })),
    checkedAt: new Date().toISOString(),
    ...extra,
  };
}

export function orderStockHoldReadyEmailIdempotencyKey(orderId: string): string {
  return `ORDER_STOCK_HOLD_READY_INTERNAL:${orderId}`;
}

export function orderStockHoldReadyRecipientIdempotencyKey(input: {
  orderId: string;
  toEmail: string;
  salesRepEmail?: string | null;
}): string {
  const email = input.toEmail.trim().toLowerCase();
  const rep = input.salesRepEmail?.trim().toLowerCase() ?? null;
  if (rep && email === rep) {
    return `ORDER_STOCK_HOLD_READY_INTERNAL_SALES_REP:${input.orderId}`;
  }
  return `ORDER_STOCK_HOLD_READY_INTERNAL:${input.orderId}:${email}`;
}
