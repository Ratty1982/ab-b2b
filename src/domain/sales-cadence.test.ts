import { describe, expect, it } from "vitest";
import {
  CADENCE_MIN_PURCHASE_EVENTS,
  derivePurchaseCadence,
  evaluateCadenceAttention,
  formatCadenceTableLines,
  formatLastPurchasedLabel,
  formatTypicalIntervalLabel,
  medianNumber,
} from "@/domain/sales-cadence";

describe("sales cadence", () => {
  it("derives median typical interval from 3+ regular purchases", () => {
    const cadence = derivePurchaseCadence(
      ["2026-01-01", "2026-01-25", "2026-02-18", "2026-03-14"],
      { asOf: "2026-03-20" },
    );
    expect(cadence.hasCadence).toBe(true);
    expect(cadence.purchaseEventCount).toBeGreaterThanOrEqual(CADENCE_MIN_PURCHASE_EVENTS);
    // gaps: 24, 24, 24 → median 24
    expect(cadence.typicalIntervalDays).toBe(24);
    expect(cadence.daysSinceLastPurchase).toBe(6);
  });

  it("returns no cadence with fewer than 3 purchase dates", () => {
    const cadence = derivePurchaseCadence(["2026-01-01", "2026-02-01"], { asOf: "2026-03-01" });
    expect(cadence.hasCadence).toBe(false);
    expect(cadence.typicalIntervalDays).toBeNull();
    expect(cadence.insufficientHistoryReason).toMatch(/Insufficient history/i);
  });

  it("handles irregular intervals with median (not mean)", () => {
    // gaps 10, 10, 100 → median 10 (mean would be ~40)
    expect(medianNumber([10, 10, 100])).toBe(10);
    const cadence = derivePurchaseCadence(
      ["2026-01-01", "2026-01-11", "2026-01-21", "2026-05-01"],
      { asOf: "2026-05-05" },
    );
    expect(cadence.typicalIntervalDays).toBe(10);
  });

  it("ignores duplicate dates (credits must not invent extra events at caller)", () => {
    const cadence = derivePurchaseCadence(
      ["2026-01-01", "2026-01-01", "2026-01-25", "2026-02-18"],
      { asOf: "2026-02-20" },
    );
    expect(cadence.purchaseEventCount).toBe(3);
    expect(cadence.hasCadence).toBe(true);
  });

  it("flags dormant when inactivity exceeds 2× typical (and min days)", () => {
    const cadence = derivePurchaseCadence(
      ["2026-01-01", "2026-01-25", "2026-02-18", "2026-03-14"],
      { asOf: "2026-06-01" }, // ~79 days since 14 Mar; typical 24 → dormant threshold max(45, 48)=48
    );
    const attn = evaluateCadenceAttention(cadence);
    expect(attn.dormant).toBe(true);
    expect(attn.purchaseGap).toBe(true);
  });

  it("does not flag dormant inside threshold", () => {
    const cadence = derivePurchaseCadence(
      ["2026-01-01", "2026-01-25", "2026-02-18", "2026-03-14"],
      { asOf: "2026-03-28" }, // 14 days since last; typical 24 → gap threshold max(14, 36)=36
    );
    const attn = evaluateCadenceAttention(cadence);
    expect(attn.dormant).toBe(false);
    expect(attn.purchaseGap).toBe(false);
  });

  it("never flags dormant without cadence", () => {
    const cadence = derivePurchaseCadence(["2026-01-01"], { asOf: "2026-06-01" });
    const attn = evaluateCadenceAttention(cadence);
    expect(attn.dormant).toBe(false);
    expect(attn.purchaseGap).toBe(false);
  });
});

describe("cadence presentation (human-friendly)", () => {
  it("0 days → Purchased today", () => {
    expect(formatLastPurchasedLabel(0, true)).toBe("Purchased today");
  });

  it("1 day → Last purchased yesterday", () => {
    expect(formatLastPurchasedLabel(1, true)).toBe("Last purchased yesterday");
  });

  it("N days → Last purchased N days ago", () => {
    expect(formatLastPurchasedLabel(3, true)).toBe("Last purchased 3 days ago");
  });

  it("no purchase date → No purchase history", () => {
    expect(formatLastPurchasedLabel(null, false)).toBe("No purchase history");
  });

  it("no cadence → Insufficient history (table lines)", () => {
    expect(formatTypicalIntervalLabel(null)).toBe("Insufficient history");
    const cadence = derivePurchaseCadence(["2026-01-01"], { asOf: "2026-01-02" });
    const lines = formatCadenceTableLines(cadence);
    expect(lines.interval).toBe("Insufficient history");
    expect(lines.last).toBe("Last purchased yesterday");
  });

  it("does not expose developer shorthand like ~1d / 0d", () => {
    expect(formatTypicalIntervalLabel(1)).toBe("Every ~1 day");
    expect(formatTypicalIntervalLabel(30)).toBe("Every ~30 days");
    const cadence = derivePurchaseCadence(
      ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"],
      { asOf: "2026-10-01" },
    );
    const lines = formatCadenceTableLines(cadence);
    expect(lines.interval).not.toMatch(/\d+d\b/);
    expect(lines.last).not.toMatch(/\d+d\b/);
    expect(lines.last).toBe("Purchased today");
  });
});
