/**
 * Autopart SLRB — historic document/ledger headers and dates.
 * Native CSV/header parser — primary use: date/header correlation for 561L.
 */
import {
  autopartMoneyToGbp2,
  headerKey,
  normaliseAccountToken,
  normaliseReportLines,
  parseAutopartDateOnly,
  parseAutopartMoney,
  splitCsvLine,
} from "@/domain/autopart-report-money";

export type AutopartSlrbDocumentType =
  | "INVOICE"
  | "CREDIT"
  | "PAYMENT"
  | "JOURNAL"
  | "UNKNOWN";

export type AutopartSlrbRow = {
  lineNumberInFile: number;
  accountCode: string | null;
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

export type AutopartSlrbParseResult = {
  report: "SLRB";
  rows: AutopartSlrbRow[];
  documents: AutopartSlrbRow[];
  invoiceDocuments: number;
  creditDocuments: number;
  ledgerRecords: number;
  malformedRows: number;
  detectedAccounts: string[];
  headerFound: boolean;
  errors: string[];
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

export function parseAutopartSlrb(text: string): AutopartSlrbParseResult {
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
  };
  let headerFound = false;
  let colMap: ColMap | null = null;
  const accounts = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNumberInFile = i + 1;
    if (!rawLine.trim()) {
      rows.push(blank(lineNumberInFile));
      continue;
    }
    const upper = rawLine.trim().toUpperCase();
    if (
      upper.includes("SLRB") ||
      upper.startsWith("END OF REPORT") ||
      upper.startsWith("PAGE ") ||
      /^[-_=.\s]+$/.test(rawLine.trim())
    ) {
      rows.push(meta(lineNumberInFile, "HEADER"));
      continue;
    }

    const cells = splitCsvLine(rawLine);
    if (!headerFound) {
      const mapped = mapHeader(cells);
      if (mapped) {
        headerFound = true;
        colMap = mapped;
        rows.push(meta(lineNumberInFile, "HEADER"));
        continue;
      }
    }

    if (!colMap) {
      // Positional fallback: A/C, Type, Ref, Date, Tot Goods, Tot VAT, Total, Run Bal
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
      } else {
        rows.push({
          ...meta(lineNumberInFile, "MALFORMED"),
          issue: "No SLRB header recognised before data row",
        });
        continue;
      }
    }

    const joined = cells.join(" ").toUpperCase();
    if (joined.includes("TOTAL") && !cellAt(cells, colMap.ref)) {
      rows.push(meta(lineNumberInFile, "TOTAL"));
      continue;
    }

    const accountCode = normaliseAccountToken(cellAt(cells, colMap.account));
    const rawType = (cellAt(cells, colMap.type) ?? "").trim() || null;
    const documentType = mapSlrbDocumentType(rawType);
    const documentReference = (cellAt(cells, colMap.ref) ?? "").trim().toUpperCase() || null;
    const documentDate = parseAutopartDateOnly(cellAt(cells, colMap.date));
    const goods = parseAutopartMoney(cellAt(cells, colMap.goods));
    const vat = parseAutopartMoney(cellAt(cells, colMap.vat));
    const total = parseAutopartMoney(cellAt(cells, colMap.total));
    const runBal = parseAutopartMoney(cellAt(cells, colMap.runBal));

    if (accountCode) accounts.add(accountCode);

    const isSalesDoc = documentType === "INVOICE" || documentType === "CREDIT";
    const ok = Boolean(accountCode && documentReference && documentType !== "UNKNOWN");

    rows.push({
      lineNumberInFile,
      accountCode,
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
          ? "Missing account"
          : !documentReference
            ? "Missing reference"
            : `Unknown document type: ${rawType ?? ""}`,
    });
  }

  if (!headerFound) errors.push("SLRB header row not found");

  const documents = rows.filter((r) => r.classification === "DOCUMENT");
  const ledgerRecords = rows.filter((r) => r.classification === "LEDGER").length;

  return {
    report: "SLRB",
    rows,
    documents,
    invoiceDocuments: documents.filter((r) => r.documentType === "INVOICE").length,
    creditDocuments: documents.filter((r) => r.documentType === "CREDIT").length,
    ledgerRecords,
    malformedRows: rows.filter((r) => r.classification === "MALFORMED").length,
    detectedAccounts: [...accounts].sort(),
    headerFound,
    errors,
  };
}

function blank(lineNumberInFile: number): AutopartSlrbRow {
  return {
    lineNumberInFile,
    accountCode: null,
    rawType: null,
    documentType: "UNKNOWN",
    documentReference: null,
    documentDate: null,
    goodsNet: null,
    vat: null,
    grossTotal: null,
    runBalance: null,
    classification: "BLANK",
    issue: null,
  };
}

function meta(
  lineNumberInFile: number,
  classification: AutopartSlrbRow["classification"],
): AutopartSlrbRow {
  return {
    ...blank(lineNumberInFile),
    classification,
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
    };
  }
  return null;
}

function cellAt(cells: string[], idx: number | undefined): string | null {
  if (idx == null) return null;
  return cells[idx] ?? null;
}
