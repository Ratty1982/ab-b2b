/**
 * Controlled customer-data reset.
 * planCustomerDataReset is read-only.
 * executeCustomerDataReset is only reachable from scripts/customer-data-reset.ts
 * and refuses to run until the backup, restore, and confirmation gates pass.
 * It is not imported by server startup, the container entrypoint, or a route.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import {
  NOT_RESET,
  PRESERVED,
  RESET,
  RESET_CHECKLIST,
  evaluateResetGates,
  orderResetDecision,
  type BackupProof,
  type OrderExportEvidence,
} from "@/domain/customer-data-reset";

type Db = PrismaClient | Prisma.TransactionClient;

const ONGOING_DOCUMENT_SOURCES = ["ONGOING_504", "ONGOING_TRM21QC", "ONGOING_504_BRIDGE"] as const;

export type FeedFlags = {
  ongoingSalesEnabled: boolean | null;
  invoiceFeedEnabled: boolean | null;
  backorderFeedEnabled: boolean | null;
};

export type ResetOrderRow = OrderExportEvidence & {
  orderId: string;
  customerName: string;
  hold: boolean;
  summary: string;
};

export type ResetPlan = {
  mode: "dry-run";
  database: string | null;
  preserved: typeof PRESERVED;
  reset: typeof RESET;
  notReset: typeof NOT_RESET;
  checklist: typeof RESET_CHECKLIST;
  counts: {
    preserved: Record<string, number>;
    reset: Record<string, number>;
    review: Record<string, number>;
  };
  companies: {
    keep: number;
    review: number;
    reviewSample: Array<{ id: string; name: string; status: string }>;
  };
  portalUsers: number;
  staffUsers: number;
  orders: ResetOrderRow[];
  feeds: FeedFlags;
  ongoingProtected: { lines: number; documents: number; runs: number };
  externalConsequences: string[];
};

async function feedFlags(db: Db): Promise<FeedFlags> {
  const [ongoing, invoices, backorders] = await Promise.all([
    db.autopartOngoingSalesFeedSettings.findUnique({ where: { id: "default" }, select: { enabled: true } }),
    db.autopart504cFeedSettings.findUnique({ where: { id: "default" }, select: { enabled: true } }),
    db.autopartBackorderFeedSettings.findUnique({ where: { id: "default" }, select: { enabled: true } }),
  ]);
  return {
    ongoingSalesEnabled: ongoing?.enabled ?? null,
    invoiceFeedEnabled: invoices?.enabled ?? null,
    backorderFeedEnabled: backorders?.enabled ?? null,
  };
}

async function scopeCounts(db: Db) {
  const historicDocumentWhere = {
    NOT: {
      OR: [
        { has504: true },
        { hasTrm21qc: true },
        { source: { in: [...ONGOING_DOCUMENT_SOURCES] } },
      ],
    },
  };
  const [
    autopartAccounts,
    companies,
    staffUsers,
    portalUsers,
    products,
    surveyResponses,
    aliases,
    masterBatches,
    ongoingLines,
    ongoingDocuments,
    ongoingRuns,
    invoiceLines,
    ledgerRows,
    documentMatches,
    salesBatches,
    historicLines,
    historicDocuments,
    historyRuns,
    baskets,
    drafts,
    quotes,
    orders,
    leads,
    opportunities,
    activities,
    tasks,
    notes,
  ] = await Promise.all([
    db.autopartAccount.count(),
    db.company.count(),
    db.user.count({ where: { actorType: "INTERNAL" } }),
    db.user.count({ where: { actorType: "TRADE" } }),
    db.product.count(),
    db.customerSurveyResponse.count(),
    db.autopartCustomerAccountAlias.count(),
    db.autopartImportBatch.count({ where: { kind: "CUSTOMER_MASTER" } }),
    db.autopartSalesLine.count({ where: { source: "ONGOING_TRM21QC" } }),
    db.autopartSalesDocument.count({
      where: {
        OR: [
          { has504: true },
          { hasTrm21qc: true },
          { source: { in: [...ONGOING_DOCUMENT_SOURCES] } },
        ],
      },
    }),
    db.autopartCustomerImportRun.count({
      where: { type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] } },
    }),
    db.autopartInvoiceLine.count(),
    db.autopartLedgerTransaction.count(),
    db.autopartDocumentMatch.count(),
    db.autopartImportBatch.count({ where: { kind: { in: ["INVOICE_LINES", "LEDGER"] } } }),
    db.autopartSalesLine.count({ where: { source: { not: "ONGOING_TRM21QC" } } }),
    db.autopartSalesDocument.count({ where: historicDocumentWhere }),
    db.autopartCustomerImportRun.count({ where: { type: "HISTORY_561L_SLRB" } }),
    db.basket.count(),
    db.salesOrderDraft.count(),
    db.quote.count(),
    db.order.count(),
    db.lead.count(),
    db.opportunity.count(),
    db.activity.count(),
    db.task.count(),
    db.note.count(),
  ]);

  return {
    preserved: {
      AutopartAccount: autopartAccounts,
      Company: companies,
      staffUsers,
      products,
      CustomerSurveyResponse: surveyResponses,
      AutopartCustomerAccountAlias: aliases,
      customerMasterBatches: masterBatches,
      ongoingSalesLines: ongoingLines,
      ongoingSalesDocuments: ongoingDocuments,
      ongoingImportRuns: ongoingRuns,
    },
    reset: {
      AutopartInvoiceLine: invoiceLines,
      AutopartLedgerTransaction: ledgerRows,
      AutopartDocumentMatch: documentMatches,
      historicalSalesBatches: salesBatches,
      historicSalesLines: historicLines,
      historicSalesDocuments: historicDocuments,
      historicImportRuns: historyRuns,
      Basket: baskets,
      SalesOrderDraft: drafts,
      Quote: quotes,
      Order: orders,
    },
    review: {
      Lead: leads,
      Opportunity: opportunities,
      Activity: activities,
      Task: tasks,
      Note: notes,
    },
    ongoingProtected: { lines: ongoingLines, documents: ongoingDocuments, runs: ongoingRuns },
  };
}

async function loadOrders(db: Db, acknowledgeExported: boolean): Promise<ResetOrderRow[]> {
  const orders = await db.order.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      autopartExportStatus: true,
      autopartExportCount: true,
      externalRef: true,
      company: { select: { name: true } },
      autopartExportBatch: { select: { reference: true } },
      fulfilmentEvents: { select: { source: true } },
    },
  });
  return orders.map((order) => {
    const evidence: OrderExportEvidence = {
      orderNumber: order.orderNumber,
      status: order.status,
      autopartExportStatus: order.autopartExportStatus,
      autopartExportCount: order.autopartExportCount,
      exportBatchReference: order.autopartExportBatch?.reference ?? null,
      externalRef: order.externalRef,
      fulfilmentSources: [...new Set(order.fulfilmentEvents.map((event) => event.source))],
    };
    const decision = orderResetDecision(evidence, acknowledgeExported);
    return {
      ...evidence,
      orderId: order.id,
      customerName: order.company.name,
      hold: decision.hold,
      summary: decision.summary,
    };
  });
}

export async function planCustomerDataReset(
  db: Db = prisma,
  options?: { acknowledgeExportedOrders?: boolean },
): Promise<ResetPlan> {
  const acknowledge = options?.acknowledgeExportedOrders ?? false;
  const [counts, orders, feeds, keep, reviewSample, review, trade, internal] = await Promise.all([
    scopeCounts(db),
    loadOrders(db, acknowledge),
    feedFlags(db),
    db.company.count({
      where: {
        OR: [{ autopartCustomerCodeVerifiedAt: { not: null } }, { autopartAccounts: { some: {} } }],
      },
    }),
    db.company.findMany({
      where: {
        autopartCustomerCodeVerifiedAt: null,
        autopartAccounts: { none: {} },
      },
      orderBy: { name: "asc" },
      take: 30,
      select: { id: true, name: true, status: true },
    }),
    db.company.count({
      where: { autopartCustomerCodeVerifiedAt: null, autopartAccounts: { none: {} } },
    }),
    db.user.count({ where: { actorType: "TRADE" } }),
    db.user.count({ where: { actorType: "INTERNAL" } }),
  ]);

  return {
    mode: "dry-run",
    database: null,
    preserved: PRESERVED,
    reset: RESET,
    notReset: NOT_RESET,
    checklist: RESET_CHECKLIST,
    counts: {
      preserved: counts.preserved,
      reset: counts.reset,
      review: counts.review,
    },
    companies: { keep, review, reviewSample },
    portalUsers: trade,
    staffUsers: internal,
    orders,
    feeds,
    ongoingProtected: counts.ongoingProtected,
    externalConsequences: orders.map((order) => order.summary),
  };
}

async function pauseSalesImports(db: PrismaClient): Promise<FeedFlags> {
  const before = await feedFlags(db);
  if (before.ongoingSalesEnabled) {
    await db.autopartOngoingSalesFeedSettings.update({
      where: { id: "default" },
      data: { enabled: false },
    });
  }
  if (before.invoiceFeedEnabled) {
    await db.autopart504cFeedSettings.update({
      where: { id: "default" },
      data: { enabled: false },
    });
  }
  return before;
}

export async function executeCustomerDataReset(input: {
  startedBy: "cli";
  confirmation: string | null;
  targetDatabase: string | null;
  actualDatabase: string | null;
  backupProof: BackupProof | null;
  restoreCheckOk: boolean;
  acknowledgeExportedOrders: boolean;
  ongoingResetRequested: boolean;
  now?: Date;
}): Promise<{ ok: true; report: Record<string, unknown> } | { ok: false; reason: string }> {
  if (input.startedBy !== "cli") {
    return { ok: false, reason: "The reset can only be started from scripts/customer-data-reset.ts." };
  }
  const gate = evaluateResetGates({
    executeRequested: true,
    confirmation: input.confirmation,
    targetDatabase: input.targetDatabase,
    actualDatabase: input.actualDatabase,
    backupProof: input.backupProof,
    restoreCheckOk: input.restoreCheckOk,
    ongoingResetRequested: input.ongoingResetRequested,
    ...(input.now ? { now: input.now } : {}),
  });
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const before = await planCustomerDataReset(prisma, {
    acknowledgeExportedOrders: input.acknowledgeExportedOrders,
  });
  const beforePreserve = { ...before.counts.preserved };
  const pausedFeeds = await pauseSalesImports(prisma);
  const removable = before.orders.filter((order) => !order.hold);
  const held = before.orders.filter((order) => order.hold);

  try {
    await prisma.$transaction(
      async (tx) => {
        const orderIds = removable.map((order) => order.orderId);
        const orderNumbers = removable.map((order) => order.orderNumber);
        if (orderIds.length) {
          await tx.autopartSalesDocument.updateMany({
            where: {
              OR: [{ abOrderId: { in: orderIds } }, { abOrderNumber: { in: orderNumbers } }],
            },
            data: { abOrderId: null, abOrderNumber: null },
          });
          await tx.invoice.deleteMany({ where: { orderId: { in: orderIds } } });
          await tx.salesOrderDraft.deleteMany({
            where: {
              OR: [{ editingOrderId: { in: orderIds } }, { placedOrderId: { in: orderIds } }],
            },
          });
        }
        await tx.quote.deleteMany({});
        await tx.salesOrderDraft.deleteMany({});
        await tx.basket.deleteMany({});
        if (orderIds.length) {
          await tx.retiredOrderNumber.createMany({
            data: removable.map((order) => ({
              orderNumber: order.orderNumber,
              orderId: order.orderId,
              previousStatus: order.status,
              reason: "Customer data reset",
            })),
            skipDuplicates: true,
          });
          await tx.transactionalEmail.deleteMany({
            where: { entityType: "Order", entityId: { in: orderIds } },
          });
          await tx.order.deleteMany({ where: { id: { in: orderIds } } });
        }
        await tx.transactionalEmail.deleteMany({ where: { entityType: "Quote" } });

        await tx.autopartSalesLine.deleteMany({ where: { source: { not: "ONGOING_TRM21QC" } } });
        await tx.autopartSalesDocument.deleteMany({
          where: {
            NOT: {
              OR: [
                { has504: true },
                { hasTrm21qc: true },
                { source: { in: [...ONGOING_DOCUMENT_SOURCES] } },
              ],
            },
          },
        });
        await tx.autopartCustomerImportRun.deleteMany({ where: { type: "HISTORY_561L_SLRB" } });
        await tx.autopartDocumentMatch.deleteMany({});
        await tx.autopartInvoiceLine.deleteMany({});
        await tx.autopartLedgerTransaction.deleteMany({});
        await tx.autopartImportBatch.deleteMany({
          where: { kind: { in: ["INVOICE_LINES", "LEDGER"] } },
        });
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
  } catch (error) {
    return {
      ok: false,
      reason: `Reset stopped and the database transaction was rolled back. Sales import schedules that were on are now off. Previous ongoing sales schedule: ${String(pausedFeeds.ongoingSalesEnabled)}. Previous invoice schedule: ${String(pausedFeeds.invoiceFeedEnabled)}. ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }

  const after = await scopeCounts(prisma);
  const preserveKeys = Object.keys(after.preserved) as Array<keyof typeof after.preserved>;
  const preserveDrift = preserveKeys.filter((key) => beforePreserve[key] !== after.preserved[key]);

  return {
    ok: true,
    report: {
      mode: "execute",
      removedOrders: removable.map((order) => order.orderNumber),
      heldOrders: held.map((order) => ({ orderNumber: order.orderNumber, summary: order.summary })),
      externalConsequences: before.externalConsequences,
      feedsBefore: pausedFeeds,
      feedsLeftOff: ["ongoing sales", "invoice feed"],
      backorderFeedUnchanged: pausedFeeds.backorderFeedEnabled,
      before: before.counts,
      after: { preserved: after.preserved, reset: after.reset },
      preserveDrift,
      checklist: RESET_CHECKLIST,
      rollback: [
        "Restore the tested backup over this database.",
        "Do not run the reset again after a restore.",
        "Turn the daily sales schedules back on only if they were on in feedsBefore and the restored data still needs them.",
      ],
    },
  };
}
