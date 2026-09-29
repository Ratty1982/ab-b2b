/**
 * Latest Cost parsing for Autopart 231PO3NEW.
 * Uses scaled Money (4dp) — never IEEE floats as the stored authority.
 */
import { moneyToString, parseMoney } from "@/domain/money";
import type { ParsedLatestCost } from "@/domain/stock-parse-types";

export function parseLatestCostCell(raw: string | null | undefined): ParsedLatestCost {
  const trimmed = (raw ?? "").trim().replace(/,/g, "");
  if (!trimmed) return { ok: false, raw: raw ?? "", reason: "missing" };
  // Strip currency decoration if present.
  const cleaned = trimmed.replace(/^£/, "").trim();
  const money = parseMoney(cleaned);
  if (!money) return { ok: false, raw: trimmed, reason: "invalid" };
  if (money.minor < 0n) return { ok: false, raw: trimmed, reason: "negative" };
  return { ok: true, value: moneyToString(money, 4), raw: trimmed };
}

/** Optional quantity/usage cell — preserve as decimal string or null. */
export function parseOptionalQuantityCell(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().replace(/,/g, "");
  if (!trimmed) return null;
  const money = parseMoney(trimmed);
  if (!money) return null;
  return moneyToString(money, 4);
}
