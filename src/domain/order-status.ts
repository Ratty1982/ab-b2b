/**
 * Customer-safe order lifecycle labels for portal / emails.
 *
 * Never expose internal enum names. Never invent PICKED without warehouse signal.
 */

export type CustomerOrderLifecycle =
  | "RECEIVED"
  | "PROCESSING"
  | "BACKORDERED"
  | "PART_BACKORDERED"
  | "PART_DESPATCHED"
  | "DESPATCHED"
  | "CANCELLED"
  | "ON_HOLD"
  | "DELIVERED"
  | "OTHER";

export type CustomerOrderStatusOpts = {
  hasBackorderItems?: boolean;
  /** All lines fully backordered at placement (no allocation). */
  fullyBackordered?: boolean;
  /** Outstanding backorder units remain. */
  hasOutstandingBackorder?: boolean;
};

export function customerOrderLifecycle(
  status: string,
  opts?: CustomerOrderStatusOpts,
): CustomerOrderLifecycle {
  switch (status) {
    case "SUBMITTED":
      return "RECEIVED";
    case "CONFIRMED":
    case "PICKING":
      if (opts?.fullyBackordered) return "BACKORDERED";
      if (opts?.hasBackorderItems || opts?.hasOutstandingBackorder) return "PART_BACKORDERED";
      return "PROCESSING";
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
  opts?: CustomerOrderStatusOpts,
): string {
  switch (customerOrderLifecycle(status, opts)) {
    case "RECEIVED":
      return "Received";
    case "PROCESSING":
      return "Processing";
    case "BACKORDERED":
      return "Backordered";
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
  opts?: CustomerOrderStatusOpts,
): "good" | "warn" | "bad" | "info" | "neutral" | "brand" {
  switch (customerOrderLifecycle(status, opts)) {
    case "RECEIVED":
      return "good";
    case "PROCESSING":
      return "brand";
    case "BACKORDERED":
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

/** Compact badge for portal tables. */
export function customerBackorderBadge(
  opts: CustomerOrderStatusOpts & { status: string },
): "BACKORDERED" | "PART BACKORDERED" | "PART DESPATCHED" | null {
  const life = customerOrderLifecycle(opts.status, opts);
  if (life === "BACKORDERED") return "BACKORDERED";
  if (life === "PART_BACKORDERED") return "PART BACKORDERED";
  if (life === "PART_DESPATCHED") return "PART DESPATCHED";
  return null;
}

/** AB order numbers used as Autopart External Reference / 504C Customer Order Number. */
export const AB_ORDER_NUMBER_PATTERN = /^AB-\d{6,}$/i;

export function isAbOrderNumber(value: string): boolean {
  return AB_ORDER_NUMBER_PATTERN.test(String(value ?? "").trim());
}

export function normaliseAbOrderNumber(value: string): string {
  return String(value ?? "").trim().toUpperCase();
}
