import { detectCsvDelimiter, parseCsvRecords } from "@/domain/catalogue-csv";
import { normalizeStockSku, skuMatchKey } from "@/domain/stock";

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

export const MAX_STOCK_FEED_BYTES = 15_000_000;

export type ParsedAvail =
  | { ok: true; value: number; raw: string }
  | { ok: false; raw: string; reason: string };

export type StagedStockRow = {
  line: number;
  sku: string;
  matchKey: string;
  description: string | null;
  availRaw: string;
  avail: ParsedAvail;
};

export type StockParseFailure = {
  code: "EMPTY" | "TOO_LARGE" | "MISSING_SKU_HEADER" | "MISSING_AVAIL_HEADER";
  message: string;
};

export type StockParseSuccess = {
  delimiter: string;
  skuHeader: string;
  availHeader: string;
  rows: StagedStockRow[];
};

export function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s._-]+/g, "");
}

export function parseAvailCell(raw: string): ParsedAvail {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, raw, reason: "blank Avail" };
  const cleaned = trimmed.replace(/,/g, "");
  if (!/^-?\d+(\.0+)?$/.test(cleaned)) {
    return { ok: false, raw, reason: "non-numeric or non-integer Avail" };
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { ok: false, raw, reason: "non-numeric Avail" };
  return { ok: true, value, raw: trimmed };
}

export function parseAutopart231Po3New(text: string, byteLength?: number): StockParseSuccess | StockParseFailure {
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
