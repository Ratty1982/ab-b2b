/**
 * Read-only rules for the Sales Enquiry reconciliation investigation.
 * These labels describe what a person should correct. They never change a record.
 */
import { unifiedReasonLabel, UNIFIED_SOURCES, UNIFIED_UNRECONCILED_REASONS } from "@/domain/unified-sales";

export const RECONCILIATION_ACTIONS = ["AUTOPART_SOURCE", "ACCOUNT_MAPPING", "IMPORT_PROCESSING"] as const;
export type ReconciliationAction = (typeof RECONCILIATION_ACTIONS)[number];

export const AMBIGUOUS_ACCOUNT_REASON = "AMBIGUOUS_ACCOUNT";

export const RECONCILIATION_REASONS = [...UNIFIED_UNRECONCILED_REASONS, AMBIGUOUS_ACCOUNT_REASON] as const;
export type ReconciliationReason = (typeof RECONCILIATION_REASONS)[number];

export const RECONCILIATION_DOCUMENT_TYPES = ["INVOICE", "CREDIT", "UNKNOWN"] as const;
export type ReconciliationDocumentType = (typeof RECONCILIATION_DOCUMENT_TYPES)[number];

export const RECONCILIATION_SOURCES = UNIFIED_SOURCES;

export const RECONCILIATION_ACTION_LABELS: Record<ReconciliationAction, string> = {
  AUTOPART_SOURCE: "Correct Autopart source data",
  ACCOUNT_MAPPING: "Correct account mapping",
  IMPORT_PROCESSING: "Correct import processing",
};

export const RECONCILIATION_ACTION_GUIDANCE: Record<ReconciliationAction, string> = {
  AUTOPART_SOURCE:
    "Correct the Autopart source data so the document, quantities and goods total agree. This screen does not change those records.",
  ACCOUNT_MAPPING:
    "Correct the account mapping so this code belongs to one CRM company. This screen does not change the link.",
  IMPORT_PROCESSING:
    "Correct import processing for the repeated 561L row. This screen does not delete the stored row.",
};

export const RECONCILIATION_READ_ONLY_NOTE =
  "Read only. This investigation does not rewrite financial records, delete duplicates, override certification, or mark anything reconciled.";

const ACTION_PRIORITY: ReconciliationAction[] = ["ACCOUNT_MAPPING", "IMPORT_PROCESSING", "AUTOPART_SOURCE"];

export function reconciliationReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Unreconciled";
  if (reason === AMBIGUOUS_ACCOUNT_REASON) {
    return "This account code is linked to more than one CRM company, so its sales stay out of certified totals.";
  }
  return unifiedReasonLabel(reason) ?? reason;
}

export function reconciliationActionForReason(reason: string): ReconciliationAction {
  if (reason === AMBIGUOUS_ACCOUNT_REASON) return "ACCOUNT_MAPPING";
  if (reason === "REPEATED_SOURCE_ROW") return "IMPORT_PROCESSING";
  return "AUTOPART_SOURCE";
}

/** Stable order so account mapping is not hidden behind a source discrepancy on the same document. */
export function reconciliationActions(reasons: string[]): ReconciliationAction[] {
  const present = new Set(reasons.map(reconciliationActionForReason));
  return ACTION_PRIORITY.filter((action) => present.has(action));
}

function toPence(value: string): number {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const [poundsRaw, fraction = ""] = trimmed.replace("-", "").split(".");
  const pounds = Number(poundsRaw || "0");
  const pence = Number((fraction + "00").slice(0, 2));
  if (!Number.isFinite(pounds) || !Number.isFinite(pence)) return 0;
  const total = pounds * 100 + pence;
  return negative ? -total : total;
}

function fromPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 504 goods total minus the product-line net. Null when there is no 504 header. */
export function goodsAgainstLinesDifference(goodsNet: string | null, productLineNet: string): string | null {
  if (goodsNet == null) return null;
  return fromPence(toPence(goodsNet) - toPence(productLineNet));
}

/** Gap between the highest and lowest source totals on one document. */
export function sourceSpread(nets: string[]): string | null {
  if (nets.length < 2) return null;
  const values = nets.map(toPence);
  return fromPence(Math.max(...values) - Math.min(...values));
}

/**
 * Difference shown on a line.
 * A 504 mismatch uses the document goods gap.
 * A SKU that exists on another source uses this net minus that other net.
 * Every other held line shows its own net, the amount kept out of the certified total.
 */
export function investigationLineDifference(input: {
  reason: string;
  net: string;
  sku: string;
  source: string;
  documentDifference: string | null;
  peers: Array<{ sku: string; source: string; net: string }>;
}): string {
  if (input.reason === "DOCUMENT_GOODS_MISMATCH" && input.documentDifference != null) {
    return input.documentDifference;
  }
  const others = input.peers.filter((peer) => peer.sku === input.sku && peer.source !== input.source);
  if (others.length > 0) {
    const baseline = others.map((peer) => toPence(peer.net)).sort((left, right) => left - right)[0]!;
    return fromPence(toPence(input.net) - baseline);
  }
  return fromPence(toPence(input.net));
}
