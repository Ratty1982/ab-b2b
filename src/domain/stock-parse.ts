import { detectCsvDelimiter, parseCsvRecords } from "@/domain/catalogue-csv";
import { normalizeStockSku, skuMatchKey } from "@/domain/stock";
import { is231Po3NewReport, parseNative231Po3New } from "@/domain/stock-parse-native";
import {
  MAX_STOCK_FEED_BYTES,
  parseAvailCell,
  type ParsedAvail,
  type StagedStockRow,
  type StockParseFailure,
  type StockParseSuccess,
} from "@/domain/stock-parse-types";

export {
  MAX_STOCK_FEED_BYTES,
  parseAvailCell,
  type ParsedAvail,
  type StagedStockRow,
  type StockParseFailure,
  type StockParseSuccess,
};

export const STOCK_SKU_HEADERS = [
  "sku",
  "code",
  "stkcode",
  "stk_code",
  "stockcode",
  "stock_code",
  "part",
  "partno",
  "part_no",
  "partnumber",
  "item",
];

export const STOCK_AVAIL_HEADERS = ["avail", "available", "availableqty", "qtyavail", "free", "freeqty"];

export const STOCK_DESC_HEADERS = ["description", "desc", "name", "product", "title"];

export function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s._-]+/g, "");
}

export function parseAutopart231Po3New(text: string, byteLength?: number): StockParseSuccess | StockParseFailure {
  if (is231Po3NewReport(text)) {
    return parseNative231Po3New(text, byteLength);
  }
  if (byteLength != null && byteLength > MAX_STOCK_FEED_BYTES) {
    return { code: "TOO_LARGE", message: `Feed exceeds ${MAX_STOCK_FEED_BYTES} bytes` };
  }
  const delimiter = detectCsvDelimiter(text);
  const records = parseCsvRecords(text, delimiter);
  if (!records.length) return { code: "EMPTY", message: "Feed has no rows" };
  const header = records[0] ?? [];
  const keys = header.map((cell) => headerKey(cell));
  const skuIdx = keys.findIndex((key) => STOCK_SKU_HEADERS.includes(key));
  const availIdx = keys.findIndex((key) => STOCK_AVAIL_HEADERS.includes(key));
  const descIdx = keys.findIndex((key) => STOCK_DESC_HEADERS.includes(key));
  if (skuIdx < 0) return { code: "MISSING_SKU_HEADER", message: "Required SKU/code column is missing" };
  if (availIdx < 0) {
    return { code: "MISSING_AVAIL_HEADER", message: "Required Avail column is missing or renamed" };
  }

  const rows: StagedStockRow[] = [];
  for (let i = 1; i < records.length; i += 1) {
    const rec = records[i] ?? [];
    const sku = normalizeStockSku(rec[skuIdx] ?? "");
    const availRaw = rec[availIdx] ?? "";
    const description = descIdx >= 0 ? (rec[descIdx] ?? "").trim() || null : null;
    rows.push({
      line: i + 1,
      sku,
      matchKey: skuMatchKey(sku),
      description,
      availRaw,
      avail: parseAvailCell(availRaw),
    });
  }
  return {
    delimiter,
    skuHeader: header[skuIdx] ?? "SKU",
    availHeader: header[availIdx] ?? "Avail",
    rows,
  };
}

export type ClassifiedStockRow =
  | { kind: "valid"; row: StagedStockRow; avail: number }
  | { kind: "invalid"; row: StagedStockRow; message: string }
  | { kind: "duplicate"; row: StagedStockRow; message: string }
  | { kind: "missing_sku"; row: StagedStockRow; message: string };

/**
 * Duplicate SKUs are conflicts: no row for that SKU is applied (not last-wins).
 */
export function classifyStockRows(rows: StagedStockRow[]): ClassifiedStockRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.matchKey) continue;
    counts.set(row.matchKey, (counts.get(row.matchKey) ?? 0) + 1);
  }
  return rows.map((row) => {
    if (!row.sku) return { kind: "missing_sku", row, message: "Missing SKU" };
    if ((counts.get(row.matchKey) ?? 0) > 1) {
      return { kind: "duplicate", row, message: "Duplicate SKU in feed" };
    }
    if (!row.avail.ok) return { kind: "invalid", row, message: row.avail.reason };
    return { kind: "valid", row, avail: row.avail.value };
  });
}
