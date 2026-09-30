/**
 * Autopart all-branches 504 — Listing of invoices/credits (document feed).
 *
 * Distinct from legacy 504C (fixed-width). This parser accepts CSV/TSV/text
 * with a header row containing Document + Customer Order Number + Goods/VAT/Value.
 */

import { isAbOrderNumber, normaliseAbOrderNumber } from "@/domain/order-status";

export const AUTOPART_504_REPORT_TITLE = "504";

export type Autopart504DocumentKind = "INVOICE" | "CREDIT" | "UNKNOWN";

export type Autopart504Row = {
  lineNumber: number;
  reportType: string | null;
  documentNumber: string;
  documentDate: string | null;
  documentTime: string | null;
  customerName: string;
  goods: string | null;
  vat: string | null;
  value: string | null;
  initials: string | null;
  customerOrderNumber: string;
  kind: Autopart504DocumentKind;
  isAbOrderReference: boolean;
  abOrderNumber: string | null;
  classification: "AB_INVOICE" | "AB_CREDIT" | "NON_AB" | "UNKNOWN" | "MALFORMED" | "BLANK";
  rawLine: string;
};

export type Autopart504ParseResult = {
  rows: Autopart504Row[];
  invoiceRows: Autopart504Row[];
  creditRows: Autopart504Row[];
  abInvoiceRows: Autopart504Row[];
  abCreditRows: Autopart504Row[];
  nonAbRows: number;
  malformedRows: number;
  headerFound: boolean;
  errors: string[];
};

const HEADER_ALIASES: Record<string, string[]> = {
  type: ["type", "report type", "doc type"],
  document: ["document", "document number", "doc", "doc no", "doc number"],
  date: ["date", "document date"],
  time: ["time", "document time"],
  customer: ["customer name", "customer", "account name", "name"],
  goods: ["goods", "goods net", "net"],
  vat: ["vat", "tax"],
  value: ["value", "gross", "total", "gross value"],
  inits: ["inits", "init", "initials"],
  orderNumber: ["customer order number", "order number", "cust order", "customer order"],
};

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

function parseTime(raw: string): string | null {
  const t = raw.trim();
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

export function parseAutopartMoneyToken(raw: string): string | null {
  const t = raw.replace(/,/g, "").trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || /-$/.test(t);
  const cleaned = t.replace(/[()]/g, "").replace(/-$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n).toFixed(2);
  return neg || n < 0 ? `-${abs}` : abs;
}

export function classifyAutopart504Kind(
  documentNumber: string,
  goods: string | null,
  value: string | null,
): Autopart504DocumentKind {
  const doc = documentNumber.toUpperCase();
  if (doc.startsWith("SC") || doc.startsWith("C") || doc.includes("CRN") || doc.startsWith("CN")) {
    return "CREDIT";
  }
  if (goods?.startsWith("-") || value?.startsWith("-")) return "CREDIT";
  if (/^\d+$/.test(documentNumber) || doc.startsWith("SS") || doc.startsWith("I") || doc.startsWith("INV")) {
    return "INVOICE";
  }
  if (goods != null || value != null) {
    // Signed evidence without clear prefix — still classifiable via money.
    const g = Number(goods ?? "0");
    const v = Number(value ?? "0");
    if (g < 0 || v < 0) return "CREDIT";
    if (g > 0 || v > 0) return "INVOICE";
  }
  return "UNKNOWN";
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
    let found = -1;
    for (let i = 0; i < normalised.length; i++) {
      if (aliases.includes(normalised[i]!)) {
        found = i;
        break;
      }
    }
    if (found >= 0) idx[key] = found;
  }
  if (idx["document"] == null || idx["orderNumber"] == null) return null;
  if (idx["goods"] == null && idx["value"] == null) return null;
  return idx;
}

/**
 * Positive content detection for all-branches 504 (not 504C).
 * Requires header with Document + Customer Order Number + Goods/Value.
 * Rejects 504C fixed-width title / .Acct. layout.
 */
export function isAutopart504Report(text: string): boolean {
  const sample = text.replace(/^\uFEFF/, "").slice(0, 4000).toUpperCase();
  if (sample.includes("LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)")) return false;
  if (sample.includes("CUSTOMER ORDER NUMBER") && sample.includes(".ACCT.")) return false;
  if (sample.includes("TRM21QC")) return false;
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines.slice(0, 40)) {
    if (!line.trim()) continue;
    const delim = detectDelimiter(line);
    const cells = splitCsvLine(line, delim);
    if (mapHeaders(cells)) return true;
  }
  return false;
}

export function detectAutopart504Filename(filename: string): boolean {
  const f = filename.toUpperCase();
  if (f.includes("504C")) return false;
  if (f.includes("504UF")) return false;
  if (f.includes("TRM21QC")) return false;
  return /\b504\b/.test(f.replace(/[^A-Z0-9]/g, " ")) || f.includes("504.");
}

export function parseAutopart504Report(text: string): Autopart504ParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const errors: string[] = [];
  const rows: Autopart504Row[] = [];
  let headerFound = false;
  let delimiter: "," | "\t" | "|" | ";" = ",";
  let headerMap: Record<string, number> | null = null;

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
    const documentNumber = get("document");
    if (!documentNumber) {
      rows.push({
        lineNumber,
        reportType: null,
        documentNumber: "",
        documentDate: null,
        documentTime: null,
        customerName: "",
        goods: null,
        vat: null,
        value: null,
        initials: null,
        customerOrderNumber: "",
        kind: "UNKNOWN",
        isAbOrderReference: false,
        abOrderNumber: null,
        classification: "BLANK",
        rawLine: line,
      });
      continue;
    }
    const goods = parseAutopartMoneyToken(get("goods"));
    const vat = parseAutopartMoneyToken(get("vat"));
    const value = parseAutopartMoneyToken(get("value"));
    const customerOrderNumber = get("orderNumber");
    const kind = classifyAutopart504Kind(documentNumber, goods, value);
    if (kind === "UNKNOWN") {
      errors.push(`Line ${lineNumber}: unknown document type for ${documentNumber}`);
    }
    const isAb = isAbOrderNumber(customerOrderNumber);
    const abOrderNumber = isAb ? normaliseAbOrderNumber(customerOrderNumber) : null;
    let classification: Autopart504Row["classification"] = "NON_AB";
    if (kind === "UNKNOWN") classification = "UNKNOWN";
    else if (isAb && kind === "CREDIT") classification = "AB_CREDIT";
    else if (isAb && kind === "INVOICE") classification = "AB_INVOICE";
    else if (!goods && !value) classification = "MALFORMED";

    rows.push({
      lineNumber,
      reportType: get("type") || null,
      documentNumber,
      documentDate: parseUkDate(get("date")),
      documentTime: parseTime(get("time")),
      customerName: get("customer"),
      goods,
      vat,
      value,
      initials: get("inits") || null,
      customerOrderNumber,
      kind,
      isAbOrderReference: isAb,
      abOrderNumber,
      classification,
      rawLine: line,
    });
  }

  if (!headerFound) {
    errors.push("504 header not found (expected Document + Customer Order Number + Goods/Value).");
  }

  const invoiceRows = rows.filter((r) => r.kind === "INVOICE");
  const creditRows = rows.filter((r) => r.kind === "CREDIT");
  return {
    rows,
    invoiceRows,
    creditRows,
    abInvoiceRows: rows.filter((r) => r.classification === "AB_INVOICE"),
    abCreditRows: rows.filter((r) => r.classification === "AB_CREDIT"),
    nonAbRows: rows.filter((r) => r.classification === "NON_AB").length,
    malformedRows: rows.filter((r) => r.classification === "MALFORMED").length,
    headerFound,
    errors,
  };
}
