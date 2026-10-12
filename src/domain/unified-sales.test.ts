import { describe, expect, it } from "vitest";
import {
  certifyUnifiedTotals,
  dayAfter,
  effectiveDating,
  isCountedStatus,
  parseIsoDay,
  purchaseFrequencyDays,
  purchaseFrequencyLabel,
  salesEnquirySurface,
  unifiedReasonLabel,
  unifiedSourceLabel,
  unifiedStatusLabel,
} from "@/domain/unified-sales";

describe("unified sales certification", () => {
  it("states a combined total only when nothing is unreconciled", () => {
    expect(certifyUnifiedTotals({ certifiedNet: "120.50", unreconciledLines: 0 })).toEqual({
      status: "COMPLETE",
      combinedNet: "120.50",
    });
    expect(certifyUnifiedTotals({ certifiedNet: "120.50", unreconciledLines: 1 })).toEqual({
      status: "INCOMPLETE",
      combinedNet: null,
    });
  });

  it("counts historical, dated and reconciled lines, never suppressed or unreconciled ones", () => {
    expect(isCountedStatus("HISTORICAL")).toBe(true);
    expect(isCountedStatus("DATED")).toBe(true);
    expect(isCountedStatus("MATCHED")).toBe(true);
    expect(isCountedStatus("DUPLICATE")).toBe(false);
    expect(isCountedStatus("UNRECONCILED")).toBe(false);
  });
});

describe("unified sales date filters", () => {
  it("never mixes undated rows into a date range", () => {
    expect(effectiveDating({ dating: "ALL", from: "2026-01-01", to: null })).toEqual({
      dating: "DATED",
      contradiction: false,
    });
    expect(effectiveDating({ dating: "UNDATED", from: null, to: "2026-01-31" })).toEqual({
      dating: "UNDATED",
      contradiction: true,
    });
    expect(effectiveDating({ dating: "UNDATED", from: null, to: null })).toEqual({
      dating: "UNDATED",
      contradiction: false,
    });
  });

  it("parses only genuine ISO days and gives an exclusive upper bound", () => {
    expect(parseIsoDay("2026-02-30")).toBeNull();
    expect(parseIsoDay("01/02/2026")).toBeNull();
    expect(parseIsoDay(null)).toBeNull();
    const day = parseIsoDay("2026-03-31")!;
    expect(dayAfter(day).toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("purchase frequency", () => {
  it("needs two dated invoices on different days", () => {
    expect(
      purchaseFrequencyDays({
        datedInvoiceCount: 1,
        firstDated: "2026-01-01",
        lastDated: "2026-01-01",
      }),
    ).toBeNull();
    expect(
      purchaseFrequencyDays({ datedInvoiceCount: 2, firstDated: null, lastDated: "2026-01-01" }),
    ).toBeNull();
    expect(
      purchaseFrequencyDays({
        datedInvoiceCount: 2,
        firstDated: "2026-01-01",
        lastDated: "2026-01-01",
      }),
    ).toBeNull();
  });

  it("averages the gap between dated invoices", () => {
    expect(
      purchaseFrequencyDays({
        datedInvoiceCount: 3,
        firstDated: "2026-01-01",
        lastDated: "2026-01-31",
      }),
    ).toBe(15);
    expect(purchaseFrequencyLabel(null)).toBe("Not enough dated invoices");
    expect(purchaseFrequencyLabel(7)).toBe("About every 7 days");
    expect(purchaseFrequencyLabel(28)).toBe("About every 4 weeks");
    expect(purchaseFrequencyLabel(90)).toBe("About every 3 months");
  });
});

describe("labels", () => {
  it("explains sources, statuses and reasons in plain language", () => {
    expect(unifiedSourceLabel("HISTORICAL_561L")).toBe("561L history (undated)");
    expect(unifiedSourceLabel("TRM21QC_FEED")).toBe("TRM21QC feed");
    expect(unifiedStatusLabel("DUPLICATE")).toBe("Duplicate suppressed");
    expect(unifiedReasonLabel("REPEATED_SOURCE_ROW")).toMatch(/not counted/);
    expect(unifiedReasonLabel("DOCUMENT_GOODS_MISMATCH")).toMatch(/not added/);
    expect(unifiedReasonLabel(null)).toBeNull();
  });
});

describe("sales enquiry surface", () => {
  it("keeps a selected customer or product on one unified screen", () => {
    expect(
      salesEnquirySurface({ mode: "customers", companyId: "c1", customerGroupId: null, sku: null }),
    ).toBe("unified-customer");
    expect(salesEnquirySurface({ mode: "products", sku: "BRAKE" })).toBe("unified-product");
    expect(
      salesEnquirySurface({ mode: "customers", customerGroupId: "g1", companyId: null }),
    ).toBe("dated-group");
    expect(salesEnquirySurface({ mode: "customers" })).toBe("picker");
  });
});
