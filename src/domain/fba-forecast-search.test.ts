import { describe, expect, it } from "vitest";
import {
  compareCustomerSalesRows,
  compareSalesNetDesc,
  defaultFbaForecastSort,
  isFbaFocusFilter,
  isFbaPlanningMode,
  planningModeSearchValue,
  salesActivitySearchValue,
  type CustomerSalesSortRow,
} from "@/domain/fba-forecast-search";

describe("FBA forecast sales activity search", () => {
  it("keeps the 365-day default out of the URL and stores the other choices", () => {
    expect(salesActivitySearchValue("365")).toBeUndefined();
    expect(salesActivitySearchValue("90")).toBe("90");
    expect(salesActivitySearchValue("30")).toBe("30");
    expect(salesActivitySearchValue("all")).toBe("all");
  });

  it("orders a sales window by customer sales and the full catalogue by priority", () => {
    expect(defaultFbaForecastSort("365")).toBe("sales");
    expect(defaultFbaForecastSort("90")).toBe("sales");
    expect(defaultFbaForecastSort("30")).toBe("sales");
    expect(defaultFbaForecastSort("all")).toBe("priority");
  });

  it("keeps verified FBA as the default plan and stores RETAILA planning in the URL", () => {
    expect(isFbaPlanningMode("fba")).toBe(true);
    expect(isFbaPlanningMode("retaila")).toBe(true);
    expect(isFbaPlanningMode("amazon")).toBe(false);
    expect(planningModeSearchValue("fba")).toBeUndefined();
    expect(planningModeSearchValue("retaila")).toBe("retaila");
    expect(isFbaFocusFilter("low_cover")).toBe(true);
    expect(isFbaFocusFilter("unavailable")).toBe(true);
    expect(isFbaFocusFilter("missing")).toBe(false);
  });
});

describe("FBA forecast customer-sales ordering", () => {
  function row(
    sku: string,
    d30: number | null,
    d90: number | null,
    d365: number | null,
  ): CustomerSalesSortRow {
    return { sku, customerSales: { d30, d90, d365 } };
  }

  it("never returns NaN when both windows are null", () => {
    expect(Number.isNaN(compareSalesNetDesc(null, null))).toBe(false);
    expect(compareSalesNetDesc(null, null)).toBe(0);
    expect(
      Number.isNaN(
        compareCustomerSalesRows(row("B", null, null, null), row("A", null, null, null)),
      ),
    ).toBe(false);
  });

  it("puts products with no sales after every scanned net, including zero", () => {
    const none = row("NONE", null, null, null);
    const zero = row("ZERO", 0, 0, 0);
    const negative = row("NEG", -2, -2, -2);
    const sold = row("SOLD", 4, 4, 4);
    const ordered = [none, zero, negative, sold].sort(compareCustomerSalesRows);
    expect(ordered.map((item) => item.sku)).toEqual(["SOLD", "ZERO", "NEG", "NONE"]);
  });

  it("breaks equal sales figures with SKU and keeps older history behind recent nets", () => {
    const recent = row("RECENT", 8, 8, 8);
    const older = row("OLDER", null, null, 12);
    const tieA = row("TIEA", 1, 1, 1);
    const tieB = row("TIEB", 1, 1, 1);
    const mid = row("MID", 0, 5, 5);
    const ordered = [older, tieB, mid, recent, tieA].sort(compareCustomerSalesRows);
    expect(ordered.map((item) => item.sku)).toEqual(["RECENT", "TIEA", "TIEB", "MID", "OLDER"]);
    expect(compareCustomerSalesRows(tieA, tieB)).toBe(tieA.sku.localeCompare(tieB.sku));
  });
});
