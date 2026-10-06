/**
 * Internal Autopart product classification — not B2B catalogue products.
 *
 * CATALOGUE  — Autopart SKU linked to a ProductVariant
 * EXTERNAL   — current 231PO3NEW master row, no B2B listing
 * HISTORIC_ONLY — sales history only; not in the current Autopart stock master
 */

export const AUTOPART_PRODUCT_KINDS = ["CATALOGUE", "EXTERNAL", "HISTORIC_ONLY"] as const;
export type AutopartProductKind = (typeof AUTOPART_PRODUCT_KINDS)[number];

export const AUTOPART_PRODUCT_KIND_LABEL: Record<AutopartProductKind, string> = {
  CATALOGUE: "Catalogue",
  EXTERNAL: "External product",
  HISTORIC_ONLY: "Historic only",
};

export function classifyAutopartProduct(input: {
  hasCatalogueVariant: boolean;
  presentInLatestFeed: boolean;
}): AutopartProductKind {
  if (input.hasCatalogueVariant) return "CATALOGUE";
  if (input.presentInLatestFeed) return "EXTERNAL";
  return "HISTORIC_ONLY";
}

export function formatInternalAvailLine(input: {
  kind: AutopartProductKind;
  availQty: number | null;
  stale: boolean;
}): string {
  if (input.kind === "HISTORIC_ONLY") return "Historic only";
  if (input.stale) return "Stock data delayed";
  if (input.availQty == null) return "Stock unknown";
  if (input.availQty <= 0) return "Out of stock";
  return `${input.availQty.toLocaleString("en-GB")} available`;
}

export function formatInternalIncomingLine(input: {
  kind: AutopartProductKind;
  incomingQty: number | null;
  stale: boolean;
}): string {
  if (input.kind === "HISTORIC_ONLY") return "No incoming stock";
  if (input.stale) return "Incoming delayed";
  if (input.incomingQty == null) return "Incoming unknown";
  if (input.incomingQty <= 0) return "No incoming stock";
  return `${input.incomingQty.toLocaleString("en-GB")} incoming`;
}

export function parsePhysicalStkCell(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/** SKU subtitle qualifier for internal intelligence screens. */
export function productKindQualifier(
  kind: AutopartProductKind | string | null | undefined,
  brandName?: string | null,
): string {
  if (kind === "EXTERNAL") return "External product";
  if (kind === "HISTORIC_ONLY") return "Historic only";
  return brandName?.trim() || "";
}
