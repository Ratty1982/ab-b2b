import { describe, expect, it } from "vitest";
import { buildAutopart216vFixture } from "@/domain/autopart-216v-fixture";
import { AUTOPART_504C_HEADER } from "@/domain/autopart-504c-fixture";
import {
  FBA_WAREHOUSE_FILE_MESSAGE,
  assessFbaStockFile,
  fbaStockIsStale,
  planFbaSnapshot,
  totalOwnedStock,
} from "@/domain/fba-stock";
import { backorderCoverage, classifyPlannerRecommendation, plannerPurchaseQty } from "@/domain/purchasing-planner";
import { buildNative231Po3New, type Native231Po3NewRow } from "@/server/stock/fixtures/native-231po3new";

function row(sku: string, avail: string, extra: Partial<Native231Po3NewRow> = {}): Native231Po3NewRow {
  return {
    sku,
    description: `Part ${sku}`,
    stk: "99.0000",
    avail,
    pick: "7.0000",
    physical: "80.0000",
    cost: "9.99",
    incoming: "15",
    condition: "O",
    group: "SX",
    subGrp: "NOTGRP",
    trailerGroup: "LATER",
    branch: "OPTIMUS",
    ...extra,
  };
}

function optimusReport(rows: Native231Po3NewRow[], selectGroup = "ALL"): string {
  return [
    `[Branch OPTIMUS] [Select Group ${selectGroup}] [Sub Grp ALL] [GROUP ALL]`,
    buildNative231Po3New(rows),
  ].join("\n");
}

const CSV_HEADER =
  "Branch,Group,Part Number,C,Description,Latest Cost,Stk,Avail,Pick Qty,Physical Stk,P/Ord Qty,Sub Grp,GROUP";

describe("FBA stock file validation", () => {
  it("reads OPTIMUS Avail and ignores Stk, Physical, Pick, P/Ord Qty, Sub Grp, and GROUP", () => {
    const assessed = assessFbaStockFile(optimusReport([row("SSAMZ", "25.0000")]));
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.rows).toEqual([
      expect.objectContaining({ sku: "SSAMZ", matchKey: "SSAMZ", branch: "OPTIMUS", availQty: 25 }),
    ]);
    expect(assessed.completeSnapshot).toBe(true);
    expect(assessed.sourceLabel).toBe("Amazon FBA");
  });

  it("rejects a warehouse SS report", () => {
    const assessed = assessFbaStockFile(buildNative231Po3New([row("SSAMZ", "4.0000", { branch: "SS" })]));
    expect(assessed).toEqual({ ok: false, message: FBA_WAREHOUSE_FILE_MESSAGE });
  });

  it("rejects a mixed SS and OPTIMUS report", () => {
    const assessed = assessFbaStockFile(
      optimusReport([row("KEEP", "2.0000"), row("WARE", "4.0000", { branch: "SS" })]),
    );
    expect(assessed.ok).toBe(false);
    if (assessed.ok) return;
    expect(assessed.message).toBe(FBA_WAREHOUSE_FILE_MESSAGE);
  });

  it("rejects 216V, 504, 504C, and TRM21QC", () => {
    expect(assessFbaStockFile(buildAutopart216vFixture()).ok).toBe(false);
    expect(assessFbaStockFile("Type,Document,Date,Goods\nACCOUNT,SS1,01/01/2026,10\n").ok).toBe(false);
    expect(assessFbaStockFile(`LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)\n${AUTOPART_504C_HEADER}\n`).ok).toBe(
      false,
    );
    const trm = assessFbaStockFile(
      "Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%\nAB,T,SS1,01/01/2026,SKU,Name,1,10,5,5,50\n",
    );
    expect(trm.ok).toBe(false);
    if (!trm.ok) expect(trm.message).toMatch(/TRM21QC/);
  });

  it("rejects an unstructured file, a blank SKU, and a non-numeric Avail", () => {
    expect(assessFbaStockFile("hello\nnot a report\n").ok).toBe(false);
    const assessed = assessFbaStockFile(
      [CSV_HEADER, "OPTIMUS,SX,,W,Blank,1.00,1,4,0,1,0,NO,LATER", "OPTIMUS,SX,BAD,W,Bad avail,1.00,9,n/a,0,1,0,NO,LATER", "OPTIMUS,SX,GOOD,W,Good,1.00,9,4.0000,0,1,0,NO,LATER"].join(
        "\n",
      ),
    );
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.rows.map((line) => line.sku)).toEqual(["GOOD"]);
    expect(assessed.invalidRows).toBeGreaterThanOrEqual(2);
    expect(assessed.completeSnapshot).toBe(false);
  });

  it("accepts a delimited OPTIMUS CSV and rejects the same shape for branch SS", () => {
    const ok = assessFbaStockFile([CSV_HEADER, "OPTIMUS,SX,AMZ1,W,Widget,3.50,50.0000,12.0000,1,40,8,SUB,END"].join("\n"));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.rows[0]).toMatchObject({ sku: "AMZ1", availQty: 12 });
    const ss = assessFbaStockFile([CSV_HEADER, "SS,SX,AMZ1,W,Widget,3.50,50.0000,12.0000,1,40,8,SUB,END"].join("\n"));
    expect(ss).toMatchObject({ ok: false, message: FBA_WAREHOUSE_FILE_MESSAGE });
  });

  it("does not import a repeated SKU", () => {
    const assessed = assessFbaStockFile(optimusReport([row("DUP", "5.0000"), row("DUP", "9.0000"), row("KEEP", "2.0000")]));
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.rows.map((line) => line.sku)).toEqual(["KEEP"]);
    expect(assessed.duplicateSkus).toBe(2);
  });
});

describe("FBA snapshot planning", () => {
  it("replaces the current quantity and does not add imports together", () => {
    const first = planFbaSnapshot({
      rows: [{ matchKey: "SSAMZ", availQty: 20 }],
      existingProductKeys: new Set(["SSAMZ"]),
      previousQty: new Map(),
      completeSnapshot: true,
      invalidRows: 0,
      duplicateSkus: 0,
      warnings: [],
    });
    expect(first).toMatchObject({ productsProcessed: 1, changedQuantities: 1, totalUnits: 20, newProducts: 0 });
    const second = planFbaSnapshot({
      rows: [{ matchKey: "SSAMZ", availQty: 12 }],
      existingProductKeys: new Set(["SSAMZ"]),
      previousQty: new Map([["SSAMZ", 20]]),
      completeSnapshot: true,
      invalidRows: 0,
      duplicateSkus: 0,
      warnings: [],
    });
    expect(second.totalUnits).toBe(12);
    expect(second.changedQuantities).toBe(1);
    expect(second.totalUnits).not.toBe(32);
  });

  it("zeros a missing SKU only for a complete snapshot", () => {
    const previous = new Map([
      ["KEEP", 5],
      ["GONE", 20],
    ]);
    const complete = planFbaSnapshot({
      rows: [{ matchKey: "KEEP", availQty: 0 }],
      existingProductKeys: new Set(["KEEP", "GONE"]),
      previousQty: previous,
      completeSnapshot: true,
      invalidRows: 0,
      duplicateSkus: 0,
      warnings: [],
    });
    expect(complete.zeroStock).toBe(1);
    expect(complete.absentZeroed).toBe(1);
    const partial = planFbaSnapshot({
      rows: [{ matchKey: "KEEP", availQty: 0 }],
      existingProductKeys: new Set(["KEEP", "GONE"]),
      previousQty: previous,
      completeSnapshot: false,
      invalidRows: 0,
      duplicateSkus: 0,
      warnings: [],
    });
    expect(partial.absentZeroed).toBe(0);
  });

  it("keeps warehouse and FBA separate from B2B sellable stock and suggested qty", () => {
    expect(totalOwnedStock(10, 25)).toBe(35);
    const purchase = plannerPurchaseQty({
      availableQty: 0,
      incomingQty: 0,
      backorderUnits: 4,
      recommendedWeekly: 2,
      targetCoverWeeks: 8,
      safetyStockQty: 0,
      leadTimeDays: 14,
      minimumOrderQty: null,
      orderMultiple: null,
    });
    const coverage = backorderCoverage({ backorderUnits: 4, availableQty: 0, incomingQty: 0 });
    const recommendation = classifyPlannerRecommendation({
      stockStale: false,
      recommendedWeekly: 2,
      confidenceSufficient: true,
      forecastStatus: "REORDER",
      suggestedQty: purchase.suggestedQty,
      requirementBeforeIncoming: purchase.requirementBeforeIncoming,
      backorderCoverage: coverage.coverage,
      supplierState: "ASSIGNED",
      incomingQty: 0,
    });
    expect(coverage.coverage).toBe("AT_RISK");
    expect(recommendation.recommendation).toBe("BACKORDERS_AT_RISK");
    expect(totalOwnedStock(0, 100)).toBe(100);
    expect(purchase.suggestedQty).toBeGreaterThan(0);
  });

  it("marks an import stale after 14 days and leaves a recent import fresh", () => {
    const now = new Date("2026-10-07T12:00:00.000Z");
    expect(fbaStockIsStale(new Date("2026-10-01T12:00:00.000Z"), now)).toBe(false);
    expect(fbaStockIsStale(new Date("2026-09-01T12:00:00.000Z"), now)).toBe(true);
    expect(fbaStockIsStale(null, now)).toBe(false);
  });
});
