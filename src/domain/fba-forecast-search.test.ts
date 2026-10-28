import { describe, expect, it } from "vitest";
import { defaultFbaForecastSort, salesActivitySearchValue } from "@/domain/fba-forecast-search";

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
});
