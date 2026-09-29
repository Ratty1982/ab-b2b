import { describe, expect, it } from "vitest";
import { parseMoney } from "@/domain/money";
import {
  classifyPositionMovement,
  computeCostChange,
  countDistinctCostMovements,
  dateInInclusiveRange,
  londonDateOnlyFromInstant,
  meetsMagnitude,
  parseCostIntelligenceSearch,
  resolveCostPeriodRange,
  resolveMagnitudeThreshold,
} from "@/domain/cost-intelligence";

describe("cost-intelligence domain", () => {
  it("computes increase £3.00 → £3.30 as +£0.30 / +10%", () => {
    const change = computeCostChange(parseMoney("3.30")!, parseMoney("3.00")!);
    expect(change).toMatchObject({
      absolute: "0.3000",
      percent: "+10.00",
      absPercent: "10.00",
      direction: "up",
    });
  });

  it("computes decrease £4.00 → £3.00 as -£1.00 / -25%", () => {
    const change = computeCostChange(parseMoney("3.00")!, parseMoney("4.00")!);
    expect(change).toMatchObject({
      absolute: "-1.0000",
      percent: "-25.00",
      absPercent: "25.00",
      direction: "down",
    });
  });

  it("first observation has no percent change from zero", () => {
    expect(computeCostChange(parseMoney("3.01")!, null)).toBeNull();
  });

  it("classifies first seen when no previous distinct cost", () => {
    const first = new Date("2026-09-29T12:00:00.000Z");
    expect(
      classifyPositionMovement({
        previousCost: null,
        latestCost: "3.0100",
        firstObservedAt: first,
        lastChangedAt: first,
        range: { from: "2026-09-01", to: "2026-09-30" },
      }),
    ).toBe("FIRST_SEEN");
  });

  it("does not treat first-seen as unchanged for the period", () => {
    const first = new Date("2026-09-29T12:00:00.000Z");
    expect(
      classifyPositionMovement({
        previousCost: null,
        latestCost: "3.0100",
        firstObservedAt: first,
        lastChangedAt: first,
        range: { from: "2026-09-01", to: "2026-09-30" },
      }),
    ).not.toBe("UNCHANGED");
  });

  it("classifies increase/decrease only when lastChanged falls in period", () => {
    const first = new Date("2026-08-01T12:00:00.000Z");
    const changed = new Date("2026-09-29T12:00:00.000Z");
    expect(
      classifyPositionMovement({
        previousCost: "6.2000",
        latestCost: "6.8500",
        firstObservedAt: first,
        lastChangedAt: changed,
        range: { from: "2026-09-01", to: "2026-09-30" },
      }),
    ).toBe("INCREASED");
    expect(
      classifyPositionMovement({
        previousCost: "4.1000",
        latestCost: "3.8900",
        firstObservedAt: first,
        lastChangedAt: changed,
        range: { from: "2026-09-01", to: "2026-09-30" },
      }),
    ).toBe("DECREASED");
    expect(
      classifyPositionMovement({
        previousCost: "6.2000",
        latestCost: "6.8500",
        firstObservedAt: first,
        lastChangedAt: new Date("2026-08-15T12:00:00.000Z"),
        range: { from: "2026-09-01", to: "2026-09-30" },
      }),
    ).toBe("UNCHANGED");
  });

  it("magnitude uses absolute percent so -12% qualifies for >=10%", () => {
    const change = computeCostChange(parseMoney("8.80")!, parseMoney("10.00")!);
    expect(change?.absPercent).toBe("12.00");
    const thr = resolveMagnitudeThreshold({ magnitude: "PCT_10" });
    expect(meetsMagnitude(change, thr)).toBe(true);
    expect(
      meetsMagnitude(computeCostChange(parseMoney("6.30")!, parseMoney("6.20")!), thr),
    ).toBe(false);
  });

  it("price review threshold 5% includes +10.48% and excludes +1.61%", () => {
    const big = computeCostChange(parseMoney("6.85")!, parseMoney("6.20")!);
    const small = computeCostChange(parseMoney("6.30")!, parseMoney("6.20")!);
    const thr = resolveMagnitudeThreshold({ magnitude: "PCT_5" });
    expect(big?.percent).toBe("+10.48");
    expect(meetsMagnitude(big, thr)).toBe(true);
    expect(meetsMagnitude(small, thr)).toBe(false);
  });

  it("resolves Europe/London period windows without sentinel dates", () => {
    const today = "2026-09-29";
    expect(resolveCostPeriodRange("7D", null, null, today)).toEqual({
      from: "2026-09-23",
      to: "2026-09-29",
    });
    expect(resolveCostPeriodRange("30D", null, null, today)).toEqual({
      from: "2026-08-31",
      to: "2026-09-29",
    });
    expect(resolveCostPeriodRange("90D", null, null, today)).toEqual({
      from: "2026-06-01",
      to: "2026-09-29",
    });
    expect(resolveCostPeriodRange("ALL", null, null, today)).toBeNull();
    expect(resolveCostPeriodRange("CUSTOM", "2026-09-01", "2026-09-15", today)).toEqual({
      from: "2026-09-01",
      to: "2026-09-15",
    });
    const y12 = resolveCostPeriodRange("12M", null, null, today)!;
    expect(y12.from).toBe("2025-09-30");
    expect(y12.to).toBe(today);
    expect(y12.from).not.toMatch(/^0001/);
  });

  it("maps UTC near BST boundary to correct London business date", () => {
    // 2026-03-29 00:30 UTC = 00:30 GMT (before clocks forward) → 29 Mar
    expect(londonDateOnlyFromInstant(new Date("2026-03-29T00:30:00.000Z"))).toBe("2026-03-29");
    // 2026-03-29 01:30 UTC = 02:30 BST → still 29 Mar
    expect(londonDateOnlyFromInstant(new Date("2026-03-29T01:30:00.000Z"))).toBe("2026-03-29");
    // 2026-10-25 00:30 UTC = 01:30 BST → 25 Oct
    expect(londonDateOnlyFromInstant(new Date("2026-10-25T00:30:00.000Z"))).toBe("2026-10-25");
    expect(
      dateInInclusiveRange("2026-09-29", { from: "2026-09-29", to: "2026-09-29" }),
    ).toBe(true);
  });

  it("parses workspace search defaults and page sizes", () => {
    const s = parseCostIntelligenceSearch({});
    expect(s).toMatchObject({
      period: "30D",
      movement: "ALL",
      view: "ALL",
      sort: "LATEST_CHANGE",
      magnitude: "ANY",
      page: 1,
      pageSize: 50,
      catalogue: "CATALOGUE",
    });
    expect(parseCostIntelligenceSearch({ pageSize: "25" }).pageSize).toBe(25);
    expect(parseCostIntelligenceSearch({ pageSize: "99" }).pageSize).toBe(50);
  });

  it("counts distinct cost transitions only", () => {
    expect(countDistinctCostMovements(["3.01", "3.01", "3.01", "3.01"])).toBe(0);
    expect(countDistinctCostMovements(["3.01", "3.10", "3.10"])).toBe(1);
    expect(countDistinctCostMovements(["3.00", "3.20", "3.10"])).toBe(2);
  });
});
