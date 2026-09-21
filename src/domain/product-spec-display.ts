const KNOWN_SPEC_LABELS: Record<string, string> = {
  size: "Size",
  producttype: "Product Type",
  product_type: "Product Type",
  form: "Form",
  containertype: "Container Type",
  container_type: "Container Type",
  finish: "Finish",
  residuefree: "Residue Free",
  residue_free: "Residue Free",
  fastevaporating: "Fast Evaporating",
  fast_evaporating: "Fast Evaporating",
  tintedwindowsafe: "Tinted Window Safe",
  tinted_window_safe: "Tinted Window Safe",
  ean: "EAN",
  mpn: "MPN",
};

/** Factual catalogue attributes that help a trade buyer identify the pack. */
const PRODUCT_DETAIL_KEYS = new Set([
  "size",
  "producttype",
  "product_type",
  "form",
  "containertype",
  "container_type",
  "ean",
  "mpn",
]);

/**
 * Marketing / boolean extras that are usually already covered by benefits or
 * features. Stored data is kept; public pages omit them.
 */
const MARKETING_SPEC_KEYS = new Set([
  "finish",
  "residuefree",
  "residue_free",
  "fastevaporating",
  "fast_evaporating",
  "tintedwindowsafe",
  "tinted_window_safe",
  "streakfree",
  "streak_free",
]);

const TECHNICAL_KEY_HINTS = [
  "voltage",
  "volt",
  "power",
  "watt",
  "current",
  "amp",
  "capacity",
  "material",
  "dimension",
  "cable",
  "load",
  "temperature",
  "iprating",
  "ipcode",
  "compatibility",
  "connector",
  "weight",
  "length",
  "width",
  "height",
  "depth",
  "pressure",
  "flow",
  "frequency",
  "battery",
  "output",
  "input",
  "torque",
];

function compactKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isBooleanish(value: string): boolean {
  return /^(true|false|yes|no)$/i.test(value.trim());
}

function isTechnicalKey(key: string): boolean {
  return TECHNICAL_KEY_HINTS.some((hint) => key.includes(hint));
}

export type PublicSpecKind = "detail" | "technical" | "hidden";

export function classifyPublicSpec(name: string, value: string): PublicSpecKind {
  const key = compactKey(name);
  if (!key || key === "sku") return "hidden";
  if (PRODUCT_DETAIL_KEYS.has(key) || PRODUCT_DETAIL_KEYS.has(name.trim().toLowerCase())) return "detail";
  if (MARKETING_SPEC_KEYS.has(key)) return "hidden";
  if (isTechnicalKey(key)) return "technical";
  if (isBooleanish(value)) return "hidden";
  return "technical";
}

/** Human-readable spec labels. Never show raw camelCase / snake_case keys. */
export function formatSpecLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const known = KNOWN_SPEC_LABELS[compactKey(trimmed)] ?? KNOWN_SPEC_LABELS[trimmed.toLowerCase()];
  if (known) return known;
  const spaced = trimmed
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return spaced
    .split(" ")
    .map((word) => (word.toUpperCase() === word && word.length <= 3 ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

export function formatSpecValue(raw: string): string {
  const trimmed = raw.trim();
  if (/^(true|yes)$/i.test(trimmed)) return "Yes";
  if (/^(false|no)$/i.test(trimmed)) return "No";
  return formatCatalogueSize(trimmed);
}

/** Canonical trade-catalogue pack sizes: 500ml, 1 Litre, 5 Litre, 25 Litre. */
export function formatCatalogueSize(raw: string): string {
  const trimmed = raw.trim();
  const ml = trimmed.match(/^(\d+(?:\.\d+)?)\s*ml$/i);
  if (ml) return `${ml[1]}ml`;
  const litres = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:l|ltr|ltrs|litre|litres)$/i);
  if (litres) {
    const amount = litres[1]!;
    return Number(amount) === 1 ? "1 Litre" : `${amount} Litre`;
  }
  return trimmed;
}

export function formatPublicSpecRows(rows: Array<{ name: string; value: string }>): Array<{ label: string; value: string }> {
  return rows
    .filter((row) => row.name.trim() && row.value.trim())
    .map((row) => ({
      label: formatSpecLabel(row.name),
      value: compactKey(row.name) === "size" || /size/i.test(row.name) ? formatCatalogueSize(row.value) : formatSpecValue(row.value),
    }));
}

export function selectPublicProductDetailRows(input: {
  specifications: Array<{ name: string; value: string }>;
  ean?: string | null | undefined;
  mpn?: string | null | undefined;
}): Array<{ label: string; value: string }> {
  const formatted = input.specifications
    .filter((row) => row.name.trim() && row.value.trim() && !/^n\/?a$|^-$|^—$/i.test(row.value.trim()))
    .map((row) => ({
      key: compactKey(row.name),
      kind: classifyPublicSpec(row.name, row.value),
      label: formatSpecLabel(row.name),
      value: compactKey(row.name) === "size" || /size/i.test(row.name) ? formatCatalogueSize(row.value) : formatSpecValue(row.value),
    }));
  const details = formatted.filter((row) => row.kind === "detail");
  const technical = formatted.filter((row) => row.kind === "technical");
  const seen = new Set(details.concat(technical).map((row) => row.key));
  const extras: Array<{ key: string; label: string; value: string }> = [];
  if (input.ean?.trim() && !seen.has("ean")) extras.push({ key: "ean", label: "EAN", value: input.ean.trim() });
  if (input.mpn?.trim() && !seen.has("mpn") && compactKey(input.mpn) !== compactKey("sku")) {
    extras.push({ key: "mpn", label: "MPN", value: input.mpn.trim() });
  }
  const order = ["size", "producttype", "form", "containertype", "ean", "mpn"];
  const ranked = [...details, ...extras].sort((a, b) => {
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return [...ranked, ...technical].map((row) => ({ label: row.label, value: row.value }));
}

function copyKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(suitable|safe|for|and|the|a|an|with|no)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Presentation-only: hide feature lines that restated a benefit. Stored data is unchanged. */
export function featuresForDisplay(benefits: string[], features: string[]): string[] {
  const benefitKeys = new Set(benefits.map(copyKey).filter(Boolean));
  return features.filter((feature) => {
    const key = copyKey(feature);
    if (!key) return false;
    return !benefitKeys.has(key);
  });
}

export function parseDirections(text: string): { kind: "steps"; steps: string[] } | { kind: "prose"; text: string } {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "prose", text: "" };
  const lines = trimmed
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[\).:-]|[-*•])\s*/, "").trim())
    .filter(Boolean);
  const numbered = /^\s*\d+[\).:-]\s+/m.test(trimmed) && lines.length > 1;
  if (numbered) return { kind: "steps", steps: lines };
  return { kind: "prose", text: trimmed };
}

export function hasPublicText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}
