/**
 * Streaming-friendly CSV recovery for Autopart 561L and SLRB exports.
 *
 * Documented 561L columns: .Acct., Inv & Ln, Part Number, Description, Units, Sales.
 * Callers may still supply a column map when a header differs.
 *
 * Autopart product descriptions use a quotation mark as an inch symbol (`14"`,
 * `15"`, `16"`), including inside an otherwise quoted field. The previous
 * scanner closed a quoted field on the first digit-plus-quote, so a real closing
 * quote was left on the description while the row still had six columns and was
 * counted as recovered. A quote that was not after a digit set a sticky malformed
 * flag, which rejected rows such as `O"Ring` as MALFORMED_CSV even when the
 * columns had already been read correctly.
 *
 * RFC 4180 quoting is unchanged. An interior quote stays in the field when a
 * later quote still closes that same field. A 561L row that still does not
 * line up is recovered only when the first three columns and the last two
 * numeric columns identify one description. Adjacent records are not joined
 * to absorb an unmatched quote. Anything else is quarantined with its source
 * row number and is not given a fabricated value.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  autopartMoneyToGbp2,
  parseAutopartDateOnly,
  parseAutopartMoney,
} from "@/domain/autopart-report-money";
import { parseInvAndLn } from "@/domain/autopart-561l";
import { addMoney, moneyToString, moneyZero, parseMoney, type Money } from "@/domain/money";

/** Documented 561L export width, including Description between the part and the quantities. */
const INVOICE_CSV_WIDTH = 6;

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

function quoteClosesField(line: string, index: number, delimiter: string): boolean {
  const next = line[index + 1];
  return next == null || next === delimiter || next === "\n" || next === "\r";
}

/** True when a later quote still ends this field before a delimiter. */
function hasLaterFieldCloser(line: string, from: number, delimiter: string): boolean {
  for (let k = from; k < line.length; k += 1) {
    if (line[k] !== '"') continue;
    if (line[k + 1] === '"') {
      k += 1;
      continue;
    }
    if (quoteClosesField(line, k, delimiter)) return true;
  }
  return false;
}

/** Parse one physical line. Does not read later lines or invent missing columns. */
export function parseCsvRecordLine(line: string, delimiter = ","): ParsedLine {
  const cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStart = true;
  let recovered = false;

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
        if (quoteClosesField(line, i, delimiter)) {
          inQuotes = false;
          fieldStart = false;
          continue;
        }
        if (hasLaterFieldCloser(line, i + 1, delimiter)) {
          field += '"';
          recovered = true;
          fieldStart = false;
          continue;
        }
        field += ch;
        recovered = true;
        fieldStart = false;
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
  return { cells, inQuotesAtEnd: inQuotes, recovered, malformed: false };
}

type SettledLine = {
  cells: string[];
  recovered: boolean;
  quarantined: boolean;
  issue: string | null;
  /** Unclosed quote on this line alone. The caller must not merge it into the next record. */
  joinable: boolean;
};

function isNumericToken(raw: string): boolean {
  if (!raw.trim()) return false;
  const money = moneyField(raw);
  return !money.invalid && money.value != null;
}

function parseLeadingFields(
  line: string,
  delimiter: string,
  count: number,
): { fields: string[]; rest: string } | null {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  let i = 0;
  for (; i < line.length && fields.length < count; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      fields.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (inQuotes) return null;
  if (fields.length === count) return { fields, rest: line.slice(i) };
  if (fields.length === count - 1) {
    fields.push(cur.trim());
    return { fields, rest: "" };
  }
  return null;
}

function peelTrailingNumericFields(
  segment: string,
  delimiter: string,
  count: number,
): { fields: string[]; descriptionRaw: string } | null {
  let rest = segment.replace(/\s+$/, "");
  const fields: string[] = [];
  for (let n = 0; n < count; n += 1) {
    if (!rest.length) return null;
    if (rest.endsWith('"')) {
      const end = rest.length - 1;
      let open = -1;
      for (let i = end - 1; i >= 0; i -= 1) {
        if (rest[i] === '"') {
          if (i > 0 && rest[i - 1] === '"') {
            i -= 1;
            continue;
          }
          open = i;
          break;
        }
      }
      if (open < 0) return null;
      const value = rest.slice(open + 1, end);
      if (value.includes('"') || !isNumericToken(value)) return null;
      fields.unshift(value.trim());
      rest = rest.slice(0, open).replace(/\s+$/, "");
      if (rest.endsWith(delimiter)) rest = rest.slice(0, -delimiter.length);
      else if (rest.length > 0) return null;
      continue;
    }
    const delimAt = rest.lastIndexOf(delimiter);
    const value = delimAt < 0 ? rest : rest.slice(delimAt + delimiter.length);
    if (!isNumericToken(value)) return null;
    fields.unshift(value.trim());
    if (delimAt < 0) {
      rest = "";
      if (n !== count - 1) return null;
    } else {
      rest = rest.slice(0, delimAt);
    }
  }
  return { fields, descriptionRaw: rest };
}

function normaliseRecoveredDescription(raw: string): string {
  let description = raw.trim();
  if (description.startsWith('"') && description.endsWith('"') && description.length >= 2) {
    description = description.slice(1, -1);
  } else if (description.startsWith('"')) {
    description = description.slice(1);
  }
  return description.replace(/""/g, '"').trim();
}

/**
 * Rebuild one 561L row from a fixed column layout.
 * Returns null when the trailing quantity could also be read from more than one numeric field.
 */
function recoverInvoiceCsvLine(line: string): { cells: string[] } | "ambiguous" | null {
  const leading = parseLeadingFields(line, ",", 3);
  if (!leading || leading.fields.length !== 3) return null;
  if (!leading.fields[0] || !leading.fields[2]) return null;
  const peeled = peelTrailingNumericFields(leading.rest, ",", 2);
  if (!peeled || peeled.fields.length !== 2) return null;
  if (peelTrailingNumericFields(leading.rest, ",", 3)) return "ambiguous";
  const description = normaliseRecoveredDescription(peeled.descriptionRaw);
  return {
    cells: [
      leading.fields[0],
      leading.fields[1] ?? "",
      leading.fields[2],
      description,
      peeled.fields[0]!,
      peeled.fields[1]!,
    ],
  };
}

function looksLike561lRecordStart(line: string): boolean {
  const leading = parseLeadingFields(line, ",", 2);
  if (!leading || leading.fields.length < 2) return false;
  return /^[IC]\//i.test(leading.fields[1] ?? "");
}

function settleCsvLine(line: string, expected: number | null): SettledLine {
  const parsed = parseCsvRecordLine(line);
  const widthOk = expected == null || parsed.cells.length === expected;
  if (!parsed.inQuotesAtEnd && widthOk) {
    return {
      cells: parsed.cells,
      recovered: parsed.recovered,
      quarantined: false,
      issue: null,
      joinable: false,
    };
  }
  if (expected === INVOICE_CSV_WIDTH) {
    const recovered = recoverInvoiceCsvLine(line);
    if (recovered === "ambiguous") {
      return {
        cells: parsed.cells,
        recovered: false,
        quarantined: true,
        issue:
          "Ambiguous CSV quoting. Another trailing numeric field could be the quantity, so this row was not recovered.",
        joinable: false,
      };
    }
    if (recovered) {
      return {
        cells: recovered.cells,
        recovered: true,
        quarantined: false,
        issue: null,
        joinable: false,
      };
    }
  }
  if (parsed.inQuotesAtEnd) {
    return {
      cells: parsed.cells,
      recovered: false,
      quarantined: false,
      issue: null,
      joinable: true,
    };
  }
  const columnMismatch = expected != null && parsed.cells.length !== expected;
  return {
    cells: parsed.cells,
    recovered: false,
    quarantined: true,
    issue: columnMismatch
      ? `Column count ${parsed.cells.length} does not match the header width ${expected}`
      : "Malformed CSV quoting",
    joinable: false,
  };
}

function unclosedQuoteRecord(rowNumber: number, raw: string, cells: string[]): CsvScanRecord {
  return {
    rowNumber,
    cells,
    raw: raw.slice(0, 2000),
    recovered: false,
    quarantined: true,
    issue: "Unclosed quote. The row was quarantined and the following record was kept.",
  };
}

function recordFromSettled(
  rowNumber: number,
  raw: string,
  settled: SettledLine,
  expected: number | null,
): { record: CsvScanRecord; expected: number | null } {
  let nextExpected = expected;
  if (nextExpected == null && settled.cells.some((cell) => cell.length > 0)) {
    nextExpected = settled.cells.length;
  }
  const columnMismatch = nextExpected != null && settled.cells.length !== nextExpected;
  const quarantined = settled.quarantined || (columnMismatch && settled.recovered);
  return {
    expected: nextExpected,
    record: {
      rowNumber,
      cells: settled.cells,
      raw: raw.slice(0, 2000),
      recovered: settled.recovered && !quarantined,
      quarantined,
      issue: quarantined
        ? columnMismatch && !settled.issue
          ? `Column count ${settled.cells.length} does not match the header width ${nextExpected}`
          : settled.issue ||
            (columnMismatch
              ? `Column count ${settled.cells.length} does not match the header width ${nextExpected}`
              : "Malformed CSV quoting")
        : null,
    },
  };
}

function continuationStandsAlone(line: string, expected: number | null): boolean {
  const settled = settleCsvLine(line, expected);
  if (settled.quarantined || settled.joinable) return false;
  if (expected === INVOICE_CSV_WIDTH && looksLike561lRecordStart(line)) return true;
  return expected != null && settled.cells.length === expected;
}

/**
 * Join a wrapped quoted field only when the following physical line is not itself a record.
 * A 561L row that starts with an account and an I/ or C/ reference is never absorbed.
 */
function joinWrappedQuote(
  lines: string[],
  start: number,
  expected: number | null,
): { settled: SettledLine; raw: string; lastIndex: number } | null {
  const first = lines[start];
  if (first == null) return null;
  const next = lines[start + 1];
  if (next == null || continuationStandsAlone(next, expected)) return null;
  let joined = first;
  let lastIndex = start;
  let settled = settleCsvLine(first, expected);
  for (let j = start + 1; j < lines.length && j - start < 8 && settled.joinable; j += 1) {
    const continuation = lines[j]!;
    if (looksLike561lRecordStart(continuation) || continuationStandsAlone(continuation, expected))
      break;
    joined += `\n${continuation}`;
    lastIndex = j;
    settled = settleCsvLine(joined, expected);
    if (!settled.joinable && !settled.quarantined) {
      return { settled, raw: joined, lastIndex };
    }
  }
  return null;
}

/** Stream records from disk. Does not load the file into one string. */
export async function* streamCsvRecords(filePath: string): AsyncGenerator<CsvScanRecord> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const iterator = rl[Symbol.asyncIterator]();
  let physical = 0;
  let expected: number | null = null;
  const pending: { rowNumber: number; line: string }[] = [];

  const pull = async (): Promise<{ rowNumber: number; line: string } | null> => {
    const queued = pending.shift();
    if (queued) return queued;
    const next = await iterator.next();
    if (next.done) return null;
    physical += 1;
    return { rowNumber: physical, line: String(next.value).replace(/^\uFEFF/, "") };
  };

  try {
    while (true) {
      const current = await pull();
      if (!current) break;
      if (!current.line.trim() && expected == null) continue;
      let settled = settleCsvLine(current.line, expected);
      let raw = current.line;
      if (settled.joinable) {
        const buffered: { rowNumber: number; line: string }[] = [];
        let joined = current.line;
        let closed = settled;
        let consumed = 0;
        while (closed.joinable && consumed < 8) {
          const more = await pull();
          if (!more) break;
          if (looksLike561lRecordStart(more.line) || continuationStandsAlone(more.line, expected)) {
            pending.unshift(more);
            break;
          }
          buffered.push(more);
          joined += `\n${more.line}`;
          consumed += 1;
          closed = settleCsvLine(joined, expected);
          if (!closed.joinable && !closed.quarantined) break;
        }
        if (!closed.joinable && !closed.quarantined) {
          settled = closed;
          raw = joined;
        } else {
          pending.unshift(...buffered);
          yield unclosedQuoteRecord(current.rowNumber, current.line, settled.cells);
          continue;
        }
      }
      const finished = recordFromSettled(current.rowNumber, raw, settled, expected);
      expected = finished.expected;
      yield finished.record;
    }
  } finally {
    rl.close();
  }
}

export function assembleCsvRecords(lines: string[], expectedColumns?: number): CsvScanRecord[] {
  const records: CsvScanRecord[] = [];
  let expected = expectedColumns ?? null;
  const normalised = lines.map((line) => line.replace(/^\uFEFF/, ""));
  for (let i = 0; i < normalised.length; i += 1) {
    const line = normalised[i]!;
    if (!records.length && !line.trim()) continue;
    const rowNumber = i + 1;
    let settled = settleCsvLine(line, expected);
    let raw = line;
    if (settled.joinable) {
      const joined = joinWrappedQuote(normalised, i, expected);
      if (!joined) {
        records.push(unclosedQuoteRecord(rowNumber, line, settled.cells));
        continue;
      }
      settled = joined.settled;
      raw = joined.raw;
      i = joined.lastIndex;
    }
    const finished = recordFromSettled(rowNumber, raw, settled, expected);
    expected = finished.expected;
    records.push(finished.record);
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

export type CsvPreviewExample = {
  rowNumber: number;
  issueType: string;
  explanation: string;
  redacted: string;
};

export type CsvPreviewTally = {
  sourceRecords: number;
  validRecords: number;
  recoveredRecords: number;
  rejectedRecords: number;
  acceptedSales: string | null;
  recoveredSales: string | null;
  rejectionReasons: { issueType: string; count: number }[];
  rejectedExamples: CsvPreviewExample[];
  unresolvedParsing: boolean;
};

/** Hide the account code on a rejected example and keep the quoting problem visible. */
export function redactCsvExample(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  const comma = flat.indexOf(",");
  const account = comma === -1 ? flat : flat.slice(0, comma);
  const bare = account.replace(/^"|"$/g, "");
  const masked = bare.length <= 2 ? "***" : `${bare.slice(0, 2)}***`;
  const shown =
    comma === -1
      ? masked
      : `${account.startsWith('"') ? `"${masked}"` : masked}${flat.slice(comma)}`;
  return shown.length > 180 ? `${shown.slice(0, 177)}...` : shown;
}

export function createCsvPreviewTally(kind: "invoice" | "ledger") {
  let sourceRecords = 0;
  let validRecords = 0;
  let recoveredRecords = 0;
  let rejectedRecords = 0;
  let accepted = moneyZero();
  let recovered = moneyZero();
  const reasons = new Map<string, number>();
  const rejectedExamples: CsvPreviewExample[] = [];

  const addSales = (total: Money, amount: string): Money => {
    const parsed = parseMoney(amount);
    return parsed ? addMoney(total, parsed) : total;
  };

  return {
    add(
      record: CsvScanRecord,
      result: { row: { accountCode: string; salesAmount?: string } } | { reject: CsvRowRejection },
    ) {
      sourceRecords += 1;
      if ("reject" in result) {
        rejectedRecords += 1;
        reasons.set(result.reject.issueType, (reasons.get(result.reject.issueType) ?? 0) + 1);
        if (rejectedExamples.length < 8) {
          rejectedExamples.push({
            rowNumber: result.reject.rowNumber,
            issueType: result.reject.issueType,
            explanation: result.reject.explanation,
            redacted: redactCsvExample(result.reject.raw),
          });
        }
        return;
      }
      const salesAmount = result.row.salesAmount;
      if (record.recovered) {
        recoveredRecords += 1;
        if (kind === "invoice" && salesAmount) {
          recovered = addSales(recovered, salesAmount);
          accepted = addSales(accepted, salesAmount);
        }
        return;
      }
      validRecords += 1;
      if (kind === "invoice" && salesAmount) accepted = addSales(accepted, salesAmount);
    },
    finish(): CsvPreviewTally {
      return {
        sourceRecords,
        validRecords,
        recoveredRecords,
        rejectedRecords,
        acceptedSales: kind === "invoice" ? moneyToString(accepted, 2) : null,
        recoveredSales: kind === "invoice" ? moneyToString(recovered, 2) : null,
        rejectionReasons: [...reasons.entries()]
          .map(([issueType, count]) => ({ issueType, count }))
          .sort((a, b) => b.count - a.count || a.issueType.localeCompare(b.issueType)),
        rejectedExamples,
        unresolvedParsing: rejectedRecords > 0,
      };
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
