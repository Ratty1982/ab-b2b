/**
 * Super Admin permanent deletion of a DISPATCHED order that was only internal test data.
 * Normal order deletion stays in deleteAdminOrder and still refuses DISPATCHED and DELIVERED.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { moneyToString, moneyZero, parseMoney } from "@/domain/money";
import {
  dispatchedTestOrderDeletionBlockers,
  isGenuineFulfilmentEvidence,
  validateDeleteDispatchedTestOrderConfirmation,
  type DispatchedTestOrderDeletionEvidence,
} from "@/domain/delete-dispatched-test-order";
import { recordAuditEventInTransaction } from "@/server/audit/record";
import { releaseStockForOrder } from "@/server/orders/reservations";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";

const TEST_ORDER_DELETE_ACTION = "order.test_dispatched_deleted";

export type DispatchedTestOrderDeletionPreview = {
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  status: string;
  grandTotal: string;
  currency: string;
  invoices: Array<{ invoiceNumber: string; status: string; kind: string | null }>;
  autopartDocuments: Array<{ documentType: string; documentReference: string; source: string }>;
  exportStatus: string;
  exportCount: number;
  exportBatchReference: string | null;
  externalRef: string | null;
  fulfilmentRecords: Array<{ kind: string; source: string; summary: string }>;
  blockers: string[];
  eligible: boolean;
};

type DeletionContext = NonNullable<Awaited<ReturnType<typeof loadDeletionContext>>>;

async function requireSuperAdmin(userId: string) {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType !== "INTERNAL" || !profile.systemRoles.includes("SUPER_ADMIN")) {
    throw new AuthError(
      "Only Super Admin can permanently delete dispatched test orders.",
      "FORBIDDEN",
      403,
    );
  }
  return profile;
}

async function loadDeletionContext(db: Prisma.TransactionClient | typeof prisma, orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      company: { select: { id: true, name: true } },
      items: { select: { despatchedQty: true } },
      invoices: {
        select: { id: true, invoiceNumber: true, status: true, autopartDocumentKind: true },
      },
      fulfilmentEvents: { select: { kind: true, source: true, summary: true } },
      reservations: { select: { status: true, quantity: true } },
      autopartExportBatch: { select: { reference: true } },
    },
  });
  if (!order) return null;

  const autopartDocuments = await db.autopartSalesDocument.findMany({
    where: {
      OR: [{ abOrderId: order.id }, { abOrderNumber: order.orderNumber }],
    },
    select: { id: true, documentType: true, documentReference: true, source: true },
  });

  return { order, autopartDocuments };
}

function evidenceFrom(context: DeletionContext): DispatchedTestOrderDeletionEvidence {
  const { order, autopartDocuments } = context;
  return {
    status: order.status,
    externalRef: order.externalRef,
    autopartExportStatus: order.autopartExportStatus,
    autopartExportCount: order.autopartExportCount,
    autopartExportBatchReference: order.autopartExportBatch?.reference ?? null,
    invoices: order.invoices.map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      autopartDocumentKind: invoice.autopartDocumentKind,
    })),
    autopartDocuments: autopartDocuments.map((document) => ({
      documentType: document.documentType,
      documentReference: document.documentReference,
      source: document.source,
    })),
    fulfilmentEvents: order.fulfilmentEvents.map((event) => ({
      kind: event.kind,
      source: event.source,
      summary: event.summary,
    })),
    despatchedQty: order.items.reduce((sum, item) => sum + (item.despatchedQty ?? 0), 0),
  };
}

function toPreview(context: DeletionContext): DispatchedTestOrderDeletionPreview {
  const evidence = evidenceFrom(context);
  const blockers = dispatchedTestOrderDeletionBlockers(evidence);
  const { order } = context;
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerId: order.companyId,
    customerName: order.company.name,
    status: order.status,
    grandTotal: moneyToString(parseMoney(String(order.grandTotal)) ?? moneyZero(), 2),
    currency: order.currency,
    invoices: evidence.invoices.map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      kind: invoice.autopartDocumentKind,
    })),
    autopartDocuments: evidence.autopartDocuments,
    exportStatus: evidence.autopartExportStatus,
    exportCount: evidence.autopartExportCount,
    exportBatchReference: evidence.autopartExportBatchReference,
    externalRef: evidence.externalRef,
    fulfilmentRecords: evidence.fulfilmentEvents,
    blockers,
    eligible: blockers.length === 0,
  };
}

export async function previewDispatchedTestOrderDeletion(
  userId: string,
  orderId: string,
): Promise<DispatchedTestOrderDeletionPreview> {
  await requireSuperAdmin(userId);
  const context = await loadDeletionContext(prisma, orderId);
  if (!context) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }
  return toPreview(context);
}

export async function deleteDispatchedTestOrder(
  userId: string,
  raw: {
    orderId?: string;
    reason?: unknown;
    confirmTestData?: unknown;
    confirmOrderNumber?: unknown;
  },
): Promise<{ orderId: string; orderNumber: string; releasedQuantity: number }> {
  await requireSuperAdmin(userId);
  const orderId = typeof raw.orderId === "string" ? raw.orderId : "";
  if (!orderId) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }

  const existing = await loadDeletionContext(prisma, orderId);
  if (!existing) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }

  const confirmation = validateDeleteDispatchedTestOrderConfirmation({
    reason: raw.reason,
    confirmTestData: raw.confirmTestData,
    confirmOrderNumber: raw.confirmOrderNumber,
    expectedOrderNumber: existing.order.orderNumber,
  });
  if (!confirmation.ok) {
    throw new AuthError(confirmation.message, confirmation.code, 400);
  }

  const blockers = dispatchedTestOrderDeletionBlockers(evidenceFrom(existing));
  if (blockers.length > 0) {
    throw new AuthError(blockers.join(" "), "TEST_ORDER_DELETE_BLOCKED", 400);
  }

  const reason = confirmation.reason;

  try {
    return await prisma.$transaction(async (tx) => {
      const context = await loadDeletionContext(tx, orderId);
      if (!context) {
        throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
      }
      const freshBlockers = dispatchedTestOrderDeletionBlockers(evidenceFrom(context));
      if (freshBlockers.length > 0) {
        throw new AuthError(freshBlockers.join(" "), "TEST_ORDER_DELETE_BLOCKED", 400);
      }

      const { order } = context;
      const reservations = order.reservations;
      const activeQuantity = reservations
        .filter((row) => row.status === "ACTIVE")
        .reduce((sum, row) => sum + row.quantity, 0);
      const consumedQuantity = reservations
        .filter((row) => row.status === "CONSUMED")
        .reduce((sum, row) => sum + row.quantity, 0);
      const alreadyReleasedQuantity = reservations
        .filter((row) => row.status === "RELEASED")
        .reduce((sum, row) => sum + row.quantity, 0);

      const released = await releaseStockForOrder(tx, { orderId: order.id });

      await tx.salesOrderDraft.updateMany({
        where: { placedOrderId: order.id },
        data: { placedOrderId: null },
      });
      await tx.quote.updateMany({
        where: { convertedOrderId: order.id },
        data: { convertedOrderId: null },
      });
      await tx.transactionalEmail.deleteMany({
        where: { entityType: "Order", entityId: order.id },
      });

      const deletedAt = new Date().toISOString();
      const evidence = evidenceFrom(context);
      await tx.retiredOrderNumber.create({
        data: {
          orderNumber: order.orderNumber,
          orderId: order.id,
          companyId: order.companyId,
          previousStatus: order.status,
          reason,
          retiredByUserId: userId,
        },
      });

      await recordAuditEventInTransaction(tx, {
        action: TEST_ORDER_DELETE_ACTION,
        entityType: "Order",
        entityId: order.id,
        actorUserId: userId,
        companyId: order.companyId,
        before: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          previousStatus: order.status,
          customerId: order.companyId,
        },
        after: { deleted: true },
        metadata: {
          orderNumber: order.orderNumber,
          orderId: order.id,
          previousStatus: order.status,
          customerId: order.companyId,
          deletedByUserId: userId,
          deletedAt,
          reason,
          stockReservationChecks: {
            activeReleasedQuantity: released.releasedQuantity,
            activeReservationCount: released.reservationCount,
            consumedQuantityNotReleased: consumedQuantity,
            alreadyReleasedQuantityNotReleasedAgain: alreadyReleasedQuantity,
            qtyOnHandUnchanged: true,
          },
          externalReferenceChecks: {
            invoiceCount: evidence.invoices.length,
            autopartDocumentCount: evidence.autopartDocuments.length,
            autopartExportStatus: evidence.autopartExportStatus,
            autopartExportCount: evidence.autopartExportCount,
            externalRef: evidence.externalRef,
            genuineFulfilmentEventCount: evidence.fulfilmentEvents.filter((event) =>
              isGenuineFulfilmentEvidence(event),
            ).length,
            despatchedQty: evidence.despatchedQty,
            blockers: freshBlockers,
          },
          expectedActiveQuantity: activeQuantity,
        },
      });

      await tx.order.delete({ where: { id: order.id } });

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        releasedQuantity: released.releasedQuantity,
      };
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new AuthError(
        "Deletion was blocked because a related financial record is still linked. Those records were not removed or unlinked.",
        "TEST_ORDER_DELETE_BLOCKED",
        400,
      );
    }
    throw error;
  }
}
