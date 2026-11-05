/**
 * Informational customer credit limit (GBP).
 *
 * Stored on Company as Decimal. Never used to block checkout, staff order entry,
 * pricing, payment terms, stock, or order status.
 */

import { moneyToString, parseMoney } from "@/domain/money";

/** Format a stored credit limit for UI/email. Null/blank → null (do not invent £0). */
export function formatCreditLimitGbp(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const money = parseMoney(String(value));
  if (!money) return null;
  if (money.minor < 0n) return null;
  const raw = moneyToString(money, 2);
  const [wholePart, frac = "00"] = raw.split(".");
  const whole = wholePart ?? "0";
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `£${withCommas}.${frac}`;
}

/**
 * Parse staff credit-limit input.
 * - undefined → omit (no change)
 * - null / "" / whitespace → clear to null
 * - valid non-negative money string → 2dp string for Prisma Decimal
 * - invalid / negative → throw via return `{ ok: false, message }`
 */
export function parseCreditLimitInput(
  raw: unknown,
):
  | { ok: true; value: string | null | undefined }
  | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) {
      return { ok: false, message: "Credit limit must be a non-negative GBP amount" };
    }
    const money = parseMoney(raw.toFixed(2));
    if (!money || money.minor < 0n) {
      return { ok: false, message: "Credit limit must be a non-negative GBP amount" };
    }
    return { ok: true, value: moneyToString(money, 2) };
  }
  if (typeof raw !== "string") {
    return { ok: false, message: "Credit limit must be a GBP amount" };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const cleaned = trimmed.replace(/£/g, "").replace(/,/g, "").trim();
  const money = parseMoney(cleaned);
  if (!money || money.minor < 0n) {
    return { ok: false, message: "Credit limit must be a non-negative GBP amount" };
  }
  return { ok: true, value: moneyToString(money, 2) };
}

export function creditLimitZodRefine(
  value: string | null | undefined,
  ctx: { addIssue: (issue: { code: "custom"; message: string; path?: (string | number)[] }) => void },
  path: string[] = ["creditLimit"],
) {
  if (value === undefined || value === null) return;
  const parsed = parseCreditLimitInput(value);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.message, path });
  }
}
