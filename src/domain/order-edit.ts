/**
 * Commercial edit eligibility for staff sales orders.
 * Server-side authority. Customer portal permissions are unchanged.
 */

const LOCKING_FULFILMENT = new Set([
  "EXPORTED_FOR_PROCESSING",
  "INVOICE_LINKED",
  "PART_DESPATCHED",
  "DESPATCHED",
]);

export type SalesOrderEditAssessment = {
  allowed: boolean;
  reason: string | null;
};

export function assessSalesOrderEditEligibility(input: {
  status: string;
  archivedAt: Date | null;
  autopartExportStatus: string;
  autopartExportCount: number;
  autopartExportedAt: Date | null;
  externalRef: string | null;
  invoiceCount: number;
  fulfilmentKinds: string[];
  consumedReservationCount: number;
}): SalesOrderEditAssessment {
  if (input.archivedAt) {
    return { allowed: false, reason: "Archived orders cannot be edited." };
  }
  if (input.externalRef) {
    return {
      allowed: false,
      reason: "This order is linked to an external record and can no longer be edited.",
    };
  }
  if (
    input.autopartExportStatus !== "NOT_EXPORTED" ||
    input.autopartExportCount > 0 ||
    input.autopartExportedAt
  ) {
    return {
      allowed: false,
      reason: "This order has been exported to Autopart and can no longer be edited.",
    };
  }
  if (input.invoiceCount > 0) {
    return { allowed: false, reason: "This order has an invoice and can no longer be edited." };
  }
  if (input.fulfilmentKinds.some((kind) => LOCKING_FULFILMENT.has(kind))) {
    return {
      allowed: false,
      reason: "Fulfilment has started, so this order can no longer be edited.",
    };
  }
  if (input.consumedReservationCount > 0) {
    return {
      allowed: false,
      reason: "Stock for this order has been consumed and can no longer be changed.",
    };
  }
  if (input.status !== "SUBMITTED") {
    return {
      allowed: false,
      reason: "Only submitted orders can be edited, and only before they are exported, invoiced, or despatched.",
    };
  }
  return { allowed: true, reason: null };
}
