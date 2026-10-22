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

export function ongoingImportAllowsCatchUp(diagnostics: unknown): boolean {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return false;
  const value = (diagnostics as { skippedIneligible?: unknown }).skippedIneligible;
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
