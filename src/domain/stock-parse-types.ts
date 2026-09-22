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
