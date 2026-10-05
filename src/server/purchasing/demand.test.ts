import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coverageDaysForPeriod, purchasingDemandWindows } from "@/server/purchasing/demand";

describe("purchasing demand SQL contract", () => {
  it("aggregates AutopartSalesLine by SKU in SQL rather than per-SKU N+1", () => {
    const demand = readFileSync(new URL("./demand.ts", import.meta.url), "utf8");
    const service = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
    expect(demand).toMatch(/GROUP BY l\.sku/);
    expect(demand).toMatch(/GROUP BY 1/);
    expect(demand).not.toMatch(/findMany\(\s*\{[^}]*sku:/s);
    expect(service).toMatch(/loadPurchasingDemandMaps/);
    expect(service).toMatch(/salesHistoryCoverageDays/);
    expect(service).not.toMatch(/netUnitsBySku\([^)]*sku/);
    expect(service).not.toMatch(/MIN\(d\."documentDate"\)/);
  });
});

describe("purchasing coverage days", () => {
  it("does not treat missing history as a full zero-demand window", () => {
    expect(coverageDaysForPeriod("2026-01-01", "2026-01-30", "2026-01-20", "2026-01-30")).toBe(11);
    expect(coverageDaysForPeriod("2026-01-01", "2026-01-30", "2026-02-01", "2026-01-30")).toBe(0);
    expect(coverageDaysForPeriod("2026-01-01", "2026-01-30", "2025-01-01", "2026-01-30")).toBe(30);
  });

  it("builds bounded London windows for 7/30/90/365 and comparables", () => {
    const windows = purchasingDemandWindows("2026-10-05");
    expect(windows.last7.to).toBe("2026-10-05");
    expect(windows.last30.from < windows.last30.to).toBe(true);
    expect(windows.samePeriodLastYear.from.startsWith("2025-")).toBe(true);
  });
});
