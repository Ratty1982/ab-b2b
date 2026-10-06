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

import type { Autopart504TrmFulfilmentMode, Autopart504cRuntimeMode, Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { recordAuditEvent } from "@/server/audit/record";
import { parseExactAbOrderReference } from "@/domain/autopart-504-trm-fulfilment";
import {
  evaluateOrder504TrmFulfilment,
  fulfilmentFingerprint,
  type FulfilmentDocumentInput,
  type OrderFulfilmentEvaluation,
} from "@/domain/autopart-504-trm-fulfilment";
import { recordFulfilmentEvent } from "@/server/orders/fulfilment";
import { enqueueOrderDespatchedEmail } from "@/server/orders/despatch-email";
import { enqueueOrderPartDespatchedEmail } from "@/server/orders/part-despatch-email";
import { parseMoney, moneyToString, moneyZero } from "@/domain/money";

const ADVISORY_LOCK_KEY = 504_210_504;
let applying: Promise<Autopart504TrmFulfilmentRunResult> | null = null;

export type Autopart504TrmFulfilmentPublicSettings = {
  fulfilmentMode: Autopart504TrmFulfilmentMode;
  fulfilmentFrom: string | null;
  fulfilmentLastPreviewAt: string | null;
  fulfilmentLastAppliedAt: string | null;
  runtime504c: Autopart504cRuntimeMode;
  bothMutatorsPrevented: boolean;
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
  if (!hasPermission(profile, "admin.access") && !hasPermission(profile, "orders.edit")) {
    throw new AuthError("Not permitted to manage Autopart fulfilment", "FORBIDDEN", 403);
  }
  return profile;
}

export async function read504TrmFulfilmentSettings(): Promise<{
  fulfilmentMode: Autopart504TrmFulfilmentMode;
  fulfilmentFrom: Date | null;
  fulfilmentLastPreviewAt: Date | null;
  fulfilmentLastAppliedAt: Date | null;
  runtime504c: Autopart504cRuntimeMode;
}> {
  const ongoing = await prisma.autopartOngoingSalesFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default", fulfilmentFrom: new Date() },
    update: {},
  });
  const c504 = await prisma.autopart504cFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  return {
    fulfilmentMode: ongoing.fulfilmentMode,
    fulfilmentFrom: ongoing.fulfilmentFrom,
    fulfilmentLastPreviewAt: ongoing.fulfilmentLastPreviewAt,
    fulfilmentLastAppliedAt: ongoing.fulfilmentLastAppliedAt,
    runtime504c: c504.runtimeMode,
  };
}

export async function get504TrmFulfilmentSettingsForActor(
  userId: string,
): Promise<Autopart504TrmFulfilmentPublicSettings> {
  await requireFulfilmentAdmin(userId);
  const row = await read504TrmFulfilmentSettings();
  return {
    fulfilmentMode: row.fulfilmentMode,
    fulfilmentFrom: row.fulfilmentFrom?.toISOString() ?? null,
    fulfilmentLastPreviewAt: row.fulfilmentLastPreviewAt?.toISOString() ?? null,
    fulfilmentLastAppliedAt: row.fulfilmentLastAppliedAt?.toISOString() ?? null,
    runtime504c: row.runtime504c,
    bothMutatorsPrevented: row.fulfilmentMode !== "ACTIVE" || row.runtime504c === "RETIRED",
  };
}

export function shouldBridge504To504c(mode: Autopart504TrmFulfilmentMode): boolean {
  return mode === "OFF";
}

export function is504cRuntimeRetired(mode: Autopart504cRuntimeMode): boolean {
  return mode === "RETIRED";
}

export async function update504TrmFulfilmentSettings(
  userId: string,
  patch: {
    fulfilmentMode?: Autopart504TrmFulfilmentMode;
    fulfilmentFrom?: string | null;
    retire504c?: boolean;
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

  const retire504c = patch.retire504c === true || nextMode === "ACTIVE";
  if (nextMode === "ACTIVE" && !retire504c) {
    throw new AuthError(
      "504/TRM fulfilment cannot be ACTIVE while 504C still mutates orders. Retire 504C first.",
      "FULFILMENT_MUTATOR_CONFLICT",
      400,
    );
  }

  const before = {
    fulfilmentMode: current.fulfilmentMode,
    runtime504c: current.runtime504c,
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

  if (retire504c) {
    await prisma.autopart504cFeedSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        runtimeMode: "RETIRED",
        enabled: false,
        updatedByUserId: userId,
      },
      update: {
        runtimeMode: "RETIRED",
        enabled: false,
        updatedByUserId: userId,
      },
    });
  }

  await recordAuditEvent({
    action: "autopart.504_trm_fulfilment_switch",
    entityType: "AutopartOngoingSalesFeedSettings",
    entityId: "default",
    actorUserId: userId,
    before,
    after: {
      fulfilmentMode: nextMode,
      runtime504c: retire504c ? "RETIRED" : current.runtime504c,
      fulfilmentFrom: nextFrom?.toISOString() ?? null,
    },
  });

  return {
    fulfilmentMode: ongoing.fulfilmentMode,
    fulfilmentFrom: ongoing.fulfilmentFrom?.toISOString() ?? null,
    fulfilmentLastPreviewAt: ongoing.fulfilmentLastPreviewAt?.toISOString() ?? null,
    fulfilmentLastAppliedAt: ongoing.fulfilmentLastAppliedAt?.toISOString() ?? null,
    runtime504c: retire504c ? ("RETIRED" as const) : current.runtime504c,
    bothMutatorsPrevented: nextMode !== "ACTIVE" || retire504c,
  };
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
          in: ["CONFIRMED", "PICKING", "PARTIALLY_DESPATCHED", "DISPATCHED", "DELIVERED", "CANCELLED", "ON_HOLD"],
        },
      };

  const docs = await prisma.autopartSalesDocument.findMany({
    where: {
      OR: [
        { abOrderId: { not: null } },
        { abOrderNumber: { startsWith: "AB-" } },
        { customerOrderNumber: { startsWith: "AB-" } },
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

async function consumeReservations(tx: Prisma.TransactionClient, orderId: string) {
  const reservations = await tx.orderStockReservation.findMany({
    where: { orderId, status: "ACTIVE" },
    select: { id: true, inventoryId: true, quantity: true },
  });
  for (const res of reservations) {
    await tx.orderStockReservation.update({
      where: { id: res.id },
      data: { status: "CONSUMED", consumedAt: new Date() },
    });
    await tx.inventory.update({
      where: { id: res.inventoryId },
      data: { qtyReserved: { decrement: res.quantity } },
    });
  }
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

async function applyEvaluation(
  evaluation: OrderFulfilmentEvaluation,
  actorUserId: string | null,
): Promise<{ mutated: boolean; emailsQueued: number }> {
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

  const order = await prisma.order.findUnique({
    where: { id: evaluation.orderId },
    select: {
      id: true,
      companyId: true,
      status: true,
      orderNumber: true,
    },
  });
  if (!order) return { mutated: false, emailsQueued: 0 };

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
  const emailActions: Array<
    | { kind: "FULL"; remainingAfterBackorder: boolean }
    | { kind: "PART"; invoiceExternalRef: string }
  > = [];

  await prisma.$transaction(async (tx) => {
    for (const line of evaluation.lines) {
      const item = await tx.orderItem.findFirst({
        where: { id: line.orderItemId, orderId: evaluation.orderId },
        select: { id: true, qty: true, despatchedQty: true },
      });
      if (!item) continue;
      const next = Math.max(item.despatchedQty, Math.min(item.qty, line.despatchedQty));
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

    if (
      evaluation.canApply &&
      (previousStatus === "CONFIRMED" || previousStatus === "PICKING")
    ) {
      await consumeReservations(tx, evaluation.orderId);
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

    if (evaluation.canApply) {
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

  const statusChanged =
    evaluation.nextStatus != null &&
    evaluation.nextStatus !== previousStatus &&
    evaluation.canApply;
  const isNewFulfilment = statusChanged && !alreadySame;

  if (isNewFulfilment) {
    if (evaluation.conceptually === "DISPATCHED") {
      const remainingAfterBackorder = previousStatus === "PARTIALLY_DESPATCHED";
      emailActions.push({ kind: "FULL", remainingAfterBackorder });
    } else if (evaluation.conceptually === "PARTIALLY_DESPATCHED") {
      const refs = evaluation.newInvoiceDocumentNumbers.length
        ? evaluation.newInvoiceDocumentNumbers
        : evaluation.documents.filter((d) => d.includedInFulfilment).map((d) => d.documentReference);
      for (const ref of refs) {
        emailActions.push({ kind: "PART", invoiceExternalRef: ref });
      }
    }
  }

  if (previousStatus === "CANCELLED") {
    emailActions.length = 0;
  }

  for (const action of emailActions) {
    try {
      if (action.kind === "FULL") {
        const sent = await enqueueOrderDespatchedEmail(evaluation.orderId, {
          remainingAfterBackorder: action.remainingAfterBackorder,
        });
        if (sent.queued) emailsQueued += 1;
      } else {
        const sent = await enqueueOrderPartDespatchedEmail({
          orderId: evaluation.orderId,
          invoiceExternalRef: action.invoiceExternalRef,
          lineQuantitiesKnown: true,
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

  if (isNewFulfilment) {
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

  return { mutated: Boolean(isNewFulfilment || (evaluation.canApply && !alreadySame)), emailsQueued };
}

async function evaluateAll(orderIds?: string[]): Promise<{
  settings: Awaited<ReturnType<typeof read504TrmFulfilmentSettings>>;
  evaluations: OrderFulfilmentEvaluation[];
}> {
  const settings = await read504TrmFulfilmentSettings();
  const { orders, docs } = await loadCandidateOrders(orderIds);
  const evaluations: OrderFulfilmentEvaluation[] = [];

  for (const order of orders) {
    const related = docs.filter((doc) => {
      const ref = parseExactAbOrderReference(doc.customerOrderNumber ?? doc.abOrderNumber);
      return doc.abOrderId === order.id || (ref != null && ref === order.orderNumber);
    });
    if (related.length === 0) continue;
    const applied = related
      .filter((d) => d.fulfilmentStatus === "FULFILMENT_APPLIED")
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

  return { settings, evaluations };
}

export async function preview504TrmFulfilment(
  actorUserId: string,
): Promise<Autopart504TrmFulfilmentPreview> {
  await requireFulfilmentAdmin(actorUserId);
  const { settings, evaluations } = await evaluateAll();
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
    },
  });
  return preview;
}

async function run504TrmFulfilmentInner(
  actorUserId: string | null,
  opts?: { orderIds?: string[] },
): Promise<Autopart504TrmFulfilmentRunResult> {
  const { settings, evaluations } = await evaluateAll(opts?.orderIds);
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

  if (settings.runtime504c !== "RETIRED") {
    await recordAuditEvent({
      action: "autopart.504_trm_fulfilment_blocked_504c_active",
      entityType: "AutopartOngoingSalesFeedSettings",
      entityId: "default",
      actorUserId,
      metadata: { reason: "504C still ACTIVE — refusing dual mutation" },
    });
    return { mode: "ACTIVE", applied: false, preview, emailsQueued: 0, ordersMutated: 0 };
  }

  let emailsQueued = 0;
  let ordersMutated = 0;
  for (const evaluation of evaluations) {
    const result = await applyEvaluation(evaluation, actorUserId);
    emailsQueued += result.emailsQueued;
    if (result.mutated) ordersMutated += 1;
  }

  await prisma.autopartOngoingSalesFeedSettings.update({
    where: { id: "default" },
    data: { fulfilmentLastAppliedAt: new Date() },
  });

  return { mode: "ACTIVE", applied: true, preview, emailsQueued, ordersMutated };
}

export async function run504TrmFulfilmentAfterImport(
  actorUserId: string | null,
  opts?: { orderIds?: string[] },
): Promise<Autopart504TrmFulfilmentRunResult> {
  if (applying) return applying;
  applying = (async () => {
    await prisma.$executeRaw`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`;
    try {
      return await run504TrmFulfilmentInner(actorUserId, opts);
    } finally {
      await prisma.$executeRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`.catch(() => undefined);
    }
  })();
  try {
    return await applying;
  } finally {
    applying = null;
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
