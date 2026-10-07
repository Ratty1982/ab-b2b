import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyOrderConstraints,
  backorderCoverage,
  classifyPlannerRecommendation,
  comparePlannerPriority,
  demandConfidenceSufficient,
  estimatedLineValue,
  matchesPlannerOperationalFilters,
  plannedQtyWarnings,
  plannerPurchaseQty,
  resolvePlanningSupplier,
  resolvePurchasingCost,
  summarizeSupplierPlan,
  summarizeWorkingSelection,
  type PlannerRecommendation,
} from "@/domain/purchasing-planner";
import type { ForecastConfidence } from "@/domain/purchasing-forecast";

const root = join(import.meta.dirname, "../..");

function classify(partial: Partial<Parameters<typeof classifyPlannerRecommendation>[0]>) {
  return classifyPlannerRecommendation({
    stockStale: false,
    recommendedWeekly: 4,
    confidenceSufficient: true,
    forecastStatus: "HEALTHY",
    suggestedQty: 0,
    requirementBeforeIncoming: 0,
    backorderCoverage: "NONE",
    supplierState: "ASSIGNED",
    incomingQty: 0,
    ...partial,
  });
}

describe("order constraints", () => {
  it("raises a raw requirement below MOQ up to the MOQ", () => {
    expect(applyOrderConstraints({ rawRequirement: 5, minimumOrderQty: 12, orderMultiple: null })).toMatchObject({
      suggestedQty: 12,
      moqApplied: true,
    });
  });

  it("rounds a raw requirement up to the order multiple", () => {
    expect(applyOrderConstraints({ rawRequirement: 17, minimumOrderQty: null, orderMultiple: 6 })).toMatchObject({
      suggestedQty: 18,
      multipleApplied: true,
    });
  });

  it("applies MOQ and then the order multiple", () => {
    expect(applyOrderConstraints({ rawRequirement: 17, minimumOrderQty: 12, orderMultiple: 6 }).suggestedQty).toBe(18);
    expect(applyOrderConstraints({ rawRequirement: 5, minimumOrderQty: 12, orderMultiple: 6 }).suggestedQty).toBe(12);
  });

  it("never suggests a negative quantity and leaves a met requirement at zero", () => {
    expect(applyOrderConstraints({ rawRequirement: -4, minimumOrderQty: 12, orderMultiple: 6 }).suggestedQty).toBe(0);
    expect(applyOrderConstraints({ rawRequirement: 0, minimumOrderQty: 12, orderMultiple: 6 }).suggestedQty).toBe(0);
  });

  it("warns when a typed quantity breaks MOQ or the order multiple without changing it", () => {
    expect(plannedQtyWarnings({ plannedQty: 5, minimumOrderQty: 12, orderMultiple: 6 })).toEqual([
      "Below supplier MOQ of 12.",
      "Not a multiple of 6.",
    ]);
    expect(plannedQtyWarnings({ plannedQty: 18, minimumOrderQty: 12, orderMultiple: 6 })).toEqual([]);
  });
});

describe("backorders versus demand", () => {
  it("marks known backorders at risk when Available + Incoming is short", () => {
    expect(backorderCoverage({ backorderUnits: 18, availableQty: 0, incomingQty: 10 })).toEqual({
      coverage: "AT_RISK",
      shortfall: 8,
    });
  });

  it("treats known backorders as covered once Available + Incoming is enough", () => {
    expect(backorderCoverage({ backorderUnits: 8, availableQty: 5, incomingQty: 20 })).toEqual({
      coverage: "COVERED_AFTER_INCOMING",
      shortfall: 0,
    });
    expect(backorderCoverage({ backorderUnits: 4, availableQty: 5, incomingQty: 0 })).toEqual({
      coverage: "COVERED_BY_STOCK",
      shortfall: 0,
    });
  });

  it("does not add customer backorders on top of historic demand", () => {
    const calc = plannerPurchaseQty({
      availableQty: 0,
      incomingQty: 10,
      backorderUnits: 18,
      recommendedWeekly: 10,
      targetCoverWeeks: 4,
      safetyStockQty: 0,
      leadTimeDays: 14,
      minimumOrderQty: null,
      orderMultiple: null,
    });
    // target = 40, demand requirement = 40 - 0 - 10 = 30, shortfall = 8. Max, not sum.
    expect(calc.demandRequirement).toBe(30);
    expect(calc.backorderShortfall).toBe(8);
    expect(calc.rawRequirement).toBe(30);
    expect(calc.suggestedQty).toBe(30);
  });

  it("still raises the requirement when backorder shortfall exceeds forecast demand", () => {
    const calc = plannerPurchaseQty({
      availableQty: 0,
      incomingQty: 10,
      backorderUnits: 18,
      recommendedWeekly: 1,
      targetCoverWeeks: 4,
      safetyStockQty: 0,
      leadTimeDays: null,
      minimumOrderQty: null,
      orderMultiple: null,
    });
    expect(calc.demandRequirement).toBe(0);
    expect(calc.rawRequirement).toBe(8);
    expect(calc.rawBasis).toBe("BACKORDERS");
  });
});

describe("incoming closed loop", () => {
  it("keeps Incoming separate from Available and drops the suggestion once P/Ord Qty covers the requirement", () => {
    const before = plannerPurchaseQty({
      availableQty: 2,
      incomingQty: 0,
      backorderUnits: 0,
      recommendedWeekly: 4,
      targetCoverWeeks: 6,
      safetyStockQty: 0,
      leadTimeDays: 14,
      minimumOrderQty: null,
      orderMultiple: null,
    });
    expect(before.suggestedQty).toBe(22);
    const after = plannerPurchaseQty({
      availableQty: 2,
      incomingQty: 22,
      backorderUnits: 0,
      recommendedWeekly: 4,
      targetCoverWeeks: 6,
      safetyStockQty: 0,
      leadTimeDays: 14,
      minimumOrderQty: null,
      orderMultiple: null,
    });
    expect(after.suggestedQty).toBe(0);
    expect(after.requirementBeforeIncoming).toBe(22);
    const recommendation = classify({
      suggestedQty: 0,
      requirementBeforeIncoming: after.requirementBeforeIncoming,
      forecastStatus: "INCOMING_COVERS_REQUIREMENT",
      incomingQty: 22,
    });
    expect(recommendation.recommendation).toBe("COVERED_BY_INCOMING");
  });
});

describe("purchasing cost", () => {
  it("prefers the supplier override, then Latest Cost, and never turns a missing cost into zero", () => {
    expect(resolvePurchasingCost({ supplierUnitCost: "3.50", latestCost: "2.00" })).toEqual({
      cost: "3.5000",
      source: "SUPPLIER_OVERRIDE",
    });
    expect(resolvePurchasingCost({ supplierUnitCost: null, latestCost: "2.5" })).toEqual({
      cost: "2.5000",
      source: "LATEST_COST",
    });
    expect(resolvePurchasingCost({ supplierUnitCost: null, latestCost: null }).source).toBe("MISSING");
    expect(resolvePurchasingCost({ supplierUnitCost: "0", latestCost: "0.00" }).cost).toBeNull();
    expect(estimatedLineValue(12, null)).toBeNull();
    expect(estimatedLineValue(12, "2.5000")).toBe("30.00");
  });
});

describe("supplier resolution", () => {
  const base = {
    supplierActive: true,
    active: true,
    supplierSku: null,
  };

  it("allows no supplier and does not guess between several active suppliers", () => {
    expect(resolvePlanningSupplier([]).state).toBe("NONE");
    const ambiguous = resolvePlanningSupplier([
      { ...base, id: "a", supplierId: "s1", supplierName: "One", isPreferred: false },
      { ...base, id: "b", supplierId: "s2", supplierName: "Two", isPreferred: false },
    ]);
    expect(ambiguous.state).toBe("AMBIGUOUS");
    expect(ambiguous.relation).toBeNull();
  });

  it("uses the only active preferred supplier", () => {
    const resolved = resolvePlanningSupplier([
      { ...base, id: "a", supplierId: "s1", supplierName: "One", isPreferred: true },
      { ...base, id: "b", supplierId: "s2", supplierName: "Two", isPreferred: false },
    ]);
    expect(resolved.relation?.supplierId).toBe("s1");
  });
});

describe("recommendation states", () => {
  const cases: Array<[string, Partial<Parameters<typeof classifyPlannerRecommendation>[0]>, PlannerRecommendation]> = [
    ["backorders at risk", { backorderCoverage: "AT_RISK", suggestedQty: 8 }, "BACKORDERS_AT_RISK"],
    ["order now", { suggestedQty: 12, forecastStatus: "CRITICAL" }, "ORDER_NOW"],
    ["order soon", { suggestedQty: 6, forecastStatus: "WATCH" }, "ORDER_SOON"],
    [
      "covered by incoming",
      { suggestedQty: 0, incomingQty: 24, requirementBeforeIncoming: 24, forecastStatus: "INCOMING_COVERS_REQUIREMENT" },
      "COVERED_BY_INCOMING",
    ],
    ["adequate stock", { suggestedQty: 0, recommendedWeekly: 2 }, "ADEQUATE_STOCK"],
    ["no verified demand", { suggestedQty: 0, recommendedWeekly: null }, "NO_VERIFIED_DEMAND"],
    ["no supplier", { suggestedQty: 10, supplierState: "NONE", forecastStatus: "REORDER" }, "NO_SUPPLIER"],
    ["review when confidence is limited", { suggestedQty: 10, confidenceSufficient: false, forecastStatus: "CRITICAL" }, "REVIEW"],
    ["review when the supplier is ambiguous", { suggestedQty: 10, supplierState: "AMBIGUOUS", forecastStatus: "REORDER" }, "REVIEW"],
    ["review when stock is stale", { stockStale: true, backorderCoverage: "AT_RISK" }, "REVIEW"],
  ];

  it.each(cases)("classifies %s", (_name, input, expected) => {
    expect(classify(input).recommendation).toBe(expected);
  });

  it("limits confidence when sales history is unverified or very short", () => {
    expect(demandConfidenceSufficient({ verified: false, confidence: "GOOD" })).toBe(false);
    expect(demandConfidenceSufficient({ verified: true, confidence: "UNVERIFIED" satisfies ForecastConfidence })).toBe(false);
    expect(demandConfidenceSufficient({ verified: true, confidence: "VERY_LOW" })).toBe(false);
    expect(demandConfidenceSufficient({ verified: true, confidence: "LOW" })).toBe(true);
  });

  it("sorts actionable risk first, then uncovered backorders, then value, then cover, then SKU", () => {
    const row = (
      recommendation: PlannerRecommendation,
      extra: Partial<{ estimatedValue: string | null; backorderShortfall: number; weeksCover: number | null; sku: string }>,
    ) => ({
      recommendation,
      estimatedValue: extra.estimatedValue ?? null,
      backorderShortfall: extra.backorderShortfall ?? 0,
      weeksCover: extra.weeksCover ?? null,
      sku: extra.sku ?? "A",
    });
    const rows = [
      row("ADEQUATE_STOCK", { sku: "B" }),
      row("ORDER_NOW", { sku: "C", estimatedValue: "10.00" }),
      row("BACKORDERS_AT_RISK", { sku: "D", backorderShortfall: 2 }),
      row("BACKORDERS_AT_RISK", { sku: "E", backorderShortfall: 8 }),
      row("NO_SUPPLIER", { sku: "F" }),
    ];
    rows.sort(comparePlannerPriority);
    expect(rows.map((item) => item.sku)).toEqual(["E", "D", "C", "F", "B"]);
  });
});

describe("planner filters and supplier totals", () => {
  const row = {
    supplierId: "sup-1" as string | null,
    supplierState: "ASSIGNED" as const,
    recommendation: "ORDER_NOW" as PlannerRecommendation,
    backorderUnits: 0,
    incomingQty: 0,
    costMissing: false,
    confidenceSufficient: true,
  };

  it("filters unassigned, missing supplier, backorders, incoming, cost and confidence", () => {
    expect(matchesPlannerOperationalFilters({ ...row, supplierState: "NONE", supplierId: null }, { supplierId: "unassigned" })).toBe(true);
    expect(matchesPlannerOperationalFilters({ ...row, supplierState: "AMBIGUOUS", supplierId: null }, { supplierId: "unassigned" })).toBe(false);
    expect(matchesPlannerOperationalFilters({ ...row, supplierState: "NONE", supplierId: null }, { missingSupplier: true })).toBe(true);
    expect(matchesPlannerOperationalFilters(row, { supplierId: "sup-1" })).toBe(true);
    expect(matchesPlannerOperationalFilters(row, { supplierId: "other" })).toBe(false);
    expect(matchesPlannerOperationalFilters({ ...row, backorderUnits: 3 }, { backordersOnly: true })).toBe(true);
    expect(matchesPlannerOperationalFilters(row, { backordersOnly: true })).toBe(false);
    expect(matchesPlannerOperationalFilters({ ...row, incomingQty: 4 }, { incomingOnly: true })).toBe(true);
    expect(matchesPlannerOperationalFilters({ ...row, costMissing: true }, { missingCost: true })).toBe(true);
    expect(matchesPlannerOperationalFilters({ ...row, confidenceSufficient: false }, { demand: "limited" })).toBe(true);
    expect(matchesPlannerOperationalFilters(row, { recommendation: "ORDER_SOON" })).toBe(false);
  });

  it("compares a supplier total with the minimum without increasing quantities", () => {
    const summary = summarizeSupplierPlan(
      [
        { recommendation: "ORDER_NOW", suggestedQty: 10, estimatedValue: "780.00", costMissing: false },
        { recommendation: "ORDER_NOW", suggestedQty: 4, estimatedValue: null, costMissing: true },
      ],
      "1000.00",
    );
    expect(summary.suggestedUnits).toBe(14);
    expect(summary.knownValue).toBe("780.00");
    expect(summary.missingCostLines).toBe(1);
    expect(summary.belowMinimumBy).toBe("220.00");
    expect(summary.orderNow).toBe(2);
  });

  it("uses Your Qty for the working list and does not persist a purchase order", () => {
    const summary = summarizeWorkingSelection(
      [
        { sku: "A", plannedQty: 5, cost: "10.00", minimumOrderQty: 12, orderMultiple: 6 },
        { sku: "B", plannedQty: 6, cost: null, minimumOrderQty: null, orderMultiple: null },
      ],
      "1000.00",
    );
    expect(summary.products).toBe(2);
    expect(summary.units).toBe(11);
    expect(summary.knownValue).toBe("50.00");
    expect(summary.missingCostLines).toBe(1);
    expect(summary.warningLines).toBe(1);
    expect(summary.belowMinimumBy).toBe("950.00");
    const planner = readFileSync(join(root, "src/domain/purchasing-planner.ts"), "utf8");
    expect(planner).not.toMatch(/model PurchaseOrder|createPurchaseOrder|poNumber/);
  });
});

describe("purchasing boundaries", () => {
  it("does not introduce a purchase-order model or infer suppliers", () => {
    const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
    expect(schema).not.toMatch(/model PurchaseOrder/);
    expect(schema).toMatch(/model Supplier/);
    expect(schema).toMatch(/model ProductSupplier/);
    const suppliers = readFileSync(join(root, "src/server/purchasing/suppliers.ts"), "utf8");
    expect(suppliers).toMatch(/never inferred/i);
    const publicCatalogue = readFileSync(join(root, "src/server/catalogue/products.ts"), "utf8");
    expect(publicCatalogue).not.toMatch(/ProductSupplier|purchasing\/suppliers/);
    const backorders = readFileSync(join(root, "src/server/purchasing/backorders.ts"), "utf8");
    expect(backorders).not.toMatch(/ProductSupplier|createSupplier/);
  });
});
