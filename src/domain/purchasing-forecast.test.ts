import { describe, expect, it } from "vitest";
import {
  DEFAULT_PURCHASING_SETTINGS,
  buildForecastConfidenceCopy,
  buildWhyCopy,
  demandComponentAvailability,
  detectUnusualDemand,
  estimatedStockoutDate,
  forecastConfidenceWarning,
  formatPurchasingGbp,
  formatSalesHistoryCoverage,
  leadTimeDemandUnits,
  quietSaleFilterLabel,
  periodDemand,
  projectedWeeksOfCover,
  reorderPointUnits,
  resolveDemandTrend,
  resolveForecastConfidence,
  resolvePurchasingStatus,
  resolveRecommendedWeeklyDemand,
  salesHistoryCoverageDays,
  seasonalComparisonAvailable,
  stockValueAtLatestCost,
  suggestedPurchaseQty,
  suggestedPurchaseValue,
  weeksOfCover,
  type DemandRates,
} from "@/domain/purchasing-forecast";
import { parseIncomingCell } from "@/domain/stock-parse-types";
import { parseAutopart231Po3New } from "@/domain/stock-parse";
import { buildNative231Po3New } from "@/server/stock/fixtures/native-231po3new";
import { publicAvailabilityFromQty } from "@/domain/availability";

function rates(partial: Partial<DemandRates> & Pick<DemandRates, "last30">): DemandRates {
  const empty = periodDemand(0, 7, 0);
  return {
    last7: empty,
    last90: empty,
    last365: empty,
    previous30: empty,
    previous90: empty,
    samePeriodLastYear: null,
    ...partial,
  };
}

describe("231PO3NEW Incoming cell", () => {
  it("parses positive, zero and blank Incoming without touching Avail rules", () => {
    expect(parseIncomingCell("240")).toEqual({ ok: true, value: 240, raw: "240" });
    expect(parseIncomingCell("240.0000")).toEqual({ ok: true, value: 240, raw: "240.0000" });
    expect(parseIncomingCell("0")).toEqual({ ok: true, value: 0, raw: "0" });
    expect(parseIncomingCell("0.0000")).toEqual({ ok: true, value: 0, raw: "0.0000" });
    expect(parseIncomingCell("")).toMatchObject({ ok: false, reason: "blank" });
    expect(parseIncomingCell("   ")).toMatchObject({ ok: false, reason: "blank" });
  });

  it("rejects malformed and negative Incoming", () => {
    expect(parseIncomingCell("n/a")).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseIncomingCell("12.5")).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseIncomingCell("-4")).toMatchObject({ ok: false, reason: "negative" });
  });
});

describe("native 231PO3NEW Incoming column", () => {
  it("reads Incoming from the header without changing Avail", () => {
    const text = buildNative231Po3New([
      {
        sku: "GC5000",
        description: "GLASS CLEANER 5L",
        stk: "93.0000",
        avail: "36.0000",
        pick: "0.0000",
        physical: "93.0000",
        incoming: "240.0000",
      },
      {
        sku: "ZEROIN",
        description: "ZERO INCOMING",
        stk: "10.0000",
        avail: "8.0000",
        pick: "0.0000",
        physical: "10.0000",
        incoming: "0.0000",
      },
      {
        sku: "BLANKIN",
        description: "BLANK INCOMING",
        stk: "10.0000",
        avail: "9.0000",
        pick: "0.0000",
        physical: "10.0000",
        incoming: "",
      },
    ]);
    const parsed = parseAutopart231Po3New(text);
    if ("code" in parsed) throw new Error(parsed.message);
    expect(parsed.incomingHeader).toBe("P/Ord Qty");
    const gc = parsed.rows.find((r) => r.sku === "GC5000");
    expect(gc?.avail).toMatchObject({ ok: true, value: 36 });
    expect(gc?.incoming).toEqual({ ok: true, value: 240, raw: "240.0000" });
    expect(parsed.rows.find((r) => r.sku === "ZEROIN")?.incoming).toMatchObject({ ok: true, value: 0 });
    expect(parsed.rows.find((r) => r.sku === "BLANKIN")?.incoming).toMatchObject({ ok: false, reason: "blank" });
  });

  it("keeps Avail when Incoming is malformed or negative", () => {
    const text = buildNative231Po3New([
      { sku: "OK1", description: "OK ONE", stk: "10.0000", avail: "8.0000", pick: "0.0000", physical: "10.0000", incoming: "12.0000" },
      { sku: "OK2", description: "OK TWO", stk: "11.0000", avail: "9.0000", pick: "0.0000", physical: "11.0000", incoming: "24.0000" },
      { sku: "OK3", description: "OK THREE", stk: "12.0000", avail: "10.0000", pick: "0.0000", physical: "12.0000", incoming: "36.0000" },
      { sku: "BADIN", description: "BAD INCOMING", stk: "13.0000", avail: "11.0000", pick: "0.0000", physical: "13.0000", incoming: "n/a" },
    ]);
    const parsed = parseAutopart231Po3New(text);
    if ("code" in parsed) throw new Error(parsed.message);
    const bad = parsed.rows.find((r) => r.sku === "BADIN");
    expect(bad?.avail).toMatchObject({ ok: true, value: 11 });
    expect(bad?.incoming).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("does not invent Incoming when the header omits the column", () => {
    const text = buildNative231Po3New([
      { sku: "GC5000", description: "GLASS CLEANER 5L", stk: "93.0000", avail: "36.0000", pick: "0.0000", physical: "93.0000" },
    ]);
    const parsed = parseAutopart231Po3New(text);
    if ("code" in parsed) throw new Error(parsed.message);
    expect(parsed.incomingHeader).toBeNull();
    expect(parsed.rows[0]?.incoming).toBeUndefined();
    expect(parsed.rows[0]?.avail).toMatchObject({ ok: true, value: 36 });
  });

  it("does not add Incoming into customer stock bands", () => {
    expect(publicAvailabilityFromQty(8)).toBe("low");
    expect(publicAvailabilityFromQty(8 + 240)).toBe("in");
  });
});

describe("purchasing demand rates", () => {
  it("computes weekly demand from net units and does not treat missing coverage as zero demand", () => {
    const full = periodDemand(94, 30, 30);
    expect(full.weeklyRate).toBeCloseTo((94 / 30) * 7, 5);
    expect(full.complete).toBe(true);
    const partial = periodDemand(0, 365, 40);
    expect(partial.complete).toBe(false);
    expect(partial.weeklyRate).not.toBeNull();
    const noCoverage = periodDemand(0, 30, 3);
    expect(noCoverage.weeklyRate).toBeNull();
  });

  it("lets signed credits reduce net units", () => {
    const net = periodDemand(100 - 25, 30, 30);
    expect(net.netUnits).toBe(75);
    expect(net.weeklyRate).toBeCloseTo((75 / 30) * 7, 5);
  });

  it("weights 30/90/365-day rates and never uses last-30 × 12", () => {
    const resolved = resolveRecommendedWeeklyDemand(
      rates({
        last30: periodDemand(46 * (30 / 7), 30, 30),
        last90: periodDemand(39 * (90 / 7), 90, 90),
        last365: periodDemand(34 * (365 / 7), 365, 365),
      }),
    );
    expect(resolved.recommendedWeekly).not.toBe(46 * 12);
    expect(resolved.recommendedWeekly).toBeCloseTo(0.5 * 46 + 0.3 * 39 + 0.2 * 34, 1);
    expect(resolved.basis.find((b) => b.label === "30-day rate")?.weeklyRate).toBeCloseTo(46, 1);
  });
});

describe("cover, stockout and incoming", () => {
  it("does not divide when recommended demand is zero", () => {
    expect(weeksOfCover(126, 0)).toBeNull();
    expect(weeksOfCover(126, null)).toBeNull();
  });

  it("uses Avail only for current cover and Incoming only for projected cover", () => {
    expect(weeksOfCover(126, 42)).toBe(3);
    expect(projectedWeeksOfCover(126, 420, 42)).toBe(13);
    expect(weeksOfCover(36, 21.9)).toBe(1.6);
  });

  it("estimates current-stock runout ignoring Incoming", () => {
    const date = estimatedStockoutDate({ today: "2026-10-05", availableQty: 42, recommendedWeekly: 42 });
    expect(date).toBe("2026-10-12");
    const empty = estimatedStockoutDate({ today: "2026-10-05", availableQty: 0, recommendedWeekly: 42 });
    expect(empty).toBe("2026-10-05");
  });
});

describe("lead time, safety stock, MOQ and multiples", () => {
  it("computes lead-time demand and reorder point", () => {
    expect(leadTimeDemandUnits(21, 7)).toBe(21);
    expect(reorderPointUnits(180, 40)).toBe(220);
    expect(leadTimeDemandUnits(21, null)).toBeNull();
  });

  it("reduces additional purchase by Incoming and never returns a negative qty", () => {
    const covered = suggestedPurchaseQty({
      availableQty: 100,
      incomingQty: 500,
      recommendedWeekly: 42,
      targetCoverWeeks: 8,
      safetyStockQty: 40,
      minimumOrderQty: null,
      orderMultiple: null,
    });
    expect(covered.suggestedQty).toBe(0);
    expect(covered.rawRequirement).toBe(0);
  });

  it("applies MOQ and rounds order multiple UP", () => {
    const result = suggestedPurchaseQty({
      availableQty: 100,
      incomingQty: 240,
      recommendedWeekly: 42,
      targetCoverWeeks: 8,
      safetyStockQty: 40,
      minimumOrderQty: 120,
      orderMultiple: 24,
    });
    // target = ceil(42*8)+40 = 336+40 = 376; raw = 376-100-240 = 36; MOQ 120; multiple 24 → 120
    expect(result.rawRequirement).toBe(36);
    expect(result.afterMoq).toBe(120);
    expect(result.suggestedQty).toBe(120);
  });

  it("rounds 160 through MOQ 120 and multiple 24 to 168", () => {
    const result = suggestedPurchaseQty({
      availableQty: 100,
      incomingQty: 240,
      recommendedWeekly: 57.5,
      targetCoverWeeks: 8,
      safetyStockQty: 0,
      minimumOrderQty: 120,
      orderMultiple: 24,
    });
    // ceil(57.5*8)=460; raw=460-100-240=120; MOQ 120; 120/24=5 exactly → 120
    expect(result.suggestedQty).toBeGreaterThanOrEqual(120);
    const example = suggestedPurchaseQty({
      availableQty: 100,
      incomingQty: 240,
      recommendedWeekly: (500 - 0) / 8,
      targetCoverWeeks: 8,
      safetyStockQty: 0,
      minimumOrderQty: 120,
      orderMultiple: 24,
    });
    expect(example.targetStock).toBe(500);
    expect(example.rawRequirement).toBe(160);
    expect(example.afterMoq).toBe(160);
    expect(example.suggestedQty).toBe(168);
  });

  it("works with missing MOQ and missing order multiple", () => {
    const result = suggestedPurchaseQty({
      availableQty: 10,
      incomingQty: 0,
      recommendedWeekly: 10,
      targetCoverWeeks: 8,
      safetyStockQty: 0,
      minimumOrderQty: null,
      orderMultiple: null,
    });
    expect(result.suggestedQty).toBe(70);
  });
});

describe("trend materiality and anomalies", () => {
  it("does not treat 1→2 as a demand surge", () => {
    const t = resolveDemandTrend(periodDemand(2, 30, 30), periodDemand(1, 30, 30));
    expect(t.trend).toBe("INSUFFICIENT_DATA");
  });

  it("requires absolute and percentage thresholds for unusual 7-day demand", () => {
    expect(detectUnusualDemand(2, 1).unusual).toBe(false);
    const spike = detectUnusualDemand(147, 42);
    expect(spike.unusual).toBe(true);
    expect(spike.last7Units).toBe(147);
  });
});

describe("latest cost monetary values", () => {
  it("does not treat missing Latest Cost as £0", () => {
    expect(suggestedPurchaseValue(168, null)).toEqual({ value: null, costAvailable: false });
    expect(formatPurchasingGbp(null)).toBe("—");
    expect(stockValueAtLatestCost(100, null)).toBeNull();
  });

  it("values suggested purchase and overstock at Latest Cost", () => {
    const purchase = suggestedPurchaseValue(10, "2.50");
    expect(purchase.costAvailable).toBe(true);
    expect(formatPurchasingGbp(purchase.value)).toBe("£25.00");
    expect(formatPurchasingGbp(stockValueAtLatestCost(36, "2.5000"))).toBe("£90.00");
  });
});

describe("purchasing status", () => {
  it("marks stale stock instead of a confident reorder", () => {
    const stale = resolvePurchasingStatus({
      availableQty: 10,
      incomingQty: 0,
      weeksCover: 0.4,
      suggestedQty: 80,
      reorderPoint: 40,
      settings: DEFAULT_PURCHASING_SETTINGS,
      recommendedWeekly: 42,
      stockStale: true,
      estimatedStockoutDate: "2026-10-06",
      today: "2026-10-05",
    });
    expect(stale.status).toBe("DATA_STALE");
  });

  it("uses INCOMING_COVERS_REQUIREMENT when on-order qty already covers the gap", () => {
    const status = resolvePurchasingStatus({
      availableQty: 100,
      incomingQty: 500,
      weeksCover: 2.4,
      suggestedQty: 0,
      reorderPoint: 220,
      settings: DEFAULT_PURCHASING_SETTINGS,
      recommendedWeekly: 42,
      stockStale: false,
      estimatedStockoutDate: "2026-10-22",
      today: "2026-10-05",
    });
    expect(status.status).toBe("INCOMING_COVERS_REQUIREMENT");
  });

  it("identifies insufficient history", () => {
    const status = resolvePurchasingStatus({
      availableQty: 10,
      incomingQty: 0,
      weeksCover: null,
      suggestedQty: 0,
      reorderPoint: null,
      settings: DEFAULT_PURCHASING_SETTINGS,
      recommendedWeekly: null,
      stockStale: false,
      estimatedStockoutDate: null,
      today: "2026-10-05",
    });
    expect(status.status).toBe("INSUFFICIENT_DATA");
  });
});

describe("why copy", () => {
  it("explains incoming cover versus additional purchase", () => {
    expect(buildWhyCopy({ weeksCover: 0.6, incomingQty: 240, suggestedQty: 0, targetCoverWeeks: 8 })).toMatch(
      /no additional purchase/i,
    );
    expect(buildWhyCopy({ weeksCover: 0.6, incomingQty: 120, suggestedQty: 168, targetCoverWeeks: 8 })).toMatch(
      /additional 168 units/i,
    );
  });
});

describe("forecast confidence and sales-history coverage", () => {
  it("maps coverage-day thresholds without treating missing history as zero demand", () => {
    expect(resolveForecastConfidence(0)).toBe("VERY_LOW");
    expect(resolveForecastConfidence(29)).toBe("VERY_LOW");
    expect(resolveForecastConfidence(30)).toBe("LOW");
    expect(resolveForecastConfidence(89)).toBe("LOW");
    expect(resolveForecastConfidence(90)).toBe("BUILDING");
    expect(resolveForecastConfidence(179)).toBe("BUILDING");
    expect(resolveForecastConfidence(180)).toBe("GOOD");
    expect(resolveForecastConfidence(364)).toBe("GOOD");
    expect(resolveForecastConfidence(365)).toBe("STRONG");
    expect(salesHistoryCoverageDays(null, "2026-10-05")).toBe(0);
    expect(salesHistoryCoverageDays("2026-09-22", "2026-10-05")).toBe(14);
    expect(periodDemand(0, 90, 3).weeklyRate).toBeNull();
    expect(periodDemand(0, 90, 90).weeklyRate).toBe(0);
    expect(periodDemand(0, 90, 90).complete).toBe(true);
  });

  it("exposes 30/90/365 and seasonal component eligibility from genuine coverage", () => {
    expect(demandComponentAvailability(periodDemand(12, 30, 6))).toBe("unavailable");
    expect(periodDemand(12, 30, 6).weeklyRate).toBeNull();
    expect(demandComponentAvailability(periodDemand(12, 30, 7))).toBe("partial");
    expect(periodDemand(12, 30, 7).weeklyRate).not.toBeNull();
    expect(demandComponentAvailability(periodDemand(12, 30, 30))).toBe("full");
    expect(demandComponentAvailability(periodDemand(12, 90, 6))).toBe("unavailable");
    expect(demandComponentAvailability(periodDemand(12, 90, 7))).toBe("partial");
    expect(demandComponentAvailability(periodDemand(12, 90, 74))).toBe("partial");
    expect(demandComponentAvailability(periodDemand(12, 90, 90))).toBe("full");
    expect(demandComponentAvailability(periodDemand(40, 365, 6))).toBe("unavailable");
    expect(demandComponentAvailability(periodDemand(40, 365, 7))).toBe("partial");
    expect(demandComponentAvailability(periodDemand(40, 365, 40))).toBe("partial");
    expect(demandComponentAvailability(periodDemand(40, 365, 365))).toBe("full");
    const shortSpy = periodDemand(10, 30, 20);
    expect(seasonalComparisonAvailable(shortSpy)).toBe(false);
    expect(seasonalComparisonAvailable(periodDemand(10, 30, 23))).toBe(false);
    expect(seasonalComparisonAvailable(periodDemand(10, 30, 24))).toBe(true);
    expect(seasonalComparisonAvailable(null)).toBe(false);
  });

  it("renormalises demand weights and does not let confidence change the recommended rate", () => {
    const only30 = resolveRecommendedWeeklyDemand(
      rates({
        last30: periodDemand(30, 30, 14),
        last90: periodDemand(0, 90, 3),
        last365: periodDemand(0, 365, 3),
      }),
    );
    expect(only30.recommendedWeekly).toBeCloseTo((30 / 14) * 7, 1);
    expect(only30.basis.find((b) => b.label === "30-day rate")?.weight).toBe(1);
    expect(only30.basis.find((b) => b.label === "90-day rate")?.weight).toBe(0);
    expect(only30.basis.find((b) => b.label === "365-day rate")?.weight).toBe(0);
    const before = only30.recommendedWeekly;
    expect(resolveForecastConfidence(14)).toBe("VERY_LOW");
    expect(resolveForecastConfidence(365)).toBe("STRONG");
    expect(only30.recommendedWeekly).toBe(before);

    const withSeasonal = resolveRecommendedWeeklyDemand(
      rates({
        last30: periodDemand(70, 30, 30),
        last90: periodDemand(90, 90, 90),
        last365: periodDemand(365, 365, 365),
        samePeriodLastYear: periodDemand(14, 30, 30),
      }),
    );
    const withoutSeasonal = resolveRecommendedWeeklyDemand(
      rates({
        last30: periodDemand(70, 30, 30),
        last90: periodDemand(90, 90, 90),
        last365: periodDemand(365, 365, 365),
        samePeriodLastYear: periodDemand(14, 30, 10),
      }),
    );
    expect(withSeasonal.seasonalBlendApplied).toBe(true);
    expect(withoutSeasonal.seasonalBlendApplied).toBe(false);
    const base = 0.5 * ((70 / 30) * 7) + 0.3 * ((90 / 90) * 7) + 0.2 * ((365 / 365) * 7);
    expect(withSeasonal.recommendedWeekly).toBeCloseTo(0.85 * base + 0.15 * ((14 / 30) * 7), 1);
    expect(withoutSeasonal.recommendedWeekly).toBeCloseTo(base, 1);
  });

  it("does not let confidence change Avail, Incoming, Latest Cost, or suggested-order maths", () => {
    const availableQty = 36;
    const incomingQty = 240;
    const latestCost = "2.5000";
    const purchase = suggestedPurchaseQty({
      availableQty,
      incomingQty,
      recommendedWeekly: 12.1,
      targetCoverWeeks: 8,
      safetyStockQty: 0,
      minimumOrderQty: 24,
      orderMultiple: 12,
    });
    expect(resolveForecastConfidence(14)).toBe("VERY_LOW");
    expect(resolveForecastConfidence(400)).toBe("STRONG");
    const again = suggestedPurchaseQty({
      availableQty,
      incomingQty,
      recommendedWeekly: 12.1,
      targetCoverWeeks: 8,
      safetyStockQty: 0,
      minimumOrderQty: 24,
      orderMultiple: 12,
    });
    expect(again.suggestedQty).toBe(purchase.suggestedQty);
    expect(availableQty).toBe(36);
    expect(incomingQty).toBe(240);
    expect(latestCost).toBe("2.5000");
    expect(suggestedPurchaseValue(purchase.suggestedQty, latestCost).costAvailable).toBe(true);
  });

  it("keeps low-confidence reorder and overstock visible with a warning, not a status change", () => {
    const reorder = resolvePurchasingStatus({
      availableQty: 10,
      incomingQty: 0,
      weeksCover: 0.4,
      suggestedQty: 80,
      reorderPoint: 40,
      settings: DEFAULT_PURCHASING_SETTINGS,
      recommendedWeekly: 42,
      stockStale: false,
      estimatedStockoutDate: "2026-10-06",
      today: "2026-10-05",
      salesHistoryCoverageDays: 14,
    });
    expect(reorder.status).toBe("CRITICAL");
    expect(forecastConfidenceWarning({ confidence: "LOW", status: "REORDER", suggestedQty: 80 })).toMatch(
      /Limited sales history — review before ordering/i,
    );
    const overstock = resolvePurchasingStatus({
      availableQty: 1000,
      incomingQty: 0,
      weeksCover: 175,
      suggestedQty: 0,
      reorderPoint: null,
      settings: DEFAULT_PURCHASING_SETTINGS,
      recommendedWeekly: 5,
      stockStale: false,
      estimatedStockoutDate: "2028-01-01",
      today: "2026-10-05",
      salesHistoryCoverageDays: 14,
    });
    expect(overstock.status).toBe("OVERSTOCK");
    expect(forecastConfidenceWarning({ confidence: "VERY_LOW", status: "OVERSTOCK", suggestedQty: 0 })).toMatch(
      /Potential overstock/i,
    );
  });

  it("does not claim a no-sale window longer than known coverage, and keeps DATA_STALE independent", () => {
    const noDemand = resolvePurchasingStatus({
      availableQty: 40,
      incomingQty: 0,
      weeksCover: null,
      suggestedQty: 0,
      reorderPoint: null,
      settings: DEFAULT_PURCHASING_SETTINGS,
      recommendedWeekly: 0,
      stockStale: false,
      estimatedStockoutDate: null,
      today: "2026-10-05",
      salesHistoryCoverageDays: 14,
    });
    expect(noDemand.status).toBe("NO_RECENT_DEMAND");
    expect(noDemand.reason).toMatch(/14 days of available sales history/i);
    expect(noDemand.reason).not.toMatch(/90 days/);
    const stale = resolvePurchasingStatus({
      availableQty: 10,
      incomingQty: 0,
      weeksCover: 0.4,
      suggestedQty: 80,
      reorderPoint: 40,
      settings: DEFAULT_PURCHASING_SETTINGS,
      recommendedWeekly: 42,
      stockStale: true,
      estimatedStockoutDate: "2026-10-06",
      today: "2026-10-05",
      salesHistoryCoverageDays: 365,
    });
    expect(stale.status).toBe("DATA_STALE");
    expect(resolveForecastConfidence(365)).toBe("STRONG");
    expect(buildForecastConfidenceCopy({ confidence: "BUILDING", coverageDays: 112 })).toMatch(/112 days of sales history/);
    expect(formatSalesHistoryCoverage(365)).toBe("365+ days history");
    expect(quietSaleFilterLabel(90, 14)).toBe("No sale in 14 days of available history");
    expect(quietSaleFilterLabel(90, 90)).toBe("No sale in 90 days");
    expect(quietSaleFilterLabel(30, 0)).toBe("No dated sales history");
  });
});
