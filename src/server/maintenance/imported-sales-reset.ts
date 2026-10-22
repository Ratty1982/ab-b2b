/**
 * Read-only plan and gated execute for imported ongoing Autopart sales.
 * Not imported by application startup. Execute is only reached from
 * scripts/imported-sales-reset.ts after the backup gates pass.
 * It does not call the historical sales cleanup.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import {
  IMPORTED_SALES_APPROVAL_GATES,
  IMPORTED_SALES_EFFECTS,
  IMPORTED_SALES_PRESERVED,
  IMPORTED_SALES_RECOVERY_WINDOW,
  IMPORTED_SALES_REMOVED,
  evaluateImportedSalesResetGates,
  type BackupProof,
} from "@/domain/imported-sales-reset";

type Db = PrismaClient | Prisma.TransactionClient;

const ONGOING_SOURCES = ["ONGOING_504", "ONGOING_TRM21QC", "ONGOING_504_BRIDGE"] as const;

const recoveryWindowWhere: Prisma.AutopartSalesDocumentWhereInput = {
  has504: true,
  documentDate: {
    gte: new Date(`${IMPORTED_SALES_RECOVERY_WINDOW.from}T00:00:00.000Z`),
    lt: new Date("2026-10-20T00:00:00.000Z"),
  },
};

const ongoingDocumentWhere: Prisma.AutopartSalesDocumentWhereInput = {
  OR: [
    { has504: true },
    { hasTrm21qc: true },
    { source: { in: [...ONGOING_SOURCES] } },
  ],
};

const removableDocumentWhere: Prisma.AutopartSalesDocumentWhereInput = {
  AND: [ongoingDocumentWhere, { NOT: recoveryWindowWhere }],
};

const removableLineWhere: Prisma.AutopartSalesLineWhereInput = {
  AND: [
    { NOT: { document: { is: recoveryWindowWhere } } },
    {
      OR: [{ source: "ONGOING_TRM21QC" }, { document: { is: ongoingDocumentWhere } }],
    },
  ],
};

const removableRunWhere: Prisma.AutopartCustomerImportRunWhereInput = {
  type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] },
  documents: { none: {} },
  lines: { none: {} },
};

export type ImportedSalesResetPlan = {
  mode: "dry-run";
  recoveryWindow: typeof IMPORTED_SALES_RECOVERY_WINDOW;
  preserved: typeof IMPORTED_SALES_PRESERVED;
  removed: typeof IMPORTED_SALES_REMOVED;
  effects: typeof IMPORTED_SALES_EFFECTS;
  approvalGates: typeof IMPORTED_SALES_APPROVAL_GATES;
  counts: {
    preserved: Record<string, number>;
    removed: Record<string, number>;
  };
  protectedDocuments: Array<{ documentReference: string; documentType: string; documentDate: string | null }>;
  removableDocuments: Array<{ documentReference: string; documentType: string; source: string }>;
};

async function preservedCounts(db: Db) {
  const [
    companies,
    prospects,
    autopartAccounts,
    aliases,
    customerPrices,
    products,
    inventory,
    orders,
    invoices,
    reservations,
    permissions,
    recoveryDocuments,
    historicalDocuments,
    historicalLines,
  ] = await Promise.all([
    db.company.count(),
    db.company.count({ where: { status: "PROSPECT" } }),
    db.autopartAccount.count(),
    db.autopartCustomerAccountAlias.count(),
    db.customerPrice.count(),
    db.product.count(),
    db.inventory.count(),
    db.order.count(),
    db.invoice.count(),
    db.orderStockReservation.count(),
    db.permission.count(),
    db.autopartSalesDocument.count({ where: recoveryWindowWhere }),
    db.autopartSalesDocument.count({ where: { NOT: ongoingDocumentWhere } }),
    db.autopartSalesLine.count({ where: { source: { not: "ONGOING_TRM21QC" }, NOT: { document: { is: ongoingDocumentWhere } } } }),
  ]);
  return {
    companies,
    prospects,
    autopartAccounts,
    aliases,
    customerPrices,
    products,
    inventory,
    orders,
    invoices,
    reservations,
    permissions,
    recoveryDocuments,
    historicalDocuments,
    historicalLines,
  };
}

export async function planImportedSalesReset(db: Db = prisma): Promise<ImportedSalesResetPlan> {
  const [preserved, removableDocuments, removableLines, removableRuns, protectedSample, removableSample] =
    await Promise.all([
      preservedCounts(db),
      db.autopartSalesDocument.count({ where: removableDocumentWhere }),
      db.autopartSalesLine.count({ where: removableLineWhere }),
      db.autopartCustomerImportRun.count({
        where: {
          type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] },
          documents: { none: recoveryWindowWhere },
          lines: { none: { document: { is: recoveryWindowWhere } } },
        },
      }),
      db.autopartSalesDocument.findMany({
        where: recoveryWindowWhere,
        select: { documentReference: true, documentType: true, documentDate: true },
        orderBy: { documentReference: "asc" },
        take: 15,
      }),
      db.autopartSalesDocument.findMany({
        where: removableDocumentWhere,
        select: { documentReference: true, documentType: true, source: true },
        orderBy: { documentReference: "asc" },
        take: 15,
      }),
    ]);

  return {
    mode: "dry-run",
    recoveryWindow: IMPORTED_SALES_RECOVERY_WINDOW,
    preserved: IMPORTED_SALES_PRESERVED,
    removed: IMPORTED_SALES_REMOVED,
    effects: IMPORTED_SALES_EFFECTS,
    approvalGates: IMPORTED_SALES_APPROVAL_GATES,
    counts: {
      preserved,
      removed: {
        ongoingDocuments: removableDocuments,
        ongoingLines: removableLines,
        ongoingRunsWithoutRecoveryDocuments: removableRuns,
      },
    },
    protectedDocuments: protectedSample.map((row) => ({
      documentReference: row.documentReference,
      documentType: row.documentType,
      documentDate: row.documentDate?.toISOString().slice(0, 10) ?? null,
    })),
    removableDocuments: removableSample,
  };
}

export async function executeImportedSalesReset(
  input: {
    db?: Db;
    confirmation: string | null;
    targetDatabase: string | null;
    actualDatabase: string | null;
    backupProof: BackupProof | null;
    restoreCheckOk: boolean;
    duringBootstrap?: boolean;
    allowProductionDatabase?: boolean;
    now?: Date;
    actorUserId?: string | null;
  },
) {
  const gate = evaluateImportedSalesResetGates({
    executeRequested: true,
    confirmation: input.confirmation,
    targetDatabase: input.targetDatabase,
    actualDatabase: input.actualDatabase,
    backupProof: input.backupProof,
    restoreCheckOk: input.restoreCheckOk,
    ...(input.duringBootstrap != null ? { duringBootstrap: input.duringBootstrap } : {}),
    ...(input.allowProductionDatabase != null
      ? { allowProductionDatabase: input.allowProductionDatabase }
      : {}),
    ...(input.now != null ? { now: input.now } : {}),
  });
  if (!gate.ok) return gate;

  const db = input.db ?? prisma;
  const before = await planImportedSalesReset(db);
  const lines = await db.autopartSalesLine.deleteMany({ where: removableLineWhere });
  const documents = await db.autopartSalesDocument.deleteMany({ where: removableDocumentWhere });
  const runs = await db.autopartCustomerImportRun.deleteMany({ where: removableRunWhere });
  const after = await preservedCounts(db);

  const report = {
    mode: "execute" as const,
    deleted: {
      lines: lines.count,
      documents: documents.count,
      runs: runs.count,
    },
    planned: before.counts.removed,
    preservedBefore: before.counts.preserved,
    preservedAfter: after,
  };

  if (input.db == null) {
    await recordAuditEvent({
      action: "autopart.imported_sales_reset_executed",
      entityType: "AutopartSalesDocument",
      entityId: null,
      actorUserId: input.actorUserId ?? null,
      metadata: report,
    });
  }

  return { ok: true as const, mode: "execute" as const, report };
}
