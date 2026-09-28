/**
 * Autopart SLRB — historic document/ledger headers and dates.
 *
 * Native printed layout (confirmed against real Autopart output):
 *
 *   A/C        Name                               Sacct      Type Ref         Date         Tot Goods     Tot VAT       Total   Run Bal
 *   YORKMOTO   YORK MOTOR FACTORS                            INV  SS100818    06 Oct 14       333.72       66.74      400.46    624.03
 *
 * Critical:
 * - A/C is the full account (not truncated). Name is a separate column.
 * - Never treat "YORKMOTO YORK MOTOR FACTORS" as a single account token.
 * - `[Start Customer XXX]` / `[End Customer XXX]` identify the selected customer.
 */
import {
  autopartMoneyToGbp2,
  extractAutopartAccountCode,
  extractReportCustomerSelection,
  headerKey,
  normaliseReportLines,
  parseAutopartDateOnly,
  parseAutopartMoney,
  splitAutopartReportCells,
  splitCsvLine,
} from "@/domain/autopart-report-money";

export type AutopartSlrbDocumentType =
  | "INVOICE"
  | "CREDIT"
  | "PAYMENT"
  | "JOURNAL"
  | "UNKNOWN";

export type AutopartSlrbRowKind =
  | "REPORT_TITLE"
  | "PAGE_HEADER"
  | "COLUMN_HEADER"
  | "SELECTION_PARAM"
  | "DOCUMENT"
  | "LEDGER"
  | "TOTAL"
  | "BLANK"
  | "UNKNOWN"
  | "MALFORMED";

export type AutopartSlrbRow = {
  lineNumberInFile: number;
  rowKind: AutopartSlrbRowKind;
  accountCode: string | null;
  customerName: string | null;
  rawType: string | null;
  documentType: AutopartSlrbDocumentType;
  documentReference: string | null;
  /** YYYY-MM-DD when parseable — date-only, no timezone shift. */
  documentDate: string | null;
  goodsNet: string | null;
  vat: string | null;
  grossTotal: string | null;
  runBalance: string | null;
  classification: "DOCUMENT" | "HEADER" | "TOTAL" | "BLANK" | "MALFORMED" | "LEDGER";
  issue: string | null;
};

export type AutopartSlrbColumnLayout = {
  account: { start: number; end: number };
  name: { start: number; end: number };
  sacct: { start: number; end: number } | null;
  type: { start: number; end: number };
  ref: { start: number; end: number };
  date: { start: number; end: number };
  moneyStart: number;
};

export type AutopartSlrbParseResult = {
  report: "SLRB";
  rows: AutopartSlrbRow[];
  documents: AutopartSlrbRow[];
  invoiceDocuments: number;
  creditDocuments: number;
  ledgerRecords: number;
  malformedRows: number;
  detectedAccounts: string[];
  reportStartCustomer: string | null;
  reportEndCustomer: string | null;
  headerFound: boolean;
  accountFieldWidth: number | null;
  layout: "CSV" | "NATIVE_FIXED" | "SPACED" | "POSITIONAL" | null;
  columnLayout: AutopartSlrbColumnLayout | null;
  errors: string[];
  diagnostics: {
    uniqueDocumentRefs: string[];
    uniqueInvoiceRefs: string[];
    uniqueCreditRefs: string[];
  };
};

const HEADER_ALIASES: Record<string, string> = {
  "a c": "account",
  acct: "account",
  account: "account",
  type: "type",
  ref: "ref",
  reference: "ref",
  date: "date",
  "tot goods": "goods",
  "total goods": "goods",
  goods: "goods",
  "tot vat": "vat",
  "total vat": "vat",
  vat: "vat",
  total: "total",
  "run bal": "runBal",
  "run balance": "runBal",
  balance: "runBal",
};

const START_CUSTOMER_RE = /\[\s*Start\s+Customer\s+([A-Za-z0-9][A-Za-z0-9_-]*)\s*\]/i;
const END_CUSTOMER_RE = /\[\s*End\s+Customer\s+([A-Za-z0-9][A-Za-z0-9_-]*)\s*\]/i;

/** Explicit document type map — unknown types stay UNKNOWN (no inference). */
export function mapSlrbDocumentType(raw: string | null | undefined): AutopartSlrbDocumentType {
  if (!raw) return "UNKNOWN";
  const t = raw.trim().toUpperCase();
  if (t === "INV" || t === "INVOICE" || t === "I") return "INVOICE";
  if (t === "CRN" || t === "CREDIT" || t === "C" || t === "CR") return "CREDIT";
  if (t === "PAY" || t === "PAYMENT" || t === "CASH" || t === "REC" || t === "RECEIPT") {
    return "PAYMENT";
  }
  if (t === "JNL" || t === "JOURNAL" || t === "ADJ") return "JOURNAL";
  return "UNKNOWN";
}

function looksLikeSlrbHeaderLine(raw: string): boolean {
  const u = raw.toUpperCase();
  const hasAcct = /\bA\/C\b/.test(u) || /\bACCT\.?\b/.test(u) || /\bACCOUNT\b/.test(u);
  const hasType = /\bTYPE\b/.test(u);
  const hasRef = /\bREF\b/.test(u);
  const hasDate = /\bDATE\b/.test(u);
  return hasAcct && hasType && hasRef && hasDate;
}

function looksLikeNativeSlrbHeader(raw: string): boolean {
  return looksLikeSlrbHeaderLine(raw) && /\bName\b/i.test(raw) && !raw.includes(",");
}

/**
 * Derive column starts from a native SLRB header that includes Name / Sacct.
 */
export function detectNativeSlrbLayout(headerLine: string): AutopartSlrbColumnLayout | null {
  if (!looksLikeNativeSlrbHeader(headerLine)) return null;
  if (headerLine.includes(",") || headerLine.includes("\t")) return null;
  const account = headerLine.search(/\bA\/C\b/i);
  const name = headerLine.search(/\bName\b/i);
  const sacctIdx = headerLine.search(/\bSacct\b/i);
  const type = headerLine.search(/\bType\b/i);
  const ref = headerLine.search(/\bRef(?:erence)?\b/i);
  const date = headerLine.search(/\bDate\b/i);
  const goods = headerLine.search(/\bTot(?:al)?\s*Goods\b/i);
  if (account < 0 || name < 0 || type < 0 || ref < 0 || date < 0) return null;
  if (!(account < name && name < type && type < ref && ref < date)) return null;

  const sacctEnd = sacctIdx >= 0 && sacctIdx < type ? sacctIdx : type;
  return {
    account: { start: account, end: name },
    name: { start: name, end: sacctEnd },
    sacct: sacctIdx >= 0 && sacctIdx < type ? { start: sacctIdx, end: type } : null,
    type: { start: type, end: ref },
    ref: { start: ref, end: date },
    date: { start: date, end: goods >= 0 ? goods : date + 14 },
    moneyStart: goods >= 0 ? goods : date + 14,
  };
}

function sliceCol(line: string, start: number, end: number | null): string {
  const padded = line.length < start ? line.padEnd(start) : line;
  if (end == null) return padded.slice(start);
  const src = padded.length < end ? padded.padEnd(end) : padded;
  return src.slice(start, end);
}

function moneyFieldsFromTail(tail: string): {
  goods: string | null;
  vat: string | null;
  total: string | null;
  runBal: string | null;
} {
  // Right-aligned money columns can overlap label starts — take last 4 money tokens.
  const tokens = tail.trim().split(/\s+/).filter(Boolean);
  const moneyLike = tokens.filter((t) => parseAutopartMoney(t) != null);
  const take = moneyLike.slice(-4);
  while (take.length < 4) take.unshift("");
  return {
    goods: take[0] || null,
    vat: take[1] || null,
    total: take[2] || null,
    runBal: take[3] || null,
  };
}

export function parseNativeSlrbDataLine(
  raw: string,
  layout: AutopartSlrbColumnLayout,
): {
  accountRaw: string;
  nameRaw: string;
  typeRaw: string;
  refRaw: string;
  dateRaw: string;
  goods: string | null;
  vat: string | null;
  total: string | null;
  runBal: string | null;
} | null {
  if (raw.length < layout.type.start) return null;
  const accountRaw = sliceCol(raw, layout.account.start, layout.account.end).trim();
  const nameRaw = sliceCol(raw, layout.name.start, layout.name.end).trim();
  const typeRaw = sliceCol(raw, layout.type.start, layout.type.end).trim();
  const refRaw = sliceCol(raw, layout.ref.start, layout.ref.end).trim();
  const dateRaw = sliceCol(raw, layout.date.start, layout.date.end).trim();
  if (!typeRaw || !refRaw) return null;
  if (mapSlrbDocumentType(typeRaw) === "UNKNOWN" && !/^[A-Z]{2,4}$/i.test(typeRaw)) return null;
  const money = moneyFieldsFromTail(raw.slice(layout.moneyStart));
  return {
    accountRaw,
    nameRaw,
    typeRaw,
    refRaw,
    dateRaw,
    ...money,
  };
}

function mapHeader(cells: string[]): {
  account: number;
  type: number;
  ref: number;
  date: number;
  goods?: number;
  vat?: number;
  total?: number;
  runBal?: number;
  name?: number;
} | null {
  const map: Partial<Record<string, number>> = {};
  cells.forEach((cell, idx) => {
    const key = HEADER_ALIASES[headerKey(cell)];
    if (key) map[key] = idx;
  });
  if (map["account"] != null && map["type"] != null && map["ref"] != null && map["date"] != null) {
    return {
      account: map["account"],
      type: map["type"],
      ref: map["ref"],
      date: map["date"],
      ...(map["goods"] != null ? { goods: map["goods"] } : {}),
      ...(map["vat"] != null ? { vat: map["vat"] } : {}),
      ...(map["total"] != null ? { total: map["total"] } : {}),
      ...(map["runBal"] != null ? { runBal: map["runBal"] } : {}),
      ...(map["name"] != null ? { name: map["name"] } : {}),
    };
  }
  return null;
}

function cellAt(cells: string[], idx: number | undefined): string | null {
  if (idx == null) return null;
  return cells[idx] ?? null;
}

function blank(lineNumberInFile: number, kind: AutopartSlrbRowKind = "BLANK"): AutopartSlrbRow {
  return {
    lineNumberInFile,
    rowKind: kind,
    accountCode: null,
    customerName: null,
    rawType: null,
    documentType: "UNKNOWN",
    documentReference: null,
    documentDate: null,
    goodsNet: null,
    vat: null,
    grossTotal: null,
    runBalance: null,
    classification: kind === "BLANK" ? "BLANK" : kind === "TOTAL" ? "TOTAL" : "HEADER",
    issue: null,
  };
}

function buildRow(input: {
  lineNumberInFile: number;
  accountRaw: string | null;
  nameRaw?: string | null;
  typeRaw: string | null;
  refRaw: string | null;
  dateRaw: string | null;
  goodsRaw: string | null;
  vatRaw: string | null;
  totalRaw: string | null;
  runBalRaw: string | null;
}): AutopartSlrbRow {
  // Account ONLY from the A/C field — never concatenate with Name.
  const accountCode = extractAutopartAccountCode(input.accountRaw);
  const customerName = (input.nameRaw ?? "").trim() || null;
  const rawType = (input.typeRaw ?? "").trim() || null;
  const documentType = mapSlrbDocumentType(rawType);
  const documentReference = (input.refRaw ?? "").trim().toUpperCase() || null;
  const documentDate = parseAutopartDateOnly(input.dateRaw);
  const goods = parseAutopartMoney(input.goodsRaw);
  const vat = parseAutopartMoney(input.vatRaw);
  const total = parseAutopartMoney(input.totalRaw);
  const runBal = parseAutopartMoney(input.runBalRaw);

  const isSalesDoc = documentType === "INVOICE" || documentType === "CREDIT";
  const ok = Boolean(accountCode && documentReference && documentType !== "UNKNOWN");

  return {
    lineNumberInFile: input.lineNumberInFile,
    rowKind: !ok ? "MALFORMED" : isSalesDoc ? "DOCUMENT" : "LEDGER",
    accountCode,
    customerName,
    rawType,
    documentType,
    documentReference,
    documentDate,
    goodsNet: goods ? autopartMoneyToGbp2(goods) : null,
    vat: vat ? autopartMoneyToGbp2(vat) : null,
    grossTotal: total ? autopartMoneyToGbp2(total) : null,
    runBalance: runBal ? autopartMoneyToGbp2(runBal) : null,
    classification: !ok ? "MALFORMED" : isSalesDoc ? "DOCUMENT" : "LEDGER",
    issue: ok
      ? documentDate
        ? null
        : "Unparseable date"
      : !accountCode
        ? input.accountRaw?.trim()
          ? "Invalid account field (not an Autopart customer code)"
          : "Missing account"
        : !documentReference
          ? "Missing reference"
          : `Unknown document type: ${rawType ?? ""}`,
  };
}

function looksLikeReportTitle(raw: string): boolean {
  const u = raw.trim().toUpperCase();
  if (/\bSLRB\b/.test(u) && !looksLikeSlrbHeaderLine(raw)) return true;
  if (/^END OF REPORT/.test(u)) return true;
  return false;
}

function looksLikePageChrome(raw: string): boolean {
  const u = raw.trim().toUpperCase();
  if (/^PAGE\s+\d+/.test(u)) return true;
  if (/\bPAGE\s+\d+\s+OF\s+\d+\b/.test(u)) return true;
  if (/^-{3,}$/.test(u) || /^={3,}$/.test(u)) return true;
  return false;
}

/** Space-separated SLRB data row without Name column (legacy CSV-like spacing). */
function parseSpacedSlrbDataRow(raw: string): {
  account: string;
  type: string;
  ref: string;
  date: string;
  goods: string | null;
  vat: string | null;
  total: string | null;
  runBal: string | null;
} | null {
  const m = raw
    .trim()
    .match(
      /^(\S+)\s+(\S+)\s+(\S+)\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\s+(.+)$/,
    );
  if (!m) return null;
  if (mapSlrbDocumentType(m[2]) === "UNKNOWN" && !/^[A-Z]{2,4}$/i.test(m[2]!)) return null;
  const money = moneyFieldsFromTail(m[5]!);
  return {
    account: m[1]!,
    type: m[2]!,
    ref: m[3]!,
    date: m[4]!,
    ...money,
  };
}

export function parseAutopartSlrb(text: string): AutopartSlrbParseResult {
  const selection = extractReportCustomerSelection(text);
  const lines = normaliseReportLines(text);
  const errors: string[] = [];
  const rows: AutopartSlrbRow[] = [];
  type ColMap = {
    account: number;
    type: number;
    ref: number;
    date: number;
    goods?: number;
    vat?: number;
    total?: number;
    runBal?: number;
    name?: number;
  };

  let headerFound = false;
  let colMap: ColMap | null = null;
  let columnLayout: AutopartSlrbColumnLayout | null = null;
  let accountFieldWidth: number | null = null;
  let layout: AutopartSlrbParseResult["layout"] = null;
  const accounts = new Set<string>();
  let lastAccountRaw: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNumberInFile = i + 1;
    if (!rawLine.trim()) {
      rows.push(blank(lineNumberInFile));
      continue;
    }

    if (looksLikeReportTitle(rawLine)) {
      rows.push(blank(lineNumberInFile, "REPORT_TITLE"));
      continue;
    }
    if (START_CUSTOMER_RE.test(rawLine) || END_CUSTOMER_RE.test(rawLine)) {
      rows.push(blank(lineNumberInFile, "SELECTION_PARAM"));
      continue;
    }
    if (looksLikePageChrome(rawLine)) {
      rows.push(blank(lineNumberInFile, "PAGE_HEADER"));
      continue;
    }

    const native = detectNativeSlrbLayout(rawLine);
    if (native) {
      headerFound = true;
      columnLayout = native;
      layout = "NATIVE_FIXED";
      accountFieldWidth = null; // SLRB prints full account codes
      rows.push(blank(lineNumberInFile, "COLUMN_HEADER"));
      continue;
    }

    if (!headerFound && looksLikeSlrbHeaderLine(rawLine)) {
      const cells = splitAutopartReportCells(rawLine);
      const mapped = mapHeader(cells.length >= 4 ? cells : splitCsvLine(rawLine));
      if (mapped) {
        headerFound = true;
        colMap = mapped;
        layout = rawLine.includes(",") || rawLine.includes("\t") ? "CSV" : "SPACED";
        rows.push(blank(lineNumberInFile, "COLUMN_HEADER"));
        continue;
      }
      headerFound = true;
      layout = "SPACED";
      rows.push(blank(lineNumberInFile, "COLUMN_HEADER"));
      continue;
    }

    if (columnLayout) {
      const joined = rawLine.toUpperCase();
      if (/\bTOTALS?\b/.test(joined) && !/\b(INV|CRN|PAY|JNL)\b/.test(joined)) {
        rows.push(blank(lineNumberInFile, "TOTAL"));
        continue;
      }
      const parsed = parseNativeSlrbDataLine(rawLine, columnLayout);
      if (parsed) {
        let accountRaw = parsed.accountRaw;
        if (!accountRaw.trim() && lastAccountRaw) accountRaw = lastAccountRaw;
        if (parsed.accountRaw.trim()) lastAccountRaw = parsed.accountRaw;
        const row = buildRow({
          lineNumberInFile,
          accountRaw,
          nameRaw: parsed.nameRaw,
          typeRaw: parsed.typeRaw,
          refRaw: parsed.refRaw,
          dateRaw: parsed.dateRaw,
          goodsRaw: parsed.goods,
          vatRaw: parsed.vat,
          totalRaw: parsed.total,
          runBalRaw: parsed.runBal,
        });
        if (
          (row.classification === "DOCUMENT" || row.classification === "LEDGER") &&
          row.accountCode
        ) {
          accounts.add(row.accountCode);
        }
        rows.push(row);
        continue;
      }
    }

    if (colMap) {
      const cells = splitAutopartReportCells(rawLine);
      let accountRaw = cellAt(cells, colMap.account);
      if (!(accountRaw ?? "").trim() && lastAccountRaw) accountRaw = lastAccountRaw;
      if ((cellAt(cells, colMap.account) ?? "").trim()) {
        lastAccountRaw = cellAt(cells, colMap.account);
      }
      const joined = cells.join(" ").toUpperCase();
      if (joined.includes("TOTAL") && !cellAt(cells, colMap.ref)) {
        rows.push(blank(lineNumberInFile, "TOTAL"));
        continue;
      }
      const row = buildRow({
        lineNumberInFile,
        accountRaw,
        nameRaw: cellAt(cells, colMap.name),
        typeRaw: cellAt(cells, colMap.type),
        refRaw: cellAt(cells, colMap.ref),
        dateRaw: cellAt(cells, colMap.date),
        goodsRaw: cellAt(cells, colMap.goods),
        vatRaw: cellAt(cells, colMap.vat),
        totalRaw: cellAt(cells, colMap.total),
        runBalRaw: cellAt(cells, colMap.runBal),
      });
      if (
        (row.classification === "DOCUMENT" || row.classification === "LEDGER") &&
        row.accountCode
      ) {
        accounts.add(row.accountCode);
      }
      rows.push(row);
      continue;
    }

    {
      const cells = splitAutopartReportCells(rawLine);
      if (cells.length >= 7 && mapSlrbDocumentType(cells[1]) !== "UNKNOWN") {
        colMap = {
          account: 0,
          type: 1,
          ref: 2,
          date: 3,
          goods: 4,
          vat: 5,
          total: 6,
          runBal: 7,
        };
        headerFound = true;
        layout = layout ?? "POSITIONAL";
        let accountRaw = cells[0] ?? "";
        if (!accountRaw.trim() && lastAccountRaw) accountRaw = lastAccountRaw;
        if ((cells[0] ?? "").trim()) lastAccountRaw = cells[0]!;
        const row = buildRow({
          lineNumberInFile,
          accountRaw,
          typeRaw: cells[1] ?? null,
          refRaw: cells[2] ?? null,
          dateRaw: cells[3] ?? null,
          goodsRaw: cells[4] ?? null,
          vatRaw: cells[5] ?? null,
          totalRaw: cells[6] ?? null,
          runBalRaw: cells[7] ?? null,
        });
        if (
          (row.classification === "DOCUMENT" || row.classification === "LEDGER") &&
          row.accountCode
        ) {
          accounts.add(row.accountCode);
        }
        rows.push(row);
        continue;
      }
    }

    const spaced = parseSpacedSlrbDataRow(rawLine);
    if (spaced) {
      headerFound = true;
      layout = layout ?? "SPACED";
      let accountRaw = spaced.account;
      if (!accountRaw.trim() && lastAccountRaw) accountRaw = lastAccountRaw;
      if (spaced.account.trim()) lastAccountRaw = spaced.account;
      const row = buildRow({
        lineNumberInFile,
        accountRaw,
        typeRaw: spaced.type,
        refRaw: spaced.ref,
        dateRaw: spaced.date,
        goodsRaw: spaced.goods,
        vatRaw: spaced.vat,
        totalRaw: spaced.total,
        runBalRaw: spaced.runBal,
      });
      if (
        (row.classification === "DOCUMENT" || row.classification === "LEDGER") &&
        row.accountCode
      ) {
        accounts.add(row.accountCode);
      }
      rows.push(row);
      continue;
    }

    rows.push({
      ...blank(lineNumberInFile, "MALFORMED"),
      classification: "MALFORMED",
      issue: headerFound
        ? "Unrecognised SLRB data row"
        : "No SLRB header recognised before data row",
    });
  }

  // SLRB prints full accounts — only set width when every detected code shares a length
  // (used as supporting evidence, not as truncation of Name).
  if (accounts.size > 0) {
    const lengths = [...accounts].map((a) => a.length);
    const max = Math.max(...lengths);
    const min = Math.min(...lengths);
    if (max === min && max >= 4 && max <= 12) {
      accountFieldWidth = max;
    }
  }

  if (!headerFound) {
    errors.push(
      "SLRB report format not recognised. Expected an Autopart SLRB report containing: A/C / Type / Ref / Date / Tot Goods / Tot VAT / Total / Run Bal.",
    );
  }

  const documents = rows.filter((r) => r.classification === "DOCUMENT");
  const ledgerRecords = rows.filter((r) => r.classification === "LEDGER").length;
  const uniqueDocumentRefs = [
    ...new Set(documents.map((d) => d.documentReference).filter(Boolean) as string[]),
  ].sort();
  const uniqueInvoiceRefs = [
    ...new Set(
      documents
        .filter((d) => d.documentType === "INVOICE")
        .map((d) => d.documentReference)
        .filter(Boolean) as string[],
    ),
  ].sort();
  const uniqueCreditRefs = [
    ...new Set(
      documents
        .filter((d) => d.documentType === "CREDIT")
        .map((d) => d.documentReference)
        .filter(Boolean) as string[],
    ),
  ].sort();

  return {
    report: "SLRB",
    rows,
    documents,
    invoiceDocuments: documents.filter((r) => r.documentType === "INVOICE").length,
    creditDocuments: documents.filter((r) => r.documentType === "CREDIT").length,
    ledgerRecords,
    malformedRows: rows.filter((r) => r.classification === "MALFORMED").length,
    detectedAccounts: [...accounts].sort(),
    reportStartCustomer: selection.startCustomer,
    reportEndCustomer: selection.endCustomer,
    headerFound,
    accountFieldWidth,
    layout,
    columnLayout,
    errors,
    diagnostics: { uniqueDocumentRefs, uniqueInvoiceRefs, uniqueCreditRefs },
  };
}
