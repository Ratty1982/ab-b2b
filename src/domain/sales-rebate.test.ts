import { describe, expect, it } from "vitest";
import {
  applyRebateEligibilityRules,
  compactRebateUrlSearch,
  countDocumentTypes,
  parseRebateUrlSearch,
  resolveRebateComparisonPeriod,
  resolveRebatePrimaryPeriod,
} from "@/domain/sales-rebate";

describe("sales-rebate domain", () => {
  it("resolves custom primary period inclusively", () => {
    expect(
      resolveRebatePrimaryPeriod({
        period: "CUSTOM",
        from: "2026-01-01",
        to: "2026-01-31",
        today: "2026-09-29",
      }),
    ).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("resolves this quarter from London today", () => {
    expect(
      resolveRebatePrimaryPeriod({
        period: "THIS_QUARTER",
        today: "2026-09-29",
      }),
    ).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("resolves previous equivalent and previous-year comparison", () => {
    const primary = { from: "2026-01-01", to: "2026-06-30" };
    expect(
      resolveRebateComparisonPeriod({ compare: "PREVIOUS", primary }),
    ).toEqual({ from: "2025-07-04", to: "2025-12-31" });
    expect(
      resolveRebateComparisonPeriod({ compare: "PREVIOUS_YEAR", primary }),
    ).toEqual({ from: "2025-01-01", to: "2025-06-30" });
    expect(resolveRebateComparisonPeriod({ compare: "OFF", primary })).toBeNull();
  });

  it("parses and compacts URL search", () => {
    const parsed = parseRebateUrlSearch({
      mode: "multi",
      period: "THIS_QUARTER",
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
    expect(parsed.period).toBe("THIS_QUARTER");
    expect(parsed.docType).toBe("CREDIT");
    expect(parsed.page).toBe(2);
    const compact = compactRebateUrlSearch(parsed);
    expect(compact.mode).toBe("multi");
    expect(compact.period).toBe("THIS_QUARTER");
    expect(compact.page).toBe(2);
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
