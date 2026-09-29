import { describe, expect, it } from "vitest";
import {
  applyRebateEligibilityRules,
  compactRebateUrlSearch,
  countDocumentTypes,
  normalizeRebatePeriodPreset,
  parseRebateUrlSearch,
  rebatePeriodCsvCells,
  resolveRebateComparisonPeriod,
  resolveRebatePrimaryPeriod,
  RebatePeriodValidationError,
  toRebatePeriodDto,
} from "@/domain/sales-rebate";
import { ALL_DATED_HISTORY_QUERY_RANGE } from "@/domain/sales-history-period";
import { formatPeriodRangeLong } from "@/domain/sales-intelligence-ux";

describe("sales-rebate domain", () => {
  it("resolves custom primary period inclusively", () => {
    const r = resolveRebatePrimaryPeriod({
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
      today: "2026-09-29",
    });
    expect(r.unbounded).toBe(false);
    expect(r.from).toBe("2026-01-01");
    expect(r.to).toBe("2026-01-31");
    expect(r.queryRange).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(r.label).toBe("1 Jan 2026 – 31 Jan 2026");
  });

  it("resolves this quarter from London today", () => {
    const r = resolveRebatePrimaryPeriod({
      period: "THIS_QUARTER",
      today: "2026-09-29",
    });
    expect(r.from).toBe("2026-07-01");
    expect(r.to).toBe("2026-09-30");
  });

  it("All history has no public date bounds and keeps dated-history query range", () => {
    const r = resolveRebatePrimaryPeriod({ period: "ALL", today: "2026-09-29" });
    expect(r.unbounded).toBe(true);
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
    expect(r.label).toBe("All history");
    expect(r.hint).toMatch(/dated/i);
    expect(r.queryRange).toEqual(ALL_DATED_HISTORY_QUERY_RANGE);
    const dto = toRebatePeriodDto(r);
    expect(dto.from).toBeNull();
    expect(dto.to).toBeNull();
    expect(JSON.stringify(dto)).not.toContain("0001-01-01");
    expect(JSON.stringify(dto)).not.toContain("9999-12-31");
  });

  it("legacy blank Custom resolves to All history", () => {
    expect(normalizeRebatePeriodPreset("CUSTOM", null, null)).toBe("ALL");
    expect(normalizeRebatePeriodPreset(undefined, undefined, undefined)).toBe("ALL");
    const r = resolveRebatePrimaryPeriod({
      period: "CUSTOM",
      from: null,
      to: null,
      today: "2026-09-29",
    });
    expect(r.preset).toBe("ALL");
    expect(r.unbounded).toBe(true);
  });

  it("legacy sentinel Custom bounds resolve to All history", () => {
    expect(
      normalizeRebatePeriodPreset("CUSTOM", "0001-01-01", "9999-12-31"),
    ).toBe("ALL");
  });

  it("Custom requires From + To and rejects from > to", () => {
    expect(() =>
      resolveRebatePrimaryPeriod({
        period: "CUSTOM",
        from: "2026-01-01",
        to: null,
        today: "2026-09-29",
      }),
    ).toThrow(RebatePeriodValidationError);

    expect(() =>
      resolveRebatePrimaryPeriod({
        period: "CUSTOM",
        from: "2026-06-30",
        to: "2026-01-01",
        today: "2026-09-29",
      }),
    ).toThrow(/on or before/i);
  });

  it("bounded dates remain inclusive via queryRange", () => {
    const r = resolveRebatePrimaryPeriod({
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-06-30",
    });
    expect(r.queryRange).toEqual({ from: "2026-01-01", to: "2026-06-30" });
  });

  it("resolves previous equivalent and previous-year comparison for bounded periods", () => {
    const primary = resolveRebatePrimaryPeriod({
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-06-30",
    });
    expect(
      resolveRebateComparisonPeriod({ compare: "PREVIOUS", primary }),
    ).toEqual({ from: "2025-07-04", to: "2025-12-31" });
    expect(
      resolveRebateComparisonPeriod({ compare: "PREVIOUS_YEAR", primary }),
    ).toEqual({ from: "2025-01-01", to: "2025-06-30" });
    expect(resolveRebateComparisonPeriod({ compare: "OFF", primary })).toBeNull();
  });

  it("All history disables previous/previous-year comparison", () => {
    const primary = resolveRebatePrimaryPeriod({ period: "ALL" });
    expect(
      resolveRebateComparisonPeriod({ compare: "PREVIOUS", primary }),
    ).toBeNull();
    expect(
      resolveRebateComparisonPeriod({ compare: "PREVIOUS_YEAR", primary }),
    ).toBeNull();
  });

  it("parses and compacts URL search with period=ALL", () => {
    const parsed = parseRebateUrlSearch({
      mode: "multi",
      period: "ALL",
      compare: "PREVIOUS",
      tab: "products",
      docType: "CREDIT",
      sort: "CREDITS_DESC",
      page: "2",
      q: "filter",
      minNet: "100",
      maxNet: "9000",
    });
    expect(parsed.mode).toBe("multi");
    expect(parsed.period).toBe("ALL");
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBeUndefined();
    const compact = compactRebateUrlSearch(parsed);
    expect(compact.period).toBe("ALL");
    expect(compact.from).toBeUndefined();
    expect(compact.to).toBeUndefined();
  });

  it("legacy blank Custom URL parses without sentinel dates", () => {
    const parsed = parseRebateUrlSearch({ period: "CUSTOM" });
    expect(parsed.period).toBeUndefined(); // default ALL omitted
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBeUndefined();
    const compact = compactRebateUrlSearch({ period: "CUSTOM" });
    expect(compact.period).toBe("ALL");
    expect(JSON.stringify(compact)).not.toMatch(/0001|9999/);
  });

  it("strips sentinel dates from URL parse", () => {
    const parsed = parseRebateUrlSearch({
      period: "CUSTOM",
      from: "0001-01-01",
      to: "9999-12-31",
    });
    expect(normalizeRebatePeriodPreset(parsed.period, parsed.from, parsed.to)).toBe("ALL");
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBeUndefined();
  });

  it("CSV All history label never uses sentinel dates", () => {
    const cells = rebatePeriodCsvCells(
      toRebatePeriodDto(resolveRebatePrimaryPeriod({ period: "ALL" })),
    );
    expect(cells.periodLabel).toBe("All history");
    expect(cells.periodFrom).toBe("All history");
    expect(cells.periodTo).toBe("All history");
    expect(cells.periodFrom).not.toMatch(/0001|9999/);
  });

  it("sentinel dates never render in period formatters", () => {
    expect(formatPeriodRangeLong("0001-01-01", "9999-12-31")).toBe("All history");
    expect(formatPeriodRangeLong("2026-01-01", "2026-06-30")).toBe("1 Jan 2026 – 30 Jun 2026");
  });

  it("eligibility rules are identity in Phase 4", () => {
    const lines = [{ id: 1 }, { id: 2 }];
    expect(applyRebateEligibilityRules(lines)).toEqual(lines);
    expect(applyRebateEligibilityRules(lines, { excludeBrandIds: ["x"] })).toEqual(lines);
  });

  it("counts invoice and credit documents distinctly", () => {
    expect(
      countDocumentTypes([
        { documentType: "INVOICE", documentReference: "A", companyId: "c1" },
        { documentType: "INVOICE", documentReference: "A", companyId: "c1" },
        { documentType: "CREDIT", documentReference: "C1", companyId: "c1" },
        { documentType: "INVOICE", documentReference: "B", companyId: "c1" },
      ]),
    ).toEqual({ invoiceDocuments: 2, creditDocuments: 1 });
  });
});
