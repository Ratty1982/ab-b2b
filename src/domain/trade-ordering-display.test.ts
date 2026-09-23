import { describe, expect, it } from "vitest";
import { formatTradeOrderingUnitPrice, mulQty, parseMoney, moneyToString, roundGbpDisplay } from "@/domain/money";

describe("formatTradeOrderingUnitPrice", () => {
  it("keeps 2dp when the authoritative price is exact to the penny", () => {
    expect(formatTradeOrderingUnitPrice("2.1900")).toBe("2.19");
    expect(formatTradeOrderingUnitPrice("3.2500")).toBe("3.25");
  });

  it("shows up to 4dp when fractions matter commercially", () => {
    expect(formatTradeOrderingUnitPrice("3.6875")).toBe("3.6875");
    expect(formatTradeOrderingUnitPrice("1.1250")).toBe("1.125");
  });

  it("does not invent float drift — 3.6875 × 12 is £44.25 at display scale", () => {
    const unit = parseMoney("3.6875")!;
    const line = roundGbpDisplay(mulQty(unit, 12));
    expect(moneyToString(line, 2)).toBe("44.25");
    expect(formatTradeOrderingUnitPrice("3.6875")).toBe("3.6875");
    // Displayed 2dp would look broken if multiplied: 3.69 × 12 = 44.28
    expect(Number((3.69 * 12).toFixed(2))).toBe(44.28);
  });
});
