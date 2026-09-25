/**
 * Customer-safe order lifecycle labels for portal / emails.
 *
 * RECEIVED  → SUBMITTED
 * PROCESSING → CONFIRMED | PICKING
 * DESPATCHED → DISPATCHED
 */

export type CustomerOrderLifecycle = "RECEIVED" | "PROCESSING" | "DESPATCHED" | "CANCELLED" | "ON_HOLD" | "DELIVERED" | "OTHER";

export function customerOrderLifecycle(status: string): CustomerOrderLifecycle {
  switch (status) {
    case "SUBMITTED":
      return "RECEIVED";
    case "CONFIRMED":
    case "PICKING":
      return "PROCESSING";
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

export function customerOrderStatusLabel(status: string): string {
  switch (customerOrderLifecycle(status)) {
    case "RECEIVED":
      return "Received";
    case "PROCESSING":
      return "Processing";
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
): "good" | "warn" | "bad" | "info" | "neutral" | "brand" {
  switch (customerOrderLifecycle(status)) {
    case "RECEIVED":
      return "good";
    case "PROCESSING":
      return "brand";
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
