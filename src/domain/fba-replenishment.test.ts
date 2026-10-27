import { describe, expect, it } from "vitest";
import { parseAutopart504Report } from "@/domain/autopart-504";
import { buildAutopart504DayEndFixture } from "@/domain/autopart-504-dayend-fixture";
import { parseAutopartTrm21qcReport } from "@/domain/autopart-trm21qc";
import { parseFbaAmazonSalesCsv } from "@/domain/fba-amazon-sales-csv";
import {
  buildOinReplenishmentBatch,
  eligibleFbaInboundQty,
  amazonWindowSupported,
  isOinReplenishmentReference,
  projectFbaShipment,
  provisionalReplenishmentWeekly,
  roundUpToCaseMultiple,
} from "@/domain/fba-replenishment";

const base = {
  fbaAvailable: 20,
  fbaStockKnown: true,
  fbaStockStale: false,
  studleyAvailable: 100,
  confirmedInboundQty: 0,
  salesSupported: true,
  amazonNetUnits30: 30,
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
      "sku,date,units_sold,document\nPM1,2026-10-01,4,OIN025730\n",
    );
    expect(rejected.ok).toBe(false);
    const report = parseFbaAmazonSalesCsv(buildAutopart504DayEndFixture());
    expect(report.ok).toBe(false);
    const sales = parseFbaAmazonSalesCsv(
      "sku,date,units_sold,units_credited\nPM1,2026-10-01,4,1\nPM1,01/10/2026,2,0\n",
    );
    expect(sales.ok).toBe(true);
    if (sales.ok) {
      expect(sales.rows).toHaveLength(1);
      expect(sales.rows[0]?.unitsSold).toBe(6);
      expect(sales.rows[0]?.unitsCredited).toBe(1);
      expect(sales.mergedDuplicateDays).toBe(1);
    }
  });
});

describe("FBA shipment forecast", () => {
  it("does not invent a weekly rate when Amazon sales are missing", () => {
    const result = projectFbaShipment({ ...base, salesSupported: false, amazonNetUnits30: 90 });
    expect(result.recommendation).toBe("INSUFFICIENT_DATA");
    expect(result.weeklyRate).toBeNull();
    expect(result.suggestedSendQty).toBeNull();
  });

  it("does not treat stale OPTIMUS stock as verified sellable inventory", () => {
    const result = projectFbaShipment({ ...base, fbaStockStale: true, fbaAvailable: 0 });
    expect(result.recommendation).toBe("INSUFFICIENT_DATA");
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
    expect(result.dispatchableQty).toBe(1);
    expect(result.studleyShortfallQty).toBe(result.suggestedSendQty! - 1);
  });

  it("keeps OIN cadence separate from the shipment quantity", () => {
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
        coverageFrom: "2025-01-01",
        coverageTo: "2026-10-26",
        windowFrom: "2026-09-27",
        windowTo: "2026-10-27",
        today: "2026-10-27",
      }),
    ).toBe(true);
    expect(
      amazonWindowSupported({
        completeDaily: false,
        coverageFrom: "2025-01-01",
        coverageTo: "2026-10-27",
        windowFrom: "2026-09-27",
        windowTo: "2026-10-27",
        today: "2026-10-27",
      }),
    ).toBe(false);
  });

  it("rounds zero and exact multiples without adding a case", () => {
    expect(roundUpToCaseMultiple(0, 4)).toBe(0);
    expect(roundUpToCaseMultiple(8, 4)).toBe(8);
    expect(roundUpToCaseMultiple(9, 4)).toBe(12);
  });
});
