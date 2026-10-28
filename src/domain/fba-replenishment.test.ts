import { describe, expect, it } from "vitest";
import { parseAutopart504Report } from "@/domain/autopart-504";
import { buildAutopart504DayEndFixture } from "@/domain/autopart-504-dayend-fixture";
import { parseAutopartTrm21qcReport } from "@/domain/autopart-trm21qc";
import { parseFbaAmazonSalesCsv } from "@/domain/fba-amazon-sales-csv";
import {
  amazonExtractIsComplete,
  amazonWindowSupported,
  averageWeeklySales,
  buildOinReplenishmentBatch,
  eligibleFbaInboundQty,
  isOinReplenishmentReference,
  projectFbaShipment,
  provisionalReplenishmentWeekly,
  RETAILA_OIN_PROVEN_AS_FBA_UK,
  selectFbaDemand,
  reconcileOinDocumentLines,
  rejectUnprovenFbaSales,
  rejectUnprovenUkMarketplace,
  roundDownToCaseMultiple,
  roundUpToCaseMultiple,
} from "@/domain/fba-replenishment";

function fbaSales(input: {
  from: string;
  to: string;
  extracted: string;
  complete?: string;
  zeros?: string;
  scope?: string;
  marketplaceScope?: string;
  header?: string;
  rows: string[];
}): string {
  const metaHeader = [
    "coverage_from",
    "coverage_to",
    "extracted_on",
    "fulfilment_scope",
    "complete",
    "zeros_omitted",
  ];
  const metaValue = [
    input.from,
    input.to,
    input.extracted,
    input.scope ?? "FBA",
    input.complete ?? "yes",
    input.zeros ?? "no",
  ];
  if (input.marketplaceScope !== undefined) {
    metaHeader.push("marketplace_scope");
    metaValue.push(input.marketplaceScope);
  }
  return [
    metaHeader.join(","),
    metaValue.join(","),
    input.header ?? "sku,date,units_sold,units_credited,marketplace,fulfilment_channel",
    ...input.rows,
  ].join("\n");
}

const base = {
  fbaAvailable: 20,
  fbaStockKnown: true,
  fbaStockStale: false,
  studleyAvailable: 100,
  confirmedInboundQty: 0,
  salesSupported: true,
  demandNetUnits30: 30,
  demandSource: "AMAZON_UK_FBA_CSV" as const,
  leadTimeDays: 14,
  targetCoverWeeks: 4,
  safetyStockQty: 2,
  caseMultiple: 4,
  overstockCoverWeeks: 16,
  today: "2026-10-27",
};

describe("OIN identification", () => {
  it("uses the parsed 9-character document, not the flush date digits", () => {
    const parsed = parseAutopart504Report(buildAutopart504DayEndFixture());
    const oin = parsed.invoiceRows.filter((row) => isOinReplenishmentReference(row.documentNumber));
    expect(oin.map((row) => row.documentNumber)).toEqual(["OIN025730"]);
    expect(isOinReplenishmentReference("OIN02573006")).toBe(true);
    expect(isOinReplenishmentReference("SS306229")).toBe(false);
    expect(isOinReplenishmentReference("JOIN100")).toBe(false);
  });

  it("keeps OIN out of Amazon sales files and dedupes a repeated day", () => {
    const rejected = parseFbaAmazonSalesCsv(
      fbaSales({
        from: "2026-10-01",
        to: "2026-10-01",
        extracted: "2026-10-01",
        header: "sku,date,units_sold,document,fulfilment_channel",
        rows: ["PM1,2026-10-01,4,OIN025730,AFN"],
      }),
    );
    expect(rejected.ok).toBe(false);
    const report = parseFbaAmazonSalesCsv(buildAutopart504DayEndFixture());
    expect(report.ok).toBe(false);
    const sales = parseFbaAmazonSalesCsv(
      fbaSales({
        from: "2026-10-01",
        to: "2026-10-01",
        extracted: "2026-10-01",
        rows: ["PM1,2026-10-01,4,1,AMAZON_UK,AFN", "PM1,01/10/2026,2,0,AMAZON_UK,FBA"],
      }),
    );
    expect(sales.ok).toBe(true);
    if (sales.ok) {
      expect(sales.rows).toHaveLength(1);
      expect(sales.rows[0]?.unitsSold).toBe(6);
      expect(sales.rows[0]?.unitsCredited).toBe(1);
      expect(sales.mergedDuplicateDays).toBe(1);
      expect(sales.coverageFrom).toBe("2026-10-01");
    }
  });

  it("rejects MFN and FBM rows so they cannot become FBA demand", () => {
    const mfn = parseFbaAmazonSalesCsv(
      fbaSales({
        from: "2026-10-01",
        to: "2026-10-01",
        extracted: "2026-10-01",
        rows: ["PM1,2026-10-01,4,0,AMAZON_UK,MFN", "PM2,2026-10-01,9,0,AMAZON_UK,AFN"],
      }),
    );
    expect(mfn.ok).toBe(false);
    const fbm = parseFbaAmazonSalesCsv(
      fbaSales({
        from: "2026-10-01",
        to: "2026-10-01",
        extracted: "2026-10-01",
        rows: ["PM1,2026-10-01,4,0,AMAZON_UK,FBM"],
      }),
    );
    expect(fbm.ok).toBe(false);
    const bare = parseFbaAmazonSalesCsv("sku,date,units_sold\nPM1,2026-10-01,4\n");
    expect(bare.ok).toBe(false);
    expect(rejectUnprovenFbaSales({ normalizedFbaOnly: true, fbaOnlyAttested: false })).toMatch(
      /FBA/,
    );
    expect(rejectUnprovenFbaSales({ normalizedFbaOnly: true, fbaOnlyAttested: true })).toBeNull();
  });

  it("keeps Amazon UK demand and rejects a missing or German marketplace", () => {
    const uk = parseFbaAmazonSalesCsv(
      fbaSales({
        from: "2026-10-01",
        to: "2026-10-01",
        extracted: "2026-10-01",
        rows: ["PM1,2026-10-01,4,0,AMAZON_UK,AFN", "PM2,2026-10-01,1,0,Amazon.co.uk,AFN"],
      }),
    );
    expect(uk.ok).toBe(true);
    if (uk.ok) {
      expect(uk.rows.every((row) => row.marketplace === "AMAZON_UK")).toBe(true);
      expect(uk.normalizedUkOnly).toBe(false);
      expect(uk.marketplaceScope).toBe("AMAZON_UK");
    }
    const missing = parseFbaAmazonSalesCsv(
      fbaSales({
        from: "2026-10-01",
        to: "2026-10-01",
        extracted: "2026-10-01",
        header: "sku,date,units_sold,units_credited,fulfilment_channel",
        rows: ["PM1,2026-10-01,4,0,AFN"],
      }),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/not treated as Amazon UK/);
    const blank = parseFbaAmazonSalesCsv(
      fbaSales({
        from: "2026-10-01",
        to: "2026-10-01",
        extracted: "2026-10-01",
        rows: ["PM1,2026-10-01,4,0,,AFN"],
      }),
    );
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.error).toMatch(/blank/);
    const de = parseFbaAmazonSalesCsv(
      fbaSales({
        from: "2026-10-01",
        to: "2026-10-01",
        extracted: "2026-10-01",
        rows: ["PM1,2026-10-01,4,0,AMAZON_UK,AFN", "PM2,2026-10-01,9,0,AMAZON_DE,AFN"],
      }),
    );
    expect(de.ok).toBe(false);
    if (!de.ok) expect(de.error).toMatch(/AMAZON_DE/);
    const deScope = parseFbaAmazonSalesCsv(
      fbaSales({
        from: "2026-10-01",
        to: "2026-10-01",
        extracted: "2026-10-01",
        marketplaceScope: "AMAZON_DE",
        header: "sku,date,units_sold,fulfilment_channel",
        rows: ["PM1,2026-10-01,4,AFN"],
      }),
    );
    expect(deScope.ok).toBe(false);
    if (!deScope.ok) expect(deScope.error).toMatch(/AMAZON_DE/);
    const normalized = parseFbaAmazonSalesCsv(
      fbaSales({
        from: "2026-10-01",
        to: "2026-10-01",
        extracted: "2026-10-01",
        marketplaceScope: "AMAZON_UK",
        header: "sku,date,units_sold,fulfilment_channel",
        rows: ["PM1,2026-10-01,4,AFN"],
      }),
    );
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.normalizedUkOnly).toBe(true);
      expect(normalized.rows[0]?.marketplace).toBe("AMAZON_UK");
    }
    expect(
      rejectUnprovenUkMarketplace({ normalizedUkOnly: true, ukMarketplaceAttested: false }),
    ).toMatch(/Amazon UK/);
    expect(
      rejectUnprovenUkMarketplace({ normalizedUkOnly: true, ukMarketplaceAttested: true }),
    ).toBeNull();
    expect(
      rejectUnprovenUkMarketplace({ normalizedUkOnly: false, ukMarketplaceAttested: false }),
    ).toBeNull();
  });

  it("does not treat endpoint sales as a complete 30-day extract", () => {
    const sparse = parseFbaAmazonSalesCsv(
      fbaSales({
        from: "2026-09-28",
        to: "2026-10-27",
        extracted: "2026-10-27",
        complete: "yes",
        zeros: "no",
        rows: ["PM1,2026-09-28,2,0,AMAZON_UK,AFN", "PM1,2026-10-27,2,0,AMAZON_UK,AFN"],
      }),
    );
    expect(sparse.ok).toBe(true);
    if (!sparse.ok) return;
    expect(sparse.coverageHasGaps).toBe(true);
    expect(sparse.coverageFrom).toBe("2026-09-28");
    expect(sparse.coverageTo).toBe("2026-10-27");
    expect(
      amazonExtractIsComplete({
        declaredComplete: sparse.declaredComplete,
        operatorAttestedComplete: true,
        fbaOnlyAttested: true,
        fulfilmentScope: sparse.fulfilmentScope,
        coverageHasGaps: sparse.coverageHasGaps,
        zerosOmitted: sparse.zerosOmitted,
      }),
    ).toBe(false);
    const attestedGaps = amazonExtractIsComplete({
      declaredComplete: true,
      operatorAttestedComplete: true,
      fbaOnlyAttested: true,
      fulfilmentScope: "FBA",
      coverageHasGaps: true,
      zerosOmitted: true,
    });
    expect(attestedGaps).toBe(true);
  });
});

describe("FBA shipment forecast", () => {
  it("does not invent a weekly rate when Amazon sales are missing", () => {
    const result = projectFbaShipment({
      ...base,
      salesSupported: false,
      demandNetUnits30: 90,
      demandSource: "NONE",
    });
    expect(result.recommendation).toBe("INSUFFICIENT_DATA");
    expect(result.blocker).toBe("DEMAND_SOURCE_UNVERIFIED");
    expect(result.weeklyRate).toBeNull();
    expect(result.suggestedSendQty).toBeNull();
  });

  it("does not treat stale OPTIMUS stock as verified sellable inventory", () => {
    const result = projectFbaShipment({ ...base, fbaStockStale: true, fbaAvailable: 0 });
    expect(result.recommendation).toBe("INSUFFICIENT_DATA");
    expect(result.blocker).toBe("STALE_FBA_STOCK");
    expect(result.fbaStockVerified).toBe(false);
    expect(result.suggestedSendQty).toBeNull();
  });

  it("subtracts only confirmed inbound and rounds up to the case multiple", () => {
    expect(
      eligibleFbaInboundQty([
        { status: "PLANNED", qty: 40 },
        { status: "CONFIRMED_IN_TRANSIT", qty: 8 },
        { status: "RECEIVED", qty: 50 },
        { status: "CANCELLED", qty: 12 },
      ]),
    ).toBe(8);
    const result = projectFbaShipment({
      ...base,
      confirmedInboundQty: 8,
      fbaAvailable: 4,
      caseMultiple: 6,
    });
    expect(result.weeklyRate).toBe(7);
    expect(result.suggestedSendQty).toBeGreaterThan(0);
    expect(result.suggestedSendQty! % 6).toBe(0);
    expect(result.rawSendQty).toBeLessThanOrEqual(result.suggestedSendQty!);
    const covered = projectFbaShipment({ ...base, confirmedInboundQty: 500, fbaAvailable: 200 });
    expect(covered.suggestedSendQty).toBe(0);
    expect(covered.recommendation).toBe("OVERSTOCKED");
  });

  it("shows a Studley shortfall instead of dispatching stock that is not there", () => {
    const result = projectFbaShipment({
      ...base,
      studleyAvailable: 1,
      fbaAvailable: 0,
      confirmedInboundQty: 0,
    });
    expect(result.suggestedSendQty).toBeGreaterThan(1);
    expect(result.dispatchableQty).toBe(0);
    expect(result.looseStudleyQty).toBe(1);
    expect(result.studleyShortfallQty).toBe(result.suggestedSendQty! - 1);
  });

  it("does not dispatch a partial case when Studley is below one case", () => {
    const result = projectFbaShipment({
      ...base,
      leadTimeDays: 14,
      targetCoverWeeks: 6,
      safetyStockQty: 0,
      fbaAvailable: 44,
      confirmedInboundQty: 0,
      caseMultiple: 12,
      studleyAvailable: 7,
    });
    expect(result.suggestedSendQty).toBe(12);
    expect(result.dispatchableQty).toBe(0);
    expect(result.looseStudleyQty).toBe(7);
    expect(result.studleyShortfallQty).toBe(5);
  });

  it("rounds a Studley remainder down and keeps the buy shortfall", () => {
    const result = projectFbaShipment({
      ...base,
      leadTimeDays: 14,
      targetCoverWeeks: 6,
      safetyStockQty: 0,
      fbaAvailable: 44,
      confirmedInboundQty: 0,
      caseMultiple: 4,
      studleyAvailable: 7,
    });
    expect(result.suggestedSendQty).toBe(12);
    expect(result.dispatchableQty).toBe(4);
    expect(result.looseStudleyQty).toBe(3);
    expect(result.studleyShortfallQty).toBe(5);
    expect(roundDownToCaseMultiple(7, 12)).toBe(0);
    expect(roundDownToCaseMultiple(7, 4)).toBe(4);
  });

  it("uses verified 30-day demand for the worked replenishment example", () => {
    const result = projectFbaShipment({
      ...base,
      fbaAvailable: 50,
      studleyAvailable: 70,
      confirmedInboundQty: 10,
      salesSupported: true,
      demandNetUnits30: 90,
      demandSource: "AMAZON_UK_FBA_CSV",
      leadTimeDays: 14,
      targetCoverWeeks: 6,
      safetyStockQty: 0,
      caseMultiple: 1,
      overstockCoverWeeks: 16,
    });
    expect(averageWeeklySales(90)).toBe(21);
    expect(result.weeklyRate).toBe(21);
    expect(result.dailyRate).toBe(3);
    expect(result.projectedRequiredQty).toBe(168);
    expect(result.suggestedSendQty).toBe(108);
    expect(result.dispatchableQty).toBe(70);
    expect(result.studleyShortfallQty).toBe(38);
    expect(result.recommendation).not.toBe("INSUFFICIENT_DATA");
    expect(result.planningEstimate).toBe(false);
    expect(result.coverBasis).toBe("verified_amazon");
  });

  it("does not treat RETAILA invoices as proven FBA UK demand or add them to an Amazon extract", () => {
    expect(RETAILA_OIN_PROVEN_AS_FBA_UK).toBe(false);
    const blocked = selectFbaDemand({
      plan: "fba",
      amazonWindowSupported: false,
      amazonNetUnits30: null,
      retailaNetUnits30: 90,
      retailaPlanningApproved: false,
      retailaReportingComplete: false,
      retailaInvoicesAvailable: true,
    });
    expect(blocked.source).toBe("NONE");
    expect(blocked.netUnits30).toBeNull();
    expect(blocked.blocker).toBe("DEMAND_SOURCE_UNVERIFIED");
    const fromOin = projectFbaShipment({
      ...base,
      salesSupported: blocked.salesSupported,
      demandNetUnits30: blocked.netUnits30,
      demandSource: blocked.source,
      fbaAvailable: 50,
      confirmedInboundQty: 10,
      studleyAvailable: 70,
    });
    expect(fromOin.recommendation).toBe("INSUFFICIENT_DATA");
    expect(fromOin.suggestedSendQty).toBeNull();
    const chosen = selectFbaDemand({
      plan: "fba",
      amazonWindowSupported: true,
      amazonNetUnits30: 10,
      retailaNetUnits30: 90,
      retailaPlanningApproved: false,
      retailaReportingComplete: false,
      retailaInvoicesAvailable: true,
    });
    expect(chosen.source).toBe("AMAZON_UK_FBA_CSV");
    expect(chosen.netUnits30).toBe(10);
    expect(chosen.reason).toMatch(/not added/);
  });

  it("uses approved RETAILA sales only as an explicit planning proxy", () => {
    const locked = selectFbaDemand({
      plan: "retaila",
      amazonWindowSupported: false,
      amazonNetUnits30: null,
      retailaNetUnits30: 90,
      retailaPlanningApproved: false,
      retailaReportingComplete: true,
      retailaInvoicesAvailable: true,
    });
    expect(locked.source).toBe("NONE");
    expect(locked.blocker).toBe("PLANNING_NOT_APPROVED");
    const incomplete = selectFbaDemand({
      plan: "retaila",
      amazonWindowSupported: false,
      amazonNetUnits30: null,
      retailaNetUnits30: 90,
      retailaPlanningApproved: true,
      retailaReportingComplete: false,
      retailaReportingReason: "Missing import days",
      retailaInvoicesAvailable: true,
    });
    expect(incomplete.blocker).toBe("RETAILA_REPORTING_INCOMPLETE");
    expect(incomplete.salesSupported).toBe(false);
    const failedInvoices = selectFbaDemand({
      plan: "retaila",
      amazonWindowSupported: false,
      amazonNetUnits30: null,
      retailaNetUnits30: null,
      retailaPlanningApproved: true,
      retailaReportingComplete: true,
      retailaInvoicesAvailable: false,
    });
    expect(failedInvoices.source).toBe("NONE");
    expect(failedInvoices.netUnits30).toBeNull();
    expect(failedInvoices.blocker).toBe("RETAILA_SALES_UNKNOWN");
    expect(failedInvoices.reason).toMatch(/not treated as zero/i);
    const zeroSales = selectFbaDemand({
      plan: "retaila",
      amazonWindowSupported: false,
      amazonNetUnits30: null,
      retailaNetUnits30: null,
      retailaPlanningApproved: true,
      retailaReportingComplete: true,
      retailaInvoicesAvailable: true,
    });
    expect(zeroSales.source).toBe("RETAILA_PLANNING");
    expect(zeroSales.netUnits30).toBe(0);
    expect(zeroSales.blocker).toBeNull();
    const proxy = selectFbaDemand({
      plan: "retaila",
      amazonWindowSupported: true,
      amazonNetUnits30: 10,
      retailaNetUnits30: 90,
      retailaPlanningApproved: true,
      retailaReportingComplete: true,
      retailaInvoicesAvailable: true,
    });
    expect(proxy.source).toBe("RETAILA_PLANNING");
    expect(proxy.netUnits30).toBe(90);
    const planned = projectFbaShipment({
      ...base,
      salesSupported: true,
      demandNetUnits30: 90,
      demandSource: "RETAILA_PLANNING",
      fbaAvailable: 50,
      confirmedInboundQty: 10,
      studleyAvailable: 70,
      leadTimeDays: 14,
      targetCoverWeeks: 6,
      safetyStockQty: 0,
      caseMultiple: 1,
    });
    expect(planned.planningEstimate).toBe(true);
    expect(planned.coverBasis).toBe("retaila_planning");
    expect(planned.suggestedSendQty).toBe(108);
    expect(planned.confidence).toBe("LOW");
    expect(planned.reason).toMatch(/planning estimate|RETAILA/i);
  });

  it("keeps OIN customer sales separate from the shipment quantity", () => {
    expect(provisionalReplenishmentWeekly(14, 7)).toBe(14);
    const trm = parseAutopartTrm21qcReport(
      `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
AMZ,RET,OIN100001,01/10/2026,PM1,Disc,2,40.00,10.00,30.00,50
AMZ,RET,SS100001,01/10/2026,PM9,Other,4,40.00,10.00,30.00,50
AMZ,RET,OIN999999,01/10/2026,PM2,Orphan,1,5.00,1.00,4.00,50
`,
    ).rows;
    const first = trm.find((row) => row.documentNumber === "OIN100001")!;
    const batch = buildOinReplenishmentBatch({
      headers: parseAutopart504Report(
        `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,OIN100001,01/10/2026,10:00,Retail Amazon,30.00,6.00,36.00,WR,AMZ
ACCOUNT,OIN100001,01/10/2026,10:05,Retail Amazon,30.00,6.00,36.00,WR,AMZ
ACCOUNT,SS100001,01/10/2026,11:00,Motor Factor,10.00,2.00,12.00,WR,PO1
`,
      ).rows,
      lines: [...trm, { ...first }],
    });
    expect(batch.documents.map((doc) => doc.documentReference)).toEqual(["OIN100001"]);
    expect(batch.documents[0]?.lines).toHaveLength(1);
    expect(batch.exceptions.some((item) => item.code === "DUPLICATE_OIN")).toBe(true);
    expect(batch.exceptions.some((item) => item.code === "DUPLICATE_LINE")).toBe(true);
    expect(batch.exceptions.some((item) => item.code === "ORPHAN_TRM_LINE")).toBe(true);
    expect(batch.exceptions.some((item) => item.code === "MISMATCHED_INVOICE_VALUE")).toBe(true);
    expect(batch.documents[0]?.lines.some((line) => line.sku === "PM9")).toBe(false);
  });

  it("accepts a complete extract that ends on the last closed day", () => {
    expect(
      amazonWindowSupported({
        completeDaily: true,
        fulfilmentScope: "FBA",
        marketplace: "AMAZON_UK",
        coverageFrom: "2025-01-01",
        coverageTo: "2026-10-26",
        extractedOn: "2026-10-26",
        windowFrom: "2026-09-27",
        windowTo: "2026-10-27",
        today: "2026-10-27",
      }),
    ).toBe(true);
    expect(
      amazonWindowSupported({
        completeDaily: false,
        fulfilmentScope: "FBA",
        marketplace: "AMAZON_UK",
        coverageFrom: "2025-01-01",
        coverageTo: "2026-10-27",
        extractedOn: "2026-10-27",
        windowFrom: "2026-09-27",
        windowTo: "2026-10-27",
        today: "2026-10-27",
      }),
    ).toBe(false);
    expect(
      amazonWindowSupported({
        completeDaily: true,
        fulfilmentScope: "MFN",
        marketplace: "AMAZON_UK",
        coverageFrom: "2025-01-01",
        coverageTo: "2026-10-27",
        extractedOn: "2026-10-27",
        windowFrom: "2026-09-27",
        windowTo: "2026-10-27",
        today: "2026-10-27",
      }),
    ).toBe(false);
    expect(
      amazonWindowSupported({
        completeDaily: true,
        fulfilmentScope: "FBA",
        marketplace: "AMAZON_DE",
        coverageFrom: "2025-01-01",
        coverageTo: "2026-10-27",
        extractedOn: "2026-10-27",
        windowFrom: "2026-09-27",
        windowTo: "2026-10-27",
        today: "2026-10-27",
      }),
    ).toBe(false);
  });

  it("replaces an amended OIN line and leaves an unrelated line", () => {
    const plan = reconcileOinDocumentLines({
      documentReference: "OIN100001",
      existing: [
        { id: "old", lineKey: "fp-2", matchKey: "PM1" },
        { id: "keep", lineKey: "fp-b", matchKey: "PM2" },
      ],
      incoming: [
        {
          lineKey: "fp-3",
          matchKey: "PM1",
          sku: "PM1",
          description: "Disc",
          qty: "3",
          salesNet: "30.00",
        },
      ],
    });
    expect(plan.supersedeIds).toEqual(["old"]);
    expect(plan.upsert.map((line) => line.qty)).toEqual(["3"]);
    expect(plan.exceptions).toHaveLength(0);
    const ambiguous = reconcileOinDocumentLines({
      documentReference: "OIN100001",
      existing: [{ id: "old", lineKey: "fp-2", matchKey: "PM1" }],
      incoming: [
        {
          lineKey: "fp-2",
          matchKey: "PM1",
          sku: "PM1",
          description: null,
          qty: "2",
          salesNet: "20",
        },
        {
          lineKey: "fp-9",
          matchKey: "PM1",
          sku: "PM1",
          description: null,
          qty: "9",
          salesNet: "90",
        },
      ],
    });
    expect(ambiguous.supersedeIds).toEqual([]);
    expect(ambiguous.upsert).toEqual([]);
    expect(ambiguous.exceptions.some((item) => item.code === "AMBIGUOUS_LINE")).toBe(true);
  });

  it("rounds zero and exact multiples without adding a case", () => {
    expect(roundUpToCaseMultiple(0, 4)).toBe(0);
    expect(roundUpToCaseMultiple(8, 4)).toBe(8);
    expect(roundUpToCaseMultiple(9, 4)).toBe(12);
  });
});
