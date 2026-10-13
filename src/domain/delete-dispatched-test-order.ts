/**
 * Rules for permanently deleting a DISPATCHED order that exists only as internal test data.
 * Server deletion enforces the same checks. The UI uses them to explain a refusal.
 */

export const GENUINE_SHIPMENT_EVENT_KINDS = [
  "DESPATCHED",
  "PART_DESPATCHED",
  "INVOICE_LINKED",
  "EXPORTED_FOR_PROCESSING",
] as const;

export const EXTERNAL_FULFILMENT_SOURCES = [
  "AUTOPART_504C",
  "AUTOPART_504_TRM",
  "AUTOPART_EXPORT",
] as const;

export type DispatchedTestOrderInvoiceEvidence = {
  invoiceNumber: string;
  status: string;
  autopartDocumentKind: string | null;
};

export type DispatchedTestOrderDocumentEvidence = {
  documentType: string;
  documentReference: string;
  source: string;
};

export type DispatchedTestOrderFulfilmentEvidence = {
  kind: string;
  source: string;
  summary: string;
};

export type DispatchedTestOrderDeletionEvidence = {
  status: string;
  externalRef: string | null;
  autopartExportStatus: string;
  autopartExportCount: number;
  autopartExportBatchReference: string | null;
  invoices: DispatchedTestOrderInvoiceEvidence[];
  autopartDocuments: DispatchedTestOrderDocumentEvidence[];
  fulfilmentEvents: DispatchedTestOrderFulfilmentEvidence[];
  despatchedQty: number;
};

export type DeleteDispatchedTestOrderConfirmation =
  | { ok: true; reason: string }
  | { ok: false; code: "REASON_REQUIRED" | "REASON_TOO_LONG" | "TEST_DATA_CONFIRMATION_REQUIRED" | "ORDER_NUMBER_MISMATCH"; message: string };

const REASON_MAX = 500;

export function canOfferDispatchedTestOrderDelete(input: {
  systemRoles: readonly string[];
  status: string;
}): boolean {
  return input.systemRoles.includes("SUPER_ADMIN") && input.status === "DISPATCHED";
}

export function validateDeleteDispatchedTestOrderConfirmation(input: {
  reason: unknown;
  confirmTestData: unknown;
  confirmOrderNumber: unknown;
  expectedOrderNumber: string;
}): DeleteDispatchedTestOrderConfirmation {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) {
    return {
      ok: false,
      code: "REASON_REQUIRED",
      message: "Enter a reason for deleting this test order.",
    };
  }
  if (reason.length > REASON_MAX) {
    return {
      ok: false,
      code: "REASON_TOO_LONG",
      message: "The deletion reason must be 500 characters or fewer.",
    };
  }
  if (input.confirmTestData !== true) {
    return {
      ok: false,
      code: "TEST_DATA_CONFIRMATION_REQUIRED",
      message: "Confirm that this order is test data and no physical goods were shipped.",
    };
  }
  if (input.confirmOrderNumber !== input.expectedOrderNumber) {
    return {
      ok: false,
      code: "ORDER_NUMBER_MISMATCH",
      message: "Type the exact order number to confirm deletion.",
    };
  }
  return { ok: true, reason };
}

export function isGenuineFulfilmentEvidence(event: DispatchedTestOrderFulfilmentEvidence): boolean {
  return (
    (GENUINE_SHIPMENT_EVENT_KINDS as readonly string[]).includes(event.kind) ||
    (EXTERNAL_FULFILMENT_SOURCES as readonly string[]).includes(event.source)
  );
}

export function dispatchedTestOrderDeletionBlockers(
  evidence: DispatchedTestOrderDeletionEvidence,
): string[] {
  const blockers: string[] = [];

  if (evidence.status === "DELIVERED") {
    blockers.push("Delivered orders cannot be permanently deleted.");
  } else if (evidence.status !== "DISPATCHED") {
    blockers.push(
      `Only dispatched test orders can be deleted this way. Current status is ${evidence.status}.`,
    );
  }

  for (const invoice of evidence.invoices) {
    const label = invoice.autopartDocumentKind === "CREDIT" ? "credit note" : "invoice";
    const payment =
      invoice.status === "PAID" || invoice.status === "PART_PAID"
        ? ` Payment recorded (${invoice.status}).`
        : "";
    blockers.push(
      `Linked ${label} ${invoice.invoiceNumber} (${invoice.status}).${payment} This financial record is not removed or unlinked.`,
    );
  }

  for (const document of evidence.autopartDocuments) {
    blockers.push(
      `Linked Autopart ${document.documentType} ${document.documentReference} (${document.source}). Autopart records are not changed or deleted.`,
    );
  }

  if (evidence.externalRef) {
    blockers.push(
      `External reference ${evidence.externalRef} is set. External records are not changed.`,
    );
  }

  if (
    evidence.autopartExportStatus === "EXPORTED" ||
    evidence.autopartExportCount > 0 ||
    evidence.autopartExportBatchReference
  ) {
    const batch = evidence.autopartExportBatchReference
      ? `, batch ${evidence.autopartExportBatchReference}`
      : "";
    blockers.push(
      `This order was exported to Autopart (${evidence.autopartExportCount} export(s)${batch}). The export is kept and the order cannot be deleted.`,
    );
  }

  for (const event of evidence.fulfilmentEvents) {
    if (!isGenuineFulfilmentEvidence(event)) continue;
    blockers.push(
      `Fulfilment evidence ${event.kind} from ${event.source}: ${event.summary}. Genuine shipment or export history blocks deletion.`,
    );
  }

  if (evidence.despatchedQty > 0) {
    blockers.push(
      `Despatched quantity of ${evidence.despatchedQty} is recorded on order lines. Genuine shipment evidence blocks deletion.`,
    );
  }

  return blockers;
}
