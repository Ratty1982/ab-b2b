/**
 * Customer-safe order lifecycle labels for portal / emails.
 *
 * RECEIVED  → SUBMITTED
 * PROCESSING → CONFIRMED | PICKING
 * PART_BACKORDERED → processing with known backorder quantities (customer copy)
 * PART_DESPATCHED → PARTIALLY_DESPATCHED
 * DESPATCHED → DISPATCHED
 */

export type CustomerOrderLifecycle =
  | "RECEIVED"
  | "PROCESSING"
  | "PART_BACKORDERED"
  | "PART_DESPATCHED"
  | "DESPATCHED"
  | "CANCELLED"
  | "ON_HOLD"
  | "DELIVERED"
  | "OTHER";

export function customerOrderLifecycle(
  status: string,
  opts?: { hasBackorderItems?: boolean },
): CustomerOrderLifecycle {
  switch (status) {
    case "SUBMITTED":
      return "RECEIVED";
    case "CONFIRMED":
    case "PICKING":
      return opts?.hasBackorderItems ? "PART_BACKORDERED" : "PROCESSING";
    case "PARTIALLY_DESPATCHED":
      return "PART_DESPATCHED";
    case "DISPATCHED":
      return "DESPATCHED";
    case "DELIVERED":
      return "DELIVERED";
    case "CANCELLED":
      return "CANCELLED";
    case "ON_HOLD":
      return "ON_HOLD";
    default:
      return "OTHER";
  }
}

export function customerOrderStatusLabel(
  status: string,
  opts?: { hasBackorderItems?: boolean },
): string {
  switch (customerOrderLifecycle(status, opts)) {
    case "RECEIVED":
      return "Received";
    case "PROCESSING":
      return opts?.hasBackorderItems ? "Processing — Backordered items" : "Processing";
    case "PART_BACKORDERED":
      return "Part Backordered";
    case "PART_DESPATCHED":
      return "Part Despatched";
    case "DESPATCHED":
      return "Despatched";
    case "DELIVERED":
      return "Delivered";
    case "CANCELLED":
      return "Cancelled";
    case "ON_HOLD":
      return "On hold";
    default:
      return status;
  }
}

export function customerOrderStatusTone(
  status: string,
  opts?: { hasBackorderItems?: boolean },
): "good" | "warn" | "bad" | "info" | "neutral" | "brand" {
  switch (customerOrderLifecycle(status, opts)) {
    case "RECEIVED":
      return "good";
    case "PROCESSING":
      return "brand";
    case "PART_BACKORDERED":
      return "warn";
    case "PART_DESPATCHED":
      return "warn";
    case "DESPATCHED":
      return "info";
    case "DELIVERED":
      return "good";
    case "CANCELLED":
      return "bad";
    case "ON_HOLD":
      return "warn";
    default:
      return "neutral";
  }
}

/** AB order numbers used as Autopart External Reference / 504C Customer Order Number. */
export const AB_ORDER_NUMBER_PATTERN = /^AB-\d{6,}$/i;

export function isAbOrderNumber(value: string): boolean {
  return AB_ORDER_NUMBER_PATTERN.test(String(value ?? "").trim());
}

export function normaliseAbOrderNumber(value: string): string {
  return String(value ?? "").trim().toUpperCase();
}
