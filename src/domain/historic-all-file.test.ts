import { describe, expect, it } from "vitest";
import {
  assignHistoricLineNumbers,
  classifyHistoricAccount,
  planAllHistoricFile,
  type HistoricAccountDirectory,
} from "@/domain/historic-all-file";

const acme = { companyId: "co_acme", canonicalCode: "ACME001" };
const beta = { companyId: "co_beta", canonicalCode: "BETA002" };

function directory(overrides: Partial<HistoricAccountDirectory> = {}): HistoricAccountDirectory {
  const verifiedByCode = new Map<string, { companyId: string; canonicalCode: string } | null>([
    ["ACME001", acme],
    ["BETA002", beta],
    ["ACMELONG", { companyId: "co_acme", canonicalCode: "ACMELONG" }],
  ]);
  return {
    verifiedByCode,
    masterCompanyByCode: new Map([
      ["ACME001", "co_acme"],
      ["BETA002", "co_beta"],
      ["WAITING", null],
      ["LINKED9", "co_other"],
    ]),
    ...overrides,
  };
}

describe("all-file historical account matching", () => {
  it("imports a verified account and a unique short code, and queues the rest", () => {
    const dir = directory();
    expect(classifyHistoricAccount("acme001", dir)).toEqual({
      outcome: "import",
      companyId: "co_acme",
      canonicalCode: "ACME001",
    });
    expect(classifyHistoricAccount("ACMELON", dir)).toEqual({ outcome: "review", reason: "UNKNOWN" });
    expect(
      classifyHistoricAccount("ACMELON", { ...dir, truncatedPrefixes: new Set(["ACMELON"]) }),
    ).toEqual({ outcome: "review", reason: "AMBIGUOUS" });
    expect(classifyHistoricAccount("WAITING", dir)).toEqual({ outcome: "review", reason: "UNLINKED" });
    expect(classifyHistoricAccount("LINKED9", dir)).toEqual({ outcome: "review", reason: "NOT_VERIFIED" });
    expect(classifyHistoricAccount("NOBODY", dir)).toEqual({ outcome: "review", reason: "UNKNOWN" });
  });

  it("does not import a truncated code even when it prefixes two verified customers", () => {
    const dir = directory({ truncatedPrefixes: new Set(["RETAILA"]) });
    expect(classifyHistoricAccount("RETAILA", dir)).toEqual({ outcome: "review", reason: "AMBIGUOUS" });
  });

  it("keeps repeated FBA lines and separates credits from ledger rows", () => {
    const plan = planAllHistoricFile({
      directory: directory(),
      lines: [
        line("ACME001", "I/FBA1/1", "SKU-A", "2", "10.00"),
        line("ACME001", "I/FBA1/1", "SKU-B", "4", "20.00"),
        line("ACME001", "C/CR1/1", "SKU-C", "-1", "-5.00"),
        line("NOBODY", "I/X1/1", "SKU-Z", "1", "3.00"),
      ],
      documents: [
        doc("ACME001", "INVOICE", "FBA1", "30.00"),
        doc("ACME001", "CREDIT", "CR1", "-5.00"),
        doc("ACME001", "PAYMENT", "P1", "30.00"),
        doc("BETA002", "INVOICE", "FBA1", "8.00"),
      ],
    });
    const acme = plan.accounts.find((account) => account.accountCode === "ACME001")!;
    expect(acme.classification.outcome).toBe("import");
    expect(acme.lines.map((row) => [row.sku, row.lineNumber, row.salesNet])).toEqual([
      ["SKU-A", 1, "10.00"],
      ["SKU-B", 2, "20.00"],
      ["SKU-C", 1, "-5.00"],
    ]);
    expect(acme.ledgerRows).toBe(1);
    expect(acme.warnings.some((warning) => warning.includes("payment or journal"))).toBe(true);
    const shared = plan.accounts.find((account) => account.accountCode === "BETA002")!;
    expect(shared.documents[0]?.documentReference).toBe("FBA1");
    expect(shared.warnings.some((warning) => warning.includes("no product lines"))).toBe(true);
    expect(plan.accounts.find((account) => account.accountCode === "NOBODY")?.classification).toEqual({
      outcome: "review",
      reason: "UNKNOWN",
    });
  });

  it("assigns a new line number when Amazon repeats /1", () => {
    expect(
      assignHistoricLineNumbers([
        { documentType: "INVOICE", documentReference: "FBA", sourceLineNumber: 1 },
        { documentType: "INVOICE", documentReference: "FBA", sourceLineNumber: 1 },
      ]),
    ).toEqual([1, 2]);
  });
});

function line(account: string, inv: string, sku: string, units: string, sales: string) {
  const type = inv.startsWith("C/") ? "CREDIT" : "INVOICE";
  const reference = inv.split("/")[1] ?? inv;
  return {
    accountCode: account,
    documentType: type as "INVOICE" | "CREDIT",
    documentReference: reference,
    sourceLineNumber: Number(inv.split("/")[2] ?? "1"),
    partNumber: sku,
    description: sku,
    units,
    salesNet: sales,
    rawInvAndLn: inv,
  };
}

function doc(
  account: string,
  documentType: "INVOICE" | "CREDIT" | "PAYMENT",
  reference: string,
  goods: string,
) {
  return {
    accountCode: account,
    documentType,
    documentReference: reference,
    documentDate: "2026-10-15",
    goodsNet: goods,
    vat: "0.00",
    grossTotal: goods,
  };
}
