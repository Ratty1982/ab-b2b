/**
 * Admin Dashboard — pure helpers and real-data-only policy constants.
 */

/** Open (non-terminal) order statuses for operational counts. Excludes DRAFT, DELIVERED, CANCELLED. */
export const DASHBOARD_OPEN_ORDER_STATUSES = [
  "SUBMITTED",
  "CONFIRMED",
  "PICKING",
  "PARTIALLY_DESPATCHED",
  "DISPATCHED",
  "ON_HOLD",
] as const;

/** Orders counted in “orders today” / order value — placed today, not draft/cancelled. */
export const DASHBOARD_ORDER_VALUE_EXCLUDED_STATUSES = ["DRAFT", "CANCELLED"] as const;

/** Quote statuses treated as open/active for the dashboard card. */
export const DASHBOARD_OPEN_QUOTE_STATUSES = ["DRAFT", "SENT", "VIEWED"] as const;

/** Trade application statuses requiring staff attention. */
export const DASHBOARD_ATTENTION_APPLICATION_STATUSES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "MORE_INFO_REQUIRED",
] as const;

/** Fulfilment states after Autopart CSV export, awaiting 504C / despatch. */
export const DASHBOARD_PROCESSING_ORDER_STATUSES = ["CONFIRMED", "PICKING"] as const;

export const PROTOTYPE_ADMIN_DASHBOARD_STRINGS = [
  "James Whitfield",
  "Priya Nayar",
  "Dee Okafor",
  "Mark Ellison",
  "Rachel Tibbs",
  "Sue Marchant",
  "APP-2026-0409",
  "PM-AUTUMN",
  "Prototype data set",
  "Sales YTD",
  "Open quote value",
  "£1,984,600",
  "£244,250",
  "Mersey Motor Factors",
  "Caldwell Commercials",
  "Penrose Autoparts",
  "Orders held for credit check",
  "Products missing safety data sheets",
] as const;

export type AttentionSeverity = "action" | "info";

export type AttentionItem = {
  id: string;
  label: string;
  count: number | null;
  href: string;
  severity: AttentionSeverity;
};

export function formatGbpIncVat(amount: string | null | undefined): string {
  if (amount == null || amount === "") return "£0.00";
  const n = Number(amount);
  if (!Number.isFinite(n)) return `£${amount}`;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function stockHealthLabel(input: {
  hasSuccess: boolean;
  status: string | null;
  /** Actionable/fatal issue count — ignored INVALID/DUPLICATE diagnostics must not be included. */
  actionableIssueCount?: number;
  /**
   * @deprecated Ignored for health. Prefer actionableIssueCount.
   * Kept so older call sites compile until updated.
   */
  invalid?: number;
  /** @deprecated Ignored for health. */
  duplicates?: number;
}): "Healthy" | "Attention required" | "No sync yet" {
  if (!input.hasSuccess) return "No sync yet";
  if (input.status === "FAILED") return "Attention required";
  if ((input.actionableIssueCount ?? 0) > 0) return "Attention required";
  return "Healthy";
}
