import { describe, expect, it } from "vitest";
import { addMonths } from "@/domain/sales-history-coverage";
import { buildSalesTrend, salesTrendDirection } from "@/domain/sales-trend";

describe("sales trend", () => {
  const observed = [
    { month: "2026-01", units: 10 },
    { month: "2026-02", units: 15 },
    { month: "2026-04", units: 20 },
  ];

  it("keeps a zero month inside known coverage and omits months before the first sale", () => {
    const trend = buildSalesTrend({ observed, range: "all", today: "2026-04-15" });
    expect(trend.points.map((point) => [point.month, point.units])).toEqual([
      ["2026-01", 10],
      ["2026-02", 15],
      ["2026-03", 0],
      ["2026-04", 20],
    ]);
    expect(trend.points.find((point) => point.month === "2026-03")?.complete).toBe(true);
    expect(trend.points.find((point) => point.month === "2026-04")?.complete).toBe(false);
    expect(trend.historyFrom).toBe("2026-01");
  });

  it("limits 12 and 24 month windows without inventing history before the first sale", () => {
    const year = buildSalesTrend({ observed, range: "12", today: "2026-04-15" });
    expect(year.points[0]?.month).toBe("2026-01");
    expect(year.points).toHaveLength(4);
    const two = buildSalesTrend({ observed, range: "24", today: "2026-04-15" });
    expect(two.points[0]?.month).toBe("2026-01");
  });

  it("classifies growing, stable, and declining from complete months", () => {
    expect(salesTrendDirection([10, 10, 10, 10, 10, 10]).direction).toBe("STABLE");
    expect(salesTrendDirection([10, 10, 10, 10.1, 10.1, 10.1]).direction).toBe("STABLE");
    expect(salesTrendDirection([10, 10, 10, 20, 20, 20]).direction).toBe("GROWING");
    expect(salesTrendDirection([20, 20, 20, 10, 10, 10]).direction).toBe("DECLINING");
    expect(salesTrendDirection([10, 10, 10, 10, 10]).direction).toBe("INSUFFICIENT_HISTORY");
  });

  it("shows year-on-year only when the same complete months exist last year", () => {
    const months = [];
    for (let month = 1; month <= 12; month += 1) {
      months.push({ month: `2025-${String(month).padStart(2, "0")}`, units: 10 });
    }
    for (let month = 1; month <= 6; month += 1) {
      months.push({ month: `2026-${String(month).padStart(2, "0")}`, units: month === 6 ? 4 : 20 });
    }
    const trend = buildSalesTrend({ observed: months, range: "12", today: "2026-07-10" });
    expect(trend.yoy).toMatchObject({
      recentUnits: 44,
      priorUnits: 30,
    });
    expect(trend.yoy?.pct).toBe(46.7);
    expect(trend.yoy?.label).toMatch(/2026/);
    expect(trend.yoy?.label).toMatch(/2025/);
    const short = buildSalesTrend({ observed, range: "all", today: "2026-04-15" });
    expect(short.yoy).toBeNull();
  });

  it("sums brand months without dropping a zero and reports the peak", () => {
    const trend = buildSalesTrend({
      observed: [
        { month: "2025-01", units: 25 },
        { month: "2025-02", units: 0 },
        { month: "2025-03", units: 8 },
      ],
      range: "all",
      today: "2025-04-01",
    });
    expect(trend.points.find((point) => point.month === "2025-02")?.units).toBe(0);
    expect(trend.peakMonth).toBe("2025-01");
    expect(trend.peakUnits).toBe(25);
    expect(trend.lowestCompleteMonth).toBe("2025-02");
  });

  it("reports the previous 12 months from full history when the chart shows 12 months", () => {
    const months = [];
    for (let i = 0; i < 24; i += 1) {
      months.push({ month: addMonths("2024-09", i), units: 3 });
    }
    const trend = buildSalesTrend({ observed: months, range: "12", today: "2026-09-02" });
    expect(trend.points).toHaveLength(12);
    expect(trend.points[0]?.month).toBe("2025-10");
    expect(trend.last12Units).toBe(33);
    expect(trend.previous12Units).toBe(36);
  });
});
