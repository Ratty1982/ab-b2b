import { describe, expect, it } from "vitest";
import {
  INVOICE_REQUIRED_COLUMNS,
  LEDGER_REQUIRED_COLUMNS,
  applyColumnMap,
  assembleCsvRecords,
  detectColumnMap,
  interpretInvoiceRecord,
  interpretLedgerRecord,
  ledgerKindFromRaw,
  reconciliationStatus,
} from "@/domain/autopart-bulk-csv";

const invoiceHeader = ".Acct.,Inv & Ln,Part Number,Description,Units,Sales";
const ledgerHeader = "A/C,Name,Sacct,Type,Ref,Date,Tot Goods,,Tot VAT,,Total,Run Bal";

describe("Autopart bulk CSV recovery", () => {
  it("reads the documented 561L header and a negative credit line", () => {
    const records = assembleCsvRecords([
      invoiceHeader,
      'ACME,C/SC100/1,14" Pad,Rear pad, -1, -8.98',
    ]);
    const header = records[0]!;
    const detected = detectColumnMap(header.cells, INVOICE_REQUIRED_COLUMNS);
    expect(detected.missing).toEqual([]);
    const interpreted = interpretInvoiceRecord(records[1]!, header.cells, detected.map);
    expect("row" in interpreted).toBe(true);
    if (!("row" in interpreted)) return;
    expect(interpreted.row.documentType).toBe("CREDIT");
    expect(interpreted.row.documentReference).toBe("SC100");
    expect(interpreted.row.sourceLineNumber).toBe(1);
    expect(interpreted.row.partNumber).toBe('14" Pad');
    expect(interpreted.row.description).toBe("Rear pad");
    expect(interpreted.row.quantity).toBe("-1.00");
    expect(interpreted.row.salesAmount).toBe("-8.98");
    expect(interpreted.row.salesMeasure).toBe("NET_EX_VAT");
  });

  it("quarantines an unclosed quote and keeps the next valid row", () => {
    const records = assembleCsvRecords(
      [
        invoiceHeader,
        'ACME,I/SS1/1,BAD,"unterminated pad,1,10.00',
        "ACME,I/SS2/1,GOOD,Pad,2,20.00",
      ],
      6,
    );
    expect(records[1]?.quarantined).toBe(true);
    expect(records[1]?.issue).toMatch(/Unclosed quote/);
    expect(records[2]?.quarantined).toBe(false);
    expect(records[2]?.cells[2]).toBe("GOOD");
  });

  it("rejects invalid money without dropping the raw row", () => {
    const records = assembleCsvRecords([invoiceHeader, "ACME,I/SS9/1,PART,Pad,1,not-money"]);
    const header = records[0]!;
    const detected = detectColumnMap(header.cells, INVOICE_REQUIRED_COLUMNS);
    const interpreted = interpretInvoiceRecord(records[1]!, header.cells, detected.map);
    expect("reject" in interpreted).toBe(true);
    if (!("reject" in interpreted)) return;
    expect(interpreted.reject.issueType).toBe("INVALID_MONEY");
    expect(interpreted.reject.raw).toContain("not-money");
  });

  it("maps a renamed header when the administrator supplies a column map", () => {
    const headers = ["Account Code", "Line Ref", "SKU", "Desc", "Qty", "Net"];
    const map = applyColumnMap(headers, {
      account: "Account Code",
      invLn: "Line Ref",
      part: "SKU",
      units: "Qty",
      sales: "Net",
    });
    expect(map.account).toBe(0);
    expect(map.part).toBe(2);
    expect(map.sales).toBe(5);
  });

  it("parses SLRB dates and does not treat cash as a sale", () => {
    const records = assembleCsvRecords([
      ledgerHeader,
      "ACME,Acme Factors,,INV,SS100,06 Oct 14,10.00,,2.00,,12.00,12.00",
      "ACME,Acme Factors,,CSH,PAY1,06 Oct 14,-12.00,,0.00,,-12.00,0.00",
    ]);
    const header = records[0]!;
    const detected = detectColumnMap(header.cells, LEDGER_REQUIRED_COLUMNS);
    expect(detected.missing).toEqual([]);
    const invoice = interpretLedgerRecord(records[1]!, header.cells, detected.map);
    const cash = interpretLedgerRecord(records[2]!, header.cells, detected.map);
    expect("row" in invoice && invoice.row.transactionDate).toBe("2014-10-06");
    expect("row" in invoice && invoice.row.ledgerKind).toBe("INVOICE");
    expect("row" in invoice && invoice.row.isSalesDocument).toBe(true);
    expect("row" in cash && cash.row.ledgerKind).toBe("PAYMENT");
    expect("row" in cash && cash.row.isSalesDocument).toBe(false);
    expect(ledgerKindFromRaw("CRN")).toBe("CREDIT");
    expect(ledgerKindFromRaw("ZZZ")).toBe("UNKNOWN");
  });

  it("reconciles documents without treating the line sales as the ledger total", () => {
    expect(
      reconciliationStatus({
        lineCount: 2,
        lineSales: "15.00",
        parsedLineIssues: 0,
        ledgerCount: 1,
        ledgerGoods: "15.00",
      }),
    ).toBe("MATCHED");
    expect(
      reconciliationStatus({
        lineCount: 1,
        lineSales: "10.00",
        parsedLineIssues: 0,
        ledgerCount: 1,
        ledgerGoods: "12.00",
      }),
    ).toBe("AMOUNT_DISCREPANCY");
    expect(
      reconciliationStatus({
        lineCount: 1,
        lineSales: "10.00",
        parsedLineIssues: 0,
        ledgerCount: 0,
        ledgerGoods: null,
      }),
    ).toBe("PRODUCT_LINES_ONLY");
    expect(
      reconciliationStatus({
        lineCount: 0,
        lineSales: null,
        parsedLineIssues: 0,
        ledgerCount: 1,
        ledgerGoods: "10.00",
      }),
    ).toBe("LEDGER_ONLY");
    expect(
      reconciliationStatus({
        lineCount: 1,
        lineSales: "10.00",
        parsedLineIssues: 0,
        ledgerCount: 2,
        ledgerGoods: "10.00",
      }),
    ).toBe("AMBIGUOUS");
  });
});
