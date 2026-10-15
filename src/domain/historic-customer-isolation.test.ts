import { describe, expect, it } from "vitest";
import { isolateCustomerHistory } from "@/domain/historic-customer-isolation";
import { summariseHistoricOverlap } from "@/domain/historic-overlap-summary";

const accepted = new Set(["ACME01"]);

describe("historic customer isolation", () => {
  it("keeps the selected account and leaves other customers out", () => {
    const result = isolateCustomerHistory({
      lines: [
        { accountCode: "ACME01", documentReference: "SS1", documentType: "INVOICE" },
        { accountCode: "ACME01", documentReference: "SS1", documentType: "INVOICE" },
        { accountCode: "OTHER1", documentReference: "SS9", documentType: "INVOICE" },
      ],
      documents: [
        { accountCode: "ACME01", documentReference: "SS1", documentType: "INVOICE" },
        { accountCode: "OTHER1", documentReference: "SS9", documentType: "INVOICE" },
      ],
      acceptedAccounts: accepted,
      width: 7,
      ambiguousShortAccounts: new Set(),
      fullIdentityPresent: true,
    });
    expect(result.mode).toBe("isolated");
    expect(result.lines).toHaveLength(2);
    expect(result.documents.map((row) => row.documentReference)).toEqual(["SS1"]);
    expect(result.excludedAccounts).toEqual(["OTHER1"]);
    expect(result.refusedLineCount).toBe(0);
  });

  it("refuses a document that names two accounts", () => {
    const result = isolateCustomerHistory({
      lines: [
        { accountCode: "ACME01", documentReference: "SS1", documentType: "INVOICE" },
        { accountCode: "OTHER1", documentReference: "SS1", documentType: "INVOICE" },
        { accountCode: "ACME01", documentReference: "SS2", documentType: "CREDIT" },
      ],
      documents: [{ accountCode: "ACME01", documentReference: "SS2", documentType: "CREDIT" }],
      acceptedAccounts: accepted,
      width: null,
      ambiguousShortAccounts: new Set(),
      fullIdentityPresent: true,
    });
    expect(result.lines.map((row) => row.documentReference)).toEqual(["SS2"]);
    expect(result.refusedLineCount).toBe(2);
    expect(result.mode).toBe("isolated");
  });

  it("refuses a shortened code that matches more than one customer when no full code is present", () => {
    const result = isolateCustomerHistory({
      lines: [{ accountCode: "ACME0", documentReference: "SS1", documentType: "INVOICE" }],
      documents: [],
      acceptedAccounts: new Set(["ACME01", "ACME02"]),
      width: 5,
      ambiguousShortAccounts: new Set(["ACME0"]),
      fullIdentityPresent: false,
    });
    expect(result.mode).toBe("refused");
    expect(result.lines).toHaveLength(0);
    expect(result.refusedAmbiguousAccounts).toEqual(["ACME0"]);
  });

  it("accepts the shortened code once the full account is in the file", () => {
    const result = isolateCustomerHistory({
      lines: [{ accountCode: "ACME0", documentReference: "SS1", documentType: "INVOICE" }],
      documents: [{ accountCode: "ACME01", documentReference: "SS1", documentType: "INVOICE" }],
      acceptedAccounts: new Set(["ACME01"]),
      width: 5,
      ambiguousShortAccounts: new Set(["ACME0"]),
      fullIdentityPresent: true,
    });
    expect(result.mode).toBe("single");
    expect(result.includedLineCount).toBe(1);
  });

  it("does not collapse repeated product lines", () => {
    const lines = Array.from({ length: 200 }, (_, index) => ({
      accountCode: "ACME01",
      documentReference: "FBA1",
      documentType: "INVOICE" as const,
      sku: index % 2 === 0 ? "BOLT" : "WASHER",
    }));
    const result = isolateCustomerHistory({
      lines,
      documents: [{ accountCode: "ACME01", documentReference: "FBA1", documentType: "INVOICE" }],
      acceptedAccounts: accepted,
      width: null,
      ambiguousShortAccounts: new Set(),
      fullIdentityPresent: true,
    });
    expect(result.lines).toHaveLength(200);
  });
});

describe("historic overlap summary", () => {
  it("treats equal document money as agreement and does not pick the larger copy", () => {
    const summary = summariseHistoricOverlap({
      incoming: [
        { reference: "SS1", documentType: "INVOICE", goodsNet: "10.00", lineNet: "10.00" },
        { reference: "SS2", documentType: "INVOICE", goodsNet: "900.00", lineNet: "900.00" },
      ],
      ongoing: [
        { reference: "SS1", documentType: "INVOICE", goodsNet: "10.00", lineNet: "10.00" },
        { reference: "SS2", documentType: "INVOICE", goodsNet: "12.00", lineNet: "12.00" },
      ],
    });
    expect(summary.leftUnchanged).toEqual(["SS1"]);
    expect(summary.differs).toEqual([{ reference: "SS2", documentType: "INVOICE" }]);
  });

  it("does not call a document a difference when one side has no money", () => {
    const summary = summariseHistoricOverlap({
      incoming: [{ reference: "SS3", documentType: "CREDIT", goodsNet: null, lineNet: "-5.00" }],
      ongoing: [{ reference: "SS3", documentType: "CREDIT", goodsNet: null, lineNet: null }],
    });
    expect(summary.differs).toEqual([]);
    expect(summary.leftUnchanged).toEqual(["SS3"]);
  });
});
