/**
 * Super Admin archive and restore for test orders.
 * Does not delete or modify invoices, credits, Autopart documents, export batches,
 * fulfilment evidence, stock reservations, or the order status. Sends no email.
 */
import { prisma } from "@/infra/database/client";
import { moneyToString, moneyZero, parseMoney } from "@/domain/money";
import {
  validateArchiveTestOrdersConfirmation,
  validateRestoreTestOrderConfirmation,
} from "@/domain/archive-test-order";
import { recordAuditEventInTransaction } from "@/server/audit/record";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";

const ARCHIVE_ACTION = "order.test_archived";
const RESTORE_ACTION = "order.test_restored";

export type ArchiveTestOrderPreview = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: string;
  grandTotal: string;
  currency: string;
  archivedAt: string | null;
  archiveReason: string | null;
  invoices: Array<{ invoiceNumber: string; status: string; kind: string | null }>;
  autopartDocuments: Array<{ documentType: string; documentReference: string; source: string }>;
  exportStatus: string;
  exportCount: number;
  exportBatchReference: string | null;
  fulfilmentCount: number;
  canArchive: boolean;
};

async function requireSuperAdmin(userId: string, action: "archive" | "restore") {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType !== "INTERNAL" || !profile.systemRoles.includes("SUPER_ADMIN")) {
    throw new AuthError(
      action === "archive"
        ? "Only Super Admin can archive test orders."
        : "Only Super Admin can restore archived test orders.",
      "FORBIDDEN",
      403,
    );
  }
  return profile;
}

async function loadPreview(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      company: { select: { name: true } },
      invoices: {
        select: { invoiceNumber: true, status: true, autopartDocumentKind: true },
      },
      fulfilmentEvents: { select: { id: true } },
      autopartExportBatch: { select: { reference: true } },
    },
  });
  if (!order) return null;
  const autopartDocuments = await prisma.autopartSalesDocument.findMany({
    where: { OR: [{ abOrderId: order.id }, { abOrderNumber: order.orderNumber }] },
    select: { documentType: true, documentReference: true, source: true },
  });
  return { order, autopartDocuments };
}

export async function previewArchiveTestOrder(
  userId: string,
  orderId: string,
): Promise<ArchiveTestOrderPreview> {
  await requireSuperAdmin(userId, "archive");
  const loaded = await loadPreview(orderId);
  if (!loaded) throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  const { order, autopartDocuments } = loaded;
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.company.name,
    status: order.status,
    grandTotal: moneyToString(parseMoney(String(order.grandTotal)) ?? moneyZero(), 2),
    currency: order.currency,
    archivedAt: order.archivedAt?.toISOString() ?? null,
    archiveReason: order.archiveReason,
    invoices: order.invoices.map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      kind: invoice.autopartDocumentKind,
    })),
    autopartDocuments,
    exportStatus: order.autopartExportStatus,
    exportCount: order.autopartExportCount,
    exportBatchReference: order.autopartExportBatch?.reference ?? null,
    fulfilmentCount: order.fulfilmentEvents.length,
    canArchive: order.archivedAt == null && order.status !== "DRAFT",
  };
}

export async function archiveTestOrders(
  userId: string,
  raw: {
    orderIds?: unknown;
    reason?: unknown;
    confirmTestData?: unknown;
    confirmOrderNumbers?: unknown;
  },
): Promise<{ archived: Array<{ orderId: string; orderNumber: string }> }> {
  await requireSuperAdmin(userId, "archive");
  const orderIds = [
    ...new Set(
      (Array.isArray(raw.orderIds) ? raw.orderIds : []).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  ];
  if (orderIds.length === 0) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      archivedAt: true,
      companyId: true,
      _count: { select: { invoices: true, fulfilmentEvents: true } },
    },
  });
  if (orders.length !== orderIds.length) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }
  if (orders.some((order) => order.status === "DRAFT")) {
    throw new AuthError("Draft orders cannot be archived.", "ORDER_NOT_ARCHIVABLE", 400);
  }
  if (orders.some((order) => order.archivedAt != null)) {
    throw new AuthError("One of these orders is already archived.", "ALREADY_ARCHIVED", 400);
  }

  const confirmation = validateArchiveTestOrdersConfirmation({
    reason: raw.reason,
    confirmTestData: raw.confirmTestData,
    confirmOrderNumbers: raw.confirmOrderNumbers,
    expectedOrderNumbers: orders.map((order) => order.orderNumber),
  });
  if (!confirmation.ok) {
    throw new AuthError(confirmation.message, confirmation.code, 400);
  }

  const archivedAt = new Date();
  const archived = await prisma.$transaction(async (tx) => {
    const fresh = await tx.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true, status: true, archivedAt: true, companyId: true },
    });
    if (fresh.length !== orders.length || fresh.some((order) => order.archivedAt || order.status === "DRAFT")) {
      throw new AuthError("One of these orders can no longer be archived.", "ALREADY_ARCHIVED", 400);
    }
    const saved: Array<{ orderId: string; orderNumber: string }> = [];
    for (const order of fresh) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          archivedAt,
          archivedByUserId: userId,
          archiveReason: confirmation.reason,
        },
      });
      const counts = orders.find((row) => row.id === order.id);
      await recordAuditEventInTransaction(tx, {
        action: ARCHIVE_ACTION,
        entityType: "Order",
        entityId: order.id,
        actorUserId: userId,
        companyId: order.companyId,
        metadata: {
          orderNumber: order.orderNumber,
          status: order.status,
          reason: confirmation.reason,
          archivedAt: archivedAt.toISOString(),
          archivedByUserId: userId,
          invoiceCount: counts?._count.invoices ?? 0,
          fulfilmentEventCount: counts?._count.fulfilmentEvents ?? 0,
          preserved: [
            "status",
            "invoices",
            "creditNotes",
            "autopartDocuments",
            "exportBatches",
            "fulfilmentEvents",
            "stock",
          ],
        },
      });
      saved.push({ orderId: order.id, orderNumber: order.orderNumber });
    }
    return saved;
  });

  return { archived };
}

export async function restoreTestOrder(
  userId: string,
  raw: { orderId?: unknown; confirmOrderNumber?: unknown },
): Promise<{ orderId: string; orderNumber: string; status: string }> {
  await requireSuperAdmin(userId, "restore");
  const orderId = typeof raw.orderId === "string" ? raw.orderId : "";
  if (!orderId) throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      companyId: true,
      archivedAt: true,
      archiveReason: true,
      archivedByUserId: true,
    },
  });
  if (!order) throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  if (!order.archivedAt) {
    throw new AuthError("This order is not archived.", "NOT_ARCHIVED", 400);
  }
  const confirmation = validateRestoreTestOrderConfirmation({
    confirmOrderNumber: raw.confirmOrderNumber,
    expectedOrderNumber: order.orderNumber,
  });
  if (!confirmation.ok) {
    throw new AuthError(confirmation.message, confirmation.code, 400);
  }

  const previous = {
    archivedAt: order.archivedAt.toISOString(),
    archiveReason: order.archiveReason,
    archivedByUserId: order.archivedByUserId,
    status: order.status,
  };

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.order.findUnique({
      where: { id: order.id },
      select: { archivedAt: true, status: true },
    });
    if (!fresh?.archivedAt) {
      throw new AuthError("This order is not archived.", "NOT_ARCHIVED", 400);
    }
    await tx.order.update({
      where: { id: order.id },
      data: { archivedAt: null, archivedByUserId: null, archiveReason: null },
    });
    await recordAuditEventInTransaction(tx, {
      action: RESTORE_ACTION,
      entityType: "Order",
      entityId: order.id,
      actorUserId: userId,
      companyId: order.companyId,
      before: previous,
      metadata: {
        orderNumber: order.orderNumber,
        status: fresh.status,
        restoredByUserId: userId,
        previousArchiveReason: order.archiveReason,
      },
    });
  });

  return { orderId: order.id, orderNumber: order.orderNumber, status: order.status };
}
