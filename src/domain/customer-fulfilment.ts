/**
 * Customer-facing fulfilment presentation for trade portal / emails.
 *
 * Distinguishes:
 * - availableQtyAtOrder / backorderQtyAtOrder → historical placement snapshot
 * - despatchedQty → only when authoritative line evidence exists
 * - Never invent despatched quantities from Autopart Avail or 504C order totals alone
 */

export type CustomerLineFulfilment = {
  orderedQty: number;
  /** Historical allocation at placement (may be null on pre-backorder orders). */
  allocatedAtOrder: number | null;
  /** Historical backorder at placement. */
  backorderedAtOrder: number;
  /**
   * Authoritative despatched quantity when known (>0), else null when unknown.
   * 0 with lineQuantitiesKnown=false means "not yet evidenced", not "zero despatched confirmed".
   */
  despatchedQty: number | null;
  /** Remaining on backorder for the customer — null when unknown under partial invoice without lines. */
  outstandingBackorderQty: number | null;
  lineStatus: "AVAILABLE" | "BACKORDERED" | "PART_BACKORDERED" | "PART_DESPATCHED" | "DESPATCHED";
  lineStatusLabel: string;
  /**
   * True when despatchedQty is authoritative line evidence.
   * False when we only have placement snapshots / order-level invoice evidence.
   */
  despatchQuantitiesKnown: boolean;
  limitation: string | null;
};

export type CustomerOrderFulfilmentSummary = {
  hasBackorderAtPlacement: boolean;
  hasOutstandingBackorder: boolean;
  outstandingBackorderUnits: number;
  linesWithOutstandingBackorder: number;
  orderStatusLabel: string;
  orderStatusBadge: "BACKORDERED" | "PART_BACKORDERED" | "PART_DESPATCHED" | "DESPATCHED" | "PROCESSING" | "RECEIVED" | "OTHER";
  /** When PART_DESPATCHED without line-level quantities. */
  lineQuantitiesLimitation: string | null;
};

const LINE_LIMITATION_504C =
  "Exact despatched quantities will update when line-level fulfilment is confirmed. You do not need to reorder.";

export function presentCustomerLineFulfilment(input: {
  qty: number;
  availableQtyAtOrder?: number | null;
  backorderQtyAtOrder?: number | null;
  despatchedQty?: number | null;
  /** Order is in PARTIALLY_DESPATCHED without line-level despatch evidence. */
  orderPartDespatchedWithoutLineQty?: boolean;
  /** Order fully despatched / delivered. */
  orderFullyDespatched?: boolean;
}): CustomerLineFulfilment {
  const orderedQty = Math.max(0, Math.trunc(input.qty));
  const backorderedAtOrder = Math.max(0, Math.trunc(input.backorderQtyAtOrder ?? 0));
  const allocatedAtOrder =
    input.availableQtyAtOrder != null
      ? Math.max(0, Math.trunc(input.availableQtyAtOrder))
      : backorderedAtOrder > 0
        ? Math.max(0, orderedQty - backorderedAtOrder)
        : null;

  const rawDespatched = input.despatchedQty != null ? Math.max(0, Math.trunc(input.despatchedQty)) : 0;
  const hasLineDespatchEvidence = rawDespatched > 0;

  if (input.orderFullyDespatched) {
    return {
      orderedQty,
      allocatedAtOrder,
      backorderedAtOrder,
      despatchedQty: orderedQty,
      outstandingBackorderQty: 0,
      lineStatus: "DESPATCHED",
      lineStatusLabel: "Despatched",
      despatchQuantitiesKnown: true,
      limitation: null,
    };
  }

  if (hasLineDespatchEvidence) {
    const despatchedQty = Math.min(orderedQty, rawDespatched);
    const outstanding = Math.max(0, orderedQty - despatchedQty);
    let lineStatus: CustomerLineFulfilment["lineStatus"] = "DESPATCHED";
    let lineStatusLabel = "Despatched";
    if (outstanding > 0 && despatchedQty > 0) {
      lineStatus = "PART_DESPATCHED";
      lineStatusLabel = "Part Despatched";
    } else if (outstanding > 0 && despatchedQty === 0) {
      lineStatus = backorderedAtOrder >= orderedQty ? "BACKORDERED" : "PART_BACKORDERED";
      lineStatusLabel = lineStatus === "BACKORDERED" ? "Backordered" : "Part Backordered";
    }
    return {
      orderedQty,
      allocatedAtOrder,
      backorderedAtOrder,
      despatchedQty,
      outstandingBackorderQty: outstanding,
      lineStatus,
      lineStatusLabel,
      despatchQuantitiesKnown: true,
      limitation: null,
    };
  }

  // No line-level despatch evidence yet.
  if (input.orderPartDespatchedWithoutLineQty && backorderedAtOrder > 0) {
    return {
      orderedQty,
      allocatedAtOrder,
      backorderedAtOrder,
      despatchedQty: null,
      outstandingBackorderQty: null,
      lineStatus: "PART_DESPATCHED",
      lineStatusLabel: "Part Despatched",
      despatchQuantitiesKnown: false,
      limitation: LINE_LIMITATION_504C,
    };
  }

  if (backorderedAtOrder <= 0) {
    return {
      orderedQty,
      allocatedAtOrder: allocatedAtOrder ?? orderedQty,
      backorderedAtOrder: 0,
      despatchedQty: null,
      outstandingBackorderQty: 0,
      lineStatus: "AVAILABLE",
      lineStatusLabel: "Available",
      despatchQuantitiesKnown: false,
      limitation: null,
    };
  }

  if (allocatedAtOrder != null && allocatedAtOrder > 0 && backorderedAtOrder > 0) {
    return {
      orderedQty,
      allocatedAtOrder,
      backorderedAtOrder,
      despatchedQty: null,
      outstandingBackorderQty: backorderedAtOrder,
      lineStatus: "PART_BACKORDERED",
      lineStatusLabel: "Part Backordered",
      despatchQuantitiesKnown: false,
      limitation: null,
    };
  }

  return {
    orderedQty,
    allocatedAtOrder: allocatedAtOrder ?? 0,
    backorderedAtOrder,
    despatchedQty: null,
    outstandingBackorderQty: backorderedAtOrder,
    lineStatus: "BACKORDERED",
    lineStatusLabel: "Backordered",
    despatchQuantitiesKnown: false,
    limitation: null,
  };
}

export function summariseCustomerOrderFulfilment(input: {
  status: string;
  items: Array<{
    qty: number;
    availableQtyAtOrder?: number | null;
    backorderQtyAtOrder?: number | null;
    despatchedQty?: number | null;
  }>;
}): CustomerOrderFulfilmentSummary {
  const lines = input.items.map((item) =>
    presentCustomerLineFulfilment({
      ...item,
      orderPartDespatchedWithoutLineQty: input.status === "PARTIALLY_DESPATCHED",
      orderFullyDespatched: input.status === "DISPATCHED" || input.status === "DELIVERED",
    }),
  );

  const hasBackorderAtPlacement = lines.some((l) => l.backorderedAtOrder > 0);
  const outstandingUnits = lines.reduce((sum, l) => sum + (l.outstandingBackorderQty ?? 0), 0);
  const linesWithOutstanding = lines.filter(
    (l) => (l.outstandingBackorderQty ?? 0) > 0 || (l.outstandingBackorderQty == null && l.backorderedAtOrder > 0),
  ).length;
  const hasOutstanding =
    linesWithOutstanding > 0 ||
    (input.status === "PARTIALLY_DESPATCHED" && hasBackorderAtPlacement);

  const anyLineQtyKnown = lines.some((l) => l.despatchQuantitiesKnown);
  const limitation =
    input.status === "PARTIALLY_DESPATCHED" && !anyLineQtyKnown ? LINE_LIMITATION_504C : null;

  let orderStatusBadge: CustomerOrderFulfilmentSummary["orderStatusBadge"] = "OTHER";
  let orderStatusLabel = input.status;

  switch (input.status) {
    case "SUBMITTED":
      orderStatusBadge = "RECEIVED";
      orderStatusLabel = "Received";
      break;
    case "CONFIRMED":
    case "PICKING":
      if (hasOutstanding && lines.every((l) => l.lineStatus === "BACKORDERED")) {
        orderStatusBadge = "BACKORDERED";
        orderStatusLabel = "Backordered";
      } else if (hasOutstanding) {
        orderStatusBadge = "PART_BACKORDERED";
        orderStatusLabel = "Part Backordered";
      } else {
        orderStatusBadge = "PROCESSING";
        orderStatusLabel = "Processing";
      }
      break;
    case "PARTIALLY_DESPATCHED":
      orderStatusBadge = "PART_DESPATCHED";
      orderStatusLabel = "Part Despatched";
      break;
    case "DISPATCHED":
    case "DELIVERED":
      orderStatusBadge = "DESPATCHED";
      orderStatusLabel = "Despatched";
      break;
    default:
      break;
  }

  return {
    hasBackorderAtPlacement,
    hasOutstandingBackorder: hasOutstanding,
    outstandingBackorderUnits: outstandingUnits,
    linesWithOutstandingBackorder: linesWithOutstanding,
    orderStatusLabel,
    orderStatusBadge,
    lineQuantitiesLimitation: limitation,
  };
}

/** Dashboard row helper: "7 items on backorder" */
export function backorderUnitsLabel(units: number): string {
  if (units <= 0) return "";
  return units === 1 ? "1 item on backorder" : `${units} items on backorder`;
}
