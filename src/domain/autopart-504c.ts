/**
 * Autopart 504C — Listing of Invoices and Credits by Customer.
 *
 * Native fixed-width / space-aligned text parser.
 * Independent of AlphaOps runtime; architectural lessons only.
 */

import { isAbOrderNumber, normaliseAbOrderNumber } from "@/domain/order-status";

export const AUTOPART_504C_REPORT_TITLE = "LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)";

export type Autopart504cDocumentKind = "INVOICE" | "CREDIT" | "UNKNOWN";

export type Autopart504cRow = {
  lineNumber: number;
  documentNumber: string;
  documentDate: string | null; // YYYY-MM-DD when parseable
  documentTime: string | null; // HH:mm when parseable
  accountCode: string;
  customerName: string;
  goods: string | null;
  vat: string | null;
  value: string | null;
  initials: string | null;
  customerOrderNumber: string;
  kind: Autopart504cDocumentKind;
  rawLine: string;
  /** True when Customer Order Number matches AB-###### */
  isAbOrderReference: boolean;
  abOrderNumber: string | null;
  classification:
    | "AB_INVOICE"
    | "AB_CREDIT"
    | "NON_AB"
    | "SUBTOTAL"
    | "HEADER"
    | "FOOTER"
    | "MALFORMED"
    | "BLANK";
};

export type Autopart504cParseResult = {
  rows: Autopart504cRow[];
  abInvoiceRows: Autopart504cRow[];
  abCreditRows: Autopart504cRow[];
  nonAbRows: number;
  malformedRows: number;
  headerFound: boolean;
  errors: string[];
};

type ColumnKey =
  | "document"
  | "date"
  | "time"
  | "account"
  | "customer"
  | "goods"
  | "vat"
  | "value"
  | "inits"
  | "orderNumber";

type ColumnLayout = { key: ColumnKey; start: number; end: number };

const HEADER_SPECS: Array<{ key: ColumnKey; labels: string[] }> = [
  { key: "document", labels: ["Document"] },
  { key: "date", labels: ["Date"] },
  { key: "time", labels: ["Time"] },
  { key: "account", labels: [".Acct.", "Acct.", "Account"] },
  { key: "customer", labels: ["Customer Name"] },
  { key: "goods", labels: ["Goods"] },
  { key: "vat", labels: ["Vat", "VAT"] },
  { key: "value", labels: ["Value"] },
  { key: "inits", labels: ["Inits", "Init"] },
  { key: "orderNumber", labels: ["Customer Order Number"] },
];

function normaliseNewlines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
}

function isBlank(line: string): boolean {
  return !line.trim();
}

function isSeparator(line: string): boolean {
  const t = line.trim();
  return Boolean(t) && /^[-_=.\s]+$/.test(t) && (t.includes("-") || t.includes("="));
}

function looksLikeHeader(line: string): boolean {
  const upper = line.toUpperCase();
  return (
    upper.includes("CUSTOMER ORDER NUMBER") &&
    (upper.includes("DOCUMENT") || upper.includes("ACCT"))
  );
}

function looksLikeFooter(line: string): boolean {
  const t = line.trim().toUpperCase();
  return (
    t.startsWith("END OF REPORT") ||
    t.startsWith("*** END") ||
    t.includes("PAGE TOTAL") ||
    /^PAGE\s*:?\s*\d+/i.test(t)
  );
}

function looksLikeSubtotal(line: string): boolean {
  const t = line.trim().toUpperCase();
  return (
    t.includes("CUSTOMER TOTAL") ||
    t.includes("ACCOUNT TOTAL") ||
    t.startsWith("TOTALS") ||
    /\bSUB[- ]?TOTAL\b/.test(t)
  );
}

function findHeaderLabel(headerLine: string, label: string): number {
  let from = 0;
  while (from <= headerLine.length) {
    const idx = headerLine.indexOf(label, from);
    if (idx < 0) return -1;
    const after = headerLine[idx + label.length] ?? " ";
    // Reject substring hits (e.g. "Vat" inside "Value").
    if (!/[A-Za-z0-9]/.test(after)) return idx;
    from = idx + 1;
  }
  return -1;
}

function detectLayout(headerLine: string): ColumnLayout[] | null {
  const starts: Array<{ key: ColumnKey; start: number }> = [];
  for (const spec of HEADER_SPECS) {
    let idx = -1;
    for (const label of spec.labels) {
      idx = findHeaderLabel(headerLine, label);
      if (idx >= 0) break;
    }
    if (idx < 0) return null;
    starts.push({ key: spec.key, start: idx });
  }
  starts.sort((a, b) => a.start - b.start);
  return starts.map((col, i) => ({
    key: col.key,
    start: col.start,
    end: i + 1 < starts.length ? starts[i + 1]!.start : Math.max(headerLine.length, 140),
  }));
}

function sliceFields(line: string, layout: ColumnLayout[]): Record<ColumnKey, string> {
  const out = {} as Record<ColumnKey, string>;
  for (const col of layout) {
    out[col.key] = line.slice(col.start, col.end).trim();
  }
  return out;
}

function parseUkDate(raw: string): string | null {
  const t = raw.trim();
  // DD/MM/YYYY or DD-MM-YYYY
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

function parseMoneyToken(raw: string): string | null {
  const t = raw.replace(/,/g, "").trim();
  if (!t) return null;
  // Credits often shown as (123.45) or trailing -
  const neg = /^\(.*\)$/.test(t) || /-$/.test(t);
  const cleaned = t.replace(/[()]/g, "").replace(/-$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n).toFixed(2);
  return neg || n < 0 ? `-${abs}` : abs;
}

function classifyKind(documentNumber: string, goods: string | null, value: string | null): Autopart504cDocumentKind {
  const doc = documentNumber.toUpperCase();
  if (doc.startsWith("C") || doc.includes("CRN") || doc.startsWith("CN")) return "CREDIT";
  if (goods?.startsWith("-") || value?.startsWith("-")) return "CREDIT";
  if (/^\d+$/.test(documentNumber) || doc.startsWith("I") || doc.startsWith("INV")) return "INVOICE";
  return "UNKNOWN";
}

/**
 * Parse Autopart 504C text report.
 * Non-AB Customer Order Numbers are classified NON_AB (not errors).
 */
export function parseAutopart504cReport(text: string): Autopart504cParseResult {
  const lines = normaliseNewlines(text);
  const errors: string[] = [];
  const rows: Autopart504cRow[] = [];
  let layout: ColumnLayout[] | null = null;
  let headerFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;

    if (isBlank(line)) continue;
    if (isSeparator(line)) continue;
    if (looksLikeFooter(line) && headerFound) continue;

    if (looksLikeHeader(line)) {
      layout = detectLayout(line);
      headerFound = true;
      if (!layout) {
        errors.push(`Line ${lineNumber}: 504C header found but column layout could not be detected.`);
      }
      continue;
    }

    if (!layout) {
      // Title / page banners before header — ignore.
      continue;
    }

    if (looksLikeSubtotal(line)) {
      rows.push({
        lineNumber,
        documentNumber: "",
        documentDate: null,
        documentTime: null,
        accountCode: "",
        customerName: "",
        goods: null,
        vat: null,
        value: null,
        initials: null,
        customerOrderNumber: "",
        kind: "UNKNOWN",
        rawLine: line,
        isAbOrderReference: false,
        abOrderNumber: null,
        classification: "SUBTOTAL",
      });
      continue;
    }

    const fields = sliceFields(line, layout);
    const documentNumber = fields.document ?? "";
    const accountCode = fields.account ?? "";
    const customerName = fields.customer ?? "";
    const customerOrderNumber = fields.orderNumber ?? "";
    const goods = parseMoneyToken(fields.goods ?? "");
    const vat = parseMoneyToken(fields.vat ?? "");
    const value = parseMoneyToken(fields.value ?? "");

    // Require at least document + account to treat as a data row
    if (!documentNumber && !accountCode) {
      rows.push({
        lineNumber,
        documentNumber: "",
        documentDate: null,
        documentTime: null,
        accountCode: "",
        customerName: "",
        goods: null,
        vat: null,
        value: null,
        initials: null,
        customerOrderNumber: "",
        kind: "UNKNOWN",
        rawLine: line,
        isAbOrderReference: false,
        abOrderNumber: null,
        classification: "MALFORMED",
      });
      continue;
    }

    if (!documentNumber || !accountCode) {
      rows.push({
        lineNumber,
        documentNumber,
        documentDate: parseUkDate(fields.date ?? ""),
        documentTime: parseTime(fields.time ?? ""),
        accountCode,
        customerName,
        goods,
        vat,
        value,
        initials: fields.inits || null,
        customerOrderNumber,
        kind: "UNKNOWN",
        rawLine: line,
        isAbOrderReference: false,
        abOrderNumber: null,
        classification: "MALFORMED",
      });
      continue;
    }

    const kind = classifyKind(documentNumber, goods, value);
    const isAb = isAbOrderNumber(customerOrderNumber);
    const abOrderNumber = isAb ? normaliseAbOrderNumber(customerOrderNumber) : null;

    let classification: Autopart504cRow["classification"] = "NON_AB";
    if (isAb && kind === "CREDIT") classification = "AB_CREDIT";
    else if (isAb) classification = "AB_INVOICE";

    rows.push({
      lineNumber,
      documentNumber,
      documentDate: parseUkDate(fields.date ?? ""),
      documentTime: parseTime(fields.time ?? ""),
      accountCode,
      customerName,
      goods,
      vat,
      value,
      initials: fields.inits || null,
      customerOrderNumber,
      kind: isAb && kind === "UNKNOWN" ? "INVOICE" : kind,
      rawLine: line,
      isAbOrderReference: isAb,
      abOrderNumber,
      classification,
    });
  }

  if (!headerFound) {
    errors.push("504C header row (Customer Order Number) was not found.");
  }

  const dataRows = rows.filter((r) => r.classification === "AB_INVOICE" || r.classification === "AB_CREDIT" || r.classification === "NON_AB" || r.classification === "MALFORMED");
  return {
    rows,
    abInvoiceRows: rows.filter((r) => r.classification === "AB_INVOICE"),
    abCreditRows: rows.filter((r) => r.classification === "AB_CREDIT"),
    nonAbRows: rows.filter((r) => r.classification === "NON_AB").length,
    malformedRows: rows.filter((r) => r.classification === "MALFORMED").length,
    headerFound,
    errors,
  };
}
