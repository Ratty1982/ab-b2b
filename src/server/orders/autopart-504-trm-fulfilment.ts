/**
 * 504 + TRM21QC B2B order fulfilment.
 *
 * 504 proves an Autopart invoice/document exists and carries the AB order reference.
 * TRM21QC supplies product quantities for that document number.
 * Cumulative positive invoice units are compared to OrderItem snapshots.
 *
 * Credits remain signed for sales reporting and never reverse physical despatch.
 * 231PO3NEW Avail remains sellable stock — this path does not decrement Inventory.qtyOnHand.
 */

import type { Autopart504TrmFulfilmentMode, Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants, hasPermission } from "@/server/rbac/access";
import { recordAuditEvent } from "@/server/audit/record";
import { parseExactAbOrderReference } from "@/domain/autopart-504-trm-fulfilment";
import {
  evaluateOrder504TrmFulfilment,
  fulfilmentFingerprint,
  plan504TrmDispatchNotifications,
  type FulfilmentDocumentInput,
  type OrderFulfilmentEvaluation,
} from "@/domain/autopart-504-trm-fulfilment";
import { planReservationConsumption } from "@/domain/manual-order-resolution";
import { recordFulfilmentEvent } from "@/server/orders/fulfilment";
import { enqueueOrderDespatchedEmail } from "@/server/orders/despatch-email";
import { enqueueOrderPartDespatchedEmail } from "@/server/orders/part-despatch-email";
import { parseMoney, moneyToString, moneyZero } from "@/domain/money";

/**
 * Serialise every fulfilment exclusive section (normal poll + recovery) in-process.
 * Callers never join an unrelated in-flight promise — each waits its turn with
 * its own orderIds / suppressCustomerDispatchEmail options.
 *
 * Intentionally does not use session-level pg_advisory_lock: Prisma's pool can
 * acquire and release on different connections, which leaks the lock and deadlocks
 * recovery. The JS queue is the production-safe exclusion for a single Node process
 * (the Coolify deploy runs one app instance for this importer).
 */
let fulfilmentExclusiveTail: Promise<unknown> = Promise.resolve();

export async function with504TrmFulfilmentExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = fulfilmentExclusiveTail.then(fn, fn);
  fulfilmentExclusiveTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export type Autopart504TrmFulfilmentPublicSettings = {
  fulfilmentMode: Autopart504TrmFulfilmentMode;
  fulfilmentFrom: string | null;
  fulfilmentLastPreviewAt: string | null;
  fulfilmentLastAppliedAt: string | null;
  fulfilmentLastError: string | null;
  fulfilmentLastErrorAt: string | null;
  fulfilmentLastErrorImportRunId: string | null;
  fulfilmentLastErrorFeed: string | null;
};

export type Autopart504TrmFulfilmentPreview = {
  generatedAt: string;
  mode: Autopart504TrmFulfilmentMode;
  fulfilmentFrom: string | null;
  ordersMatched: number;
  wouldBecomePartial: number;
  wouldBecomeDespatched: number;
  reviewRequired: number;
  waiting: number;
  skippedTerminal: number;
  skippedBeforeFrom: number;
  orders: Array<{
    orderId: string;
    orderNumber: string;
    previousStatus: string;
    conceptually: OrderFulfilmentEvaluation["conceptually"];
    nextStatus: OrderFulfilmentEvaluation["nextStatus"];
    warnings: string[];
    documents: string[];
    lines: Array<{
      sku: string;
      orderedQty: number;
      despatchedQty: number;
      remainingQty: number;
      invoicedQty: number;
    }>;
  }>;
};

export type Autopart504TrmFulfilmentRunResult = {
  mode: Autopart504TrmFulfilmentMode;
  applied: boolean;
  preview: Autopart504TrmFulfilmentPreview;
  emailsQueued: number;
  ordersMutated: number;
};

async function requireFulfilmentAdmin(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!grants(profile, "admin.access", "orders.edit")) {
    throw new AuthError("Not permitted to manage Autopart fulfilment", "FORBIDDEN", 403);
  }
  return profile;
}

export async function read504TrmFulfilmentSettings(): Promise<{
  fulfilmentMode: Autopart504TrmFulfilmentMode;
  fulfilmentFrom: Date | null;
  fulfilmentLastPreviewAt: Date | null;
  fulfilmentLastAppliedAt: Date | null;
  fulfilmentLastError: string | null;
  fulfilmentLastErrorAt: Date | null;
  fulfilmentLastErrorImportRunId: string | null;
  fulfilmentLastErrorFeed: string | null;
}> {
  const ongoing = await prisma.autopartOngoingSalesFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default", fulfilmentFrom: new Date() },
    update: {},
  });
  return {
    fulfilmentMode: ongoing.fulfilmentMode,
    fulfilmentFrom: ongoing.fulfilmentFrom,
    fulfilmentLastPreviewAt: ongoing.fulfilmentLastPreviewAt,
    fulfilmentLastAppliedAt: ongoing.fulfilmentLastAppliedAt,
    fulfilmentLastError: ongoing.fulfilmentLastError,
    fulfilmentLastErrorAt: ongoing.fulfilmentLastErrorAt,
    fulfilmentLastErrorImportRunId: ongoing.fulfilmentLastErrorImportRunId,
    fulfilmentLastErrorFeed: ongoing.fulfilmentLastErrorFeed,
  };
}

/** Truly read-only settings load — never upserts or stamps clocks. */
export async function read504TrmFulfilmentSettingsReadonly(): Promise<{
  fulfilmentMode: Autopart504TrmFulfilmentMode;
  fulfilmentFrom: Date | null;
  fulfilmentLastPreviewAt: Date | null;
  fulfilmentLastAppliedAt: Date | null;
  fulfilmentLastError: string | null;
  fulfilmentLastErrorAt: Date | null;
  fulfilmentLastErrorImportRunId: string | null;
  fulfilmentLastErrorFeed: string | null;
}> {
  const ongoing = await prisma.autopartOngoingSalesFeedSettings.findUnique({
    where: { id: "default" },
  });
  return {
    fulfilmentMode: ongoing?.fulfilmentMode ?? "OFF",
    fulfilmentFrom: ongoing?.fulfilmentFrom ?? null,
    fulfilmentLastPreviewAt: ongoing?.fulfilmentLastPreviewAt ?? null,
    fulfilmentLastAppliedAt: ongoing?.fulfilmentLastAppliedAt ?? null,
    fulfilmentLastError: ongoing?.fulfilmentLastError ?? null,
    fulfilmentLastErrorAt: ongoing?.fulfilmentLastErrorAt ?? null,
    fulfilmentLastErrorImportRunId: ongoing?.fulfilmentLastErrorImportRunId ?? null,
    fulfilmentLastErrorFeed: ongoing?.fulfilmentLastErrorFeed ?? null,
  };
}

function toPublicSettings(
  row: Awaited<ReturnType<typeof read504TrmFulfilmentSettings>>,
): Autopart504TrmFulfilmentPublicSettings {
  return {
    fulfilmentMode: row.fulfilmentMode,
    fulfilmentFrom: row.fulfilmentFrom?.toISOString() ?? null,
    fulfilmentLastPreviewAt: row.fulfilmentLastPreviewAt?.toISOString() ?? null,
    fulfilmentLastAppliedAt: row.fulfilmentLastAppliedAt?.toISOString() ?? null,
    fulfilmentLastError: row.fulfilmentLastError,
    fulfilmentLastErrorAt: row.fulfilmentLastErrorAt?.toISOString() ?? null,
    fulfilmentLastErrorImportRunId: row.fulfilmentLastErrorImportRunId,
    fulfilmentLastErrorFeed: row.fulfilmentLastErrorFeed,
  };
}

export async function get504TrmFulfilmentSettingsForActor(
  userId: string,
): Promise<Autopart504TrmFulfilmentPublicSettings> {
  await requireFulfilmentAdmin(userId);
  return toPublicSettings(await read504TrmFulfilmentSettings());
}

export async function update504TrmFulfilmentSettings(
  userId: string,
  patch: {
    fulfilmentMode?: Autopart504TrmFulfilmentMode;
    fulfilmentFrom?: string | null;
  },
) {
  await requireFulfilmentAdmin(userId);
  const current = await read504TrmFulfilmentSettings();
  const nextMode = patch.fulfilmentMode ?? current.fulfilmentMode;
  let nextFrom = current.fulfilmentFrom;
  if (patch.fulfilmentFrom !== undefined) {
    nextFrom = patch.fulfilmentFrom ? new Date(patch.fulfilmentFrom) : null;
  }
  if ((nextMode === "PREVIEW" || nextMode === "ACTIVE") && !nextFrom) {
    nextFrom = new Date();
  }

  const before = {
    fulfilmentMode: current.fulfilmentMode,
    fulfilmentFrom: current.fulfilmentFrom?.toISOString() ?? null,
  };

  const ongoing = await prisma.autopartOngoingSalesFeedSettings.update({
    where: { id: "default" },
    data: {
      fulfilmentMode: nextMode,
      fulfilmentFrom: nextFrom,
      updatedByUserId: userId,
    },
  });

  // Keep any stored legacy feed row disabled. Do not create one, and do not use it to despatch.
  await prisma.autopart504cFeedSettings.updateMany({
    where: { id: "default" },
    data: { runtimeMode: "RETIRED", enabled: false, updatedByUserId: userId },
  });

  await recordAuditEvent({
    action: "autopart.504_trm_fulfilment_switch",
    entityType: "AutopartOngoingSalesFeedSettings",
    entityId: "default",
    actorUserId: userId,
    before,
    after: {
      fulfilmentMode: nextMode,
      fulfilmentFrom: nextFrom?.toISOString() ?? null,
    },
  });

  return toPublicSettings({
    fulfilmentMode: ongoing.fulfilmentMode,
    fulfilmentFrom: ongoing.fulfilmentFrom,
    fulfilmentLastPreviewAt: ongoing.fulfilmentLastPreviewAt,
    fulfilmentLastAppliedAt: ongoing.fulfilmentLastAppliedAt,
    fulfilmentLastError: ongoing.fulfilmentLastError,
    fulfilmentLastErrorAt: ongoing.fulfilmentLastErrorAt,
    fulfilmentLastErrorImportRunId: ongoing.fulfilmentLastErrorImportRunId,
    fulfilmentLastErrorFeed: ongoing.fulfilmentLastErrorFeed,
  });
}

export async function record504TrmFulfilmentProcessorFailure(input: {
  actorUserId: string | null;
  importRunId?: string | null;
  feed: "504" | "TRM21QC" | "RETRY" | "SCHEDULE";
  error: unknown;
}): Promise<void> {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const now = new Date();
  // updateMany only — never upsert/create a settings row (would default mode to OFF
  // and invent a fulfilmentFrom, which must not disturb production ACTIVE settings).
  await prisma.autopartOngoingSalesFeedSettings.updateMany({
    where: { id: "default" },
    data: {
      fulfilmentLastError: message.slice(0, 2000),
      fulfilmentLastErrorAt: now,
      fulfilmentLastErrorImportRunId: input.importRunId ?? null,
      fulfilmentLastErrorFeed: input.feed,
    },
  });
  if (input.importRunId) {
    await prisma.autopartCustomerImportRun
      .update({
        where: { id: input.importRunId },
        data: {
          fulfilmentProcessorStatus: "FAILED",
          fulfilmentProcessorError: message.slice(0, 2000),
          fulfilmentProcessorAt: now,
        },
      })
      .catch(() => undefined);
  }
  await recordAuditEvent({
    action: "autopart.504_trm_fulfilment_failed",
    entityType: input.importRunId ? "AutopartCustomerImportRun" : "AutopartOngoingSalesFeedSettings",
    entityId: input.importRunId ?? "default",
    actorUserId: input.actorUserId,
    metadata: { error: message, feed: input.feed, importRunId: input.importRunId ?? null },
  });
}

export async function clear504TrmFulfilmentProcessorFailure(input?: {
  importRunId?: string | null;
}): Promise<void> {
  await prisma.autopartOngoingSalesFeedSettings.updateMany({
    where: { id: "default" },
    data: {
      fulfilmentLastError: null,
      fulfilmentLastErrorAt: null,
      fulfilmentLastErrorImportRunId: null,
      fulfilmentLastErrorFeed: null,
    },
  });
  if (input?.importRunId) {
    await prisma.autopartCustomerImportRun
      .update({
        where: { id: input.importRunId },
        data: {
          fulfilmentProcessorStatus: "SUCCESS",
          fulfilmentProcessorError: null,
          fulfilmentProcessorAt: new Date(),
        },
      })
      .catch(() => undefined);
  }
}

function moneyOrZero(raw: string | null | undefined): string {
  const m = parseMoney(raw ?? "");
  return m ? moneyToString(m, 2) : moneyToString(moneyZero(), 2);
}

async function loadCandidateOrders(orderIds?: string[]) {
  const where: Prisma.OrderWhereInput = orderIds?.length
    ? { id: { in: orderIds } }
    : {
        status: {
          in: ["CONFIRMED", "PICKING", "PARTIALLY_DESPATCHED", "DISPATCHED", "DELIVERED", "CANCELLED", "ON_HOLD", "ADMINISTRATIVELY_CLOSED"],
        },
      };

  const docs = await prisma.autopartSalesDocument.findMany({
    where: {
      AND: [
        { OR: [{ has504: true }, { hasTrm21qc: true }] },
        {
          OR: [
            { abOrderId: { not: null } },
            { abOrderNumber: { startsWith: "AB-" } },
            { customerOrderNumber: { startsWith: "AB-" } },
          ],
        },
      ],
    },
    include: {
      lines: {
        select: {
          sku: true,
          units: true,
          salesNet: true,
          documentType: true,
        },
      },
    },
  });

  const orderNumbers = new Set<string>();
  const orderIdsFromDocs = new Set<string>();
  for (const doc of docs) {
    const ref = parseExactAbOrderReference(doc.customerOrderNumber ?? doc.abOrderNumber);
    if (ref) orderNumbers.add(ref);
    if (doc.abOrderId) orderIdsFromDocs.add(doc.abOrderId);
  }

  const orders = await prisma.order.findMany({
    where: {
      AND: [
        { archivedAt: null },
        where,
        {
          OR: [
            orderIdsFromDocs.size ? { id: { in: [...orderIdsFromDocs] } } : { id: { in: [] } },
            orderNumbers.size ? { orderNumber: { in: [...orderNumbers] } } : { id: { in: [] } },
          ],
        },
      ],
    },
    include: {
      items: { select: { id: true, sku: true, name: true, qty: true, despatchedQty: true } },
    },
  });

  return { orders, docs };
}

function toDocInput(doc: {
  id: string;
  documentReference: string;
  documentType: string;
  documentDate: Date | null;
  createdAt: Date;
  has504: boolean;
  hasTrm21qc: boolean;
  goodsNet: unknown;
  customerOrderNumber: string | null;
  abOrderNumber: string | null;
  abOrderId: string | null;
  lines: Array<{ sku: string; units: unknown; salesNet: unknown; documentType: string }>;
}): FulfilmentDocumentInput {
  return {
    id: doc.id,
    documentReference: doc.documentReference,
    documentType: doc.documentType,
    documentDate: doc.documentDate,
    createdAt: doc.createdAt,
    has504: doc.has504,
    hasTrm21qc: doc.hasTrm21qc,
    goodsNet: doc.goodsNet != null ? String(doc.goodsNet) : null,
    customerOrderNumber: doc.customerOrderNumber,
    abOrderNumber: doc.abOrderNumber,
    abOrderId: doc.abOrderId,
    lines: doc.lines.map((l) => ({
      sku: l.sku,
      units: String(l.units),
      salesNet: l.salesNet != null ? String(l.salesNet) : null,
      documentType: l.documentType,
    })),
  };
}

function previewFromEvaluations(
  mode: Autopart504TrmFulfilmentMode,
  fulfilmentFrom: Date | null,
  evaluations: OrderFulfilmentEvaluation[],
): Autopart504TrmFulfilmentPreview {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    fulfilmentFrom: fulfilmentFrom?.toISOString() ?? null,
    ordersMatched: evaluations.filter((e) => e.documents.some((d) => d.status !== "NOT_AB_ORDER")).length,
    wouldBecomePartial: evaluations.filter(
      (e) => e.canApply && e.conceptually === "PARTIALLY_DESPATCHED" && e.nextStatus === "PARTIALLY_DESPATCHED",
    ).length,
    wouldBecomeDespatched: evaluations.filter(
      (e) => e.canApply && e.conceptually === "DISPATCHED" && e.nextStatus === "DISPATCHED",
    ).length,
    reviewRequired: evaluations.filter((e) => e.financialReview || e.lineMatchReview || e.overFulfilment).length,
    waiting: evaluations.filter((e) => e.waitingFor504 || e.waitingForTrm).length,
    skippedTerminal: evaluations.filter((e) => e.documents.some((d) => d.status === "SKIPPED_TERMINAL")).length,
    skippedBeforeFrom: evaluations.filter((e) => e.documents.some((d) => d.status === "SKIPPED_BEFORE_FROM")).length,
    orders: evaluations.map((e) => ({
      orderId: e.orderId,
      orderNumber: e.orderNumber,
      previousStatus: e.previousStatus,
      conceptually: e.conceptually,
      nextStatus: e.nextStatus,
      warnings: e.warnings,
      documents: e.documents.map((d) => d.documentReference),
      lines: e.lines.map((l) => ({
        sku: l.sku,
        orderedQty: l.orderedQty,
        despatchedQty: l.despatchedQty,
        remainingQty: l.remainingQty,
        invoicedQty: l.invoicedQty,
      })),
    })),
  };
}

/**
 * Consume ACTIVE reservations only for newly despatched units.
 * Matches manual-resolution policy: leftover undelivered reserved qty stays ACTIVE.
 * Backordered lines never held a reservation, so they are unaffected.
 */
async function consumeReservationsForDespatchDeltas(
  tx: Prisma.TransactionClient,
  orderId: string,
  deltas: Array<{ orderItemId: string; variantId: string | null; quantity: number }>,
) {
  const increaseTotal = deltas.reduce((sum, delta) => sum + Math.max(0, delta.quantity), 0);
  if (increaseTotal <= 0) return 0;

  const reservations = await tx.orderStockReservation.findMany({
    where: { orderId, status: "ACTIVE" },
    orderBy: { id: "asc" },
    select: { id: true, orderItemId: true, variantId: true, inventoryId: true, quantity: true },
  });
  if (!reservations.length) return 0;

  const taken = planReservationConsumption(reservations, deltas);
  let units = 0;
  const now = new Date();
  for (const reservation of reservations) {
    const take = taken.get(reservation.id) ?? 0;
    if (take <= 0) continue;
    units += take;
    await tx.inventory.update({
      where: { id: reservation.inventoryId },
      data: { qtyReserved: { decrement: take } },
    });
    if (take >= reservation.quantity) {
      await tx.orderStockReservation.update({
        where: { id: reservation.id },
        data: { status: "CONSUMED", consumedAt: now },
      });
    } else {
      await tx.orderStockReservation.update({
        where: { id: reservation.id },
        data: { quantity: reservation.quantity - take },
      });
      await tx.orderStockReservation.create({
        data: {
          orderId,
          orderItemId: reservation.orderItemId,
          variantId: reservation.variantId,
          inventoryId: reservation.inventoryId,
          quantity: take,
          status: "CONSUMED",
          consumedAt: now,
        },
      });
    }
  }
  return units;
}

async function ensureInvoice(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    companyId: string;
    documentNumber: string;
    kind: "INVOICE" | "CREDIT";
    goodsNet: string | null;
    documentDate: Date | null;
    customerOrderNumber: string | null;
  },
) {
  const existing = await tx.invoice.findFirst({
    where: { externalRef: input.documentNumber },
    select: { id: true, orderId: true },
  });
  if (existing) return existing;
  const prefix = input.kind === "CREDIT" ? "AP-CR" : "AP-INV";
  try {
    return await tx.invoice.create({
      data: {
        invoiceNumber: `${prefix}-${input.documentNumber}`,
        companyId: input.companyId,
        orderId: input.orderId,
        status: "ISSUED",
        subtotal: moneyOrZero(input.goodsNet),
        vatTotal: "0.00",
        grandTotal: moneyOrZero(input.goodsNet),
        issuedAt: input.documentDate ?? new Date(),
        externalRef: input.documentNumber,
        autopartDocumentKind: input.kind,
        autopartCustomerOrderNumber: input.customerOrderNumber,
        autopartDocumentAt: input.documentDate,
      },
      select: { id: true, orderId: true },
    });
  } catch {
    return tx.invoice.findFirst({
      where: { externalRef: input.documentNumber },
      select: { id: true, orderId: true },
    });
  }
}

/**
 * A manual resolution already recorded despatch or an administrative close.
 * Later 504/TRM evidence may link the financial document. It must not despatch again,
 * change quantities, move status, consume stock, or email the customer.
 */
async function linkFinancialEvidenceWithoutDespatch(
  order: { id: string; companyId: string; orderNumber: string },
  evaluation: OrderFulfilmentEvaluation,
  actorUserId: string | null,
): Promise<{ mutated: boolean; emailsQueued: number }> {
  let linked = 0;
  await prisma.$transaction(async (tx) => {
    for (const doc of evaluation.documents) {
      if (doc.status === "NOT_AB_ORDER" || doc.status === "SKIPPED_BEFORE_FROM") continue;
      const stored = await tx.autopartSalesDocument.findUnique({
        where: { id: doc.id },
        select: { fulfilmentStatus: true },
      });
      if (!stored) continue;
      if (stored.fulfilmentStatus === "FINANCIAL_LINKED" || stored.fulfilmentStatus === "FULFILMENT_APPLIED") {
        continue;
      }
      const invoice = await ensureInvoice(tx, {
        orderId: order.id,
        companyId: order.companyId,
        documentNumber: doc.documentReference,
        kind: doc.documentType === "CREDIT" ? "CREDIT" : "INVOICE",
        goodsNet: doc.goodsNet,
        documentDate: doc.documentDate,
        customerOrderNumber: order.orderNumber,
      });
      await tx.autopartSalesDocument.update({
        where: { id: doc.id },
        data: {
          fulfilmentStatus: "FINANCIAL_LINKED",
          fulfilmentWarning: "Manual resolution already recorded. Invoice linked without repeating despatch.",
          fulfilmentAppliedAt: new Date(),
          abOrderId: order.id,
          abOrderNumber: order.orderNumber,
        },
      });
      if (invoice) {
        await recordFulfilmentEvent(tx, {
          orderId: order.id,
          kind: "INVOICE_LINKED",
          summary: `Autopart document ${doc.documentReference} linked after manual resolution. Despatch was not repeated.`,
          source: "AUTOPART_504_TRM",
          invoiceId: invoice.id,
          lineQuantitiesKnown: false,
          limitation: "Manual resolution is unchanged.",
        });
        linked += 1;
      }
    }
    if (linked > 0) {
      await tx.order.update({
        where: { id: order.id },
        data: { invoiceEvidence: "LINKED" },
      });
    }
  });
  if (linked > 0) {
    await recordAuditEvent({
      action: "order.invoice_linked_after_manual_resolution",
      entityType: "Order",
      entityId: order.id,
      actorUserId,
      companyId: order.companyId,
      metadata: { documentsLinked: linked, despatchRepeated: false },
    });
  }
  return { mutated: linked > 0, emailsQueued: 0 };
}

async function applyEvaluation(
  evaluation: OrderFulfilmentEvaluation,
  actorUserId: string | null,
  opts?: { suppressCustomerDispatchEmail?: boolean },
): Promise<{ mutated: boolean; emailsQueued: number }> {
  const order = await prisma.order.findUnique({
    where: { id: evaluation.orderId },
    select: {
      id: true,
      companyId: true,
      status: true,
      orderNumber: true,
      archivedAt: true,
      manualResolutionKind: true,
    },
  });
  if (!order || order.archivedAt) return { mutated: false, emailsQueued: 0 };

  if (order.manualResolutionKind !== "NONE") {
    return linkFinancialEvidenceWithoutDespatch(order, evaluation, actorUserId);
  }

  if (!evaluation.canApply && !evaluation.overFulfilment && !evaluation.lineMatchReview) {
    for (const doc of evaluation.documents) {
      await prisma.autopartSalesDocument.update({
        where: { id: doc.id },
        data: {
          fulfilmentStatus: doc.status,
          fulfilmentWarning: doc.warning,
        },
      });
    }
    return { mutated: false, emailsQueued: 0 };
  }

  const fingerprint = fulfilmentFingerprint(evaluation);
  const alreadySame = await prisma.autopartSalesDocument.findFirst({
    where: {
      abOrderId: evaluation.orderId,
      fulfilmentFingerprint: fingerprint,
      fulfilmentStatus: "FULFILMENT_APPLIED",
    },
    select: { id: true },
  });

  const previousStatus = order.status;
  let emailsQueued = 0;
  const evidenceApplied = evaluation.canApply && !alreadySame;
  const emailActions = plan504TrmDispatchNotifications({
    previousStatus,
    evaluation,
    alreadySameFingerprint: Boolean(alreadySame),
  });

  await prisma.$transaction(async (tx) => {
    const despatchDeltas: Array<{
      orderItemId: string;
      variantId: string | null;
      quantity: number;
    }> = [];

    for (const line of evaluation.lines) {
      const item = await tx.orderItem.findFirst({
        where: { id: line.orderItemId, orderId: evaluation.orderId },
        select: { id: true, qty: true, despatchedQty: true, variantId: true },
      });
      if (!item) continue;
      const next = Math.max(item.despatchedQty, Math.min(item.qty, line.despatchedQty));
      const increase = next - item.despatchedQty;
      if (increase > 0) {
        despatchDeltas.push({
          orderItemId: item.id,
          variantId: item.variantId,
          quantity: increase,
        });
      }
      if (next !== item.despatchedQty) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { despatchedQty: next },
        });
      }
    }

    const shouldMoveStatus =
      evaluation.nextStatus != null &&
      (previousStatus === "CONFIRMED" ||
        previousStatus === "PICKING" ||
        previousStatus === "PARTIALLY_DESPATCHED");

    if (shouldMoveStatus && evaluation.nextStatus) {
      await tx.order.update({
        where: { id: evaluation.orderId },
        data: { status: evaluation.nextStatus },
      });
    }

    if (evaluation.canApply && despatchDeltas.length) {
      await consumeReservationsForDespatchDeltas(tx, evaluation.orderId, despatchDeltas);
    }

    let firstInvoiceId: string | null = null;
    for (const doc of evaluation.documents) {
      const status =
        evaluation.canApply && doc.includedInFulfilment ? "FULFILMENT_APPLIED" : doc.status;
      await tx.autopartSalesDocument.update({
        where: { id: doc.id },
        data: {
          fulfilmentStatus: status,
          fulfilmentWarning: doc.warning ?? (evaluation.overFulfilment ? "OVER-FULFILMENT / ORDER DIFFERENCE" : null),
          ...(doc.includedInFulfilment
            ? { fulfilmentFingerprint: fingerprint, fulfilmentAppliedAt: new Date() }
            : {}),
          abOrderId: evaluation.orderId,
          abOrderNumber: evaluation.orderNumber,
        },
      });
      if (evaluation.canApply && doc.includedInFulfilment) {
        const invoice = await ensureInvoice(tx, {
          orderId: evaluation.orderId,
          companyId: order.companyId,
          documentNumber: doc.documentReference,
          kind: doc.documentType === "CREDIT" ? "CREDIT" : "INVOICE",
          goodsNet: doc.goodsNet,
          documentDate: doc.documentDate,
          customerOrderNumber: evaluation.orderNumber,
        });
        if (invoice && !firstInvoiceId) firstInvoiceId = invoice.id;
      }
    }

    if (evidenceApplied) {
      const kind = evaluation.conceptually === "DISPATCHED" ? "DESPATCHED" : "PART_DESPATCHED";
      await recordFulfilmentEvent(tx, {
        orderId: evaluation.orderId,
        kind,
        summary:
          evaluation.conceptually === "DISPATCHED"
            ? "Order despatched from Autopart 504 + TRM21QC evidence"
            : "Order partially despatched from Autopart 504 + TRM21QC evidence",
        source: "AUTOPART_504_TRM",
        invoiceId: firstInvoiceId,
        lineQuantitiesKnown: true,
        limitation: evaluation.warnings[0] ?? null,
        metadata: {
          orderId: evaluation.orderId,
          documents: evaluation.documents
            .filter((d) => d.includedInFulfilment)
            .map((d) => d.documentReference),
          previousStatus,
          newStatus: evaluation.nextStatus ?? previousStatus,
          lines: evaluation.lines.map((l) => ({
            sku: l.sku,
            ordered: l.orderedQty,
            despatched: l.despatchedQty,
            invoiced: l.invoicedQty,
          })),
          warnings: evaluation.warnings,
        },
      });
    }
  });

  if (opts?.suppressCustomerDispatchEmail) {
    if (emailActions.length) {
      await recordAuditEvent({
        action: "order.despatch_email_suppressed",
        entityType: "Order",
        entityId: evaluation.orderId,
        actorUserId: actorUserId,
        metadata: {
          source: "AUTOPART_504_TRM_RECOVERY",
          actions: emailActions.map((action) => action.kind),
          reason: "Recovery of previously skipped invoice — customer already physically fulfilled",
        },
      });
    }
  } else {
    for (const action of emailActions) {
      try {
        if (action.kind === "FULL") {
          const sent = await enqueueOrderDespatchedEmail(evaluation.orderId, {
            remainingAfterBackorder: action.remainingAfterBackorder,
            actorUserId,
          });
          if (sent.queued) emailsQueued += 1;
        } else {
          const sent = await enqueueOrderPartDespatchedEmail({
            orderId: evaluation.orderId,
            invoiceExternalRef: action.invoiceExternalRef,
            lineQuantitiesKnown: true,
            newlyDespatchedLines: action.newlyDespatchedLines,
            stillToComeLines: action.stillToComeLines,
            actorUserId,
          });
          if (sent.queued) emailsQueued += 1;
        }
      } catch (err) {
        await recordAuditEvent({
          action: "order.despatch_email_failed",
          entityType: "Order",
          entityId: evaluation.orderId,
          actorUserId: actorUserId,
          metadata: { error: err instanceof Error ? err.message : "unknown", source: "AUTOPART_504_TRM" },
        });
      }
    }
  }

  if (evidenceApplied) {
    await recordAuditEvent({
      action:
        evaluation.conceptually === "DISPATCHED"
          ? "order.despatched"
          : evaluation.conceptually === "PARTIALLY_DESPATCHED"
            ? "order.partially_despatched"
            : "order.autopart_fulfilment_linked",
      entityType: "Order",
      entityId: evaluation.orderId,
      actorUserId: actorUserId,
      companyId: order.companyId,
      metadata: {
        orderId: evaluation.orderId,
        documents: evaluation.documents
          .filter((d) => d.includedInFulfilment)
          .map((d) => d.documentReference),
        previousStatus,
        newStatus: evaluation.nextStatus ?? previousStatus,
        lineQuantities: evaluation.lines.map((l) => ({
          sku: l.sku,
          ordered: l.orderedQty,
          despatched: l.despatchedQty,
        })),
      },
    });
    if (evaluation.warnings.length) {
      await recordAuditEvent({
        action: "order.fulfilment_review_required",
        entityType: "Order",
        entityId: evaluation.orderId,
        actorUserId: actorUserId,
        companyId: order.companyId,
        metadata: {
          orderId: evaluation.orderId,
          warnings: evaluation.warnings,
          documents: evaluation.documents.map((d) => d.documentReference),
        },
      });
    }
  } else if (evaluation.lineMatchReview || evaluation.financialReview || evaluation.overFulfilment) {
    await recordAuditEvent({
      action: "order.fulfilment_review_required",
      entityType: "Order",
      entityId: evaluation.orderId,
      actorUserId: actorUserId,
      companyId: order.companyId,
      metadata: {
        orderId: evaluation.orderId,
        warnings: evaluation.warnings,
        documents: evaluation.documents.map((d) => d.documentReference),
      },
    });
  }

  return { mutated: Boolean(evidenceApplied), emailsQueued };
}

async function evaluateAll(
  orderIds: string[] | undefined,
  settings: Awaited<ReturnType<typeof read504TrmFulfilmentSettingsReadonly>>,
): Promise<OrderFulfilmentEvaluation[]> {
  const { orders, docs } = await loadCandidateOrders(orderIds);
  const evaluations: OrderFulfilmentEvaluation[] = [];

  for (const order of orders) {
    const related = docs.filter((doc) => {
      const ref = parseExactAbOrderReference(doc.customerOrderNumber ?? doc.abOrderNumber);
      return doc.abOrderId === order.id || (ref != null && ref === order.orderNumber);
    });
    if (related.length === 0) continue;
    const applied = related
      .filter((d) => d.fulfilmentStatus === "FULFILMENT_APPLIED" || d.fulfilmentStatus === "FINANCIAL_LINKED")
      .map((d) => d.documentReference);
    evaluations.push(
      evaluateOrder504TrmFulfilment({
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        items: order.items,
        documents: related.map(toDocInput),
        fulfilmentFrom: settings.fulfilmentFrom,
        alreadyAppliedDocumentNumbers: applied,
      }),
    );
  }

  return evaluations;
}

/**
 * Audited admin preview. Intentionally stamps fulfilmentLastPreviewAt and writes an audit row.
 * For a no-side-effect readiness check use evaluate504TrmFulfilmentReadonly instead.
 */
export async function preview504TrmFulfilment(
  actorUserId: string,
): Promise<Autopart504TrmFulfilmentPreview> {
  await requireFulfilmentAdmin(actorUserId);
  const settings = await read504TrmFulfilmentSettings();
  const evaluations = await evaluateAll(undefined, settings);
  const preview = previewFromEvaluations(settings.fulfilmentMode, settings.fulfilmentFrom, evaluations);
  await prisma.autopartOngoingSalesFeedSettings.update({
    where: { id: "default" },
    data: { fulfilmentLastPreviewAt: new Date() },
  });
  await recordAuditEvent({
    action: "autopart.504_trm_fulfilment_preview",
    entityType: "AutopartOngoingSalesFeedSettings",
    entityId: "default",
    actorUserId,
    metadata: {
      ordersMatched: preview.ordersMatched,
      wouldBecomePartial: preview.wouldBecomePartial,
      wouldBecomeDespatched: preview.wouldBecomeDespatched,
      reviewRequired: preview.reviewRequired,
      sideEffects: ["fulfilmentLastPreviewAt", "audit"],
    },
  });
  return preview;
}

/**
 * Truly read-only fulfilment evaluation for dispatch readiness diagnostics.
 * Does not upsert settings, stamp clocks, write audits, mutate orders, or send email.
 */
export async function evaluate504TrmFulfilmentReadonly(
  actorUserId: string,
  opts?: { orderIds?: string[] },
): Promise<Autopart504TrmFulfilmentPreview & { readOnly: true }> {
  await requireFulfilmentAdmin(actorUserId);
  const settings = await read504TrmFulfilmentSettingsReadonly();
  const evaluations = await evaluateAll(opts?.orderIds, settings);
  return {
    ...previewFromEvaluations(settings.fulfilmentMode, settings.fulfilmentFrom, evaluations),
    readOnly: true,
  };
}

async function run504TrmFulfilmentInner(
  actorUserId: string | null,
  opts?: { orderIds?: string[]; suppressCustomerDispatchEmail?: boolean },
): Promise<Autopart504TrmFulfilmentRunResult> {
  const settings = await read504TrmFulfilmentSettings();
  const evaluations = await evaluateAll(opts?.orderIds, settings);
  const preview = previewFromEvaluations(settings.fulfilmentMode, settings.fulfilmentFrom, evaluations);

  if (settings.fulfilmentMode === "OFF") {
    return { mode: "OFF", applied: false, preview, emailsQueued: 0, ordersMutated: 0 };
  }

  if (settings.fulfilmentMode === "PREVIEW") {
    await prisma.autopartOngoingSalesFeedSettings.update({
      where: { id: "default" },
      data: { fulfilmentLastPreviewAt: new Date() },
    });
    return { mode: "PREVIEW", applied: false, preview, emailsQueued: 0, ordersMutated: 0 };
  }

  let emailsQueued = 0;
  let ordersMutated = 0;
  for (const evaluation of evaluations) {
    const result = await applyEvaluation(
      evaluation,
      actorUserId,
      opts?.suppressCustomerDispatchEmail
        ? { suppressCustomerDispatchEmail: true }
        : undefined,
    );
    emailsQueued += result.emailsQueued;
    if (result.mutated) ordersMutated += 1;
  }

  await prisma.autopartOngoingSalesFeedSettings.update({
    where: { id: "default" },
    data: {
      fulfilmentLastAppliedAt: new Date(),
      fulfilmentLastError: null,
      fulfilmentLastErrorAt: null,
      fulfilmentLastErrorImportRunId: null,
      fulfilmentLastErrorFeed: null,
    },
  });

  return { mode: "ACTIVE", applied: true, preview, emailsQueued, ordersMutated };
}

export async function run504TrmFulfilmentAfterImport(
  actorUserId: string | null,
  opts?: { orderIds?: string[]; suppressCustomerDispatchEmail?: boolean },
): Promise<Autopart504TrmFulfilmentRunResult> {
  return with504TrmFulfilmentExclusive(() => run504TrmFulfilmentInner(actorUserId, opts));
}

/**
 * Apply recovery fulfilment while the caller already holds with504TrmFulfilmentExclusive.
 * Fail closed when orderIds is empty. Verifies company ownership.
 */
export async function run504TrmFulfilmentInnerForRecovery(
  actorUserId: string | null,
  opts: {
    companyId: string;
    orderIds: string[];
    suppressCustomerDispatchEmail: boolean;
  },
): Promise<Autopart504TrmFulfilmentRunResult> {
  if (!opts.orderIds.length) {
    throw new AuthError(
      "Recovery fulfilment requires at least one verified AB order for this customer. No unfiltered fulfilment was run.",
      "VALIDATION",
      400,
    );
  }
  const owned = await prisma.order.findMany({
    where: { id: { in: opts.orderIds }, companyId: opts.companyId },
    select: { id: true },
  });
  if (owned.length !== opts.orderIds.length) {
    throw new AuthError(
      "One or more recovery orders do not belong to the selected customer. Fulfilment was not run.",
      "VALIDATION",
      400,
    );
  }
  return run504TrmFulfilmentInner(actorUserId, {
    orderIds: opts.orderIds,
    suppressCustomerDispatchEmail: opts.suppressCustomerDispatchEmail,
  });
}

/**
 * Customer-scoped recovery fulfilment with its own exclusive lock.
 * Prefer with504TrmFulfilmentExclusive + run504TrmFulfilmentInnerForRecovery when
 * import and fulfilment must share one critical section.
 */
export async function run504TrmFulfilmentForRecovery(
  actorUserId: string | null,
  opts: {
    companyId: string;
    orderIds: string[];
    suppressCustomerDispatchEmail: boolean;
  },
): Promise<Autopart504TrmFulfilmentRunResult> {
  return with504TrmFulfilmentExclusive(() => run504TrmFulfilmentInnerForRecovery(actorUserId, opts));
}

/**
 * Safe staff retry after a visible fulfilment processor failure.
 * Re-runs evaluation/apply only — does not replay 504/TRM financial imports.
 * Duplicate-safe via fulfilment fingerprints and email idempotency keys.
 *
 * Clears the recorded failure only when ACTIVE apply completed successfully.
 * OFF / PREVIEW retries must leave the failure visible — they did not apply.
 */
export async function retry504TrmFulfilmentProcessor(
  actorUserId: string,
  opts?: { importRunId?: string | null },
): Promise<Autopart504TrmFulfilmentRunResult> {
  await requireFulfilmentAdmin(actorUserId);
  try {
    const result = await run504TrmFulfilmentAfterImport(actorUserId);
    const clearedFailure = result.mode === "ACTIVE" && result.applied;
    if (clearedFailure) {
      await clear504TrmFulfilmentProcessorFailure({ importRunId: opts?.importRunId ?? null });
    }
    await recordAuditEvent({
      action: "autopart.504_trm_fulfilment_retry",
      entityType: opts?.importRunId ? "AutopartCustomerImportRun" : "AutopartOngoingSalesFeedSettings",
      entityId: opts?.importRunId ?? "default",
      actorUserId,
      metadata: {
        applied: result.applied,
        mode: result.mode,
        ordersMutated: result.ordersMutated,
        emailsQueued: result.emailsQueued,
        financialImportReplayed: false,
        failureCleared: clearedFailure,
      },
    });
    return result;
  } catch (error) {
    await record504TrmFulfilmentProcessorFailure({
      actorUserId,
      importRunId: opts?.importRunId ?? null,
      feed: "RETRY",
      error,
    });
    throw error;
  }
}

export type AutopartOrderFulfilmentView = {
  statusLabel: string;
  warnings: string[];
  lastUpdated: string | null;
  lines: Array<{
    sku: string;
    name: string;
    orderedQty: number;
    despatchedQty: number;
    remainingQty: number;
    invoicedQty: number;
  }>;
  documents: Array<{
    documentReference: string;
    documentDate: string | null;
    documentType: string;
    fulfilmentStatus: string | null;
    goodsNet: string | null;
    importedAt: string;
    lines: Array<{ sku: string; units: string; description: string | null }>;
  }>;
};

export async function getAutopartFulfilmentForOrder(
  orderId: string,
): Promise<AutopartOrderFulfilmentView | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      updatedAt: true,
      items: { select: { id: true, sku: true, name: true, qty: true, despatchedQty: true } },
    },
  });
  if (!order) return null;

  const docs = await prisma.autopartSalesDocument.findMany({
    where: {
      OR: [{ abOrderId: order.id }, { abOrderNumber: order.orderNumber }, { customerOrderNumber: order.orderNumber }],
    },
    include: {
      lines: {
        select: {
          sku: true,
          units: true,
          salesNet: true,
          documentType: true,
          descriptionSnapshot: true,
        },
        orderBy: { lineNumber: "asc" },
      },
    },
    orderBy: [{ documentDate: "asc" }, { createdAt: "asc" }],
  });

  if (docs.length === 0 && order.items.every((i) => i.despatchedQty === 0)) {
    return {
      statusLabel: "No Autopart fulfilment",
      warnings: [],
      lastUpdated: null,
      lines: order.items.map((i) => ({
        sku: i.sku,
        name: i.name,
        orderedQty: i.qty,
        despatchedQty: i.despatchedQty,
        remainingQty: Math.max(0, i.qty - i.despatchedQty),
        invoicedQty: 0,
      })),
      documents: [],
    };
  }

  const settings = await read504TrmFulfilmentSettings();
  const evaluation = evaluateOrder504TrmFulfilment({
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderStatus: order.status,
    items: order.items,
    documents: docs.map(toDocInput),
    fulfilmentFrom: settings.fulfilmentFrom,
    alreadyAppliedDocumentNumbers: docs
      .filter((d) => d.fulfilmentStatus === "FULFILMENT_APPLIED")
      .map((d) => d.documentReference),
  });

  const statusLabel =
    order.status === "DISPATCHED" || order.status === "DELIVERED"
      ? "Despatched"
      : order.status === "PARTIALLY_DESPATCHED"
        ? "Partially despatched"
        : evaluation.waitingForTrm
          ? "Waiting for line detail"
          : evaluation.waitingFor504
            ? "Waiting for 504"
            : "No Autopart fulfilment";

  const last = docs.reduce<Date | null>((acc, d) => {
    const t = d.fulfilmentAppliedAt ?? d.updatedAt ?? d.createdAt;
    if (!acc || t > acc) return t;
    return acc;
  }, null);

  return {
    statusLabel,
    warnings: evaluation.warnings,
    lastUpdated: last?.toISOString() ?? order.updatedAt.toISOString(),
    lines: evaluation.lines.map((l) => {
      const stored = order.items.find((item) => item.id === l.orderItemId)?.despatchedQty ?? 0;
      const despatchedQty = Math.max(stored, l.despatchedQty);
      return {
        sku: l.sku,
        name: l.name,
        orderedQty: l.orderedQty,
        despatchedQty,
        remainingQty: Math.max(0, l.orderedQty - despatchedQty),
        invoicedQty: l.invoicedQty,
      };
    }),
    documents: docs.map((d) => ({
      documentReference: d.documentReference,
      documentDate: d.documentDate?.toISOString() ?? null,
      documentType: d.documentType,
      fulfilmentStatus: d.fulfilmentStatus,
      goodsNet: d.goodsNet != null ? String(d.goodsNet) : null,
      importedAt: d.updatedAt.toISOString(),
      lines: d.lines.map((l) => ({
        sku: l.sku,
        units: String(l.units),
        description: l.descriptionSnapshot,
      })),
    })),
  };
}
