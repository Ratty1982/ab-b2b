/**
 * Customer-scoped 561L product evidence and SLRB ledger evidence.
 * Payments and journals are not product sales. Credits are stored negative.
 */

export type HistoricalDocumentType = "INVOICE" | "CREDIT" | "PAYMENT" | "JOURNAL" | "UNKNOWN";

export function historicalDocumentIsSale(documentType: HistoricalDocumentType): boolean {
  return documentType === "INVOICE" || documentType === "CREDIT" || documentType === "UNKNOWN";
}

/** Credits are always negative. Payments and journals contribute no sales measure. */
export function signedHistoricalMeasure(
  documentType: HistoricalDocumentType,
  raw: string | null | undefined,
  scale: 2 | 3,
): string | null {
  if (!historicalDocumentIsSale(documentType)) return null;
  if (raw == null || raw.trim() === "") return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return null;
  const signed = documentType === "CREDIT" && amount > 0 ? -amount : amount;
  return signed.toFixed(scale);
}

/**
 * Product-line identity for historical 561L imports.
 *
 * Autopart often repeats the same Inv&Ln suffix (`/1`) across many SKUs on one
 * credit/invoice. Fingerprints therefore include SKU + signed measures so those
 * physical lines stay distinct. Byte-identical source rows share one fingerprint
 * (in-file duplicates). Prefer the Autopart source line number for storage when
 * free; callers allocate a unique document lineNumber on collision.
 *
 * `legacyFingerprints` keeps prior `ln:TYPE|REF|N` keys recognisable on re-import.
 */
export function historicalProductLineIdentity(input: {
  documentType: string;
  documentReference: string;
  sku: string;
  sourceLineNumber: number | null;
  rawInvAndLn: string | null;
  skuOrdinal: number;
  units?: string | null;
  salesNet?: string | null;
}): { fingerprint: string; lineNumber: number | null; legacyFingerprints: string[] } {
  const type = input.documentType.trim().toUpperCase();
  const reference = input.documentReference.trim().toUpperCase();
  const sku = input.sku.trim().toUpperCase();
  const units = (input.units ?? "").trim();
  const salesNet = (input.salesNet ?? "").trim();
  if (input.sourceLineNumber != null && input.sourceLineNumber > 0) {
    const legacy = `ln:${type}|${reference}|${input.sourceLineNumber}`;
    return {
      fingerprint: `row:${type}|${reference}|${input.sourceLineNumber}|${sku}|${units}|${salesNet}`,
      lineNumber: input.sourceLineNumber,
      legacyFingerprints: [legacy],
    };
  }
  const raw = (input.rawInvAndLn ?? "").trim().toUpperCase();
  const ordinal = input.skuOrdinal > 0 ? input.skuOrdinal : 1;
  return {
    fingerprint: `fp:${type}|${reference}|${raw}|${sku}|${ordinal}`,
    lineNumber: null,
    legacyFingerprints: [],
  };
}

/**
 * Exact byte-identical 561L rows cannot be told apart as separate returns.
 * Report them as exceptions; do not invent extra transaction identities.
 */
export const EXACT_REPEATED_SOURCE_ROW_REASON =
  "Exact repeated source row with the same document, SKU, quantity and sales. Autopart does not distinguish a separate return.";

/** Fingerprints to match against stored `sourceFingerprint` for one planned line. */
export function historicalProductLineLookupFingerprints(fingerprint: string): string[] {
  const primary = fingerprint.trim();
  if (!primary) return [];
  const out = [primary];
  if (primary.startsWith("row:")) {
    const parts = primary.slice(4).split("|");
    if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
      out.push(`ln:${parts[0]}|${parts[1]}|${parts[2]}`);
    }
  } else if (primary.startsWith("ln:")) {
    out.push(primary);
  }
  return out;
}

/** Autopart source line preference encoded in `row:` / legacy `ln:` fingerprints. */
export function preferredHistoricalLineNumber(fingerprint: string): number | null {
  const primary = fingerprint.trim();
  if (primary.startsWith("row:")) {
    const token = primary.slice(4).split("|")[2];
    const value = token != null ? Number(token) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (primary.startsWith("ln:")) {
    const value = Number(primary.split("|").pop());
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return null;
}

export function historicalProductLineSkuFromFingerprint(fingerprint: string): string | null {
  const primary = fingerprint.trim();
  if (!primary.startsWith("row:")) return null;
  const sku = primary.slice(4).split("|")[3];
  return sku ? sku.trim().toUpperCase() : null;
}

export function ongoingImportAllowsCatchUp(diagnostics: unknown): boolean {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return false;
  const value = (diagnostics as { skippedIneligible?: unknown }).skippedIneligible;
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
