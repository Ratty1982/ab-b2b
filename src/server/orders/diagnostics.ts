/** Read-only evidence for one sales order. No provider requests or mutations. */
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";

export async function getOrderDiagnostics(actorUserId: string, orderId: string) {
  const profile = await requireSystemPermission(actorUserId, "orders.view");
  const accessible = await getAccessibleCompanyIdsForSales(profile);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, companyId: true, orderNumber: true, status: true, invoiceEvidence: true,
      createdAt: true, placedAt: true, updatedAt: true,
      stockReleasePolicy: true, stockHoldState: true,
      stockHeldAt: true, stockHoldLastCheckedAt: true, stockReleasedAt: true,
      stockReleaseReason: true, stockHoldCancelledAt: true, stockHoldCancelReason: true,
      autopartExportStatus: true, autopartExportedAt: true, autopartExportCount: true,
      autopartExportBatch: { select: { reference: true, createdAt: true, filename: true, isReexport: true } },
      invoices: { orderBy: { createdAt: "desc" }, take: 30,
        select: { id: true, invoiceNumber: true, status: true, issuedAt: true,
          autopartDocumentKind: true, autopartDocumentAt: true, autopartImportRunId: true, externalRef: true } },
      fulfilmentEvents: { orderBy: { occurredAt: "asc" }, take: 100,
        select: { id: true, kind: true, occurredAt: true, summary: true, source: true,
          limitation: true, lineQuantitiesKnown: true, invoiceId: true } },
    },
  });
  if (!order || (accessible !== "all" && !accessible.includes(order.companyId))) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }

  const [emails, audits] = await Promise.all([
    prisma.transactionalEmail.findMany({
      where: { entityType: "Order", entityId: orderId },
      orderBy: { createdAt: "asc" }, take: 100,
      select: { id: true, purpose: true, status: true, toEmail: true,
        attemptCount: true, lastError: true, providerId: true,
        createdAt: true, sentAt: true, updatedAt: true },
    }),
    prisma.auditEvent.findMany({
      where: { entityType: "Order", entityId: orderId },
      orderBy: { createdAt: "asc" }, take: 100,
      select: { id: true, action: true, createdAt: true, actorUserId: true },
    }),
  ]);

  const timeline = [
    ...(order.placedAt ? [{ id: "placed", at: order.placedAt, kind: "ORDER_PLACED", detail: "Order placed" }] : []),
    ...(order.stockHeldAt ? [{ id: "held", at: order.stockHeldAt, kind: "STOCK_HELD", detail: "Hold applied" }] : []),
    ...(order.stockReleasedAt ? [{ id: "released", at: order.stockReleasedAt, kind: "STOCK_RELEASED", detail: order.stockReleaseReason || "Hold released" }] : []),
    ...(order.stockHoldCancelledAt ? [{ id: "hold-cancelled", at: order.stockHoldCancelledAt, kind: "HOLD_CANCELLED", detail: order.stockHoldCancelReason || "Hold cancelled" }] : []),
    ...(order.autopartExportedAt ? [{ id: "exported", at: order.autopartExportedAt, kind: "AUTOPART_EXPORT", detail: "CSV export recorded; not proof of Autopart receipt" }] : []),
    ...order.invoices.map(x => ({ id: "invoice-" + x.id, at: x.autopartDocumentAt || x.issuedAt || order.createdAt, kind: "INVOICE_RECORD", detail: x.invoiceNumber + " (" + x.status + ")" })),
    ...order.fulfilmentEvents.map(x => ({ id: "fulfilment-" + x.id, at: x.occurredAt, kind: "FULFILMENT_" + x.kind, detail: x.summary + " · " + x.source })),
    ...emails.map(x => ({ id: "email-" + x.id, at: x.sentAt || x.createdAt, kind: "EMAIL_" + x.purpose, detail: x.status + " · " + x.attemptCount + " attempt(s)" })),
    ...audits.map(x => ({ id: "audit-" + x.id, at: x.createdAt, kind: "AUDIT", detail: x.action })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id))
    .map(x => ({ ...x, at: x.at.toISOString() }));

  return {
    orderId: order.id, orderNumber: order.orderNumber, orderStatus: order.status,
    invoiceEvidence: order.invoiceEvidence,
    stockReleasePolicy: order.stockReleasePolicy, stockHoldState: order.stockHoldState,
    stockHoldLastCheckedAt: order.stockHoldLastCheckedAt?.toISOString() ?? null,
    stockReleaseReason: order.stockReleaseReason,
    exportStatus: order.autopartExportStatus,
    exportCount: order.autopartExportCount,
    exportBatch: order.autopartExportBatch
      ? { ...order.autopartExportBatch, createdAt: order.autopartExportBatch.createdAt.toISOString() } : null,
    invoices: order.invoices.map(x => ({
      ...x, issuedAt: x.issuedAt?.toISOString() ?? null,
      autopartDocumentAt: x.autopartDocumentAt?.toISOString() ?? null,
    })),
    fulfilmentEvents: order.fulfilmentEvents.map(x => ({ ...x, occurredAt: x.occurredAt.toISOString() })),
    emails: emails.map(x => ({
      ...x, createdAt: x.createdAt.toISOString(), updatedAt: x.updatedAt.toISOString(),
      sentAt: x.sentAt?.toISOString() ?? null,
    })),
    auditEvents: audits.map(x => ({ ...x, createdAt: x.createdAt.toISOString() })),
    timeline,
    limitations: [
      "A CSV export is not proof that Autopart received or processed the order.",
      "An invoice record is not, by itself, confirmation of physical despatch.",
      "SENT means the email provider accepted the send, not that the recipient read it.",
      "Only the 100 earliest fulfilment, email and audit records and 30 latest invoices are shown.",
    ],
  };
}
