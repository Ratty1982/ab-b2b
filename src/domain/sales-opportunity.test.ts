import { describe, expect, it } from "vitest";
import {
  RANGE_OPPORTUNITY_CONFIG,
  calculateCustomerSimilarity,
  calculateObservedAdoption,
  compactOpportunityUrlSearch,
  computeSkuCoPurchase,
  emptyPurchaseProfileSets,
  isOpportunityAvailabilityEligible,
  jaccardSimilarity,
  parseOpportunityUrlSearch,
  resolveOpportunityAnalysisPeriod,
  resolveRangeMatch,
  sortOpportunityRows,
} from "@/domain/sales-opportunity";

function profile(partial: {
  categories?: string[];
  brands?: string[];
  skus?: string[];
}) {
  const p = emptyPurchaseProfileSets();
  for (const c of partial.categories ?? []) p.categoryIds.add(c);
  for (const b of partial.brands ?? []) p.brandIds.add(b);
  for (const s of partial.skus ?? []) p.skus.add(s.toUpperCase());
  return p;
}

describe("jaccardSimilarity", () => {
  it("identical sets → 1", () => {
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(1);
  });

  it("partial overlap", () => {
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });

  it("no overlap → 0", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("both empty → null (unused dimension)", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBeNull();
  });

  it("one empty → 0", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set())).toBe(0);
  });
});

describe("calculateCustomerSimilarity", () => {
  it("identical purchase profile scores 1", () => {
    const a = profile({ categories: ["c1"], brands: ["b1"], skus: ["S1", "S2"] });
    const b = profile({ categories: ["c1"], brands: ["b1"], skus: ["S1", "S2"] });
    const s = calculateCustomerSimilarity(a, b);
    expect(s.score).toBeCloseTo(1);
  });

  it("partial category/brand/sku overlap is weighted", () => {
    const a = profile({ categories: ["c1", "c2"], brands: ["b1"], skus: ["S1"] });
    const b = profile({ categories: ["c1"], brands: ["b1"], skus: ["S2"] });
    const s = calculateCustomerSimilarity(a, b);
    // category 1/2, brand 1, sku 0 → 0.5*(0.5)+0.3*(1)+0.2*(0) = 0.55
    expect(s.category).toBeCloseTo(0.5);
    expect(s.brand).toBe(1);
    expect(s.sku).toBe(0);
    expect(s.score).toBeCloseTo(0.55);
  });

  it("unknown both sides excluded and weights renormalized", () => {
    const a = profile({ categories: ["c1"], brands: [], skus: ["S1"] });
    const b = profile({ categories: ["c1"], brands: [], skus: ["S1"] });
    const s = calculateCustomerSimilarity(a, b);
    expect(s.brand).toBeNull();
    expect(s.weightsUsed.brand).toBe(0);
    expect(s.weightsUsed.category + s.weightsUsed.sku).toBeCloseTo(1);
    expect(s.score).toBeCloseTo(1);
  });

  it("empty profiles score 0", () => {
    expect(calculateCustomerSimilarity(emptyPurchaseProfileSets(), emptyPurchaseProfileSets()).score).toBe(
      0,
    );
  });

  it("no overlap below typical threshold", () => {
    const a = profile({ categories: ["c1"], brands: ["b1"], skus: ["S1"] });
    const b = profile({ categories: ["c9"], brands: ["b9"], skus: ["S9"] });
    expect(calculateCustomerSimilarity(a, b).score).toBe(0);
    expect(calculateCustomerSimilarity(a, b).score).toBeLessThan(
      RANGE_OPPORTUNITY_CONFIG.minSimilarity,
    );
  });
});

describe("range match / adoption / eligibility", () => {
  it("resolves range match labels", () => {
    const t = profile({ categories: ["c1"], brands: ["b1"] });
    expect(resolveRangeMatch(t, "b1", "c1")).toBe("SAME_BRAND_CATEGORY");
    expect(resolveRangeMatch(t, null, "c1")).toBe("SAME_CATEGORY");
    expect(resolveRangeMatch(t, "b1", null)).toBe("SAME_BRAND");
    expect(resolveRangeMatch(t, "b9", "c9")).toBe("BROADER_RANGE");
  });

  it("adoption is buyers/cohort", () => {
    expect(calculateObservedAdoption(18, 27)).toBeCloseTo(18 / 27);
    expect(calculateObservedAdoption(0, 0)).toBeNull();
  });

  it("stock eligibility excludes out-of-stock", () => {
    expect(isOpportunityAvailabilityEligible("in")).toBe(true);
    expect(isOpportunityAvailabilityEligible("backorder")).toBe(true);
    expect(isOpportunityAvailabilityEligible("out")).toBe(false);
    expect(isOpportunityAvailabilityEligible(null)).toBe(false);
  });
});

describe("period / URL / sort", () => {
  it("resolves last 12 months analysis period", () => {
    const r = resolveOpportunityAnalysisPeriod({ period: "LAST_365", today: "2026-09-29" });
    expect(r.to).toBe("2026-09-29");
    expect(r.from).toBe("2025-09-30");
  });

  it("parses and compacts URL state", () => {
    const parsed = parseOpportunityUrlSearch({
      companyId: "c1",
      period: "LAST_180",
      sort: "ADOPTION",
      page: "2",
      minAdoption: "0.5",
    });
    expect(parsed.period).toBe("LAST_180");
    expect(parsed.page).toBe(2);
    expect(parsed.minAdoption).toBe(0.5);
    expect(compactOpportunityUrlSearch(parsed)).toMatchObject({
      companyId: "c1",
      period: "LAST_180",
      sort: "ADOPTION",
      page: 2,
      minAdoption: 0.5,
    });
  });

  it("sorts by range match then adoption", () => {
    const rows = [
      {
        rangeMatch: "SAME_CATEGORY" as const,
        adoption: 0.5,
        buyers: 2,
        comparableUnits: 10,
        name: "B",
      },
      {
        rangeMatch: "SAME_BRAND_CATEGORY" as const,
        adoption: 0.4,
        buyers: 3,
        comparableUnits: 5,
        name: "A",
      },
      {
        rangeMatch: "SAME_BRAND_CATEGORY" as const,
        adoption: 0.9,
        buyers: 4,
        comparableUnits: 8,
        name: "C",
      },
    ];
    sortOpportunityRows(rows, "RANGE_MATCH");
    expect(rows.map((r) => r.name)).toEqual(["C", "A", "B"]);
  });
});

describe("cross-sell foundation", () => {
  it("counts co-purchasing companies for a seed SKU", () => {
    const sets = [
      new Set(["A", "B", "C"]),
      new Set(["A", "B"]),
      new Set(["B", "C"]),
    ];
    const co = computeSkuCoPurchase(sets, "A");
    expect(co.get("B")).toBe(2);
    expect(co.get("C")).toBe(1);
    expect(co.has("A")).toBe(false);
  });
});
