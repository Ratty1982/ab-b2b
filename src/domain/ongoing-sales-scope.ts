/**
 * Sales reporting reads ongoing 504 / TRM21QC rows only.
 * A document that started as 561L or SLRB and was later accepted by the live
 * feed stays, because has504 / hasTrm21qc marks it as operational.
 * Historical-only rows are not treated as a complete purchase history.
 */

export const ONGOING_DOCUMENT_SOURCES = [
  "ONGOING_504",
  "ONGOING_TRM21QC",
  "ONGOING_504_BRIDGE",
] as const;

export const ONGOING_LINE_SOURCE = "ONGOING_TRM21QC";

export const ONGOING_SALES_EMPTY =
  "No ongoing 504 or TRM21QC sales are recorded for this customer. Historical Autopart purchases are not included.";

export type SalesDocumentScope = {
  source: string | null | undefined;
  has504: boolean;
  hasTrm21qc: boolean;
};

export function isOngoingSalesDocument(document: SalesDocumentScope): boolean {
  if (document.has504 || document.hasTrm21qc) return true;
  return ONGOING_DOCUMENT_SOURCES.includes(
    document.source as (typeof ONGOING_DOCUMENT_SOURCES)[number],
  );
}

/**
 * A 561L or SLRB line on a live 504/TRM document is kept.
 * A line with no source is kept as well: missing source is not proof of historical origin.
 */
export function isHistoricalOnlySalesLine(line: {
  source: string | null | undefined;
  document: SalesDocumentScope | null;
}): boolean {
  if (line.source == null) return false;
  if (line.source === ONGOING_LINE_SOURCE) return false;
  if (line.document && isOngoingSalesDocument(line.document)) return false;
  return line.source === "561L" || line.source === "SLRB";
}

export function isHistoricalOnlySalesDocument(document: SalesDocumentScope): boolean {
  if (isOngoingSalesDocument(document)) return false;
  const source = document.source ?? "";
  return source === "561L" || source === "SLRB";
}
