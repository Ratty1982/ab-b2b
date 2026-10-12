/**
 * Display-only quantity formatting for Sales Intelligence.
 * Trailing fractional zeros are hidden and the integer part is grouped.
 * Values are not rounded, and this helper does not change stored precision.
 */

const QUANTITY_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

export function formatQuantity(value: number | string | null | undefined): string {
  if (value == null) return "—";
  if (typeof value === "number" && !Number.isFinite(value)) return "—";

  const text = (typeof value === "number" ? String(value) : value).trim().replace(/,/g, "");
  if (text === "") return "—";
  const normalised = text.startsWith("+") ? text.slice(1) : text;
  const match = QUANTITY_PATTERN.exec(normalised);
  if (!match) return "—";

  const negative = match[1] === "-";
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const integerDigits = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  if ((integerDigits === "0" || integerDigits === "") && fraction === "") return "0";

  const grouped = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fraction ? `${grouped}.${fraction}` : grouped;
  return negative ? `-${body}` : body;
}
