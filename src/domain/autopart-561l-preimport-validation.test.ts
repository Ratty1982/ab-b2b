import { describe, expect, it } from "vitest";
import {
  INVOICE_REQUIRED_COLUMNS,
  assembleCsvRecords,
  detectColumnMap,
  interpretInvoiceRecord,
} from "@/domain/autopart-bulk-csv";
import {
  INVOICE_IMPORT_CHUNK,
  createInvoicePreimportValidation,
  failedValidationChecks,
  invoiceValidationReportCsv,
  type InvoicePreimportValidation,
} from "@/domain/autopart-561l-preimport-validation";

const header = ".Acct.,Inv & Ln,Part Number,Description,Units,Sales";

function validate(
  lines: string[],
  accounts: string[],
  exceptionLimit = 100,
): InvoicePreimportValidation {
  const records = assembleCsvRecords([header, ...lines]);
  const detected = detectColumnMap(records[0]!.cells, INVOICE_REQUIRED_COLUMNS);
  const validation = createInvoicePreimportValidation({
    knownAccountCodes: new Set(accounts),
    exceptionLimit,
  });
  for (const record of records.slice(1)) {
    validation.observe(
      record,
      interpretInvoiceRecord(record, records[0]!.cells, detected.map),
      detected.map,
    );
  }
  return validation.finish();
}

function check(report: InvoicePreimportValidation, id: string) {
  const found = report.checks.find((item) => item.id === id);
  if (!found) throw new Error(`missing check ${id}`);
  return found;
}

describe("561L pre-import financial validation", () => {
  it("sums signed NET_EX_VAT with decimal arithmetic and splits positive, credit, and zero lines", () => {
    const report = validate(
      [
        "ACME,I/SS1/1,PART-A,Pad,1,0.10",
        "ACME,I/SS1/2,PART-B,Pad,1,0.20",
        "ACME,C/SC1/1,PART-C,Credit,-1,-2.50",
        "ACME,I/SS1/3,PART-Z,Zero,1,0.00",
      ],
      ["ACME"],
    );
    expect(report.netSales).toBe("-2.20");
    expect(report.positiveSales).toBe("0.30");
    expect(report.positiveCount).toBe(2);
    expect(report.negativeSales).toBe("-2.50");
    expect(report.negativeCount).toBe(1);
    expect(report.zeroCount).toBe(1);
    expect(report.salesMeasure).toBe("NET_EX_VAT");
    expect(report.dryRun).toBe(true);
    expect(check(report, "signed_net_sales").outcome).toBe("PASS");
    expect(check(report, "positive_sales").outcome).toBe("PASS");
    expect(check(report, "negative_sales").outcome).toBe("PASS");
    expect(check(report, "zero_value_lines").outcome).toBe("PASS");
  });

  it("checks recovered account, reference, part, signed quantity, and signed sales without merging the next line", () => {
    const report = validate(
      [
        '"ACME","I/SS14/1","SWUX14","14" Phoenix Premium Boxed Whee","1","24.99"',
        '"ACME","I/SS14/1","SWUX15","15" Phoenix Premium Boxed Whee","-2","-8.98"',
        "ACME,I/SS14/1,PART-B,Same reference different part,1,4.00",
      ],
      ["ACME"],
    );
    expect(report.recoveredLines).toBe(2);
    expect(report.recoveredFieldFailures).toBe(0);
    expect(report.mergedLineFailures).toBe(0);
    expect(report.preservedSeparateLines).toBe(2);
    expect(report.identityCollisions).toBe(0);
    expect(report.netSales).toBe("20.01");
    expect(check(report, "recovered_fields").outcome).toBe("PASS");
    expect(check(report, "no_merged_lines").outcome).toBe("PASS");
    expect(check(report, "legitimate_duplicate_lines").outcome).toBe("PASS");
    expect(check(report, "unexpected_duplicate_identities").outcome).toBe("PASS");
  });

  it("fails ambiguous recovery and does not invent a sales amount for that row", () => {
    const report = validate(
      ["ACME,I/SS9/1,PART,Pad,2,1,10.00", "ACME,I/SS9/2,GOOD,Pad,1,4.00"],
      ["ACME"],
    );
    expect(report.ambiguousRecovered).toBe(1);
    expect(report.acceptedLines).toBe(1);
    expect(report.netSales).toBe("4.00");
    expect(check(report, "ambiguous_recovered").outcome).toBe("FAIL");
    expect(report.exceptions.some((row) => row.checkId === "ambiguous_recovered")).toBe(true);
  });

  it("fails missing accounts, missing invoice references, and invalid amounts", () => {
    const report = validate(
      [
        ",I/SS8/1,PART-M,Missing account,1,1.00",
        "ACME,,PART-R,Missing reference,1,2.00",
        "ACME,I/NOT-A-REF,PART-Q,Bad reference,1,3.00",
        "ACME,I/SS7/1,PART-X,Bad money,1,not-money",
        "ACME,I/SS7/2,PART-Y,Bad quantity,nope,4.00",
      ],
      ["ACME"],
    );
    expect(report.missingAccounts).toBe(1);
    expect(report.missingInvoiceReferences).toBe(2);
    expect(report.invalidAmounts).toBe(2);
    expect(report.netSales).toBe("5.00");
    expect(check(report, "missing_account_codes").outcome).toBe("FAIL");
    expect(check(report, "missing_invoice_references").outcome).toBe("FAIL");
    expect(check(report, "invalid_numeric_amounts").outcome).toBe("FAIL");
  });

  it("quarantines account codes that are absent from the 407EXP master and does not match names", () => {
    const report = validate(
      [
        "KEEP,I/SS1/1,PART-A,Pad,1,10.00",
        "OTHER,I/SS2/1,PART-B,KEEP,1,3.50",
        "OTHER,C/SC2/1,PART-C,KEEP MOTORS,-1,-1.25",
      ],
      ["KEEP"],
    );
    expect(report.accountMatchRule).toBe("exact_account_code");
    expect(report.nameMatching).toBe("never");
    expect(report.matchedLines).toBe(1);
    expect(report.unmatchedLines).toBe(2);
    expect(report.distinctUnmatchedAccounts).toBe(1);
    expect(report.unmatchedSales).toBe("2.25");
    expect(check(report, "account_master_match").outcome).toBe("WARNING");
    expect(check(report, "account_master_match").summary).toMatch(/Names are not used/);
    expect(
      report.exceptions.every(
        (row) => row.accountCode !== "KEEP" || row.checkId !== "account_master_match",
      ),
    ).toBe(true);
  });

  it("keeps a repeated natural key in the next chunk as a separate occurrence", () => {
    const first = "ACME,I/SS1/1,PART-A,First,1,10.00";
    const filler = Array.from({ length: INVOICE_IMPORT_CHUNK - 1 }, (_, index) => {
      return `ACME,I/SS${index + 2}/1,PART-${index + 2},Pad,1,1.00`;
    });
    const report = validate([first, ...filler, "ACME,I/SS1/1,PART-A,Second,1,10.00"], ["ACME"]);
    expect(report.acceptedLines).toBe(INVOICE_IMPORT_CHUNK + 1);
    expect(report.identityCollisions).toBe(0);
    expect(report.preservedSeparateLines).toBe(1);
    expect(check(report, "unexpected_duplicate_identities").outcome).toBe("PASS");
    expect(check(report, "legitimate_duplicate_lines").outcome).toBe("PASS");
    expect(report.netSales).toBe("219.00");
  });

  it("blocks import when any check fails and allows a warning for unmatched accounts", () => {
    const failed = validate(["ACME,I/SS9/1,PART,Pad,2,1,10.00"], ["ACME"]);
    expect(failedValidationChecks(failed).map((item) => item.id)).toContain("ambiguous_recovered");
    const unmatched = validate(["OTHER,I/SS1/1,PART-A,KEEP,1,3.00"], ["KEEP"]);
    expect(failedValidationChecks(unmatched)).toEqual([]);
    expect(check(unmatched, "account_master_match").outcome).toBe("WARNING");
  });

  it("keeps two identical lines inside one chunk as separate identities", () => {
    const report = validate(
      ["ACME,I/SS1/1,PART-A,First,1,10.00", "ACME,I/SS1/1,PART-A,Second description,1,10.00"],
      ["ACME"],
    );
    expect(report.identityCollisions).toBe(0);
    expect(report.preservedSeparateLines).toBe(1);
    expect(report.acceptedLines).toBe(2);
    expect(report.netSales).toBe("20.00");
    expect(check(report, "unexpected_duplicate_identities").outcome).toBe("PASS");
  });

  it("writes a formula-safe report covering totals and exception rows", () => {
    const report = validate(
      [
        'OTHER,I/SS1/1,"=HYPERLINK(""http://evil"")",Formula,1,-2.50',
        "ACME,I/SS2/1,PART-A,Pad,1,10.00",
      ],
      ["ACME"],
      5,
    );
    const csv = invoiceValidationReportCsv(report);
    expect(csv.split("\n")[0]).toBe(
      "section,check,outcome,row_number,account_code,invoice_reference,part_number,quantity,sales_amount,detail",
    );
    expect(csv).toContain("summary,signed_net_sales,PASS,,,,,,7.50,");
    expect(csv).toContain("summary,negative_sales,PASS,,,,,,-2.50,");
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(csv).not.toContain(",=HYPERLINK");
    expect(csv).toContain("Exact account code only");
    expect(check(report, "account_master_match").outcome).toBe("WARNING");
  });
});
