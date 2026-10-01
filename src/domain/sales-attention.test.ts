import { describe, expect, it } from "vitest";
import { classifyPeriodMovement, buildAttentionReasons, needsAttention } from "@/domain/sales-attention";
import { derivePurchaseCadence } from "@/domain/sales-cadence";

describe("sales attention movement", () => {
  it("classifies material decline with valid percentage", () => {
    // £1000 → £700 = -30%
    const m = classifyPeriodMovement(7_000_000n, 10_000_000n);
    expect(m.declining).toBe(true);
    expect(m.growing).toBe(false);
    expect(m.percentChange).toBeCloseTo(-30, 1);
  });

  it("avoids invalid percentage when previous is zero", () => {
    const m = classifyPeriodMovement(1_000_000n, 0n);
    expect(m.percentChange).toBeNull();
    expect(m.declining).toBe(false);
    expect(m.growing).toBe(true); // £100 >= £50 material
  });

  it("does not treat tiny movements as declining", () => {
    const m = classifyPeriodMovement(9_900_000n, 10_000_000n); // -£10
    expect(m.declining).toBe(false);
  });
});

describe("attention reasons", () => {
  it("aggregates dormant / declining / stopped without fabricating scores", () => {
    const cadence = derivePurchaseCadence(
      ["2026-01-01", "2026-01-25", "2026-02-18", "2026-03-14"],
      { asOf: "2026-06-01" },
    );
    const movement = classifyPeriodMovement(1_000_000n, 5_000_000n);
    const reasons = buildAttentionReasons({
      cadence,
      movement,
      stoppedProductCount: 4,
      opportunityCount: 2,
    });
    expect(reasons.some((r) => r.code === "DORMANT")).toBe(true);
    expect(reasons.some((r) => r.code === "DECLINING")).toBe(true);
    expect(reasons.some((r) => r.code === "STOPPED_PRODUCTS")).toBe(true);
    expect(needsAttention(reasons)).toBe(true);
  });
});
