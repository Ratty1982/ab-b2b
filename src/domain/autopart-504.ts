/**
 * Autopart all-branches 504 — Listing of invoices/credits (document feed).
 *
 * Distinct from legacy 504C. Accepts:
 * - CSV/TSV (existing tests / older exports)
 * - Production day-end fixed-width TXT
 *   "LISTING OF INVOICES AND CREDITS BY CUSTOMER TYPE (504)"
 *
 * 504 != 504C. Never treat (504C) / .Acct. reports as this feed.
 */

import { isAbOrderNumber, normaliseAbOrderNumber } from "@/domain/order-status";

export const AUTOPART_504_REPORT_TITLE = "504";
export const AUTOPART_504_DAYEND_TITLE = "LISTING OF INVOICES AND CREDITS BY CUSTOMER TYPE (504)";

export type Autopart504DocumentKind = "INVOICE" | "CREDIT" | "UNKNOWN";

export type Autopart504RowClassification =
  | "AB_INVOICE"
  | "AB_CREDIT"
  | "NON_AB"
  | "UNKNOWN"
  | "MALFORMED"
  | "BLANK"
  | "HEADER"
  | "PAGE"
  | "SUBTOTAL"
  | "TOTAL";

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
  classification: Autopart504RowClassification;
  rawLine: string;
  malformedReason?: string | null;
};

export type Autopart504MoneyTriple = { goods: string | null; vat: string | null; value: string | null };

export type Autopart504ParseResult = {
  rows: Autopart504Row[];
  invoiceRows: Autopart504Row[];
  creditRows: Autopart504Row[];
  abInvoiceRows: Autopart504Row[];
  abCreditRows: Autopart504Row[];
  nonAbRows: number;
  malformedRows: number;
  headerFound: boolean;
  layoutMode: "csv" | "fixed-width" | null;
  warnings: string[];
  grandTotal: Autopart504MoneyTriple | null;
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

type FixedColumnKey =
  | "type"
  | "document"
  | "date"
  | "time"
  | "customer"
  | "goods"
  | "vat"
  | "value"
  | "inits"
  | "orderNumber";

type FixedColumnLayout = { key: FixedColumnKey; start: number; end: number };

const FIXED_HEADER_SPECS: Array<{ key: FixedColumnKey; labels: string[]; required: boolean }> = [
  { key: "type", labels: ["Type"], required: true },
  { key: "document", labels: ["Document"], required: true },
  { key: "date", labels: ["Date"], required: true },
  { key: "time", labels: ["Time"], required: false },
  { key: "customer", labels: ["Customer Name", "Name"], required: true },
  { key: "goods", labels: ["Goods"], required: true },
  { key: "vat", labels: ["Vat", "VAT"], required: false },
  { key: "value", labels: ["Value"], required: true },
  { key: "inits", labels: ["Inits", "Init"], required: false },
  { key: "orderNumber", labels: ["Customer Order Number"], required: true },
];

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

function normaliseHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseAutopart504UkDate(raw: string): string | null {
  const t = raw.trim();
  const slash = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (slash) {
    const day = slash[1]!.padStart(2, "0");
    const month = slash[2]!.padStart(2, "0");
    let year = slash[3]!;
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }
  const named = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})$/);
  if (named) {
    const day = named[1]!.padStart(2, "0");
    const month = MONTHS[named[2]!.toLowerCase()];
    if (!month) return null;
    let year = named[3]!;
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }
  return null;
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

function findHeaderLabel(headerLine: string, label: string): number {
  let from = 0;
  while (from <= headerLine.length) {
    const idx = headerLine.indexOf(label, from);
    if (idx < 0) return -1;
    const after = headerLine[idx + label.length] ?? " ";
    if (!/[A-Za-z0-9]/.test(after)) return idx;
    from = idx + 1;
  }
  return -1;
}

export function detectAutopart504FixedWidthLayout(headerLine: string): FixedColumnLayout[] | null {
  const starts: Array<{ key: FixedColumnKey; start: number }> = [];
  for (const spec of FIXED_HEADER_SPECS) {
    let idx = -1;
    for (const label of spec.labels) {
      idx = findHeaderLabel(headerLine, label);
      if (idx >= 0) break;
    }
    if (idx < 0) {
      if (spec.required) return null;
      continue;
    }
    starts.push({ key: spec.key, start: idx });
  }
  starts.sort((a, b) => a.start - b.start);
  return starts.map((col, i) => ({
    key: col.key,
    start: col.start,
    end: i + 1 < starts.length ? starts[i + 1]!.start : Math.max(headerLine.length, 160),
  }));
}

function sliceFixedFields(line: string, layout: FixedColumnLayout[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of layout) {
    out[col.key] = line.slice(col.start, col.end).trim();
  }
  return out;
}

function colByKey(layout: FixedColumnLayout[], key: FixedColumnKey): FixedColumnLayout | undefined {
  return layout.find((c) => c.key === key);
}

/**
 * Autopart right-aligns Goods/VAT/Value. VAT can overflow the naive Goods→Vat
 * slice (e.g. "49.99    10" / ".00"). Recover the three money tokens from the
 * Goods…Inits (or Goods…Order) span when individual slices are not clean.
 */
function extractFixedWidthMoney(
  line: string,
  layout: FixedColumnLayout[],
): Autopart504MoneyTriple {
  const goodsCol = colByKey(layout, "goods");
  const vatCol = colByKey(layout, "vat");
  const valueCol = colByKey(layout, "value");
  const initsCol = colByKey(layout, "inits");
  const orderCol = colByKey(layout, "orderNumber");

  const slicedGoods = goodsCol ? parseAutopartMoneyToken(line.slice(goodsCol.start, goodsCol.end)) : null;
  const slicedVat = vatCol ? parseAutopartMoneyToken(line.slice(vatCol.start, vatCol.end)) : null;
  const slicedValue = valueCol ? parseAutopartMoneyToken(line.slice(valueCol.start, valueCol.end)) : null;
  if (slicedGoods && slicedValue && (!vatCol || slicedVat)) {
    return { goods: slicedGoods, vat: slicedVat, value: slicedValue };
  }

  const spanStart = goodsCol?.start ?? vatCol?.start ?? valueCol?.start ?? 0;
  const spanEnd = initsCol?.start ?? orderCol?.start ?? line.length;
  const tokens = line
    .slice(spanStart, Math.max(spanEnd, spanStart))
    .trim()
    .split(/\s+/)
    .map((tok) => parseAutopartMoneyToken(tok))
    .filter((tok): tok is string => tok != null);

  if (tokens.length >= 3) {
    return { goods: tokens[0]!, vat: tokens[1]!, value: tokens[2]! };
  }
  if (tokens.length === 2) {
    return { goods: tokens[0]!, vat: slicedVat, value: tokens[1]! };
  }
  if (tokens.length === 1) {
    return { goods: tokens[0]!, vat: slicedVat, value: slicedValue ?? tokens[0]! };
  }
  return { goods: slicedGoods, vat: slicedVat, value: slicedValue };
}

function looksLikeLegacy504cContent(sampleUpper: string): boolean {
  if (sampleUpper.includes("LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)")) return true;
  if (/\(504C\)/.test(sampleUpper)) return true;
  if (sampleUpper.includes("CUSTOMER ORDER NUMBER") && sampleUpper.includes(".ACCT.")) return true;
  return false;
}

export function looksLikeAutopart504DayEndTitle(text: string): boolean {
  const sample = text.replace(/^\uFEFF/, "").slice(0, 8000).toUpperCase();
  if (looksLikeLegacy504cContent(sample)) return false;
  return /LISTING OF INVOICES AND CREDITS BY CUSTOMER TYPE\s*\(504\)/.test(sample);
}

export function looksLikeAutopart504FixedWidthHeader(line: string): boolean {
  const upper = line.toUpperCase();
  if (upper.includes("504C") || upper.includes(".ACCT.")) return false;
  return (
    upper.includes("TYPE") &&
    upper.includes("DOCUMENT") &&
    upper.includes("CUSTOMER ORDER NUMBER") &&
    (upper.includes("GOODS") || upper.includes("VALUE")) &&
    (upper.includes("NAME") || upper.includes("CUSTOMER"))
  );
}

function isSeparator(line: string): boolean {
  const t = line.trim();
  return Boolean(t) && /^[-_=.\s]+$/.test(t) && (t.includes("-") || t.includes("=") || t.includes("*"));
}

function isPageBanner(line: string): boolean {
  const t = line.trim();
  if (/^page\s*:?\s*\d+/i.test(t)) return true;
  if (/A\s*U\s*T\s*O\s*P\s*A\s*R\s*T\s+S\s*Y\s*S\s*T\s*E\s*M/i.test(t)) return true;
  if (/listing of invoices and credits by customer type/i.test(t)) return true;
  if (/\[select branch/i.test(t) || /\[start date/i.test(t) || /\[ending date/i.test(t)) return true;
  return false;
}

function parseTotalAmounts(line: string): Autopart504MoneyTriple | null {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return null;
  const amounts = tokens.map((tok) => parseAutopartMoneyToken(tok));
  if (amounts.some((a) => a == null)) return null;
  return {
    goods: amounts[0] ?? null,
    vat: amounts[1] ?? null,
    value: amounts[2] ?? amounts[0] ?? null,
  };
}

function moneyMinor(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function classifyDocumentRow(input: {
  documentNumber: string;
  customerOrderNumber: string;
  goods: string | null;
  value: string | null;
}): { kind: Autopart504DocumentKind; classification: Autopart504RowClassification } {
  const kind = classifyAutopart504Kind(input.documentNumber, input.goods, input.value);
  const isAb = isAbOrderNumber(input.customerOrderNumber);
  let classification: Autopart504RowClassification = "NON_AB";
  if (kind === "UNKNOWN") classification = "UNKNOWN";
  else if (isAb && kind === "CREDIT") classification = "AB_CREDIT";
  else if (isAb && kind === "INVOICE") classification = "AB_INVOICE";
  else if (!input.goods && !input.value) classification = "MALFORMED";
  return { kind, classification };
}

function metaRow(
  lineNumber: number,
  line: string,
  classification: Autopart504RowClassification,
): Autopart504Row {
  return {
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
    classification,
    rawLine: line,
  };
}

/**
 * Positive content detection for all-branches 504 (not 504C).
 */
export function isAutopart504Report(text: string): boolean {
  const raw = text.replace(/^\uFEFF/, "");
  const sample = raw.slice(0, 8000).toUpperCase();
  if (looksLikeLegacy504cContent(sample)) return false;
  if (sample.includes("TRM21QC")) return false;
  if (looksLikeAutopart504DayEndTitle(raw)) return true;
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines.slice(0, 80)) {
    if (!line.trim()) continue;
    if (looksLikeAutopart504FixedWidthHeader(line) && detectAutopart504FixedWidthLayout(line)) return true;
    const delim = detectDelimiter(line);
    const cells = splitCsvLine(line, delim);
    if (cells.length > 1 && mapHeaders(cells)) return true;
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

export function isAutopart504FinancialRow(row: Autopart504Row): boolean {
  return (
    row.classification === "AB_INVOICE" ||
    row.classification === "AB_CREDIT" ||
    row.classification === "NON_AB" ||
    row.classification === "UNKNOWN" ||
    row.classification === "MALFORMED"
  );
}

export function isAutopart504ArtefactRow(row: Autopart504Row): boolean {
  return (
    row.classification === "HEADER" ||
    row.classification === "PAGE" ||
    row.classification === "SUBTOTAL" ||
    row.classification === "TOTAL"
  );
}

export function isAutopart504ImportableRow(row: Autopart504Row): boolean {
  return Boolean(
    row.documentNumber &&
      (row.classification === "AB_INVOICE" ||
        row.classification === "AB_CREDIT" ||
        row.classification === "NON_AB" ||
        row.classification === "UNKNOWN"),
  );
}

export function describeAutopart504Malformed(row: Autopart504Row): string {
  const reason = row.malformedReason?.trim() || "malformed row";
  const doc = row.documentNumber?.trim() || "n/a";
  return `Line ${row.lineNumber}: ${reason}; document candidate ${doc}`;
}

export function parseAutopart504Report(text: string): Autopart504ParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: Autopart504Row[] = [];
  let headerFound = false;
  let layoutMode: "csv" | "fixed-width" | null = null;
  let delimiter: "," | "\t" | "|" | ";" = ",";
  let headerMap: Record<string, number> | null = null;
  let fixedLayout: FixedColumnLayout[] | null = null;
  const totals: Autopart504MoneyTriple[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    if (!line.trim()) continue;
    if (isSeparator(line)) continue;
    if (isPageBanner(line)) {
      if (headerFound) rows.push(metaRow(lineNumber, line, "PAGE"));
      continue;
    }

    const csvCells = splitCsvLine(line, detectDelimiter(line));
    const csvMap = csvCells.length > 1 ? mapHeaders(csvCells) : null;
    const fixedCandidate =
      looksLikeAutopart504FixedWidthHeader(line) ? detectAutopart504FixedWidthLayout(line) : null;

    if (csvMap || fixedCandidate) {
      headerFound = true;
      if (csvMap) {
        layoutMode = "csv";
        headerMap = csvMap;
        delimiter = detectDelimiter(line);
        fixedLayout = null;
      } else {
        layoutMode = "fixed-width";
        fixedLayout = fixedCandidate;
        headerMap = null;
      }
      rows.push(metaRow(lineNumber, line, "HEADER"));
      continue;
    }

    if (!headerFound) continue;

    const total = parseTotalAmounts(line);
    if (total && !/^[A-Za-z]/.test(line.trim())) {
      totals.push(total);
      rows.push({
        ...metaRow(lineNumber, line, totals.length === 1 ? "SUBTOTAL" : "TOTAL"),
        goods: total.goods,
        vat: total.vat,
        value: total.value,
      });
      continue;
    }

    let reportType: string | null = null;
    let documentNumber = "";
    let dateRaw = "";
    let timeRaw = "";
    let customerName = "";
    let goodsRaw = "";
    let vatRaw = "";
    let valueRaw = "";
    let initials: string | null = null;
    let customerOrderNumber = "";

    if (layoutMode === "csv" && headerMap) {
      const cells = splitCsvLine(line, delimiter);
      const get = (key: string) => {
        const at = headerMap![key];
        return at == null ? "" : (cells[at] ?? "").trim();
      };
      reportType = get("type") || null;
      documentNumber = get("document");
      dateRaw = get("date");
      timeRaw = get("time");
      customerName = get("customer");
      goodsRaw = get("goods");
      vatRaw = get("vat");
      valueRaw = get("value");
      initials = get("inits") || null;
      customerOrderNumber = get("orderNumber");
    } else if (layoutMode === "fixed-width" && fixedLayout) {
      const fields = sliceFixedFields(line, fixedLayout);
      reportType = fields.type || null;
      documentNumber = fields.document ?? "";
      dateRaw = fields.date ?? "";
      timeRaw = fields.time ?? "";
      customerName = fields.customer ?? "";
      initials = fields.inits || null;
      customerOrderNumber = fields.orderNumber ?? "";
      const money = extractFixedWidthMoney(line, fixedLayout);
      goodsRaw = money.goods ?? "";
      vatRaw = money.vat ?? "";
      valueRaw = money.value ?? "";
    }

    if (!documentNumber) {
      rows.push(metaRow(lineNumber, line, "BLANK"));
      continue;
    }

    const goods =
      layoutMode === "fixed-width" ? goodsRaw || null : parseAutopartMoneyToken(goodsRaw);
    const vat = layoutMode === "fixed-width" ? vatRaw || null : parseAutopartMoneyToken(vatRaw);
    const value =
      layoutMode === "fixed-width" ? valueRaw || null : parseAutopartMoneyToken(valueRaw);
    const { kind, classification } = classifyDocumentRow({
      documentNumber,
      customerOrderNumber,
      goods,
      value,
    });
    let finalClassification = classification;
    let malformedReason: string | null = null;
    if (kind === "UNKNOWN") {
      malformedReason = `unknown document type`;
      errors.push(`Line ${lineNumber}: ${malformedReason}; document candidate ${documentNumber}`);
    } else if (finalClassification === "MALFORMED") {
      malformedReason = `missing goods/value`;
      errors.push(`Line ${lineNumber}: ${malformedReason}; document candidate ${documentNumber}`);
    }

    const isAb = isAbOrderNumber(customerOrderNumber);
    rows.push({
      lineNumber,
      reportType,
      documentNumber,
      documentDate: parseAutopart504UkDate(dateRaw),
      documentTime: parseTime(timeRaw),
      customerName,
      goods,
      vat,
      value,
      initials,
      customerOrderNumber,
      kind,
      isAbOrderReference: isAb,
      abOrderNumber: isAb ? normaliseAbOrderNumber(customerOrderNumber) : null,
      classification: finalClassification,
      rawLine: line,
      malformedReason,
    });
  }

  if (!headerFound) {
    errors.push("504 header not found (expected Document + Customer Order Number + Goods/Value).");
  }

  const financial = rows.filter(isAutopart504FinancialRow);
  const importable = rows.filter(isAutopart504ImportableRow);
  const invoiceRows = importable.filter((r) => r.kind === "INVOICE");
  const creditRows = importable.filter((r) => r.kind === "CREDIT");
  const grandTotal = totals.length ? totals[totals.length - 1]! : null;
  if (grandTotal?.goods) {
    const sum = invoiceRows.concat(creditRows).reduce((acc, r) => acc + (moneyMinor(r.goods) ?? 0), 0);
    const reported = moneyMinor(grandTotal.goods);
    if (reported != null && Math.abs(sum - reported) > 1) {
      warnings.push(
        `Report goods total ${grandTotal.goods} differs from parsed document goods ${(sum / 100).toFixed(2)} (informational).`,
      );
    }
  }

  return {
    rows,
    invoiceRows,
    creditRows,
    abInvoiceRows: financial.filter((r) => r.classification === "AB_INVOICE"),
    abCreditRows: financial.filter((r) => r.classification === "AB_CREDIT"),
    nonAbRows: financial.filter((r) => r.classification === "NON_AB").length,
    malformedRows: financial.filter((r) => r.classification === "MALFORMED").length,
    headerFound,
    layoutMode,
    warnings,
    grandTotal,
    errors,
  };
}
