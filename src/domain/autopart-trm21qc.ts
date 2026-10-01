/**
 * Autopart TRM21QC — ongoing product-line sales/credit feed.
 *
 * Sales column is NET / EX VAT (signed; credits negative).
 */

import type { AutopartImportReasonCode } from "@/domain/autopart-import-diagnostics";

export type AutopartTrm21qcLineKind = "INVOICE" | "CREDIT" | "UNKNOWN";

/** Why a non-blank row failed to become a financial line. */
export type AutopartTrm21qcMalformedReason =
  | "MISSING_DOCUMENT"
  | "MISSING_PART_NUMBER"
  | "INVALID_NET_SALES"
  | "UNRECOGNISED_ROW_TYPE";

export type AutopartTrm21qcRow = {
  lineNumber: number;
  customerAccount: string;
  group: string | null;
  documentNumber: string;
  documentDate: string | null;
  partNumber: string;
  description: string | null;
  qty: string | null;
  salesNet: string | null;
  cost: string | null;
  margin: string | null;
  perc: string | null;
  kind: AutopartTrm21qcLineKind;
  sourceFingerprint: string;
  classification: "OK" | "MALFORMED" | "BLANK";
  /** Set when classification is MALFORMED — drives specific diagnostic reason codes. */
  malformedReason?: AutopartTrm21qcMalformedReason;
  /** True when the Sales cell was present but not a parseable Autopart amount. */
  salesRawPresent?: boolean;
  rawLine: string;
};

export type AutopartTrm21qcParseResult = {
  rows: AutopartTrm21qcRow[];
  invoiceLines: AutopartTrm21qcRow[];
  creditLines: AutopartTrm21qcRow[];
  documents: string[];
  malformedRows: number;
  headerFound: boolean;
  errors: string[];
};

const HEADER_ALIASES: Record<string, string[]> = {
  cust: ["cust", "customer", "account", "acct", "customer account", "account number"],
  group: ["group", "grp"],
  document: ["document", "document number", "doc", "doc no", "invoice"],
  date: ["date", "document date"],
  part: ["part number", "part", "sku", "product", "part no"],
  description: ["description", "desc", "product description"],
  qty: ["qty", "quantity", "units"],
  sales: ["sales", "sales net", "net sales", "net"],
  cost: ["cost"],
  margin: ["margin"],
  perc: ["perc%", "perc", "percent", "%", "margin %"],
};

const NON_PRODUCT_PART_RE =
  /^(TOTAL|SUBTOTAL|SUB-TOTAL|PAGE|REPORT|CUSTOMER|ACCOUNT|COUNT|AVERAGE|AVG|BALANCE|CARRIED|BROUGHT)$/i;
const NON_PRODUCT_DOC_RE = /^(TOTAL|SUBTOTAL|SUB-TOTAL|PAGE|REPORT|BALANCE)$/i;

function normaliseHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseUkDate(raw: string): string | null {
  const t = raw.trim();
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  const day = m[1]!.padStart(2, "0");
  const month = m[2]!.padStart(2, "0");
  let year = m[3]!;
  if (year.length === 2) year = `20${year}`;
  return `${year}-${month}-${day}`;
}

/**
 * Parse Autopart signed decimal tokens used on TRM21QC Qty / Sales / Cost / Margin / Perc%.
 * Aligns with historic Autopart money handling (£, CR/DR, unicode minus, invisible chars)
 * without inventing values from blank or non-numeric cells.
 */
export function parseTrm21qcSignedDecimal(raw: string, places: number): string | null {
  let t = String(raw ?? "")
    .replace(/^\uFEFF/, "")
    // Zero-width / BOM / NBSP that Excel/CSV exports sometimes embed in numeric cells
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .replace(/,/g, "")
    .trim();
  t = t.replace(/[£$€]/g, "").replace(/\s+/g, "");
  if (!t) return null;
  // Unicode minus / en-dash / em-dash → ASCII minus
  t = t.replace(/[\u2212\u2012\u2013\u2014]/g, "-");

  const upper = t.toUpperCase();
  let forcedNeg = false;
  if (upper.endsWith("CR") && /[\d.]/.test(t)) {
    forcedNeg = true;
    t = t.slice(0, -2);
  } else if (upper.endsWith("DR") && /[\d.]/.test(t)) {
    t = t.slice(0, -2);
  }

  const parenNeg = /^\(.*\)$/.test(t);
  const trailingNeg = /-$/.test(t);
  const leadingNeg = t.startsWith("-");
  const neg = forcedNeg || parenNeg || trailingNeg || leadingNeg;
  const cleaned = t.replace(/[()]/g, "").replace(/-$/, "").replace(/^-/, "");
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n).toFixed(places);
  return neg ? `-${abs}` : abs;
}

function detectDelimiter(headerLine: string): "," | "\t" | "|" | ";" {
  const counts = [
    { d: "," as const, n: (headerLine.match(/,/g) ?? []).length },
    { d: "\t" as const, n: (headerLine.match(/\t/g) ?? []).length },
    { d: "|" as const, n: (headerLine.match(/\|/g) ?? []).length },
    { d: ";" as const, n: (headerLine.match(/;/g) ?? []).length },
  ];
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.d : ",";
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
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
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function mapHeaders(cells: string[]): Record<string, number> | null {
  const idx: Record<string, number> = {};
  const normalised = cells.map(normaliseHeader);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    for (let i = 0; i < normalised.length; i++) {
      if (aliases.includes(normalised[i]!)) {
        idx[key] = i;
        break;
      }
    }
  }
  if (idx["cust"] == null || idx["document"] == null || idx["part"] == null || idx["sales"] == null) {
    return null;
  }
  return idx;
}

function looksLikeNonProductRow(input: {
  documentNumber: string;
  partNumber: string;
  description: string | null;
  customerAccount: string;
}): boolean {
  const part = input.partNumber.trim();
  const doc = input.documentNumber.trim();
  const desc = (input.description ?? "").trim();
  if (part && NON_PRODUCT_PART_RE.test(part)) return true;
  if (doc && NON_PRODUCT_DOC_RE.test(doc)) return true;
  if (!part && !doc && /^(TOTAL|SUBTOTAL|PAGE\s+\d+)/i.test(desc)) return true;
  if (!part && /^TOTAL\b/i.test(input.customerAccount)) return true;
  return false;
}

export function trm21qcMalformedToReasonCode(
  reason: AutopartTrm21qcMalformedReason | undefined,
): AutopartImportReasonCode {
  switch (reason) {
    case "MISSING_DOCUMENT":
      return "MISSING_DOCUMENT";
    case "MISSING_PART_NUMBER":
      return "MISSING_PART_NUMBER";
    case "INVALID_NET_SALES":
      return "INVALID_NET_SALES";
    case "UNRECOGNISED_ROW_TYPE":
      return "UNRECOGNISED_ROW_TYPE";
    default:
      return "PARSE_ERROR";
  }
}

export function isAutopartTrm21qcReport(text: string): boolean {
  const sample = text.replace(/^\uFEFF/, "").slice(0, 4000).toUpperCase();
  if (sample.includes("LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)")) return false;
  if (sample.includes("(504C)")) return false;
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines.slice(0, 40)) {
    if (!line.trim()) continue;
    const delim = detectDelimiter(line);
    const cells = splitCsvLine(line, delim);
    const mapped = mapHeaders(cells);
    if (!mapped) continue;
    // Prefer reports that look like TRM21QC (Part Number + Sales + Cust).
    const headers = cells.map(normaliseHeader).join("|");
    if (headers.includes("part") || headers.includes("qty") || sample.includes("TRM21QC")) return true;
    return true;
  }
  return false;
}

export function detectAutopartTrm21qcFilename(filename: string): boolean {
  const f = filename.toUpperCase();
  return f.includes("TRM21QC");
}

export function trm21qcLineFingerprint(input: {
  documentNumber: string;
  partNumber: string;
  qty: string | null;
  salesNet: string | null;
  description: string | null;
  occurrence: number;
}): string {
  return [
    input.documentNumber.trim().toUpperCase(),
    input.partNumber.trim().toUpperCase(),
    input.qty ?? "",
    input.salesNet ?? "",
    (input.description ?? "").trim().toUpperCase(),
    String(input.occurrence),
  ].join("|");
}

export function assignStableTrm21qcLineNumbers(
  rows: AutopartTrm21qcRow[],
): Array<AutopartTrm21qcRow & { stableLineNumber: number }> {
  const byDoc = new Map<string, AutopartTrm21qcRow[]>();
  for (const row of rows) {
    if (row.classification !== "OK") continue;
    const list = byDoc.get(row.documentNumber) ?? [];
    list.push(row);
    byDoc.set(row.documentNumber, list);
  }
  const out: Array<AutopartTrm21qcRow & { stableLineNumber: number }> = [];
  for (const [, list] of byDoc) {
    const sorted = [...list].sort((a, b) => a.sourceFingerprint.localeCompare(b.sourceFingerprint));
    sorted.forEach((row, i) => {
      out.push({ ...row, stableLineNumber: i + 1 });
    });
  }
  return out;
}

function blankRow(lineNumber: number, line: string): AutopartTrm21qcRow {
  return {
    lineNumber,
    customerAccount: "",
    group: null,
    documentNumber: "",
    documentDate: null,
    partNumber: "",
    description: null,
    qty: null,
    salesNet: null,
    cost: null,
    margin: null,
    perc: null,
    kind: "UNKNOWN",
    sourceFingerprint: "",
    classification: "BLANK",
    rawLine: line,
  };
}

export function parseAutopartTrm21qcReport(text: string): AutopartTrm21qcParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const errors: string[] = [];
  const rows: AutopartTrm21qcRow[] = [];
  let headerFound = false;
  let delimiter: "," | "\t" | "|" | ";" = ",";
  let headerMap: Record<string, number> | null = null;
  const fingerprintCounts = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    if (!line.trim()) continue;
    if (!headerFound) {
      delimiter = detectDelimiter(line);
      const cells = splitCsvLine(line, delimiter);
      const mapped = mapHeaders(cells);
      if (mapped) {
        headerFound = true;
        headerMap = mapped;
        continue;
      }
      continue;
    }
    const cells = splitCsvLine(line, delimiter);
    const get = (key: string) => {
      const at = headerMap![key];
      return at == null ? "" : (cells[at] ?? "").trim();
    };
    const customerAccount = get("cust");
    const documentNumber = get("document");
    const partNumber = get("part");
    const description = get("description") || null;
    if (!customerAccount && !documentNumber && !partNumber) {
      rows.push(blankRow(lineNumber, line));
      continue;
    }

    const salesRaw = get("sales");
    const salesRawPresent = Boolean(salesRaw.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "").trim());
    const qty = parseTrm21qcSignedDecimal(get("qty"), 3);
    const salesNet = parseTrm21qcSignedDecimal(salesRaw, 2);
    const cost = parseTrm21qcSignedDecimal(get("cost"), 2);
    const margin = parseTrm21qcSignedDecimal(get("margin"), 2);
    const perc = parseTrm21qcSignedDecimal(get("perc"), 3);
    const documentDate = parseUkDate(get("date"));

    if (looksLikeNonProductRow({ documentNumber, partNumber, description, customerAccount })) {
      rows.push({
        lineNumber,
        customerAccount,
        group: get("group") || null,
        documentNumber,
        documentDate,
        partNumber,
        description,
        qty,
        salesNet,
        cost,
        margin,
        perc,
        kind: "UNKNOWN",
        sourceFingerprint: "",
        classification: "MALFORMED",
        malformedReason: "UNRECOGNISED_ROW_TYPE",
        salesRawPresent,
        rawLine: line,
      });
      continue;
    }

    if (!documentNumber || !partNumber || salesNet == null) {
      let malformedReason: AutopartTrm21qcMalformedReason = "INVALID_NET_SALES";
      if (!documentNumber) malformedReason = "MISSING_DOCUMENT";
      else if (!partNumber) malformedReason = "MISSING_PART_NUMBER";
      else malformedReason = "INVALID_NET_SALES";
      rows.push({
        lineNumber,
        customerAccount,
        group: get("group") || null,
        documentNumber,
        documentDate,
        partNumber,
        description,
        qty,
        salesNet,
        cost,
        margin,
        perc,
        kind: "UNKNOWN",
        sourceFingerprint: "",
        classification: "MALFORMED",
        malformedReason,
        salesRawPresent,
        rawLine: line,
      });
      continue;
    }
    const salesN = Number(salesNet);
    const qtyN = qty != null ? Number(qty) : 0;
    let kind: AutopartTrm21qcLineKind = "UNKNOWN";
    if (salesN < 0 || qtyN < 0) kind = "CREDIT";
    else if (salesN > 0 || qtyN > 0) kind = "INVOICE";
    else kind = "INVOICE"; // zero line — treat as invoice presence-neutral

    const baseFp = `${documentNumber}|${partNumber}|${qty ?? ""}|${salesNet}|${description ?? ""}`;
    const occurrence = (fingerprintCounts.get(baseFp) ?? 0) + 1;
    fingerprintCounts.set(baseFp, occurrence);
    const sourceFingerprint = trm21qcLineFingerprint({
      documentNumber,
      partNumber,
      qty,
      salesNet,
      description,
      occurrence,
    });

    rows.push({
      lineNumber,
      customerAccount,
      group: get("group") || null,
      documentNumber,
      documentDate,
      partNumber,
      description,
      qty,
      salesNet,
      cost,
      margin,
      perc,
      kind,
      sourceFingerprint,
      classification: "OK",
      rawLine: line,
    });
  }

  if (!headerFound) {
    errors.push("TRM21QC header not found (expected Cust + Document + Part Number + Sales).");
  }

  const ok = rows.filter((r) => r.classification === "OK");
  return {
    rows,
    invoiceLines: ok.filter((r) => r.kind === "INVOICE"),
    creditLines: ok.filter((r) => r.kind === "CREDIT"),
    documents: [...new Set(ok.map((r) => r.documentNumber))],
    malformedRows: rows.filter((r) => r.classification === "MALFORMED").length,
    headerFound,
    errors,
  };
}
