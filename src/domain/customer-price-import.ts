import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { parseCsvRecords } from "@/domain/catalogue-csv";
import { priceDifferenceFromUnknown } from "@/domain/pricing-management";

export const CUSTOMER_PRICE_IMPORT_MAX_BYTES = 2_000_000;
export const CUSTOMER_PRICE_IMPORT_MAX_ROWS = 2_000;

const HEADER_SKU = "sku";
const HEADER_PRICE = "customer price ex vat";
const HEADER_FROM = "valid from";
const HEADER_UNTIL = "valid until";
const ALLOWED_HEADERS = new Set([HEADER_SKU, HEADER_PRICE, HEADER_FROM, HEADER_UNTIL]);

const FORMULA_START = /^[=+@\t\r]/;

export const CUSTOMER_PRICE_IMPORT_TEMPLATE_CSV = `SKU,Customer Price Ex VAT,Valid From,Valid Until
SS473,16.50,,
PM500,7.25,,
PM1000,10.50,,
`;

export type CustomerPriceImportActionName = "NEW" | "UPDATE" | "UNCHANGED" | "INVALID";

export type CustomerPriceFileIssue = {
  rowNumber: number | null;
  message: string;
};

export type CustomerPriceImportLineDraft = {
  rowNumber: number;
  sku: string;
  action: CustomerPriceImportActionName;
  variantId: string | null;
  productName: string | null;
  proposedPrice: string | null;
  existingPrice: string | null;
  normalPrice: string | null;
  percentChange: string | null;
  startsAt: string | null;
  endsAt: string | null;
  existingStartsAt: string | null;
  existingEndsAt: string | null;
  existingUpdatedAt: string | null;
  messages: string[];
};

export type CustomerPriceImportPreview = {
  lines: CustomerPriceImportLineDraft[];
  productsFound: number;
  newCount: number;
  updateCount: number;
  unchangedCount: number;
  invalidCount: number;
  fingerprint: string;
};

export type CustomerPriceCatalogueVariant = {
  id: string;
  sku: string;
  productName: string;
  tradePrice: string | null;
};

export type CustomerPriceExistingSnapshot = {
  variantId: string;
  unitPrice: string;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
};

type ImportCell =
  | { kind: "empty" }
  | { kind: "formula" }
  | { kind: "number"; value: number }
  | { kind: "text"; value: string };

type RawImportRow = {
  rowNumber: number;
  sku: string;
  messages: string[];
  proposedPrice: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

export type ParsedCustomerPriceFile = {
  fileIssues: CustomerPriceFileIssue[];
  rows: RawImportRow[];
};

export function customerPriceImportTemplateCsv(): string {
  return CUSTOMER_PRICE_IMPORT_TEMPLATE_CSV;
}

export function customerPriceFileIssue(input: { filename: string; byteLength: number }): string | null {
  const base = input.filename.split(/[/\\]/).pop()?.trim() ?? "";
  const ext = base.includes(".") ? (base.split(".").pop()?.toLowerCase() ?? "") : "";
  if (ext !== "csv" && ext !== "xlsx") return "Upload a .csv or .xlsx file";
  if (input.byteLength <= 0) return "The file is empty";
  if (input.byteLength > CUSTOMER_PRICE_IMPORT_MAX_BYTES) return "File exceeds the 2 MB limit";
  return null;
}

/** Prefix formula-like text so spreadsheet apps do not execute exported cells. */
export function protectSpreadsheetCell(value: string): string {
  if (FORMULA_START.test(value) || value.startsWith("-")) return `'${value}`;
  return value;
}

function csvCell(value: string): string {
  const safe = protectSpreadsheetCell(value);
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function exportNegotiatedPricesCsv(
  rows: Array<{
    sku: string;
    productName: string;
    unitPrice: string;
    startsAt: string | null;
    endsAt: string | null;
  }>,
): string {
  const lines = ["SKU,Product,Customer Price Ex VAT,Valid From,Valid Until"];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.sku),
        csvCell(row.productName),
        csvCell(row.unitPrice),
        csvCell(row.startsAt ? row.startsAt.slice(0, 10) : ""),
        csvCell(row.endsAt ? row.endsAt.slice(0, 10) : ""),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function parseImportPriceText(raw: string): { price: string | null; message: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { price: null, message: "Missing price" };
  if (FORMULA_START.test(trimmed)) return { price: null, message: "Formula values are not allowed" };
  let body = trimmed;
  if (body.startsWith("£")) body = body.slice(1).trim();
  if (body.startsWith("-")) return { price: null, message: "Price must be greater than zero" };
  const thousands = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
  if (thousands.test(body)) body = body.replaceAll(",", "");
  if (!/^\d+(\.\d+)?$/.test(body)) return { price: null, message: "Invalid price" };
  const [whole = "", frac = ""] = body.split(".");
  if (frac.length > 4) return { price: null, message: "Price has more than 4 decimal places" };
  if (whole.length > 8) return { price: null, message: "Price exceeds the allowed size" };
  const normalized = `${whole}.${(frac + "0000").slice(0, 4)}`;
  if (normalized === "0.0000") return { price: null, message: "Price must be greater than zero" };
  return { price: normalized, message: null };
}

export function parseImportPriceNumber(value: number): { price: string | null; message: string | null } {
  if (!Number.isFinite(value)) return { price: null, message: "Invalid price" };
  const scaled = value * 10_000;
  const nearest = Math.round(scaled);
  if (Math.abs(scaled - nearest) > 1e-4) {
    return { price: null, message: "Price is not an exact 4 decimal place amount" };
  }
  if (nearest <= 0) return { price: null, message: "Price must be greater than zero" };
  if (nearest > 99_999_999 * 10_000) return { price: null, message: "Price exceeds the allowed size" };
  const whole = Math.trunc(nearest / 10_000);
  const frac = Math.abs(nearest % 10_000);
  return { price: `${whole}.${String(frac).padStart(4, "0")}`, message: null };
}

export function parseImportDate(raw: string, label: string): { iso: string | null; message: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { iso: null, message: null };
  if (FORMULA_START.test(trimmed)) return { iso: null, message: `${label} contains a formula` };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return { iso: null, message: `${label} must be YYYY-MM-DD` };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { iso: null, message: `${label} is not a real calendar date` };
  }
  return { iso: date.toISOString(), message: null };
}

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function headerMap(headers: string[]): {
  issues: CustomerPriceFileIssue[];
  index: { sku: number; price: number; from: number | null; until: number | null } | null;
} {
  const named = [...headers];
  while (named.length > 0 && normaliseHeader(named[named.length - 1] ?? "") === "") named.pop();
  if (named.length === 0) {
    return { issues: [{ rowNumber: 1, message: "The file has no column headers" }], index: null };
  }
  if (named.some((header) => normaliseHeader(header) === "")) {
    return { issues: [{ rowNumber: 1, message: "A column header is blank" }], index: null };
  }
  const keys = named.map(normaliseHeader);
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      return { issues: [{ rowNumber: 1, message: `Duplicate column header "${key}"` }], index: null };
    }
    seen.add(key);
  }
  const unexpected = keys.filter((key) => !ALLOWED_HEADERS.has(key));
  if (unexpected.length) {
    return {
      issues: [
        {
          rowNumber: 1,
          message: `Unexpected column header${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}`,
        },
      ],
      index: null,
    };
  }
  if (!seen.has(HEADER_SKU) || !seen.has(HEADER_PRICE)) {
    return {
      issues: [{ rowNumber: 1, message: "The file must include SKU and Customer Price Ex VAT columns" }],
      index: null,
    };
  }
  return {
    issues: [],
    index: {
      sku: keys.indexOf(HEADER_SKU),
      price: keys.indexOf(HEADER_PRICE),
      from: seen.has(HEADER_FROM) ? keys.indexOf(HEADER_FROM) : null,
      until: seen.has(HEADER_UNTIL) ? keys.indexOf(HEADER_UNTIL) : null,
    },
  };
}

function textCell(value: string): ImportCell {
  return value === "" ? { kind: "empty" } : { kind: "text", value };
}

function cellText(cell: ImportCell): { text: string; message: string | null } {
  if (cell.kind === "formula") return { text: "", message: "Formula values are not allowed" };
  if (cell.kind === "empty") return { text: "", message: null };
  if (cell.kind === "number") return { text: String(cell.value), message: null };
  if (FORMULA_START.test(cell.value.trim())) return { text: "", message: "Formula values are not allowed" };
  return { text: cell.value.trim(), message: null };
}

function priceFromCell(cell: ImportCell): { price: string | null; message: string | null } {
  if (cell.kind === "formula") return { price: null, message: "Formula values are not allowed" };
  if (cell.kind === "empty") return { price: null, message: "Missing price" };
  if (cell.kind === "number") return parseImportPriceNumber(cell.value);
  return parseImportPriceText(cell.value);
}

function dateFromCell(cell: ImportCell, label: string): { iso: string | null; message: string | null } {
  if (cell.kind === "empty") return { iso: null, message: null };
  if (cell.kind === "formula") return { iso: null, message: `${label} contains a formula` };
  if (cell.kind === "number") return { iso: null, message: `${label} must be YYYY-MM-DD` };
  return parseImportDate(cell.value, label);
}

function rowFromCells(
  rowNumber: number,
  cells: ImportCell[],
  index: { sku: number; price: number; from: number | null; until: number | null },
): RawImportRow {
  const skuCell = cells[index.sku] ?? { kind: "empty" as const };
  const priceCell = cells[index.price] ?? { kind: "empty" as const };
  const fromCell = index.from == null ? { kind: "empty" as const } : (cells[index.from] ?? { kind: "empty" as const });
  const untilCell = index.until == null ? { kind: "empty" as const } : (cells[index.until] ?? { kind: "empty" as const });
  const messages: string[] = [];
  const skuRead = cellText(skuCell);
  if (skuRead.message) messages.push(skuRead.message);
  const sku = skuRead.text;
  if (!sku && !skuRead.message) messages.push("SKU is empty");
  const price = priceFromCell(priceCell);
  if (price.message) messages.push(price.message);
  const from = dateFromCell(fromCell, "Valid From");
  if (from.message) messages.push(from.message);
  const until = dateFromCell(untilCell, "Valid Until");
  if (until.message) messages.push(until.message);
  if (from.iso && until.iso && until.iso < from.iso) {
    messages.push("Valid Until is before Valid From");
  }
  return {
    rowNumber,
    sku,
    messages,
    proposedPrice: price.price,
    startsAt: from.iso,
    endsAt: until.iso,
  };
}

function rowsFromMatrix(matrix: ImportCell[][], originRow: number): ParsedCustomerPriceFile {
  if (!matrix.length) {
    return { fileIssues: [{ rowNumber: 1, message: "The file is empty" }], rows: [] };
  }
  const headerCells = matrix[0] ?? [];
  const headerTexts = headerCells.map((cell) => {
    if (cell.kind === "formula") return { text: "", formula: true };
    if (cell.kind === "number") return { text: String(cell.value), formula: false };
    if (cell.kind === "text") return { text: cell.value, formula: false };
    return { text: "", formula: false };
  });
  if (headerTexts.some((cell) => cell.formula)) {
    return { fileIssues: [{ rowNumber: originRow, message: "Column headers contain a formula" }], rows: [] };
  }
  const mapped = headerMap(headerTexts.map((cell) => cell.text));
  if (!mapped.index) return { fileIssues: mapped.issues, rows: [] };
  const data = matrix.slice(1);
  if (data.length > CUSTOMER_PRICE_IMPORT_MAX_ROWS) {
    return {
      fileIssues: [
        {
          rowNumber: null,
          message: `The file has more than ${CUSTOMER_PRICE_IMPORT_MAX_ROWS} data rows`,
        },
      ],
      rows: [],
    };
  }
  if (!data.length) {
    return { fileIssues: [{ rowNumber: null, message: "The file has no data rows" }], rows: [] };
  }
  return {
    fileIssues: [],
    rows: data.map((cells, offset) => rowFromCells(originRow + 1 + offset, cells, mapped.index!)),
  };
}

export function parseCustomerPriceCsv(text: string): ParsedCustomerPriceFile {
  let table: string[][];
  try {
    table = parseCsvRecords(text);
  } catch {
    return { fileIssues: [{ rowNumber: null, message: "The CSV file could not be read" }], rows: [] };
  }
  const matrix = table.map((row) => row.map((cell) => textCell(cell.trim())));
  return rowsFromMatrix(matrix, 1);
}

function excelCell(value: ExcelJS.CellValue): ImportCell {
  if (value == null || value === "") return { kind: "empty" };
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value || "error" in value) return { kind: "formula" };
    if (value instanceof Date) {
      const year = value.getUTCFullYear();
      const month = String(value.getUTCMonth() + 1).padStart(2, "0");
      const day = String(value.getUTCDate()).padStart(2, "0");
      return { kind: "text", value: `${year}-${month}-${day}` };
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return { kind: "text", value: value.richText.map((part) => part.text).join("") };
    }
    if ("text" in value && typeof value.text === "string") return { kind: "text", value: value.text };
    return { kind: "formula" };
  }
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "boolean") return { kind: "formula" };
  return { kind: "text", value: String(value) };
}

export async function parseCustomerPriceXlsx(bytes: Uint8Array): Promise<ParsedCustomerPriceFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    return {
      fileIssues: [{ rowNumber: null, message: "The spreadsheet could not be read. It may be malformed." }],
      rows: [],
    };
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { fileIssues: [{ rowNumber: null, message: "The spreadsheet has no worksheet" }], rows: [] };
  }
  const lastRow = sheet.rowCount;
  if (lastRow < 1) return { fileIssues: [{ rowNumber: 1, message: "The file is empty" }], rows: [] };
  let width = 0;
  sheet.getRow(1).eachCell({ includeEmpty: false }, (_cell, col) => {
    if (col > width) width = col;
  });
  if (width > 12) {
    return { fileIssues: [{ rowNumber: 1, message: "Unexpected extra columns" }], rows: [] };
  }
  const readRow = (rowNumber: number): ImportCell[] => {
    const row = sheet.getRow(rowNumber);
    const cells: ImportCell[] = [];
    for (let col = 1; col <= Math.max(width, 1); col += 1) {
      cells.push(excelCell(row.getCell(col).value));
    }
    return cells;
  };
  const header = readRow(1);
  const data: Array<{ rowNumber: number; cells: ImportCell[] }> = [];
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const cells = readRow(rowNumber);
    if (cells.every((cell) => cell.kind === "empty")) continue;
    data.push({ rowNumber, cells });
  }
  const parsed = rowsFromMatrix([header, ...data.map((row) => row.cells)], 1);
  if (parsed.fileIssues.length || parsed.rows.length !== data.length) return parsed;
  return {
    fileIssues: [],
    rows: parsed.rows.map((row, index) => ({ ...row, rowNumber: data[index]!.rowNumber })),
  };
}

function percentLabel(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const diff = priceDifferenceFromUnknown(from, to);
  return diff ? diff.percentLabel : null;
}

export function buildCustomerPriceImportPreview(input: {
  companyId: string;
  rows: RawImportRow[];
  variants: CustomerPriceCatalogueVariant[];
  existingPrices: CustomerPriceExistingSnapshot[];
  priceListPrices: Array<{ variantId: string; unitPrice: string }>;
}): CustomerPriceImportPreview {
  const bySku = new Map<string, CustomerPriceCatalogueVariant[]>();
  for (const variant of input.variants) {
    const key = variant.sku.trim().toUpperCase();
    const list = bySku.get(key) ?? [];
    list.push(variant);
    bySku.set(key, list);
  }
  const skuCounts = new Map<string, number>();
  for (const row of input.rows) {
    const key = row.sku.trim().toUpperCase();
    if (!key) continue;
    skuCounts.set(key, (skuCounts.get(key) ?? 0) + 1);
  }
  const existingByVariant = new Map(input.existingPrices.map((row) => [row.variantId, row]));
  const listByVariant = new Map(input.priceListPrices.map((row) => [row.variantId, row.unitPrice]));

  const lines: CustomerPriceImportLineDraft[] = input.rows.map((row) => {
    const messages = [...row.messages];
    const key = row.sku.trim().toUpperCase();
    if (key && (skuCounts.get(key) ?? 0) > 1) messages.push("Duplicate SKU");
    const matches = key ? (bySku.get(key) ?? []) : [];
    let variant: CustomerPriceCatalogueVariant | null = null;
    if (matches.length > 1) messages.push("Ambiguous product match");
    else if (key && matches.length === 0) {
      messages.push("Unknown SKU");
    } else if (matches.length === 1) {
      variant = matches[0] ?? null;
    }
    const existing = variant ? (existingByVariant.get(variant.id) ?? null) : null;
    const normal = variant ? (listByVariant.get(variant.id) ?? variant.tradePrice) : null;
    const samePrice = Boolean(existing && row.proposedPrice && existing.unitPrice === row.proposedPrice);
    const sameDates = Boolean(
      existing && existing.startsAt === row.startsAt && existing.endsAt === row.endsAt,
    );
    let action: CustomerPriceImportActionName = "INVALID";
    if (messages.length === 0 && variant && row.proposedPrice) {
      if (!existing) action = "NEW";
      else if (samePrice && sameDates) action = "UNCHANGED";
      else action = "UPDATE";
    }
    const comparison = existing?.unitPrice ?? normal;
    return {
      rowNumber: row.rowNumber,
      sku: row.sku,
      action,
      variantId: variant?.id ?? null,
      productName: variant?.productName ?? null,
      proposedPrice: row.proposedPrice,
      existingPrice: existing?.unitPrice ?? null,
      normalPrice: normal,
      percentChange: percentLabel(comparison, row.proposedPrice),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      existingStartsAt: existing?.startsAt ?? null,
      existingEndsAt: existing?.endsAt ?? null,
      existingUpdatedAt: existing?.updatedAt ?? null,
      messages,
    };
  });

  const productsFound = lines.filter((line) => line.variantId).length;
  const newCount = lines.filter((line) => line.action === "NEW").length;
  const updateCount = lines.filter((line) => line.action === "UPDATE").length;
  const unchangedCount = lines.filter((line) => line.action === "UNCHANGED").length;
  const invalidCount = lines.filter((line) => line.action === "INVALID").length;
  const canonical = lines
    .filter((line) => line.action === "NEW" || line.action === "UPDATE")
    .map((line) =>
      [line.sku.trim().toUpperCase(), line.proposedPrice ?? "", line.startsAt ?? "", line.endsAt ?? ""].join("|"),
    )
    .sort()
    .join("\n");
  const fingerprint = createHash("sha256").update(`${input.companyId}\n${canonical}`).digest("hex");
  return { lines, productsFound, newCount, updateCount, unchangedCount, invalidCount, fingerprint };
}
