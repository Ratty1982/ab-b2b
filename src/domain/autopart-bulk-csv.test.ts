import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  INVOICE_REQUIRED_COLUMNS,
  LEDGER_REQUIRED_COLUMNS,
  applyColumnMap,
  assembleCsvRecords,
  createCsvPreviewTally,
  detectColumnMap,
  interpretInvoiceRecord,
  interpretLedgerRecord,
  ledgerKindFromRaw,
  reconciliationStatus,
  streamCsvRecords,
  type CsvScanRecord,
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
      [invoiceHeader, 'ACME,I/SS1/1,BAD,"unterminated pad', "ACME,I/SS2/1,GOOD,Pad,2,20.00"],
      6,
    );
    expect(records).toHaveLength(3);
    expect(records[1]?.quarantined).toBe(true);
    expect(records[1]?.issue).toMatch(/Unclosed quote/);
    expect(records[2]?.quarantined).toBe(false);
    expect(records[2]?.cells[2]).toBe("GOOD");
  });

  it("recovers inch marks without a trailing quote and keeps signed amounts", () => {
    const quoted = (size: string, qty: string, sales: string) =>
      `"ACME","I/SS${size}/1","SWUX${size}","${size}" Phoenix Premium Boxed Whee","${qty}","${sales}"`;
    const records = assembleCsvRecords([
      invoiceHeader,
      quoted("14", "1", "24.99"),
      quoted("15", "-1", "-24.99"),
      quoted("16", "2", "8.50"),
      'ACME,I/SS20/1,RING,"O"Ring seal",1,8.00',
      'ACME,I/SS21/1,HUB,"Hub "cap" special",1,9.00',
      'ACME,I/SS22/1,TRIM,"14" and 15" and 16" trim",1,12.00',
      'ACME,I/SS23/1,PART,"Pad, rear",2,10.00',
      'ACME,I/SS24/1,PART,"say ""hello""",1,5.00',
      'ACME,I/SS25/1,BARE,14" bare trim,3,-1.25',
    ]);
    const header = records[0]!;
    const detected = detectColumnMap(header.cells, INVOICE_REQUIRED_COLUMNS);
    const read = (record: CsvScanRecord) => {
      const interpreted = interpretInvoiceRecord(record, header.cells, detected.map);
      if (!("row" in interpreted)) throw new Error(interpreted.reject.explanation);
      return interpreted.row;
    };
    expect(read(records[1]!).description).toBe('14" Phoenix Premium Boxed Whee');
    expect(read(records[1]!).quantity).toBe("1.00");
    expect(read(records[1]!).salesAmount).toBe("24.99");
    expect(records[1]?.recovered).toBe(true);
    expect(records[1]?.quarantined).toBe(false);
    expect(read(records[2]!)).toMatchObject({
      description: '15" Phoenix Premium Boxed Whee',
      quantity: "-1.00",
      salesAmount: "-24.99",
      rawInvAndLn: "I/SS15/1",
    });
    expect(read(records[3]!).description).toBe('16" Phoenix Premium Boxed Whee');
    expect(read(records[4]!).description).toBe('O"Ring seal');
    expect(records[4]?.quarantined).toBe(false);
    expect(read(records[5]!).description).toBe('Hub "cap" special');
    expect(read(records[6]!).description).toBe('14" and 15" and 16" trim');
    expect(read(records[7]!)).toMatchObject({ description: "Pad, rear", quantity: "2.00" });
    expect(records[7]?.recovered).toBe(false);
    expect(read(records[8]!).description).toBe('say "hello"');
    expect(records[8]?.recovered).toBe(false);
    expect(read(records[9]!)).toMatchObject({
      description: '14" bare trim',
      quantity: "3.00",
      salesAmount: "-1.25",
    });
    expect(records[9]?.recovered).toBe(true);
  });

  it("recovers consecutive broken descriptions without merging them", () => {
    const long = `${"Wheel trim ".repeat(40)}16" cover`;
    const records = assembleCsvRecords([
      invoiceHeader,
      `ACME,I/SS30/1,LONG,"${long}, polished,1,10.00`,
      'ACME,I/SS30/1,LONG2,"15" alloy, polished,-2,-3.50',
      "ACME,I/SS31/1,PART-A,Same reference,1,4.00",
      "ACME,I/SS31/1,PART-B,Same reference again,1,6.00",
    ]);
    expect(records).toHaveLength(5);
    const header = records[0]!;
    const detected = detectColumnMap(header.cells, INVOICE_REQUIRED_COLUMNS);
    const first = interpretInvoiceRecord(records[1]!, header.cells, detected.map);
    const second = interpretInvoiceRecord(records[2]!, header.cells, detected.map);
    expect("row" in first && first.row.description).toBe(`${long}, polished`);
    expect("row" in first && first.row.salesAmount).toBe("10.00");
    expect("row" in second && second.row.description).toBe('15" alloy, polished');
    expect("row" in second && second.row.salesAmount).toBe("-3.50");
    expect(records[1]?.rowNumber).toBe(2);
    expect(records[2]?.rowNumber).toBe(3);
    expect(records[3]?.cells[2]).toBe("PART-A");
    expect(records[4]?.cells[2]).toBe("PART-B");
    expect(records[3]?.cells[1]).toBe(records[4]?.cells[1]);
  });

  it("quarantines ambiguous numeric tails and does not invent sales", () => {
    const records = assembleCsvRecords(
      [invoiceHeader, "ACME,I/SS9/1,PART,Pad,2,1,10.00", "ACME,I/SS9/2,GOOD,Pad,1,4.00"],
      6,
    );
    expect(records[1]?.quarantined).toBe(true);
    expect(records[1]?.recovered).toBe(false);
    expect(records[1]?.issue).toMatch(/Ambiguous CSV quoting/);
    expect(records[1]?.rowNumber).toBe(2);
    expect(records[2]?.cells[2]).toBe("GOOD");
    expect(records[2]?.cells[5]).toBe("4.00");

    const header = records[0]!;
    const detected = detectColumnMap(header.cells, INVOICE_REQUIRED_COLUMNS);
    const tally = createCsvPreviewTally("invoice");
    for (const record of records.slice(1)) {
      tally.add(record, interpretInvoiceRecord(record, header.cells, detected.map));
    }
    const preview = tally.finish();
    expect(preview).toMatchObject({
      sourceRecords: 2,
      validRecords: 1,
      recoveredRecords: 0,
      rejectedRecords: 1,
      acceptedSales: "4.00",
      recoveredSales: "0.00",
      unresolvedParsing: true,
    });
    expect(preview.rejectionReasons[0]).toEqual({ issueType: "MALFORMED_CSV", count: 1 });
    expect(preview.rejectedExamples[0]?.redacted.startsWith("AC***")).toBe(true);
    expect(preview.rejectedExamples[0]?.redacted).not.toContain("ACME");
    expect(preview.rejectedExamples[0]?.explanation).toMatch(/Ambiguous/);
  });

  it("streams the same 561L decisions as the in-memory assembler", async () => {
    const lines = [
      invoiceHeader,
      '"ACME","I/SS14/1","SWUX14","14" Phoenix Premium Boxed Whee","1","24.99"',
      'ACME,I/SS1/1,BAD,"unterminated pad',
      "ACME,I/SS2/1,GOOD,Pad,2,20.00",
    ];
    const dir = await mkdtemp(path.join(tmpdir(), "autopart-561-"));
    const filePath = path.join(dir, "561L-ALL.CSV");
    await writeFile(filePath, lines.join("\n"), "utf8");
    const streamed: CsvScanRecord[] = [];
    try {
      for await (const record of streamCsvRecords(filePath)) streamed.push(record);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const assembled = assembleCsvRecords(lines);
    expect(streamed.map(({ raw: _raw, ...record }) => record)).toEqual(
      assembled.map(({ raw: _raw, ...record }) => record),
    );
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
