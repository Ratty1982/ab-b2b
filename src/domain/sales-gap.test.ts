import { describe, expect, it } from "vitest";
import {
  activityFromAgg,
  classifyGapActivity,
  compactGapUrlSearch,
  emptyGapActivity,
  moneyMovement,
  parseGapUrlSearch,
  resolveGapPeriods,
  unitsMovement,
} from "@/domain/sales-gap";
import { accumulateLine, createLineAgg } from "@/domain/sales-intelligence";
import {
  previousEquivalentPeriod,
  samePeriodPreviousYear,
} from "@/domain/sales-history-period";

function act(
  lines: Array<{
    type: "INVOICE" | "CREDIT";
    ref: string;
    units: number;
    salesNet: string;
    date?: string;
  }>,
) {
  const agg = createLineAgg();
  for (const l of lines) {
    accumulateLine(
      agg,
      {
        documentType: l.type,
        documentReference: l.ref,
        units: l.units,
        salesNet: l.salesNet,
        sku: "X",
      },
      l.date ?? null,
    );
  }
  return activityFromAgg(agg);
}

describe("gap classification", () => {
  it("STOPPED when comparison has invoices and selected has none", () => {
    const comparison = act([{ type: "INVOICE", ref: "A", units: 20, salesNet: "200.00", date: "2025-06-01" }]);
    const selected = emptyGapActivity();
    expect(classifyGapActivity(selected, comparison)).toBe("STOPPED");
  });

  it("STOPPED when selected has credit-only (no invoice presence)", () => {
    const comparison = act([{ type: "INVOICE", ref: "A", units: 10, salesNet: "100.00", date: "2025-06-01" }]);
    const selected = act([{ type: "CREDIT", ref: "C", units: -2, salesNet: "-20.00", date: "2026-03-20" }]);
    expect(selected.hasInvoicePurchase).toBe(false);
    expect(classifyGapActivity(selected, comparison)).toBe("STOPPED");
    expect(selected.netUnits).toBe(-2);
  });

  it("NEW when selected has invoices and comparison has none", () => {
    const comparison = emptyGapActivity();
    const selected = act([{ type: "INVOICE", ref: "B", units: 12, salesNet: "120.00", date: "2026-03-01" }]);
    expect(classifyGapActivity(selected, comparison)).toBe("NEW");
  });

  it("DECREASED / INCREASED / UNCHANGED by invoice units", () => {
    const comparison = act([{ type: "INVOICE", ref: "A", units: 20, salesNet: "200.00" }]);
    const decreased = act([{ type: "INVOICE", ref: "B", units: 10, salesNet: "100.00" }]);
    const increased = act([{ type: "INVOICE", ref: "C", units: 30, salesNet: "300.00" }]);
    const unchanged = act([{ type: "INVOICE", ref: "D", units: 20, salesNet: "250.00" }]);
    expect(classifyGapActivity(decreased, comparison)).toBe("DECREASED");
    expect(classifyGapActivity(increased, comparison)).toBe("INCREASED");
    expect(classifyGapActivity(unchanged, comparison)).toBe("UNCHANGED");
  });

  it("credits do not create purchase presence", () => {
    const onlyCredit = act([{ type: "CREDIT", ref: "C", units: -5, salesNet: "-50.00" }]);
    expect(onlyCredit.hasInvoicePurchase).toBe(false);
    expect(classifyGapActivity(onlyCredit, onlyCredit)).toBeNull();
  });

  it("NET_SALES compareBy for financial movement", () => {
    const comparison = act([{ type: "INVOICE", ref: "A", units: 10, salesNet: "100.00" }]);
    const selected = act([{ type: "INVOICE", ref: "B", units: 10, salesNet: "80.00" }]);
    expect(classifyGapActivity(selected, comparison, "UNITS")).toBe("UNCHANGED");
    expect(classifyGapActivity(selected, comparison, "NET_SALES")).toBe("DECREASED");
  });
});

describe("samePeriodPreviousYear", () => {
  it("shifts calendar dates by one year", () => {
    expect(samePeriodPreviousYear({ from: "2026-01-01", to: "2026-06-30" })).toEqual({
      from: "2025-01-01",
      to: "2025-06-30",
    });
  });

  it("clamps leap day 29 Feb to 28 Feb in non-leap prior year", () => {
    expect(samePeriodPreviousYear({ from: "2024-02-29", to: "2024-02-29" })).toEqual({
      from: "2023-02-28",
      to: "2023-02-28",
    });
  });

  it("previous equivalent period is same length ending day before selected from", () => {
    expect(previousEquivalentPeriod({ from: "2026-01-01", to: "2026-06-30" })).toEqual({
      from: "2025-07-04",
      to: "2025-12-31",
    });
  });
});

describe("gap period resolution and URL state", () => {
  it("resolveGapPeriods supports PREVIOUS_YEAR and CUSTOM comparison", () => {
    const year = resolveGapPeriods({
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-06-30",
      compare: "PREVIOUS_YEAR",
    });
    expect(year.comparison).toEqual({ from: "2025-01-01", to: "2025-06-30" });

    const custom = resolveGapPeriods({
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
      compare: "CUSTOM",
      compareFrom: "2025-06-01",
      compareTo: "2025-06-30",
    });
    expect(custom.comparison).toEqual({ from: "2025-06-01", to: "2025-06-30" });
  });

  it("parse/compact gap URL search", () => {
    const parsed = parseGapUrlSearch({
      mode: "products",
      sku: "ABC",
      period: "YTD",
      compare: "PREVIOUS_YEAR",
      status: "STOPPED",
      page: "2",
    });
    expect(parsed.mode).toBe("products");
    expect(parsed.compare).toBe("PREVIOUS_YEAR");
    expect(parsed.page).toBe(2);
    expect(compactGapUrlSearch(parsed)).toMatchObject({
      mode: "products",
      sku: "ABC",
      period: "YTD",
      compare: "PREVIOUS_YEAR",
      status: "STOPPED",
      page: 2,
    });
  });

  it("zero comparison percent is null; signed money change preserved", () => {
    expect(moneyMovement(-200000n, 0n).percentChange).toBeNull();
    expect(moneyMovement(-200000n, 1_000_000n).change).toBe("-120.00");
    expect(unitsMovement(0, 0).percentChange).toBeNull();
  });
});
