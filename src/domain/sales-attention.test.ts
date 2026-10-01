import { describe, expect, it } from "vitest";
import {
  buildAttentionReasons,
  classifyPeriodMovement,
  isSignificantStoppedBuying,
  needsAttention,
} from "@/domain/sales-attention";
import { derivePurchaseCadence } from "@/domain/sales-cadence";

/** £1.00 = 10_000 minor (4 d.p.). */
const gbp = (n: number) => BigInt(Math.round(n * 10_000));

function dailyCadencePurchasedToday(asOf = "2026-10-01") {
  // ~1 day typical; purchased today
  return derivePurchaseCadence(
    ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"],
    { asOf },
  );
}

describe("sales attention movement", () => {
  it("classifies material decline (≥20% and ≥£100)", () => {
    // £1000 → £700 = -30% and -£300
    const m = classifyPeriodMovement(gbp(700), gbp(1000));
    expect(m.declining).toBe(true);
    expect(m.growing).toBe(false);
    expect(m.percentChange).toBeCloseTo(-30, 1);
  });

  it("does not treat small absolute decline as material (Retail Amazon style)", () => {
    // £20 → £16.66 ≈ -16.7% and -£3.34 — below £100 and below 20%
    const m = classifyPeriodMovement(gbp(16.66), gbp(20));
    expect(m.declining).toBe(false);
    expect(m.percentChange).toBeCloseTo(-16.7, 0);
  });

  it("does not treat tiny % movements as declining", () => {
    const m = classifyPeriodMovement(gbp(990), gbp(1000)); // -£10 / -1%
    expect(m.declining).toBe(false);
  });

  it("requires both % and £ thresholds for decline", () => {
    // -25% but only -£50 → not material attention decline
    const pctOnly = classifyPeriodMovement(gbp(150), gbp(200));
    expect(pctOnly.percentChange).toBeCloseTo(-25, 1);
    expect(pctOnly.declining).toBe(false);

    // -£200 but only -10% → not material
    const absOnly = classifyPeriodMovement(gbp(1800), gbp(2000));
    expect(absOnly.percentChange).toBeCloseTo(-10, 1);
    expect(absOnly.declining).toBe(false);

    // both clear
    const both = classifyPeriodMovement(gbp(700), gbp(1000));
    expect(both.declining).toBe(true);
  });

  it("avoids invalid percentage when previous is zero", () => {
    const m = classifyPeriodMovement(gbp(100), 0n);
    expect(m.percentChange).toBeNull();
    expect(m.declining).toBe(false);
    expect(m.growing).toBe(true); // £100 >= £50 material growth
  });
});

describe("significant stopped buying", () => {
  it("does not flag growing daily buyer on short period (Street Rhino style)", () => {
    expect(
      isSignificantStoppedBuying({
        stoppedCount: 2,
        previousSkuCount: 6,
        daysSinceLastPurchase: 0,
        growing: true,
        currentPeriodDays: 1,
      }),
    ).toBe(false);
  });

  it("does not flag purchased-today on short period even if not growing", () => {
    expect(
      isSignificantStoppedBuying({
        stoppedCount: 4,
        previousSkuCount: 10,
        daysSinceLastPurchase: 0,
        growing: false,
        currentPeriodDays: 1,
      }),
    ).toBe(false);
  });

  it("flags when count/share thresholds clear on a longer window", () => {
    expect(
      isSignificantStoppedBuying({
        stoppedCount: 3,
        previousSkuCount: 10, // 30% ≥ 25%
        daysSinceLastPurchase: 10,
        growing: false,
        currentPeriodDays: 30,
      }),
    ).toBe(true);
  });

  it("flags absolute ≥5 stopped SKUs", () => {
    expect(
      isSignificantStoppedBuying({
        stoppedCount: 5,
        previousSkuCount: 40, // 12.5% < 25% but absolute ≥ 5
        daysSinceLastPurchase: 5,
        growing: false,
        currentPeriodDays: 30,
      }),
    ).toBe(true);
  });

  it("does not flag 1–2 stopped SKUs alone", () => {
    expect(
      isSignificantStoppedBuying({
        stoppedCount: 2,
        previousSkuCount: 4,
        daysSinceLastPurchase: 7,
        growing: false,
        currentPeriodDays: 30,
      }),
    ).toBe(false);
  });
});

describe("attention reasons", () => {
  it("opportunity-only customer is NOT Needs Attention", () => {
    const cadence = dailyCadencePurchasedToday();
    const movement = classifyPeriodMovement(gbp(246.16), gbp(20)); // growing strongly
    const reasons = buildAttentionReasons({
      cadence,
      movement,
      stoppedProductCount: 2,
      previousSkuCount: 8,
      currentPeriodDays: 1,
    });
    expect(reasons).toEqual([]);
    expect(needsAttention(reasons)).toBe(false);
  });

  it("purchased today + growing + minor stopped products NOT Needs Attention", () => {
    const cadence = dailyCadencePurchasedToday();
    const movement = classifyPeriodMovement(gbp(500), gbp(40));
    expect(movement.growing).toBe(true);
    const reasons = buildAttentionReasons({
      cadence,
      movement,
      stoppedProductCount: 2,
      previousSkuCount: 10,
      currentPeriodDays: 1,
    });
    expect(needsAttention(reasons)).toBe(false);
  });

  it("purchase gap qualifies", () => {
    // typical ~24d; asOf 40 days after last → gap (threshold max(14,36)=36)
    const cadence = derivePurchaseCadence(
      ["2026-01-01", "2026-01-25", "2026-02-18", "2026-03-14"],
      { asOf: "2026-04-23" },
    );
    expect(cadence.daysSinceLastPurchase).toBe(40);
    const reasons = buildAttentionReasons({
      cadence,
      movement: classifyPeriodMovement(gbp(100), gbp(100)),
      stoppedProductCount: 0,
      previousSkuCount: 0,
      currentPeriodDays: 30,
    });
    expect(reasons.some((r) => r.code === "PURCHASE_GAP")).toBe(true);
    expect(needsAttention(reasons)).toBe(true);
  });

  it("dormant qualifies and sorts before purchase gap", () => {
    const cadence = derivePurchaseCadence(
      ["2026-01-01", "2026-01-25", "2026-02-18", "2026-03-14"],
      { asOf: "2026-06-01" },
    );
    const movement = classifyPeriodMovement(gbp(100), gbp(500));
    const reasons = buildAttentionReasons({
      cadence,
      movement,
      stoppedProductCount: 4,
      previousSkuCount: 10,
      currentPeriodDays: 30,
    });
    expect(reasons[0]?.code).toBe("DORMANT");
    expect(reasons.some((r) => r.code === "DECLINING")).toBe(true);
    expect(reasons.some((r) => r.code === "STOPPED_BUYING")).toBe(true);
    expect(needsAttention(reasons)).toBe(true);
  });

  it("insufficient cadence never becomes dormant", () => {
    const cadence = derivePurchaseCadence(["2026-01-01"], { asOf: "2026-06-01" });
    const reasons = buildAttentionReasons({
      cadence,
      movement: classifyPeriodMovement(0n, 0n),
      stoppedProductCount: 0,
      previousSkuCount: 0,
      currentPeriodDays: 30,
    });
    expect(reasons.some((r) => r.code === "DORMANT")).toBe(false);
    expect(needsAttention(reasons)).toBe(false);
  });

  it("significant stopped buying can qualify without other reasons", () => {
    const cadence = derivePurchaseCadence(
      ["2026-08-01", "2026-08-15", "2026-08-29", "2026-09-12"],
      { asOf: "2026-09-20" },
    );
    const reasons = buildAttentionReasons({
      cadence,
      movement: classifyPeriodMovement(gbp(200), gbp(200)),
      stoppedProductCount: 5,
      previousSkuCount: 12,
      currentPeriodDays: 20,
    });
    expect(reasons.some((r) => r.code === "STOPPED_BUYING")).toBe(true);
    expect(needsAttention(reasons)).toBe(true);
  });
});
