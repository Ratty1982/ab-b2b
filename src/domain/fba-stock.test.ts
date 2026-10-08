import { describe, expect, it } from "vitest";
import { buildAutopart216vFixture } from "@/domain/autopart-216v-fixture";
import { AUTOPART_504C_HEADER } from "@/domain/autopart-504c-fixture";
import {
  FBA_PARTIAL_CSV_WARNING,
  FBA_WAREHOUSE_FILE_MESSAGE,
  assessFbaStockFile,
  buildFbaPreviewProducts,
  fbaImportSafetyLines,
  fbaIssuesCsv,
  fbaMatchingEquation,
  fbaRowsReadEquation,
  fbaStockIsStale,
  planFbaSnapshot,
  presentFbaDiagnosticText,
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
      rowsRead: 1,
      invalidRows: 0,
      duplicateSkus: 0,
      warnings: [],
    });
    expect(first).toMatchObject({
      productsProcessed: 1,
      changedQuantities: 1,
      newFbaRecords: 1,
      fbaQuantityChanges: 0,
      totalUnits: 20,
      newProducts: 0,
    });
    const second = planFbaSnapshot({
      rows: [{ matchKey: "SSAMZ", availQty: 12 }],
      existingProductKeys: new Set(["SSAMZ"]),
      previousQty: new Map([["SSAMZ", 20]]),
      completeSnapshot: true,
      rowsRead: 1,
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
      rowsRead: 1,
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
      rowsRead: 1,
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

  it("keeps rows read, valid rows, invalid rows, matched products, and new products reconcilable", () => {
    const header = "Branch,Group,Part Number,C,Description,Latest Cost,Stk,Avail";
    const lines = [
      "OPTIMUS,SX,M1,O,Matched one,1.00,9,1",
      "OPTIMUS,SX,M2,O,Matched two,1.00,9,0",
      "OPTIMUS,SX,M3,O,Matched three,1.00,9,4",
      "OPTIMUS,SX,M4,O,Matched four,1.00,9,2",
      "OPTIMUS,SX,M5,O,Matched five,1.00,9,8",
      "OPTIMUS,SX,M6,O,Matched six,1.00,9,3",
      "OPTIMUS,AB,N1,N,New one,1.00,9,6",
      "OPTIMUS,AB,N2,W,New two,1.00,9,0",
      ",SX,,O,No sku,1.00,9,5",
      "OPTIMUS,SX,BAD,O,Bad avail,1.00,9,n/a",
    ];
    const assessed = assessFbaStockFile([header, ...lines].join("\n"));
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    const totals = planFbaSnapshot({
      rows: assessed.rows,
      existingProductKeys: new Set(["M1", "M2", "M3", "M4", "M5", "M6"]),
      previousQty: new Map(),
      completeSnapshot: assessed.completeSnapshot,
      rowsRead: assessed.rowsRead,
      invalidRows: assessed.invalidRows,
      duplicateSkus: assessed.duplicateSkus,
      warnings: assessed.warnings,
    });
    expect(totals.rowsRead).toBe(10);
    expect(totals.productsProcessed).toBe(8);
    expect(totals.invalidRows).toBe(2);
    expect(totals.matchedExisting).toBe(6);
    expect(totals.newProducts).toBe(2);
    expect(totals.rowsRead).toBe(totals.productsProcessed + totals.invalidRows + totals.duplicateSkus);
    expect(totals.productsProcessed).toBe(totals.matchedExisting + totals.newProducts);
    expect(fbaRowsReadEquation(totals)).toBe("8 valid product rows + 2 invalid rows = 10 rows read.");
    expect(fbaMatchingEquation(totals)).toBe("6 matched existing products + 2 new to AB = 8 valid product rows.");
    expect(JSON.stringify(totals)).not.toMatch(/unknown/i);
    expect(assessed.rows.map((row) => row.sku)).toEqual(["M1", "M2", "M3", "M4", "M5", "M6", "N1", "N2"]);
    const created = assessed.rows.find((row) => row.sku === "N1");
    expect(created).toMatchObject({ groupCode: "AB", conditionCode: "N", availQty: 6 });
  });

  it("counts a first zero as a new FBA record and leaves an equal quantity unchanged", () => {
    const first = planFbaSnapshot({
      rows: [{ matchKey: "ZERO", availQty: 0 }],
      existingProductKeys: new Set(["ZERO"]),
      previousQty: new Map(),
      completeSnapshot: false,
      rowsRead: 1,
      invalidRows: 0,
      duplicateSkus: 0,
      warnings: [],
    });
    expect(first.productsWithStock).toBe(0);
    expect(first.zeroStock).toBe(1);
    expect(first.invalidRows).toBe(0);
    expect(first.newFbaRecords).toBe(1);
    expect(first.fbaQuantityChanges).toBe(0);
    expect(first.changedQuantities).toBe(1);
    const same = planFbaSnapshot({
      rows: [{ matchKey: "ZERO", availQty: 0 }],
      existingProductKeys: new Set(["ZERO"]),
      previousQty: new Map([["ZERO", 0]]),
      completeSnapshot: false,
      rowsRead: 1,
      invalidRows: 0,
      duplicateSkus: 0,
      warnings: [],
    });
    expect(same.unchangedQuantities).toBe(1);
    expect(same.changedQuantities).toBe(0);
    expect(same.newFbaRecords).toBe(0);
  });

  it("marks an import stale after 14 days and leaves a recent import fresh", () => {
    const now = new Date("2026-10-07T12:00:00.000Z");
    expect(fbaStockIsStale(new Date("2026-10-01T12:00:00.000Z"), now)).toBe(false);
    expect(fbaStockIsStale(new Date("2026-09-01T12:00:00.000Z"), now)).toBe(true);
    expect(fbaStockIsStale(null, now)).toBe(false);
  });
});

describe("FBA CSV inch quotations", () => {
  const header =
    "Branch,Group,Part Number,C,Description,Latest Cost,Stk,Avail,Pick Qty,Physical Stk,P/Ord Qty,Sub Grp,GROUP";

  function dataRow(sku: string, description: string, avail: string): string {
    return ["OPTIMUS", "SX", sku, "W", description, "1.25", "10", avail, "0", "10", "0", "SUB", "GRP"].join(",");
  }

  it("keeps VENUS14, VENUS15, VENUS16 and every later SKU as separate rows", () => {
    const later = Array.from({ length: 12 }, (_, index) => dataRow(`AFTER${index + 1}`, `Pad ${index + 1}`, String(index + 1)));
    const assessed = assessFbaStockFile(
      [
        header,
        dataRow("BEFORE", "Plain widget", "2"),
        dataRow("VENUS14", 'Venus 14" Wheel Trim', "4"),
        dataRow("VENUS15", 'Venus 15" Wheel Trim', "5"),
        dataRow("VENUS16", 'Venus 16" Wheel Trim', "6"),
        ...later,
      ].join("\n"),
    );
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.rows.map((row) => row.sku)).toEqual([
      "BEFORE",
      "VENUS14",
      "VENUS15",
      "VENUS16",
      ...later.map((_, index) => `AFTER${index + 1}`),
    ]);
    expect(assessed.rows.find((row) => row.sku === "VENUS14")).toMatchObject({
      availQty: 4,
      description: 'Venus 14" Wheel Trim',
      line: 3,
    });
    expect(assessed.rows.find((row) => row.sku === "VENUS15")?.availQty).toBe(5);
    expect(assessed.rows.find((row) => row.sku === "VENUS16")?.availQty).toBe(6);
    expect(assessed.invalidRows).toBe(0);
    expect(assessed.rowsRead).toBe(assessed.rows.length);
    const units = assessed.rows.reduce((sum, row) => sum + row.availQty, 0);
    expect(units).toBe(2 + 4 + 5 + 6 + later.reduce((sum, _, index) => sum + index + 1, 0));
    expect(assessed.quoteDiagnostics.filter((row) => row.recovered).map((row) => row.sku)).toEqual([
      "VENUS14",
      "VENUS15",
      "VENUS16",
    ]);
    expect(assessed.rows.some((row) => (row.description ?? "").includes("VENUS15"))).toBe(false);
  });

  it("reads a properly escaped inch mark, a quoted comma, and a quoted newline", () => {
    const escaped = `OPTIMUS,SX,VENUS14,W,"Venus 14"" Wheel Trim",1.25,10,4,0,10,0,SUB,GRP`;
    const comma = `OPTIMUS,SX,COMMA,W,"Pad, front",1.25,10,8,0,10,0,SUB,GRP`;
    const newline = `OPTIMUS,SX,MULTI,W,"Line one\nLine two",1.25,10,3,0,10,0,SUB,GRP`;
    const assessed = assessFbaStockFile([header, escaped, comma, newline].join("\n"));
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.rows.map((row) => [row.sku, row.description, row.availQty, row.line])).toEqual([
      ["VENUS14", 'Venus 14" Wheel Trim', 4, 2],
      ["COMMA", "Pad, front", 8, 3],
      ["MULTI", "Line one\nLine two", 3, 4],
    ]);
    expect(assessed.quoteDiagnostics).toEqual([]);
    expect(assessed.invalidRows).toBe(0);
  });

  it("recovers a quoted description whose inch mark was not escaped", () => {
    const row = `OPTIMUS,SX,VENUS14,W,"Venus 14"" Wheel Trim",1.25,10,4,0,10,0,SUB,GRP`.replace(
      '"Venus 14"" Wheel Trim"',
      '"Venus 14" Wheel Trim"',
    );
    const assessed = assessFbaStockFile([header, row, dataRow("NEXT", "Next pad", "9")].join("\n"));
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.rows.map((item) => [item.sku, item.description, item.availQty])).toEqual([
      ["VENUS14", 'Venus 14" Wheel Trim', 4],
      ["NEXT", "Next pad", 9],
    ]);
    expect(assessed.quoteDiagnostics[0]).toMatchObject({ sku: "VENUS14", recovered: true, line: 2 });
  });

  it("rejects one malformed quotation and keeps the following branch rows", () => {
    const broken = `OPTIMUS,SX,BAD,W,"this " is not an inch mark`;
    const assessed = assessFbaStockFile(
      [header, dataRow("BEFORE", "Plain", "1"), broken, dataRow("NEXT", "Next pad", "9"), dataRow("LAST", "Last pad", "2")].join(
        "\n",
      ),
    );
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.rows.map((row) => [row.sku, row.availQty])).toEqual([
      ["BEFORE", 1],
      ["NEXT", 9],
      ["LAST", 2],
    ]);
    expect(assessed.invalidRowDetails).toEqual([
      expect.objectContaining({
        line: 3,
        sku: "BAD",
        reason: "malformed_quote",
        reasonLabel: "Malformed CSV quotation",
        value: null,
      }),
    ]);
    expect(assessed.quoteDiagnostics).toEqual([
      expect.objectContaining({ line: 3, sku: "BAD", recovered: false }),
    ]);
    expect(assessed.rowsRead).toBe(assessed.rows.length + assessed.invalidRows);
    expect(assessed.invalidRowDetails[0]?.description ?? "").not.toMatch(/NEXT|LAST/);
  });

  it("blocks the file when a quotation runs into lines that are not new product rows", () => {
    const assessed = assessFbaStockFile(
      [header, dataRow("BEFORE", "Plain", "1"), 'OPTIMUS,SX,BAD,W,"description keeps going', "and has, commas, but no close", "still not a product row"].join(
        "\n",
      ),
    );
    expect(assessed.ok).toBe(false);
    if (assessed.ok) return;
    expect(assessed.message).toMatch(/cannot be split safely/);
    expect(assessed.message).toMatch(/No FBA stock was changed/);
  });

  it("recovers an opened description whose inch mark has no closing quote when the columns still align", () => {
    const row = `OPTIMUS,SX,VENUS14,W,"Venus 14" Wheel Trim,1.25,10,4,0,10,0,SUB,GRP`;
    const later = Array.from({ length: 8 }, (_, index) => dataRow(`AFTER${index + 1}`, `Pad ${index + 1}`, String(index + 1)));
    const assessed = assessFbaStockFile([header, row, dataRow("VENUS15", 'Venus 15" Wheel Trim', "5"), ...later].join("\n"));
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.rows.find((item) => item.sku === "VENUS14")).toMatchObject({
      description: 'Venus 14" Wheel Trim',
      availQty: 4,
      line: 2,
    });
    expect(assessed.rows.find((item) => item.sku === "VENUS15")?.availQty).toBe(5);
    expect(assessed.rows.map((item) => item.sku)).toEqual(["VENUS14", "VENUS15", ...later.map((_, index) => `AFTER${index + 1}`)]);
    expect(assessed.invalidRows).toBe(0);
    expect(assessed.rowsRead).toBe(assessed.rows.length);
    expect(assessed.rows.reduce((sum, item) => sum + item.availQty, 0)).toBe(4 + 5 + later.reduce((sum, _, index) => sum + index + 1, 0));
  });

  it("does not swallow the next OPTIMUS row when a quotation stays open", () => {
    const open = `OPTIMUS,SX,VENUS14,W,"Venus fourteen inch trim that never closes`;
    const assessed = assessFbaStockFile(
      [header, open, dataRow("VENUS15", 'Venus 15" Wheel Trim', "5"), dataRow("VENUS16", 'Venus 16" Wheel Trim', "6")].join("\n"),
    );
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.rows.map((row) => [row.sku, row.availQty])).toEqual([
      ["VENUS15", 5],
      ["VENUS16", 6],
    ]);
    expect(assessed.invalidRowDetails).toEqual([
      expect.objectContaining({
        line: 2,
        sku: "VENUS14",
        reason: "malformed_quote",
        value: null,
      }),
    ]);
    expect(assessed.quoteDiagnostics[0]).toMatchObject({ sku: "VENUS14", recovered: false, line: 2 });
    expect(assessed.rowsRead).toBe(3);
    expect(assessed.invalidRowDetails[0]?.description ?? "").not.toMatch(/VENUS15|VENUS16/);
  });

  it("shortens a long diagnostic description", () => {
    const long = `Venus 14" ${"Wheel ".repeat(40)}Trim`;
    const shown = presentFbaDiagnosticText(long);
    expect(shown?.endsWith("…")).toBe(true);
    expect(shown!.length).toBeLessThanOrEqual(160);
    expect(shown).not.toContain("\n");
    expect(long.length).toBeGreaterThan(160);
  });

  it("uses the physical line number when a blank line precedes the inch-mark row", () => {
    const assessed = assessFbaStockFile([header, "", dataRow("VENUS14", 'Venus 14" Wheel Trim', "4")].join("\n"));
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.rows[0]).toMatchObject({ sku: "VENUS14", availQty: 4, line: 3 });
  });
});

describe("FBA preview diagnostics", () => {
  const header = "Branch,Group,Part Number,C,Description,Latest Cost,Stk,Avail";

  function csv(lines: string[]): string {
    return [header, ...lines].join("\n");
  }

  it("records a reason, row number, and SKU for each invalid condition the parser produces", () => {
    const assessed = assessFbaStockFile(
      csv([
        "OPTIMUS,SX,KEEP,O,Kept,1.00,9,4",
        ",SX,,O,No sku,1.00,9,5",
        "OPTIMUS,SX,BAD,O,Bad avail,1.00,9,n/a",
        "OPTIMUS,SX,BLANK,O,Blank avail,1.00,9,",
        "OPTIMUS,SX,NEG,O,Negative,1.00,9,-3",
        ",SX,NOBRANCH,O,No branch,1.00,9,2",
      ]),
    );
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.rows.map((row) => row.sku)).toEqual(["KEEP"]);
    expect(assessed.invalidRowDetails.map((row) => row.reason)).toEqual([
      "missing_sku",
      "invalid_avail",
      "invalid_avail",
      "negative_avail",
      "missing_branch",
    ]);
    expect(assessed.invalidRowDetails[0]).toMatchObject({ line: 3, sku: null, description: "No sku", reasonLabel: "Missing SKU" });
    expect(assessed.invalidRowDetails[1]).toMatchObject({ line: 4, sku: "BAD", value: "n/a", reasonLabel: "Invalid Avail" });
    expect(assessed.invalidRowDetails[3]).toMatchObject({ line: 6, sku: "NEG", value: "-3", reasonLabel: "Negative Avail" });
    expect(assessed.invalidRowDetails[4]).toMatchObject({ line: 7, sku: "NOBRANCH", reasonLabel: "Missing branch" });
    expect(assessed.invalidRows).toBe(5);
    const csvText = fbaIssuesCsv(assessed.invalidRowDetails);
    expect(csvText.split("\n")[0]).toBe("row,sku,description,reason,value");
    expect(csvText).toContain("4,BAD,Bad avail,Invalid Avail,n/a");
  });

  it("classifies a valid unknown SKU as a new internal product, including zero stock", () => {
    const assessed = assessFbaStockFile(
      csv(["OPTIMUS,AB,NEW1,N,New seal,1.00,9,17", "OPTIMUS,AB,NEW0,W,Zero seal,1.00,9,0"]),
    );
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.invalidRows).toBe(0);
    const totals = planFbaSnapshot({
      rows: assessed.rows,
      existingProductKeys: new Set(),
      previousQty: new Map(),
      completeSnapshot: false,
      rowsRead: assessed.rowsRead,
      invalidRows: 0,
      duplicateSkus: 0,
      warnings: assessed.warnings,
    });
    expect(totals.newProducts).toBe(2);
    expect(totals.matchedExisting).toBe(0);
    expect(totals.productsWithStock).toBe(1);
    expect(totals.zeroStock).toBe(1);
    const lines = buildFbaPreviewProducts({
      rows: assessed.rows,
      existing: new Map(),
      previousQty: new Map(),
    });
    expect(lines.newProducts.map((row) => row.result)).toEqual(["Create internal product", "Create internal product"]);
    expect(lines.stockedProducts.map((row) => row.sku)).toEqual(["NEW1"]);
    expect(lines.newProducts[0]).toMatchObject({ groupCode: "AB", conditionCode: "N", importedFbaQty: 17 });
  });

  it("shows warehouse, current FBA, imported FBA, change, and total without treating total as sellable", () => {
    const assessed = assessFbaStockFile(csv(["OPTIMUS,SX,SSAMZ,O,Steel Seal,1.00,9,17"]));
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    const lines = buildFbaPreviewProducts({
      rows: assessed.rows,
      existing: new Map([
        ["SSAMZ", { description: "Steel Seal head gasket", warehouseQty: 120, groupCode: "SX", conditionCode: "O" }],
      ]),
      previousQty: new Map([["SSAMZ", 0]]),
    });
    expect(lines.stockedProducts).toEqual([
      {
        sku: "SSAMZ",
        description: "Steel Seal head gasket",
        warehouseQty: 120,
        currentFbaQty: 0,
        importedFbaQty: 17,
        change: 17,
        totalAfterImport: 137,
        groupCode: "SX",
        conditionCode: "O",
        result: "Update FBA quantity",
      },
    ]);
    expect(lines.newProducts).toEqual([]);
    expect(totalOwnedStock(120, 17)).toBe(137);
    expect(totalOwnedStock(120, 17)).not.toBe(120);
  });

  it("keeps a delimited CSV as a partial snapshot and does not zero absent FBA products", () => {
    const assessed = assessFbaStockFile(csv(["OPTIMUS,SX,KEEP,O,Keep,1.00,9,8"]));
    expect(assessed.ok).toBe(true);
    if (!assessed.ok) return;
    expect(assessed.completeSnapshot).toBe(false);
    expect(assessed.warnings[0]).toBe(FBA_PARTIAL_CSV_WARNING);
    const totals = planFbaSnapshot({
      rows: assessed.rows,
      existingProductKeys: new Set(["KEEP", "GONE"]),
      previousQty: new Map([
        ["KEEP", 8],
        ["GONE", 20],
      ]),
      completeSnapshot: assessed.completeSnapshot,
      rowsRead: assessed.rowsRead,
      invalidRows: assessed.invalidRows,
      duplicateSkus: assessed.duplicateSkus,
      warnings: assessed.warnings,
    });
    expect(totals.absentZeroed).toBe(0);
    expect(totals.unchangedQuantities).toBe(1);
    expect(fbaImportSafetyLines({
      matchedExisting: 6,
      newProducts: 2,
      productsWithStock: 1,
      invalidRows: 2,
      duplicateSkus: 0,
      completeSnapshot: false,
    })).toEqual([
      "6 existing products will receive the FBA quantity from this file.",
      "2 internal Autopart product records will be created. They will not become public catalogue products.",
      "1 product will have positive FBA stock.",
      "2 invalid rows will be skipped.",
      "Products missing from this file will keep their existing FBA quantity.",
      "Warehouse stock will not be changed.",
      "B2B sellable stock will not be changed.",
    ]);
  });
});
