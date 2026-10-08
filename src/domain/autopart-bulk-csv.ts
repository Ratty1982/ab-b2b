/**
 * Streaming-friendly CSV recovery for Autopart 561L and SLRB exports.
 *
 * Column names below are the documented headers. The real 561L-ALL and SLRB-ALL
 * files were not available when this parser was written, so callers must preview
 * and may supply a column map when the header differs.
 *
 * An interior inch mark is recovered when the field still closes. A quote that
 * runs into the next complete record is quarantined with its raw text. The
 * following record is kept. Rows are not dropped without an issue.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  autopartMoneyToGbp2,
  parseAutopartDateOnly,
  parseAutopartMoney,
} from "@/domain/autopart-report-money";
import { parseInvAndLn } from "@/domain/autopart-561l";

export type CsvScanRecord = {
  rowNumber: number;
  cells: string[];
  raw: string;
  recovered: boolean;
  quarantined: boolean;
  issue: string | null;
};

type ParsedLine = {
  cells: string[];
  inQuotesAtEnd: boolean;
  recovered: boolean;
  malformed: boolean;
};

function hasValidCloser(line: string, from: number, delimiter: string): boolean {
  let inQuotes = false;
  for (let i = from; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === delimiter || ch === "\n")) return true;
  }
  return false;
}

function lastCharIsDigit(field: string): boolean {
  const last = field.trim().slice(-1);
  return last >= "0" && last <= "9";
}

/** Parse one physical or joined record. Does not read later lines. */
export function parseCsvRecordLine(line: string, delimiter = ","): ParsedLine {
  const cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStart = true;
  let recovered = false;
  let malformed = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
          fieldStart = false;
          continue;
        }
        if (next == null || next === delimiter || next === "\n" || next === "\r") {
          inQuotes = false;
          fieldStart = false;
          continue;
        }
        if (hasValidCloser(line, i + 1, delimiter)) {
          field += '"';
          recovered = true;
          fieldStart = false;
          continue;
        }
        if (lastCharIsDigit(field)) {
          field += '"';
          inQuotes = false;
          recovered = true;
          fieldStart = false;
          continue;
        }
        malformed = true;
        field += ch;
        continue;
      }
      if (ch === "\r") continue;
      field += ch;
      fieldStart = false;
      continue;
    }
    if (ch === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      continue;
    }
    if (ch === '"') {
      field += '"';
      recovered = true;
      fieldStart = false;
      continue;
    }
    if (ch === delimiter) {
      cells.push(field.trim());
      field = "";
      fieldStart = true;
      continue;
    }
    if (ch === "\n" || ch === "\r") continue;
    field += ch;
    fieldStart = false;
  }
  cells.push(field.trim());
  return { cells, inQuotesAtEnd: inQuotes && !malformed, recovered, malformed };
}

/**
 * Turn physical lines into records. `expectedColumns` is the header width once known.
 * Pass the header width on the second pass; the first record may establish it.
 */
/** Stream records from disk. Does not load the file into one string. */
export async function* streamCsvRecords(filePath: string): AsyncGenerator<CsvScanRecord> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const iterator = rl[Symbol.asyncIterator]();
  let physical = 0;
  let expected: number | null = null;
  let lookahead: { rowNumber: number; line: string } | null = null;

  const pull = async (): Promise<{ rowNumber: number; line: string } | null> => {
    if (lookahead) {
      const current = lookahead;
      lookahead = null;
      return current;
    }
    const next = await iterator.next();
    if (next.done) return null;
    physical += 1;
    return { rowNumber: physical, line: String(next.value).replace(/^\uFEFF/, "") };
  };
  const peek = async (): Promise<{ rowNumber: number; line: string } | null> => {
    if (lookahead) return lookahead;
    const next = await iterator.next();
    if (next.done) return null;
    physical += 1;
    lookahead = { rowNumber: physical, line: String(next.value).replace(/^\uFEFF/, "") };
    return lookahead;
  };

  try {
    while (true) {
      const current = await pull();
      if (!current) break;
      if (!current.line.trim() && expected == null) continue;
      let parsed = parseCsvRecordLine(current.line);
      let raw = current.line;
      if (parsed.inQuotesAtEnd) {
        const upcoming = await peek();
        const upcomingParsed = upcoming ? parseCsvRecordLine(upcoming.line) : null;
        const nextIsComplete =
          upcomingParsed != null &&
          !upcomingParsed.inQuotesAtEnd &&
          !upcomingParsed.malformed &&
          expected != null &&
          upcomingParsed.cells.length === expected;
        if (nextIsComplete || upcoming == null) {
          yield {
            rowNumber: current.rowNumber,
            cells: parsed.cells,
            raw: raw.slice(0, 2000),
            recovered: false,
            quarantined: true,
            issue: "Unclosed quote. The row was quarantined and the following record was kept.",
          };
          continue;
        }
        let joined = current.line;
        let steps = 0;
        let closed = parsed;
        while (closed.inQuotesAtEnd && steps < 8) {
          const more = await pull();
          if (!more) break;
          joined += `\n${more.line}`;
          closed = parseCsvRecordLine(joined);
          steps += 1;
          if (expected != null && !closed.inQuotesAtEnd && closed.cells.length === expected) break;
        }
        if (closed.inQuotesAtEnd || closed.malformed) {
          yield {
            rowNumber: current.rowNumber,
            cells: parsed.cells,
            raw: joined.slice(0, 2000),
            recovered: false,
            quarantined: true,
            issue: "Unclosed quote could not be recovered. The raw text is stored on the issue.",
          };
          continue;
        }
        parsed = closed;
        raw = joined;
      }
      if (expected == null && parsed.cells.some((cell) => cell.length > 0)) {
        expected = parsed.cells.length;
      }
      const columnMismatch = expected != null && parsed.cells.length !== expected;
      const quarantined = parsed.malformed || (columnMismatch && parsed.recovered);
      yield {
        rowNumber: current.rowNumber,
        cells: parsed.cells,
        raw: raw.slice(0, 2000),
        recovered: parsed.recovered && !quarantined,
        quarantined,
        issue: quarantined
          ? columnMismatch
            ? `Column count ${parsed.cells.length} does not match the header width ${expected}`
            : "Malformed CSV quoting"
          : null,
      };
    }
  } finally {
    rl.close();
  }
}

export function assembleCsvRecords(lines: string[], expectedColumns?: number): CsvScanRecord[] {
  const records: CsvScanRecord[] = [];
  let expected = expectedColumns ?? null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.replace(/^\uFEFF/, "");
    if (!records.length && !line.trim()) continue;
    let parsed = parseCsvRecordLine(line);
    let raw = line;
    const rowNumber = i + 1;
    if (parsed.inQuotesAtEnd) {
      const next = lines[i + 1];
      const nextParsed = next == null ? null : parseCsvRecordLine(next);
      const nextIsComplete =
        nextParsed != null &&
        !nextParsed.inQuotesAtEnd &&
        !nextParsed.malformed &&
        expected != null &&
        nextParsed.cells.length === expected;
      if (nextIsComplete || next == null) {
        records.push({
          rowNumber,
          cells: parsed.cells,
          raw,
          recovered: false,
          quarantined: true,
          issue: "Unclosed quote. The row was quarantined and the following record was kept.",
        });
        continue;
      }
      let j = i + 1;
      let joined = line;
      let closed = parsed;
      while (j < lines.length && closed.inQuotesAtEnd && j - i < 8) {
        joined += `\n${lines[j]}`;
        closed = parseCsvRecordLine(joined);
        j += 1;
        if (expected != null && !closed.inQuotesAtEnd && closed.cells.length === expected) break;
      }
      if (closed.inQuotesAtEnd || closed.malformed) {
        records.push({
          rowNumber,
          cells: parsed.cells,
          raw: joined.slice(0, 2000),
          recovered: false,
          quarantined: true,
          issue: "Unclosed quote could not be recovered. The raw text is stored on the issue.",
        });
        i = j - 1;
        continue;
      }
      parsed = closed;
      raw = joined;
      i = j - 1;
    }
    if (expected == null && parsed.cells.some((cell) => cell.length > 0)) {
      expected = parsed.cells.length;
    }
    const columnMismatch = expected != null && parsed.cells.length !== expected;
    const quarantined = parsed.malformed || (columnMismatch && parsed.recovered);
    records.push({
      rowNumber,
      cells: parsed.cells,
      raw: raw.slice(0, 2000),
      recovered: parsed.recovered && !quarantined,
      quarantined,
      issue: quarantined
        ? columnMismatch
          ? `Column count ${parsed.cells.length} does not match the header width ${expected}`
          : "Malformed CSV quoting"
        : null,
    });
  }
  return records;
}

export type CanonicalColumn =
  | "account"
  | "invLn"
  | "part"
  | "description"
  | "units"
  | "sales"
  | "name"
  | "sacct"
  | "type"
  | "ref"
  | "date"
  | "goods"
  | "vat"
  | "total"
  | "balance";

const HEADER_ALIASES: Record<CanonicalColumn, string[]> = {
  account: [".acct.", "acct", "account", "a/c", "a c"],
  invLn: ["inv & ln", "inv ln", "invoice line", "inv and ln"],
  part: ["part number", "part", "sku"],
  description: ["description", "desc"],
  units: ["units", "qty", "quantity"],
  sales: ["sales", "value", "amount"],
  name: ["name", "customer name"],
  sacct: ["sacct", "s acct", "sub account"],
  type: ["type"],
  ref: ["ref", "reference"],
  date: ["date"],
  goods: ["tot goods", "goods", "goods amount"],
  vat: ["tot vat", "vat"],
  total: ["total"],
  balance: ["run bal", "running balance", "balance"],
};

export function headerKey(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function detectColumnMap(
  headers: string[],
  required: CanonicalColumn[],
): { map: Partial<Record<CanonicalColumn, number>>; missing: CanonicalColumn[] } {
  const map: Partial<Record<CanonicalColumn, number>> = {};
  headers.forEach((header, index) => {
    const key = headerKey(header);
    if (!key) return;
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES) as [
      CanonicalColumn,
      string[],
    ][]) {
      if (map[canonical] != null) continue;
      if (aliases.includes(key)) map[canonical] = index;
    }
  });
  const missing = required.filter((column) => map[column] == null);
  return { map, missing };
}

export function applyColumnMap(
  headers: string[],
  columnMap: Partial<Record<CanonicalColumn, string>>,
): Partial<Record<CanonicalColumn, number>> {
  const indexByHeader = new Map<string, number>();
  headers.forEach((header, index) => {
    const key = headerKey(header);
    if (key && !indexByHeader.has(key)) indexByHeader.set(key, index);
  });
  const map: Partial<Record<CanonicalColumn, number>> = {};
  for (const [canonical, header] of Object.entries(columnMap) as [CanonicalColumn, string][]) {
    if (!header) continue;
    const index = indexByHeader.get(headerKey(header));
    if (index != null) map[canonical] = index;
  }
  return map;
}

export const INVOICE_REQUIRED_COLUMNS: CanonicalColumn[] = [
  "account",
  "invLn",
  "part",
  "units",
  "sales",
];
export const LEDGER_REQUIRED_COLUMNS: CanonicalColumn[] = [
  "account",
  "type",
  "ref",
  "date",
  "goods",
  "vat",
  "total",
  "balance",
];

export type ParsedInvoiceCsvRow = {
  rowNumber: number;
  accountCode: string;
  rawInvAndLn: string;
  documentType: "INVOICE" | "CREDIT" | "UNKNOWN";
  documentReference: string | null;
  sourceLineNumber: number | null;
  partNumber: string;
  description: string | null;
  quantity: string;
  salesAmount: string;
  salesMeasure: "NET_EX_VAT";
  parseIssue: string | null;
  raw: Record<string, string>;
};

export type ParsedLedgerCsvRow = {
  rowNumber: number;
  accountCode: string;
  originalName: string | null;
  sacct: string | null;
  rawType: string;
  ledgerKind: "INVOICE" | "CREDIT" | "PAYMENT" | "JOURNAL" | "UNKNOWN";
  reference: string;
  transactionDate: string | null;
  goodsAmount: string | null;
  vatAmount: string | null;
  totalAmount: string | null;
  runningBalance: string | null;
  parseIssue: string | null;
  isSalesDocument: boolean;
  raw: Record<string, string>;
};

export type CsvRowRejection = {
  rowNumber: number;
  sourceRecordId: string | null;
  issueType: string;
  explanation: string;
  raw: string;
};

function cell(cells: string[], index: number | undefined): string {
  if (index == null) return "";
  return cells[index] ?? "";
}

function rawObject(headers: string[], cells: string[]): Record<string, string> {
  const raw: Record<string, string> = {};
  headers.forEach((header, index) => {
    const key = header.trim() || `column_${index + 1}`;
    raw[key] = cells[index] ?? "";
  });
  return raw;
}

export function ledgerKindFromRaw(rawType: string): ParsedLedgerCsvRow["ledgerKind"] {
  const t = rawType.trim().toUpperCase();
  if (t === "INV" || t === "INVOICE" || t === "I") return "INVOICE";
  if (t === "CRN" || t === "CREDIT" || t === "C" || t === "CR") return "CREDIT";
  if (["CSH", "CASH", "PAY", "PAYMENT", "REC", "RECEIPT"].includes(t)) return "PAYMENT";
  if (["JNL", "JOURNAL", "ADJ", "ADJUSTMENT", "TRF", "TRANSFER"].includes(t)) return "JOURNAL";
  return "UNKNOWN";
}

export function moneyField(raw: string): { value: string | null; invalid: boolean } {
  if (!raw.trim()) return { value: null, invalid: false };
  const money = parseAutopartMoney(raw);
  if (!money) return { value: null, invalid: true };
  return { value: autopartMoneyToGbp2(money), invalid: false };
}

export function interpretInvoiceRecord(
  record: CsvScanRecord,
  headers: string[],
  map: Partial<Record<CanonicalColumn, number>>,
): { row: ParsedInvoiceCsvRow } | { reject: CsvRowRejection } {
  if (record.quarantined) {
    return {
      reject: {
        rowNumber: record.rowNumber,
        sourceRecordId: null,
        issueType: "MALFORMED_CSV",
        explanation: record.issue || "Malformed CSV row",
        raw: record.raw,
      },
    };
  }
  const accountCode = cell(record.cells, map.account).trim();
  const rawInvAndLn = cell(record.cells, map.invLn).trim();
  const partNumber = cell(record.cells, map.part).trim();
  const unitsRaw = cell(record.cells, map.units);
  const salesRaw = cell(record.cells, map.sales);
  const identity = accountCode || rawInvAndLn || null;
  if (!accountCode) {
    return {
      reject: {
        rowNumber: record.rowNumber,
        sourceRecordId: identity,
        issueType: "MISSING_ACCOUNT",
        explanation: "Invoice line has no account code",
        raw: record.raw,
      },
    };
  }
  if (!partNumber) {
    return {
      reject: {
        rowNumber: record.rowNumber,
        sourceRecordId: accountCode,
        issueType: "MISSING_PART",
        explanation: "Invoice line has no part number",
        raw: record.raw,
      },
    };
  }
  const units = moneyField(unitsRaw);
  const sales = moneyField(salesRaw);
  if (!unitsRaw.trim() || units.invalid || units.value == null) {
    return {
      reject: {
        rowNumber: record.rowNumber,
        sourceRecordId: `${accountCode}:${rawInvAndLn}`,
        issueType: "INVALID_QUANTITY",
        explanation: `Quantity "${unitsRaw}" is not a number`,
        raw: record.raw,
      },
    };
  }
  if (!salesRaw.trim() || sales.invalid || sales.value == null) {
    return {
      reject: {
        rowNumber: record.rowNumber,
        sourceRecordId: `${accountCode}:${rawInvAndLn}`,
        issueType: "INVALID_MONEY",
        explanation: `Sales "${salesRaw}" is not a monetary value`,
        raw: record.raw,
      },
    };
  }
  const parsedRef = parseInvAndLn(rawInvAndLn);
  return {
    row: {
      rowNumber: record.rowNumber,
      accountCode,
      rawInvAndLn,
      documentType: parsedRef.ok ? parsedRef.documentType : "UNKNOWN",
      documentReference: parsedRef.documentReference,
      sourceLineNumber: parsedRef.sourceLineNumber,
      partNumber,
      description: cell(record.cells, map.description).trim() || null,
      quantity: units.value,
      salesAmount: sales.value,
      salesMeasure: "NET_EX_VAT",
      parseIssue: parsedRef.ok ? null : parsedRef.issue,
      raw: rawObject(headers, record.cells),
    },
  };
}

export function interpretLedgerRecord(
  record: CsvScanRecord,
  headers: string[],
  map: Partial<Record<CanonicalColumn, number>>,
): { row: ParsedLedgerCsvRow } | { reject: CsvRowRejection } {
  if (record.quarantined) {
    return {
      reject: {
        rowNumber: record.rowNumber,
        sourceRecordId: null,
        issueType: "MALFORMED_CSV",
        explanation: record.issue || "Malformed CSV row",
        raw: record.raw,
      },
    };
  }
  const accountCode = cell(record.cells, map.account).trim();
  const rawType = cell(record.cells, map.type).trim();
  const reference = cell(record.cells, map.ref).trim();
  const dateRaw = cell(record.cells, map.date).trim();
  if (!accountCode) {
    return {
      reject: {
        rowNumber: record.rowNumber,
        sourceRecordId: reference || null,
        issueType: "MISSING_ACCOUNT",
        explanation: "Ledger row has no account code",
        raw: record.raw,
      },
    };
  }
  if (!rawType || !reference) {
    return {
      reject: {
        rowNumber: record.rowNumber,
        sourceRecordId: accountCode,
        issueType: "MISSING_REFERENCE",
        explanation: "Ledger row needs a type and reference",
        raw: record.raw,
      },
    };
  }
  const goods = moneyField(cell(record.cells, map.goods));
  const vat = moneyField(cell(record.cells, map.vat));
  const total = moneyField(cell(record.cells, map.total));
  const balance = moneyField(cell(record.cells, map.balance));
  const invalid = [
    ["Tot Goods", goods],
    ["Tot VAT", vat],
    ["Total", total],
    ["Run Bal", balance],
  ].find(([, money]) => (money as { invalid: boolean }).invalid);
  if (invalid) {
    return {
      reject: {
        rowNumber: record.rowNumber,
        sourceRecordId: `${accountCode}:${reference}`,
        issueType: "INVALID_MONEY",
        explanation: `${invalid[0] as string} is not a monetary value`,
        raw: record.raw,
      },
    };
  }
  const transactionDate = dateRaw ? parseAutopartDateOnly(dateRaw) : null;
  const ledgerKind = ledgerKindFromRaw(rawType);
  const dateIssue = dateRaw && !transactionDate ? `Date "${dateRaw}" was not recognised` : null;
  const typeIssue =
    ledgerKind === "UNKNOWN"
      ? `Transaction type "${rawType}" is not a known sales, credit, payment, or adjustment type`
      : null;
  return {
    row: {
      rowNumber: record.rowNumber,
      accountCode,
      originalName: cell(record.cells, map.name).trim() || null,
      sacct: cell(record.cells, map.sacct).trim() || null,
      rawType,
      ledgerKind,
      reference,
      transactionDate,
      goodsAmount: goods.value,
      vatAmount: vat.value,
      totalAmount: total.value,
      runningBalance: balance.value,
      parseIssue: [dateIssue, typeIssue].filter(Boolean).join(". ") || null,
      isSalesDocument: ledgerKind === "INVOICE" || ledgerKind === "CREDIT",
      raw: rawObject(headers, record.cells),
    },
  };
}

export type DocumentMatchStatus =
  | "MATCHED"
  | "PARTIALLY_MATCHED"
  | "LEDGER_ONLY"
  | "PRODUCT_LINES_ONLY"
  | "AMOUNT_DISCREPANCY"
  | "AMBIGUOUS"
  | "REQUIRES_REVIEW";

/** Compare one document's product lines with ledger invoice/credit rows. Payments are not passed here. */
export function reconciliationStatus(input: {
  lineCount: number;
  lineSales: string | null;
  parsedLineIssues: number;
  ledgerCount: number;
  ledgerGoods: string | null;
}): DocumentMatchStatus {
  if (input.lineCount === 0 && input.ledgerCount === 0) return "REQUIRES_REVIEW";
  if (input.lineCount === 0) return "LEDGER_ONLY";
  if (input.ledgerCount === 0) return "PRODUCT_LINES_ONLY";
  if (input.ledgerCount > 1) return "AMBIGUOUS";
  if (input.ledgerGoods == null || input.lineSales == null) return "REQUIRES_REVIEW";
  if (input.lineSales !== input.ledgerGoods) return "AMOUNT_DISCREPANCY";
  if (input.parsedLineIssues > 0) return "PARTIALLY_MATCHED";
  return "MATCHED";
}
