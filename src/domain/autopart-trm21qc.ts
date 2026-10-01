/**
 * Autopart TRM21QC — ongoing product-line sales/credit feed.
 *
 * Sales column is NET / EX VAT (signed; credits negative).
 *
 * Autopart sometimes emits an unescaped inch mark inside an already-quoted
 * Description (e.g. `"14" Phoenix…"`). Strict CSV then shifts columns. We
 * recover those rows from stable leading/trailing field boundaries — never by
 * inventing financial values.
 */

import type { AutopartImportReasonCode } from "@/domain/autopart-import-diagnostics";
import { parseAutopartDateOnly } from "@/domain/autopart-report-money";

export type AutopartTrm21qcLineKind = "INVOICE" | "CREDIT" | "UNKNOWN";

/** Why a non-blank row failed to become a financial line. */
export type AutopartTrm21qcMalformedReason =
  | "MISSING_DOCUMENT"
  | "MISSING_PART_NUMBER"
  | "INVALID_NET_SALES"
  | "UNRECOGNISED_ROW_TYPE"
  /** Row quoting/structure could not be recovered confidently (not a Sales-value issue). */
  | "ROW_STRUCTURE_INVALID";

/** Canonical TRM21QC logical column count. */
export const TRM21QC_COLUMN_COUNT = 11;

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
  // Prefer shared Autopart date parser ("01 Oct 26", DD/MM/YYYY, ISO).
  const viaShared = parseAutopartDateOnly(raw);
  if (viaShared) return viaShared;
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

/**
 * Parse the first `count` CSV fields with strict quote rules, returning the
 * remainder of the line (which may contain Autopart's broken Description quoting).
 */
export function parseLeadingCsvFields(
  line: string,
  delimiter: string,
  count: number,
): { fields: string[]; rest: string } | null {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  let i = 0;
  for (; i < line.length && fields.length < count; i++) {
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
  if (fields.length === count) {
    // Consumed delimiter after the Nth field; rest starts at i.
    return { fields, rest: line.slice(i) };
  }
  if (fields.length === count - 1 && !inQuotes) {
    // Line ended exactly on the Nth field (no trailing delimiter).
    fields.push(cur.trim());
    return { fields, rest: "" };
  }
  return null;
}

/** True when a trailing TRM financial token is blank or a recognised Autopart amount. */
function isTrmTrailingFinancialToken(raw: string): boolean {
  const t = raw.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "").trim();
  if (!t) return true; // blank allowed (e.g. empty Perc%) — does not invent a value
  return parseTrm21qcSignedDecimal(t, 3) != null || parseTrm21qcSignedDecimal(t, 2) != null;
}

/**
 * Peel `count` trailing delimiter-separated fields from the end of `segment`.
 * Each field may be quoted (`"24.99"`) or bare (`24.99` / empty).
 * Returns null when any field is not a confident blank-or-numeric financial token.
 *
 * Walks from the end: each field is either `"…"` (no internal quotes) or a bare
 * token with no delimiter; bare tokens must be blank or Autopart-numeric.
 */
export function peelTrailingFinancialFields(
  segment: string,
  delimiter: string,
  count: number,
): { fields: string[]; descriptionRaw: string } | null {
  let rest = segment.replace(/\s+$/, "");
  const fields: string[] = [];

  for (let n = 0; n < count; n++) {
    if (rest.length === 0) return null;

    if (rest.endsWith('"')) {
      // Find the opening quote of this trailing quoted field.
      const end = rest.length - 1;
      let open = -1;
      for (let i = end - 1; i >= 0; i--) {
        if (rest[i] === '"') {
          // Escaped "" inside a well-formed field — skip pair.
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
      // For financial fields Autopart does not put inch marks inside Qty/Sales/etc.
      // Reject if the quoted value itself contains a raw " (should have been "").
      if (value.includes('"')) return null;
      if (!isTrmTrailingFinancialToken(value)) return null;
      fields.unshift(value.trim());
      rest = rest.slice(0, open).replace(/\s+$/, "");
      if (rest.endsWith(delimiter)) {
        rest = rest.slice(0, -delimiter.length);
      } else if (rest.length > 0) {
        return null;
      }
      continue;
    }

    // Bare field: take back to previous delimiter (or start).
    const delimAt = rest.lastIndexOf(delimiter);
    const value = delimAt < 0 ? rest : rest.slice(delimAt + delimiter.length);
    if (!isTrmTrailingFinancialToken(value)) return null;
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

/** Strip a single outer Autopart Description quote wrapper when present. */
export function normaliseTrmDescription(raw: string): string {
  let d = raw.trim();
  if (d.startsWith('"') && d.endsWith('"') && d.length >= 2) {
    d = d.slice(1, -1);
  } else if (d.startsWith('"') && !d.endsWith('"')) {
    d = d.slice(1);
  } else if (!d.startsWith('"') && d.endsWith('"')) {
    d = d.slice(0, -1);
  }
  // Autopart sometimes doubles quotes correctly — collapse CSV escapes.
  d = d.replace(/""/g, '"');
  return d.trim();
}

export type Trm21qcResolvedCells = {
  cust: string;
  group: string;
  document: string;
  date: string;
  part: string;
  description: string;
  qty: string;
  sales: string;
  cost: string;
  margin: string;
  perc: string;
  /** How cells were obtained. */
  resolution: "standard" | "structural";
};

/**
 * Resolve a TRM21QC data row into the 11 logical columns.
 *
 * Prefer structural recovery (first 5 + last 5) when strict CSV would shift
 * financial columns because of an unescaped inch mark in Description.
 * Returns null only when neither path can confidently identify the trailing
 * financial fields — callers must not invent Sales.
 */
export function resolveTrm21qcRowCells(
  line: string,
  delimiter: string,
  headerMap: Record<string, number>,
): Trm21qcResolvedCells | null {
  const standard = splitCsvLine(line, delimiter);
  const getStd = (key: string) => {
    const at = headerMap[key];
    return at == null ? "" : (standard[at] ?? "").trim();
  };

  const stdSales = getStd("sales");
  const stdSalesOk = parseTrm21qcSignedDecimal(stdSales, 2) != null;
  const expectedCols = Math.max(...Object.values(headerMap), 0) + 1;
  const stdLooksAligned =
    standard.length >= expectedCols &&
    stdSalesOk &&
    // Description should not absorb trailing financial commas when quoting breaks.
    !(standard.length > expectedCols + 2);

  if (stdLooksAligned) {
    return {
      cust: getStd("cust"),
      group: getStd("group"),
      document: getStd("document"),
      date: getStd("date"),
      part: getStd("part"),
      description: getStd("description"),
      qty: getStd("qty"),
      sales: stdSales,
      cost: getStd("cost"),
      margin: getStd("margin"),
      perc: getStd("perc"),
      resolution: "standard",
    };
  }

  // Structural recovery: Cust,Group,Document,Date,Part | Description | Qty,Sales,Cost,Margin,Perc%
  const leading = parseLeadingCsvFields(line, delimiter, 5);
  if (!leading || leading.fields.length !== 5) return null;
  const trailing = peelTrailingFinancialFields(leading.rest, delimiter, 5);
  if (!trailing || trailing.fields.length !== 5) return null;

  const [qty, sales, cost, margin, perc] = trailing.fields;
  return {
    cust: leading.fields[0]!,
    group: leading.fields[1]!,
    document: leading.fields[2]!,
    date: leading.fields[3]!,
    part: leading.fields[4]!,
    description: normaliseTrmDescription(trailing.descriptionRaw),
    qty: qty ?? "",
    sales: sales ?? "",
    cost: cost ?? "",
    margin: margin ?? "",
    perc: perc ?? "",
    resolution: "structural",
  };
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
    case "ROW_STRUCTURE_INVALID":
      return "PARSE_ERROR";
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
    const resolved = resolveTrm21qcRowCells(line, delimiter, headerMap!);
    if (!resolved) {
      // Cannot confidently identify Qty/Sales/Cost/Margin/Perc% — do not guess Sales.
      // Still classify TOTAL/subtotal artefacts from the stable leading five fields.
      const leading = parseLeadingCsvFields(line, delimiter, 5);
      const rough = splitCsvLine(line, delimiter);
      const roughCust = (leading?.fields[0] ?? rough[headerMap!["cust"] ?? 0] ?? "").trim();
      const roughGroup = (leading?.fields[1] ?? "").trim();
      const roughDoc = (leading?.fields[2] ?? rough[headerMap!["document"] ?? 2] ?? "").trim();
      const roughDate = (leading?.fields[3] ?? "").trim();
      const roughPart = (leading?.fields[4] ?? rough[headerMap!["part"] ?? 4] ?? "").trim();
      if (!roughCust && !roughDoc && !roughPart) {
        rows.push(blankRow(lineNumber, line));
        continue;
      }
      const artefact = looksLikeNonProductRow({
        documentNumber: roughDoc,
        partNumber: roughPart,
        description: null,
        customerAccount: roughCust,
      });
      rows.push({
        lineNumber,
        customerAccount: roughCust,
        group: roughGroup || null,
        documentNumber: roughDoc,
        documentDate: parseUkDate(roughDate),
        partNumber: roughPart,
        description: null,
        qty: null,
        salesNet: null,
        cost: null,
        margin: null,
        perc: null,
        kind: "UNKNOWN",
        sourceFingerprint: "",
        classification: "MALFORMED",
        malformedReason: artefact ? "UNRECOGNISED_ROW_TYPE" : "ROW_STRUCTURE_INVALID",
        salesRawPresent: false,
        rawLine: line,
      });
      continue;
    }

    const customerAccount = resolved.cust;
    const documentNumber = resolved.document;
    const partNumber = resolved.part;
    const description = resolved.description || null;
    if (!customerAccount && !documentNumber && !partNumber) {
      rows.push(blankRow(lineNumber, line));
      continue;
    }

    const salesRaw = resolved.sales;
    const salesRawPresent = Boolean(salesRaw.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "").trim());
    const qty = parseTrm21qcSignedDecimal(resolved.qty, 3);
    const salesNet = parseTrm21qcSignedDecimal(salesRaw, 2);
    const cost = parseTrm21qcSignedDecimal(resolved.cost, 2);
    const margin = parseTrm21qcSignedDecimal(resolved.margin, 2);
    const perc = parseTrm21qcSignedDecimal(resolved.perc, 3);
    const documentDate = parseUkDate(resolved.date);

    if (looksLikeNonProductRow({ documentNumber, partNumber, description, customerAccount })) {
      rows.push({
        lineNumber,
        customerAccount,
        group: resolved.group || null,
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
      let malformedReason: AutopartTrm21qcMalformedReason;
      if (!documentNumber) malformedReason = "MISSING_DOCUMENT";
      else if (!partNumber) malformedReason = "MISSING_PART_NUMBER";
      else malformedReason = "INVALID_NET_SALES"; // Sales blank/invalid after confident column recovery
      rows.push({
        lineNumber,
        customerAccount,
        group: resolved.group || null,
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
      group: resolved.group || null,
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
