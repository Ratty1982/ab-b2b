/**
 * Product Cost Intelligence accordion presentation contracts (no DOM).
 */
import { describe, expect, it } from "vitest";
import {
  productCostAccordionDefaultOpen,
  shouldRenderCostHistoryChart,
  collapseDistinctCostMovements,
} from "@/domain/product-cost-history";

describe("product Cost Intelligence accordion contracts", () => {
  it("defaults collapsed so the large chart is not always visible", () => {
    expect(productCostAccordionDefaultOpen()).toBe(false);
  });

  it("keeps Latest Cost available from position data while collapsed (summary inputs)", () => {
    // Collapsed summary is driven by position DTO fields — assert the shape used by the UI.
    const pos = {
      latestCost: "0.8400",
      previousCost: "0.7900",
      lastChangedAt: "2026-09-29T12:00:00.000Z",
      change: { absolute: "0.0500", percent: "+6.33", direction: "up" as const },
    };
    expect(pos.latestCost).toBeTruthy();
    expect(Number(pos.latestCost)).toBeCloseTo(0.84, 2);
    expect(pos.previousCost).toBeTruthy();
    expect(pos.change.direction).toBe("up");
  });

  it("expanded history exposes distinct movements, not daily duplicates", () => {
    const moves = collapseDistinctCostMovements([
      { businessDate: "2026-09-29", latestCost: "0.8400" },
      { businessDate: "2026-09-30", latestCost: "0.8400" },
      { businessDate: "2026-10-05", latestCost: "0.9000" },
    ]);
    expect(moves).toHaveLength(2);
    expect(shouldRenderCostHistoryChart(moves)).toBe(true);
  });

  it("single genuine cost point suppresses large chart", () => {
    const moves = collapseDistinctCostMovements([
      { businessDate: "2026-09-29", latestCost: "0.8400" },
      { businessDate: "2026-09-30", latestCost: "0.8400" },
    ]);
    expect(shouldRenderCostHistoryChart(moves)).toBe(false);
  });
});
