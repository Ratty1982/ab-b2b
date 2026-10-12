/**
 * The 561L source identity counts occurrences inside each 200-row write. These tests pin what that
 * means for totals: replays and re-chunked overlapping exports never add stored sales; an identical
 * row repeated inside one chunk is stored twice, which the unified sales layer then holds back as a
 * REPEATED_SOURCE_ROW instead of counting it.
 */
import { describe, expect, it } from "vitest";
import {
  INVOICE_REQUIRED_COLUMNS,
  assembleCsvRecords,
  detectColumnMap,
  type CsvScanRecord,
} from "@/domain/autopart-bulk-csv";
import {
  FINANCIAL_IMPORT_CHUNK,
  analysePreparedInvoices,
  prepareInvoiceChunk,
  type PreparedInvoiceLine,
  type StoredInvoiceCandidate,
} from "@/server/companies/autopart-incremental-match";

const header = ".Acct.,Inv & Ln,Part Number,Description,Units,Sales";

function parse(rows: string[]) {
  const records = assembleCsvRecords([header, ...rows]);
  const head = records[0]!;
  const detected = detectColumnMap(head.cells, INVOICE_REQUIRED_COLUMNS);
  expect(detected.missing).toEqual([]);
  return { cells: head.cells, map: detected.map, records: records.slice(1) };
}

function prepareInChunks(rows: string[], chunkSize: number): PreparedInvoiceLine[] {
  const { cells, map, records } = parse(rows);
  const lines: PreparedInvoiceLine[] = [];
  for (let start = 0; start < records.length; start += chunkSize) {
    const chunk: CsvScanRecord[] = records.slice(start, start + chunkSize);
    lines.push(...prepareInvoiceChunk(cells, map, chunk).lines);
  }
  return lines;
}

function stored(lines: PreparedInvoiceLine[]): StoredInvoiceCandidate[] {
  const seen = new Set<string>();
  const out: StoredInvoiceCandidate[] = [];
  for (const line of lines) {
    if (seen.has(line.sourceIdentity)) continue;
    seen.add(line.sourceIdentity);
    out.push({
      sourceIdentity: line.sourceIdentity,
      accountCode: line.accountCode,
      rawInvAndLn: line.rawInvAndLn,
      partNumber: line.partNumber,
      quantity: line.quantity,
      salesAmount: line.salesAmount,
    });
  }
  return out;
}

const repeated = "ACME,I/SS100/1,PAD-1,Front pad,1,10.00";
const filler = (n: number) => `ACME,I/SS${200 + n}/1,FILL-${n},Filler,1,1.00`;

describe("561L occurrence identity and totals", () => {
  it("uses a 200-row write chunk", () => {
    expect(FINANCIAL_IMPORT_CHUNK).toBe(200);
  });

  it("keeps distinct lines that share a reference as separate identities", () => {
    const lines = prepareInChunks(
      ["ACME,I/SS100/1,PAD-1,Front pad,1,10.00", "ACME,I/SS100/2,PAD-1,Front pad,1,10.00"],
      FINANCIAL_IMPORT_CHUNK,
    );
    expect(new Set(lines.map((line) => line.sourceIdentity)).size).toBe(2);
    expect(lines.map((line) => line.documentReference)).toEqual(["SS100", "SS100"]);
  });

  it("stores an identical row repeated inside one chunk twice, but only once across chunks", () => {
    const sameChunk = prepareInChunks([repeated, repeated], FINANCIAL_IMPORT_CHUNK);
    expect(new Set(sameChunk.map((line) => line.sourceIdentity)).size).toBe(2);

    const rows = [
      repeated,
      ...Array.from({ length: FINANCIAL_IMPORT_CHUNK - 1 }, (_, i) => filler(i)),
      repeated,
    ];
    const split = prepareInChunks(rows, FINANCIAL_IMPORT_CHUNK);
    const repeats = split.filter((line) => line.partNumber === "PAD-1");
    expect(repeats).toHaveLength(2);
    expect(repeats[0]!.sourceIdentity).toBe(repeats[1]!.sourceIdentity);
    const report = analysePreparedInvoices(split, 0, []);
    expect(report.newRecords).toBe(FINANCIAL_IMPORT_CHUNK);
    expect(report.identicalRecords).toBe(1);
  });

  it("adds nothing when the same file is replayed", () => {
    const rows = [repeated, repeated, ...Array.from({ length: 250 }, (_, i) => filler(i))];
    const first = prepareInChunks(rows, FINANCIAL_IMPORT_CHUNK);
    const replay = analysePreparedInvoices(
      prepareInChunks(rows, FINANCIAL_IMPORT_CHUNK),
      0,
      stored(first),
    );
    expect(replay.newRecords).toBe(0);
    expect(replay.ambiguousRecords).toBe(0);
    expect(replay.financialConflicts).toBe(0);
    expect(replay.expectedStoredTotalChange).toBe("0.00");
  });

  it("never adds sales when an overlapping export splits stored repeats across chunks", () => {
    const original = prepareInChunks([repeated, repeated], FINANCIAL_IMPORT_CHUNK);
    const overlap = [
      repeated,
      ...Array.from({ length: FINANCIAL_IMPORT_CHUNK - 1 }, (_, i) => filler(i)),
      repeated,
    ];
    const report = analysePreparedInvoices(
      prepareInChunks(overlap, FINANCIAL_IMPORT_CHUNK),
      0,
      stored(original),
    );
    const added = prepareInChunks(overlap, FINANCIAL_IMPORT_CHUNK).filter(
      (line) => line.partNumber === "PAD-1",
    );
    expect(added).toHaveLength(2);
    expect(report.identicalRecords).toBe(2);
    expect(report.newRecords).toBe(FINANCIAL_IMPORT_CHUNK - 1);
    expect(report.classifiedNewAmount).toBe("199.00");
  });

  it("blocks, rather than adds, when an overlapping export brings repeats into one chunk", () => {
    const rows = [
      repeated,
      ...Array.from({ length: FINANCIAL_IMPORT_CHUNK - 1 }, (_, i) => filler(i)),
      repeated,
    ];
    const original = prepareInChunks(rows, FINANCIAL_IMPORT_CHUNK);
    const report = analysePreparedInvoices(
      prepareInChunks([repeated, repeated], FINANCIAL_IMPORT_CHUNK),
      0,
      stored(original),
    );
    expect(report.identicalRecords).toBe(1);
    expect(report.ambiguousRecords).toBe(1);
    expect(report.canCommit).toBe(false);
    expect(report.expectedStoredTotalChange).toBe("0.00");
  });
});
