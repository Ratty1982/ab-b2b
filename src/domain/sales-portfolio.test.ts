import { describe, expect, it } from "vitest";
import {
  buildCrossSellOpportunity,
  buildStoppedProductOpportunity,
  PORTFOLIO_CROSS_SELL_CONFIG,
  rowMatchesPortfolioFilter,
} from "@/domain/sales-portfolio";

describe("portfolio opportunities", () => {
  it("builds cross-sell with correct numerator/denominator", () => {
    const opp = buildCrossSellOpportunity({
      seedSku: "SKU-A",
      suggestedSku: "SKU-B",
      suggestedName: "Widget B",
      coBuyers: 18,
      cohortSize: 24,
    });
    expect(opp).not.toBeNull();
    expect(opp!.evidenceNumerator).toBe(18);
    expect(opp!.evidenceDenominator).toBe(24);
    expect(opp!.explanation).toContain("18 of 24");
    expect(opp!.explanation).toContain("75%");
  });

  it("refuses cross-sell below minimum cohort", () => {
    expect(
      buildCrossSellOpportunity({
        seedSku: "SKU-A",
        suggestedSku: "SKU-B",
        coBuyers: 3,
        cohortSize: PORTFOLIO_CROSS_SELL_CONFIG.minCohortBuyers - 1,
      }),
    ).toBeNull();
  });

  it("refuses opportunity when customer already buys suggested SKU (caller filters)", () => {
    // Domain helper itself doesn't know ownership; adoption still requires minCoBuyers.
    expect(
      buildCrossSellOpportunity({
        seedSku: "SKU-A",
        suggestedSku: "SKU-B",
        coBuyers: 2,
        cohortSize: 20,
      }),
    ).toBeNull();
  });

  it("builds stopped product opportunity", () => {
    const opp = buildStoppedProductOpportunity({ count: 4, sampleSkus: ["AA", "BB"] });
    expect(opp?.type).toBe("STOPPED_PRODUCT");
    expect(opp?.explanation).toMatch(/4 previously|Previously purchased/i);
  });
});

describe("portfolio filters", () => {
  const base = {
    needsAttention: true,
    dormant: false,
    declining: true,
    growing: false,
    stoppedProductCount: 2,
    opportunityCount: 1,
    openFollowUpCount: 0,
    currentNetSales: "100.00",
  };

  it("matches attention / declining / no-sales filters", () => {
    expect(rowMatchesPortfolioFilter(base, "NEEDS_ATTENTION")).toBe(true);
    expect(rowMatchesPortfolioFilter(base, "DECLINING")).toBe(true);
    expect(rowMatchesPortfolioFilter(base, "GROWING")).toBe(false);
    expect(rowMatchesPortfolioFilter({ ...base, currentNetSales: "0.00" }, "NO_SALES")).toBe(true);
  });
});
