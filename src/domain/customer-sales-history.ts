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
 * Same SKU on one invoice is not a duplicate. Identity is the source line number
 * when Autopart sent one, otherwise a fingerprint of the line plus its ordinal.
 */
export function historicalProductLineIdentity(input: {
  documentType: string;
  documentReference: string;
  sku: string;
  sourceLineNumber: number | null;
  rawInvAndLn: string | null;
  skuOrdinal: number;
}): { fingerprint: string; lineNumber: number | null } {
  const type = input.documentType.trim().toUpperCase();
  const reference = input.documentReference.trim().toUpperCase();
  const sku = input.sku.trim().toUpperCase();
  if (input.sourceLineNumber != null && input.sourceLineNumber > 0) {
    return {
      fingerprint: `ln:${type}|${reference}|${input.sourceLineNumber}`,
      lineNumber: input.sourceLineNumber,
    };
  }
  const raw = (input.rawInvAndLn ?? "").trim().toUpperCase();
  const ordinal = input.skuOrdinal > 0 ? input.skuOrdinal : 1;
  return {
    fingerprint: `fp:${type}|${reference}|${raw}|${sku}|${ordinal}`,
    lineNumber: null,
  };
}

export function ongoingImportAllowsCatchUp(diagnostics: unknown): boolean {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return false;
  const value = (diagnostics as { skippedIneligible?: unknown }).skippedIneligible;
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
