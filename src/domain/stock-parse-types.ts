export const MAX_STOCK_FEED_BYTES = 15_000_000;

export type ParsedAvail =
  | { ok: true; value: number; raw: string }
  | { ok: false; raw: string; reason: string };

/**
 * Latest Cost from 231PO3NEW — stored as a decimal string (never JS float).
 * missing = field absent/blank; invalid = malformed; ok includes genuine 0.00.
 */
export type ParsedLatestCost =
  | { ok: true; value: string; raw: string }
  | { ok: false; raw: string; reason: "missing" | "invalid" | "negative" };

/**
 * Autopart source usage/stock quantity fields from 231PO3NEW.
 * Field names mirror the report header. Period semantics for Ryr/Curr/Mth*
 * are NOT interpreted here — meaning to be confirmed with Autopart.
 */
export type StagedUsageFields = {
  stk: string | null;
  pickQty: string | null;
  physicalStk: string | null;
  /** Source field "Ryr" — meaning to be confirmed with Autopart. */
  ryr: string | null;
  /** Source field "Curr" — meaning to be confirmed with Autopart. */
  curr: string | null;
  /** Source fields Mth1…Mth12 — meaning to be confirmed with Autopart. */
  mth: Array<string | null>;
};

export type StagedStockRow = {
  line: number;
  sku: string;
  matchKey: string;
  description: string | null;
  availRaw: string;
  avail: ParsedAvail;
  /** Present on native 231PO3NEW; absent on delimited CSV uploads. */
  latestCost?: ParsedLatestCost;
  usage?: StagedUsageFields;
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
