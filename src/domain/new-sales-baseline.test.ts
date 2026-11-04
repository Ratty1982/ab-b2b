import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NEW_SALES_BASELINE_KIND,
  parseNewSalesBaselineConfirmation,
} from "@/domain/new-sales-baseline";

const input = {
  companyName: "WORSBRO MOTOR SPARES LTD",
  verifiedAccount: "WORSBRO",
  confirmAccount: "worsbro",
  reason: "New customer. The Autopart history export contained no sales for this account.",
  recordedAt: "2026-11-04T15:00:00.000Z",
};

describe("new sales baseline confirmation", () => {
  it("accepts the verified account and keeps the zero-history kind", () => {
    const parsed = parseNewSalesBaselineConfirmation(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.evidence).toEqual({
      kind: NEW_SALES_BASELINE_KIND,
      reason: input.reason,
      verifiedAccount: "WORSBRO",
      companyName: "WORSBRO MOTOR SPARES LTD",
      recordedAt: input.recordedAt,
    });
  });

  it("refuses a different account, a short reason, and does not read a file", () => {
    expect(parseNewSalesBaselineConfirmation({ ...input, confirmAccount: "OTHER" }).ok).toBe(false);
    expect(parseNewSalesBaselineConfirmation({ ...input, reason: "empty" }).ok).toBe(false);
    expect(parseNewSalesBaselineConfirmation({ ...input, confirmAccount: "" }).ok).toBe(false);
  });

  it("is an explicit action on Import Sales History", () => {
    const source = readFileSync("src/components/ab/autopart/AutopartHistoryImport.tsx", "utf8");
    expect(source).toContain("Establish New Sales Baseline");
    expect(source).toContain('data-sales-baseline="establish"');
    expect(source).toContain("completeCustomerSalesCutoverFn");
    expect(source).not.toContain("Other ways to record history");
  });
});
