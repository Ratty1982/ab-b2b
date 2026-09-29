import { describe, expect, it } from "vitest";
import {
  accumulateLine,
  buildCsv,
  compareSalesTotals,
  createLineAgg,
  emptySalesTotals,
  lineAggPurchaseCount,
  percentChange,
  percentChangeMinor,
  resolveEnquiryComparisonPeriod,
  resolveEnquiryPrimaryPeriod,
  totalsToDto,
} from "@/domain/sales-intelligence";

describe("sales-intelligence domain", () => {
  it("accumulates invoice and credit lines with purchase-transaction semantics", () => {
    const agg = createLineAgg();
    accumulateLine(
      agg,
      {
        documentType: "INVOICE",
        documentReference: "SS1",
        units: 10,
        salesNet: "100.00",
        sku: "A",
        documentDate: new Date("2026-03-10T12:00:00.000Z"),
      },
      "2026-03-10",
    );
    accumulateLine(
      agg,
      {
        documentType: "INVOICE",
        documentReference: "SS1",
        units: 2,
        salesNet: "20.00",
        sku: "A",
        documentDate: new Date("2026-03-10T12:00:00.000Z"),
      },
      "2026-03-10",
    );
    accumulateLine(
      agg,
      {
        documentType: "CREDIT",
        documentReference: "SC1",
        units: -1,
        salesNet: "-10.00",
        sku: "A",
        documentDate: new Date("2026-03-15T12:00:00.000Z"),
      },
      "2026-03-15",
    );
    expect(lineAggPurchaseCount(agg)).toBe(1);
    expect(agg.units).toBe(11);
    expect(totalsToDto({
      ...emptySalesTotals(),
      invoiceSalesMinor: agg.invoiceSalesMinor,
      creditsMinor: agg.creditsMinor,
      netSalesMinor: agg.netSalesMinor,
      units: agg.units,
      purchaseTransactions: lineAggPurchaseCount(agg),
      productsPurchased: 1,
      customers: 1,
    })).toMatchObject({
      invoiceSales: "120.00",
      credits: "-10.00",
      netSales: "110.00",
      units: 11,
      purchaseTransactions: 1,
    });
  });

  it("handles comparison base zero without Infinity", () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChangeMinor(10000n, 0n)).toBeNull();
    const cmp = compareSalesTotals(
      { from: "2026-01-01", to: "2026-01-31" },
      { from: "2025-01-01", to: "2025-01-31" },
      { ...emptySalesTotals(), netSalesMinor: 50000n, units: 5, purchaseTransactions: 1, productsPurchased: 1, customers: 1 },
      emptySalesTotals(),
    );
    expect(cmp.netSales.percentChange).toBeNull();
    expect(cmp.netSales.difference).toBe("5.00");
  });

  it("resolves previous and custom comparison periods", () => {
    const primary = resolveEnquiryPrimaryPeriod({
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-06-30",
      today: "2026-09-29",
    });
    expect(resolveEnquiryComparisonPeriod({ compare: "OFF", primary })).toBeNull();
    const prev = resolveEnquiryComparisonPeriod({ compare: "PREVIOUS", primary });
    expect(prev).toEqual({ from: "2025-07-04", to: "2025-12-31" });
    expect(
      resolveEnquiryComparisonPeriod({
        compare: "CUSTOM",
        primary,
        compareFrom: "2025-01-01",
        compareTo: "2025-06-30",
      }),
    ).toEqual({ from: "2025-01-01", to: "2025-06-30" });
  });

  it("builds CSV with escaped fields", () => {
    const csv = buildCsv(["A", "B"], [["x,y", 'he said "hi"']]);
    expect(csv).toBe('A,B\n"x,y","he said ""hi"""\n');
  });
});
