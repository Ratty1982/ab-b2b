/**
 * Autopart SLRB — historic document/ledger headers and dates.
 * Native content-based parser (CSV / tab / report text).
 * Filename/extension is never used for format detection.
 */
import {
  autopartMoneyToGbp2,
  detectFixedWidthLayout,
  extractAutopartAccountCode,
  headerKey,
  normaliseReportLines,
  parseAutopartDateOnly,
  parseAutopartMoney,
  sliceFixedWidthCells,
  splitAutopartReportCells,
  splitCsvLine,
  type FixedWidthColumn,
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
  accountFieldWidth: number | null;
  layout: "CSV" | "FIXED_WIDTH" | "SPACED" | "POSITIONAL" | null;
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

const FIXED_WIDTH_LABELS = [
  { key: "account", patterns: [/\bA\/C\b/i, /\bAcct\.?\b/i, /\bAccount\b/i] },
  { key: "type", patterns: [/\bType\b/i] },
  { key: "ref", patterns: [/\bRef(?:erence)?\b/i] },
  { key: "date", patterns: [/\bDate\b/i] },
  { key: "goods", patterns: [/\bTot(?:al)?\s*Goods\b/i, /\bGoods\b/i] },
  { key: "vat", patterns: [/\bTot(?:al)?\s*VAT\b/i, /\bVAT\b/i] },
  { key: "total", patterns: [/\bTotal\b/i] },
  { key: "runBal", patterns: [/\bRun\s*Bal(?:ance)?\b/i, /\bBalance\b/i] },
];

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

function moneyTailFields(rest: string): {
  goods: string | null;
  vat: string | null;
  total: string | null;
  runBal: string | null;
} {
  // Pull trailing money tokens (supports negatives / £ / CR)
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
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

/** Space-separated SLRB data row. */
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
  const money = moneyTailFields(m[5]!);
  return {
    account: m[1]!,
    type: m[2]!,
    ref: m[3]!,
    date: m[4]!,
    ...money,
  };
}

function buildRow(input: {
  lineNumberInFile: number;
  accountRaw: string | null;
  typeRaw: string | null;
  refRaw: string | null;
  dateRaw: string | null;
  goodsRaw: string | null;
  vatRaw: string | null;
  totalRaw: string | null;
  runBalRaw: string | null;
}): AutopartSlrbRow {
  const accountCode = extractAutopartAccountCode(input.accountRaw);
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
        ? input.accountRaw?.trim()
          ? "Invalid account field (not an Autopart customer code)"
          : "Missing account"
        : !documentReference
          ? "Missing reference"
          : `Unknown document type: ${rawType ?? ""}`,
  };
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
  let fixedColumns: FixedWidthColumn[] | null = null;
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
    const upper = rawLine.trim().toUpperCase();
    if (
      (upper.includes("SLRB") && !looksLikeSlrbHeaderLine(rawLine)) ||
      upper.startsWith("END OF REPORT") ||
      upper.startsWith("PAGE ") ||
      /^[-_=.\s]+$/.test(rawLine.trim())
    ) {
      rows.push(meta(lineNumberInFile, "HEADER"));
      continue;
    }

    if (!headerFound) {
      if (looksLikeSlrbHeaderLine(rawLine) && !rawLine.includes(",")) {
        const fw = detectFixedWidthLayout(rawLine, FIXED_WIDTH_LABELS);
        if (
          fw &&
          fw.columns.some((c) => c.key === "account") &&
          fw.columns.some((c) => c.key === "type") &&
          fw.columns.some((c) => c.key === "ref") &&
          fw.columns.some((c) => c.key === "date")
        ) {
          headerFound = true;
          fixedColumns = fw.columns;
          accountFieldWidth = fw.accountFieldWidth;
          layout = "FIXED_WIDTH";
          rows.push(meta(lineNumberInFile, "HEADER"));
          continue;
        }
      }
      const cells = splitAutopartReportCells(rawLine);
      const mapped = mapHeader(cells.length >= 4 ? cells : splitCsvLine(rawLine));
      if (mapped) {
        headerFound = true;
        colMap = mapped;
        layout = rawLine.includes(",") || rawLine.includes("\t") ? "CSV" : "SPACED";
        rows.push(meta(lineNumberInFile, "HEADER"));
        continue;
      }
      if (looksLikeSlrbHeaderLine(rawLine)) {
        headerFound = true;
        layout = "SPACED";
        rows.push(meta(lineNumberInFile, "HEADER"));
        continue;
      }
    }

    if (fixedColumns) {
      const sliced = sliceFixedWidthCells(rawLine, fixedColumns);
      let accountRaw = sliced["account"] ?? "";
      if (!accountRaw.trim() && lastAccountRaw) accountRaw = lastAccountRaw;
      if ((sliced["account"] ?? "").trim()) lastAccountRaw = sliced["account"]!;
      const joined = rawLine.toUpperCase();
      if (joined.includes("TOTAL") && !(sliced["ref"] ?? "").trim()) {
        rows.push(meta(lineNumberInFile, "TOTAL"));
        continue;
      }
      const row = buildRow({
        lineNumberInFile,
        accountRaw,
        typeRaw: sliced["type"] ?? null,
        refRaw: sliced["ref"] ?? null,
        dateRaw: sliced["date"] ?? null,
        goodsRaw: sliced["goods"] ?? null,
        vatRaw: sliced["vat"] ?? null,
        totalRaw: sliced["total"] ?? null,
        runBalRaw: sliced["runBal"] ?? null,
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

    if (colMap) {
      const cells = splitAutopartReportCells(rawLine);
      let accountRaw = cellAt(cells, colMap.account);
      if (!(accountRaw ?? "").trim() && lastAccountRaw) accountRaw = lastAccountRaw;
      if ((cellAt(cells, colMap.account) ?? "").trim()) {
        lastAccountRaw = cellAt(cells, colMap.account);
      }
      const joined = cells.join(" ").toUpperCase();
      if (joined.includes("TOTAL") && !cellAt(cells, colMap.ref)) {
        rows.push(meta(lineNumberInFile, "TOTAL"));
        continue;
      }
      const row = buildRow({
        lineNumberInFile,
        accountRaw,
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
      ...meta(lineNumberInFile, "MALFORMED"),
      issue: headerFound
        ? "Unrecognised SLRB data row"
        : "No SLRB header recognised before data row",
    });
  }

  // Confirmed truncation width = consistent printed account length in this report.
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
    accountFieldWidth,
    layout,
    errors,
  };
}
