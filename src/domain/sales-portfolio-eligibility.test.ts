import { describe, expect, it } from "vitest";
import {
  companyMatchesPortfolioAccountClass,
  isRetailInternalAutopartClassification,
  parsePortfolioAccountClass,
  PORTFOLIO_ACCOUNT_CLASS_DEFAULT,
  PORTFOLIO_RETAIL_INTERNAL_CLASSIFICATIONS,
} from "@/domain/sales-portfolio-eligibility";
import { parsePortfolioUrlSearch, compactPortfolioUrlSearch } from "@/domain/sales-portfolio";

describe("portfolio account eligibility", () => {
  it("defaults account class to TRADE", () => {
    expect(parsePortfolioAccountClass(undefined)).toBe("TRADE");
    expect(parsePortfolioAccountClass("bogus")).toBe(PORTFOLIO_ACCOUNT_CLASS_DEFAULT);
    expect(parsePortfolioAccountClass("ALL")).toBe("ALL");
    expect(parsePortfolioAccountClass("RETAIL_INTERNAL")).toBe("RETAIL_INTERNAL");
  });

  it("maps Autopart INTERNAL/CASH/STAFF as retail/internal only", () => {
    expect(PORTFOLIO_RETAIL_INTERNAL_CLASSIFICATIONS).toEqual(["INTERNAL", "CASH", "STAFF"]);
    expect(isRetailInternalAutopartClassification("INTERNAL")).toBe(true);
    expect(isRetailInternalAutopartClassification("TRADE_CANDIDATE")).toBe(false);
    expect(isRetailInternalAutopartClassification("OBSOLETE")).toBe(false);
  });

  it("requires ACTIVE status for every account class", () => {
    expect(
      companyMatchesPortfolioAccountClass({
        companyStatus: "PROSPECT",
        accountClass: "ALL",
        linkedClassifications: [],
      }),
    ).toBe(false);
    expect(
      companyMatchesPortfolioAccountClass({
        companyStatus: "PENDING_APPROVAL",
        accountClass: "TRADE",
        linkedClassifications: ["TRADE_CANDIDATE"],
      }),
    ).toBe(false);
    expect(
      companyMatchesPortfolioAccountClass({
        companyStatus: "ON_HOLD",
        accountClass: "ALL",
        linkedClassifications: [],
      }),
    ).toBe(false);
    expect(
      companyMatchesPortfolioAccountClass({
        companyStatus: "CLOSED",
        accountClass: "ALL",
        linkedClassifications: [],
      }),
    ).toBe(false);
  });

  it("keeps ACTIVE trade and unlinked ACTIVE; excludes retail/internal from TRADE", () => {
    expect(
      companyMatchesPortfolioAccountClass({
        companyStatus: "ACTIVE",
        accountClass: "TRADE",
        linkedClassifications: [],
      }),
    ).toBe(true);
    expect(
      companyMatchesPortfolioAccountClass({
        companyStatus: "ACTIVE",
        accountClass: "TRADE",
        linkedClassifications: ["TRADE_CANDIDATE"],
      }),
    ).toBe(true);
    expect(
      companyMatchesPortfolioAccountClass({
        companyStatus: "ACTIVE",
        accountClass: "TRADE",
        linkedClassifications: ["INTERNAL"],
      }),
    ).toBe(false);
    expect(
      companyMatchesPortfolioAccountClass({
        companyStatus: "ACTIVE",
        accountClass: "RETAIL_INTERNAL",
        linkedClassifications: ["INTERNAL"],
      }),
    ).toBe(true);
    expect(
      companyMatchesPortfolioAccountClass({
        companyStatus: "ACTIVE",
        accountClass: "RETAIL_INTERNAL",
        linkedClassifications: ["TRADE_CANDIDATE"],
      }),
    ).toBe(false);
  });

  it("parses and compacts accountClass in portfolio URL search", () => {
    expect(parsePortfolioUrlSearch({}).accountClass).toBeUndefined();
    expect(parsePortfolioUrlSearch({ accountClass: "ALL" }).accountClass).toBe("ALL");
    expect(
      compactPortfolioUrlSearch({ accountClass: "TRADE", period: "THIS_MONTH" }).accountClass,
    ).toBeUndefined();
    expect(compactPortfolioUrlSearch({ accountClass: "ALL" }).accountClass).toBe("ALL");
  });
});
