import { describe, expect, it } from "vitest";
import {
  collapseDistinctCostMovements,
  productCostAccordionDefaultOpen,
  shouldRenderCostHistoryChart,
} from "@/domain/product-cost-history";

describe("product cost distinct movements", () => {
  it("collapses repeated identical cost observations across days", () => {
    const moves = collapseDistinctCostMovements([
      { businessDate: "2026-09-29", latestCost: "0.8400" },
      { businessDate: "2026-09-30", latestCost: "0.8400" },
      { businessDate: "2026-10-01", latestCost: "0.8400" },
    ]);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.firstObservedDate).toBe("2026-09-29");
    expect(moves[0]?.lastObservedDate).toBe("2026-10-01");
    expect(moves[0]?.latestCost).toBe("0.8400");
  });

  it("keeps genuine cost transitions as separate movements", () => {
    const moves = collapseDistinctCostMovements([
      { businessDate: "2026-09-20", latestCost: "0.7900" },
      { businessDate: "2026-09-21", latestCost: "0.7900" },
      { businessDate: "2026-09-29", latestCost: "0.8400" },
      { businessDate: "2026-09-30", latestCost: "0.8400" },
    ]);
    expect(moves).toHaveLength(2);
    expect(moves[0]?.latestCost).toBe("0.7900");
    expect(moves[0]?.firstObservedDate).toBe("2026-09-20");
    expect(moves[0]?.lastObservedDate).toBe("2026-09-21");
    expect(moves[1]?.latestCost).toBe("0.8400");
    expect(moves[1]?.firstObservedDate).toBe("2026-09-29");
    expect(moves[1]?.lastObservedDate).toBe("2026-09-30");
  });

  it("does not render a chart for a single genuine cost point", () => {
    const moves = collapseDistinctCostMovements([
      { businessDate: "2026-09-29", latestCost: "0.8400" },
      { businessDate: "2026-09-30", latestCost: "0.8400" },
    ]);
    expect(shouldRenderCostHistoryChart(moves)).toBe(false);
  });

  it("renders a chart when multiple distinct costs exist", () => {
    const moves = collapseDistinctCostMovements([
      { businessDate: "2026-09-01", latestCost: "0.7900" },
      { businessDate: "2026-09-29", latestCost: "0.8400" },
    ]);
    expect(shouldRenderCostHistoryChart(moves)).toBe(true);
  });

  it("product accordion defaults collapsed", () => {
    expect(productCostAccordionDefaultOpen()).toBe(false);
  });
});
