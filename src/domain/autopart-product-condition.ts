/**
 * Canonical Autopart product condition (231PO3NEW column C).
 * Store the source code. Resolve labels here — do not duplicate them in UI or imports.
 */

export const AUTOPART_PRODUCT_CONDITIONS = [
  { code: "S", label: "Superseded" },
  { code: "N", label: "Not Yet Available" },
  { code: "O", label: "Obsolete" },
  { code: "W", label: "While Stocks Last" },
  { code: "D", label: "Delete" },
  { code: "M", label: "Made to Order" },
] as const;

export type KnownAutopartConditionCode = (typeof AUTOPART_PRODUCT_CONDITIONS)[number]["code"];

const LABELS: Record<KnownAutopartConditionCode, string> = {
  S: "Superseded",
  N: "Not Yet Available",
  O: "Obsolete",
  W: "While Stocks Last",
  D: "Delete",
  M: "Made to Order",
};

export type BackorderConditionFilter = "HAS" | "NONE" | KnownAutopartConditionCode;

export function isKnownAutopartConditionCode(code: string): code is KnownAutopartConditionCode {
  return Object.prototype.hasOwnProperty.call(LABELS, code);
}

export function isBackorderConditionFilter(value: string): value is BackorderConditionFilter {
  return value === "HAS" || value === "NONE" || isKnownAutopartConditionCode(value);
}

/** Friendly label. Null when there is no condition. Unknown codes stay visible as Unknown (X). */
export function autopartConditionLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  if (isKnownAutopartConditionCode(code)) return LABELS[code];
  return `Unknown (${code})`;
}

export function autopartConditionTitle(code: string | null | undefined): string | null {
  const label = autopartConditionLabel(code);
  if (!code || !label) return null;
  return `Autopart condition: ${code} — ${label}`;
}

/** O and D are the strongest warnings. Other known codes stay visible without looking like errors. */
export type AutopartConditionTone = "bad" | "warn" | "info" | "neutral";

export function autopartConditionTone(code: string | null | undefined): AutopartConditionTone {
  if (code === "O" || code === "D") return "bad";
  if (code === "S" || code === "W") return "warn";
  if (code === "N" || code === "M") return "info";
  return "neutral";
}

export const BACKORDER_CONDITION_FILTERS: Array<{ value: "" | BackorderConditionFilter; label: string }> = [
  { value: "", label: "All conditions" },
  { value: "HAS", label: "Has condition" },
  ...AUTOPART_PRODUCT_CONDITIONS.map((row) => ({ value: row.code, label: row.label })),
  { value: "NONE", label: "No condition" },
];
