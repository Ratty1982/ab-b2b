import { describe, expect, it } from "vitest";
import {
  buildCrossSellOpportunity,
  buildStoppedProductOpportunity,
  compareOpportunityRows,
  PORTFOLIO_CROSS_SELL_CONFIG,
  rowMatchesPortfolioFilter,
  type PortfolioCustomerRow,
} from "@/domain/sales-portfolio";

function row(partial: Partial<PortfolioCustomerRow>): PortfolioCustomerRow {
  return {
    companyId: partial.companyId ?? "c1",
    companyName: partial.companyName ?? "Acme",
    customerGroupId: null,
    customerGroupName: null,
    mamAccount: null,
    salesRepId: null,
    salesRepName: null,
    currentNetSales: partial.currentNetSales ?? "100.00",
    previousNetSales: "50.00",
    movement: "50.00",
    movementPercent: 100,
    declining: false,
    growing: true,
    lastPurchaseDate: "2026-10-01",
    typicalIntervalDays: 1,
    daysSinceLastPurchase: 0,
    cadenceSummary: "Usually orders every ~1 day · Purchased today",
    cadenceIntervalLabel: "Every ~1 day",
    cadenceLastPurchaseLabel: "Purchased today",
    productsPurchased: 2,
    stoppedProductCount: partial.stoppedProductCount ?? 0,
    significantStoppedBuying: false,
    opportunityCount: partial.opportunityCount ?? 0,
    openFollowUpCount: 0,
    attentionReasons: partial.attentionReasons ?? [],
    needsAttention: partial.needsAttention ?? false,
    dormant: false,
    opportunities: partial.opportunities ?? [],
  };
}

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
    expect(JSON.stringify(opp)).not.toMatch(/£|GBP|revenue|probability/i);
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

  it("refuses opportunity when adoption evidence is weak", () => {
    expect(
      buildCrossSellOpportunity({
        seedSku: "SKU-A",
        suggestedSku: "SKU-B",
        coBuyers: 2,
        cohortSize: 20,
      }),
    ).toBeNull();
  });

  it("uses softer not-bought-this-period wording unless significant for attention", () => {
    const soft = buildStoppedProductOpportunity({
      count: 4,
      sampleSkus: ["AA", "BB"],
      significantForAttention: false,
    });
    expect(soft?.title).toMatch(/not bought this period/i);
    expect(soft?.explanation).toMatch(/comparable period/i);

    const strong = buildStoppedProductOpportunity({
      count: 4,
      sampleSkus: ["AA", "BB"],
      significantForAttention: true,
    });
    expect(strong?.title).toMatch(/stopped product/i);
  });

  it("orders Top Opportunities by count, then cross-sell adoption, then stopped, then sales", () => {
    const low = row({
      companyId: "a",
      companyName: "Alpha",
      opportunityCount: 1,
      opportunities: [
        {
          type: "STOPPED_PRODUCT",
          title: "1 not bought",
          explanation: "x",
        },
      ],
      stoppedProductCount: 1,
      currentNetSales: "999.00",
    });
    const high = row({
      companyId: "b",
      companyName: "Beta",
      opportunityCount: 3,
      opportunities: [
        {
          type: "CROSS_SELL",
          title: "Cross",
          explanation: "y",
          evidenceNumerator: 8,
          evidenceDenominator: 10,
        },
        {
          type: "BRAND_GAP",
          title: "Brand",
          explanation: "z",
        },
        {
          type: "STOPPED_PRODUCT",
          title: "2 not bought",
          explanation: "w",
        },
      ],
      stoppedProductCount: 2,
      currentNetSales: "10.00",
    });
    expect(compareOpportunityRows(high, low)).toBeLessThan(0);
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

  it("HAS_OPPORTUNITIES includes opportunity-only customers (not attention)", () => {
    const oppOnly = {
      ...base,
      needsAttention: false,
      declining: false,
      opportunityCount: 2,
    };
    expect(rowMatchesPortfolioFilter(oppOnly, "HAS_OPPORTUNITIES")).toBe(true);
    expect(rowMatchesPortfolioFilter(oppOnly, "NEEDS_ATTENTION")).toBe(false);
  });
});
