/**
 * Read-only plan and gated execute for the pre-launch imported-sales wipe.
 * Not imported by application startup. Execute is only reached from
 * scripts/imported-sales-reset.ts after the backup gates pass.
 */
import { mkdirSync, copyFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import {
  IMPORTED_SALES_APPROVAL_GATES,
  IMPORTED_SALES_EFFECTS,
  IMPORTED_SALES_PRESERVED,
  IMPORTED_SALES_REMOVED,
  evaluateImportedSalesResetGates,
  salesArchiveDirectory,
  type BackupProof,
} from "@/domain/imported-sales-reset";

type Db = PrismaClient | Prisma.TransactionClient;

const SALES_BATCH_KINDS = ["INVOICE_LINES", "LEDGER"] as const;

export type ImportedSalesResetPlan = {
  mode: "dry-run";
  preserved: typeof IMPORTED_SALES_PRESERVED;
  removed: typeof IMPORTED_SALES_REMOVED;
  effects: typeof IMPORTED_SALES_EFFECTS;
  approvalGates: typeof IMPORTED_SALES_APPROVAL_GATES;
  feedEnabled: boolean;
  counts: {
    preserved: Record<string, number>;
    removed: Record<string, number>;
  };
  orderReferences: Array<{
    documentReference: string;
    documentType: string;
    abOrderNumber: string | null;
    abOrderId: string | null;
  }>;
  /** Documents that store an AB order id or number. The orders themselves are not sales rows. */
  orderReferenceCount: number;
};

async function tableCounts(db: Db) {
  const [
    companies,
    activeCompanies,
    prospects,
    contacts,
    addresses,
    autopartAccounts,
    aliases,
    customerPrices,
    products,
    suppliers,
    inventory,
    orders,
    orderItems,
    invoices,
    reservations,
    fulfilmentEvents,
    users,
    permissions,
    customerMasterBatches,
    legacy504cRuns,
    salesDocuments,
    salesLines,
    importRuns,
    diagnostics,
    historyImports,
    stagedDocuments,
    stagedLines,
    reviewAccounts,
    snapshotGaps,
    documentMatches,
    invoiceLines,
    ledgerTransactions,
    salesBatches,
    ongoingHashReceipts,
    cutovers,
  ] = await Promise.all([
    db.company.count(),
    db.company.count({ where: { status: "ACTIVE" } }),
    db.company.count({ where: { status: "PROSPECT" } }),
    db.contact.count(),
    db.address.count(),
    db.autopartAccount.count(),
    db.autopartCustomerAccountAlias.count(),
    db.customerPrice.count(),
    db.product.count(),
    db.supplier.count(),
    db.inventory.count(),
    db.order.count(),
    db.orderItem.count(),
    db.invoice.count(),
    db.orderStockReservation.count(),
    db.orderFulfilmentEvent.count(),
    db.user.count(),
    db.permission.count(),
    db.autopartImportBatch.count({ where: { kind: "CUSTOMER_MASTER" } }),
    db.autopart504cImportRun.count(),
    db.autopartSalesDocument.count(),
    db.autopartSalesLine.count(),
    db.autopartCustomerImportRun.count(),
    db.autopartImportDiagnostic.count(),
    db.autopartHistoryAllImport.count(),
    db.autopartHistoryStagedDocument.count(),
    db.autopartHistoryStagedLine.count(),
    db.autopartHistoryReviewAccount.count(),
    db.autopartHistorySnapshotGap.count(),
    db.autopartDocumentMatch.count(),
    db.autopartInvoiceLine.count(),
    db.autopartLedgerTransaction.count(),
    db.autopartImportBatch.count({ where: { kind: { in: [...SALES_BATCH_KINDS] } } }),
    db.stockEmailReceipt.count({ where: { receiptKey: { startsWith: "ongoing-hash:" } } }),
    db.customerSalesCutover.count(),
  ]);
  const salesIssues = await db.autopartImportIssue.count({
    where: { batch: { kind: { in: [...SALES_BATCH_KINDS] } } },
  });
  return {
    preserved: {
      companies,
      activeCompanies,
      prospects,
      contacts,
      addresses,
      autopartAccounts,
      aliases,
      customerPrices,
      products,
      suppliers,
      inventory,
      orders,
      orderItems,
      invoices,
      reservations,
      fulfilmentEvents,
      users,
      permissions,
      customerMasterBatches,
      legacy504cRuns,
    },
    removed: {
      salesDocuments,
      salesLines,
      importRuns,
      diagnostics,
      historyImports,
      stagedDocuments,
      stagedLines,
      reviewAccounts,
      snapshotGaps,
      documentMatches,
      invoiceLines,
      ledgerTransactions,
      salesBatches,
      salesIssues,
      ongoingHashReceipts,
      cutovers,
    },
  };
}

async function orderReferenceSample(db: Db) {
  const where = { OR: [{ abOrderId: { not: null } }, { abOrderNumber: { not: null } }] };
  const [total, rows] = await Promise.all([
    db.autopartSalesDocument.count({ where }),
    db.autopartSalesDocument.findMany({
      where,
      select: {
        documentReference: true,
        documentType: true,
        abOrderNumber: true,
        abOrderId: true,
      },
      orderBy: { documentReference: "asc" },
      take: 25,
    }),
  ]);
  return { total, rows };
}

export async function planImportedSalesReset(db: Db = prisma): Promise<ImportedSalesResetPlan> {
  const [counts, orderReferences, feed] = await Promise.all([
    tableCounts(db),
    orderReferenceSample(db),
    db.autopartOngoingSalesFeedSettings.findUnique({ where: { id: "default" }, select: { enabled: true } }),
  ]);
  return {
    mode: "dry-run",
    preserved: IMPORTED_SALES_PRESERVED,
    removed: IMPORTED_SALES_REMOVED,
    effects: IMPORTED_SALES_EFFECTS,
    approvalGates: IMPORTED_SALES_APPROVAL_GATES,
    feedEnabled: feed?.enabled ?? false,
    counts,
    orderReferences: orderReferences.rows,
    orderReferenceCount: orderReferences.total,
  };
}

async function archiveSourceReports(): Promise<{ directory: string; files: number }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve(salesArchiveDirectory(), stamp);
  mkdirSync(directory, { recursive: true });
  const manifest: Array<Record<string, string | number | null>> = [];
  let files = 0;

  const history = await prisma.autopartHistoryAllImport.findMany({
    select: {
      id: true,
      filename561l: true,
      filenameSlrb: true,
      storagePath561l: true,
      storagePathSlrb: true,
      fileBody561l: true,
      fileBodySlrb: true,
    },
  });
  for (const row of history) {
    const folder = path.join(directory, "history", row.id);
    mkdirSync(folder, { recursive: true });
    if (row.fileBody561l) {
      writeFileSync(path.join(folder, row.filename561l || "561l.bin"), row.fileBody561l);
      files += 1;
    }
    if (row.fileBodySlrb) {
      writeFileSync(path.join(folder, row.filenameSlrb || "slrb.bin"), row.fileBodySlrb);
      files += 1;
    }
    for (const storagePath of [row.storagePath561l, row.storagePathSlrb]) {
      if (!storagePath || !existsSync(storagePath)) continue;
      copyFileSync(storagePath, path.join(folder, path.basename(storagePath)));
      files += 1;
    }
    manifest.push({
      kind: "history",
      id: row.id,
      filename561l: row.filename561l,
      filenameSlrb: row.filenameSlrb,
    });
  }

  const batches = await prisma.autopartImportBatch.findMany({
    where: { kind: { in: [...SALES_BATCH_KINDS] }, storagePath: { not: null } },
    select: { id: true, kind: true, filename: true, storagePath: true },
  });
  for (const batch of batches) {
    manifest.push({ kind: batch.kind, id: batch.id, filename: batch.filename, storagePath: batch.storagePath });
    if (!batch.storagePath || !existsSync(batch.storagePath)) continue;
    const folder = path.join(directory, "batches");
    mkdirSync(folder, { recursive: true });
    copyFileSync(batch.storagePath, path.join(folder, `${batch.id}-${path.basename(batch.storagePath)}`));
    files += 1;
  }

  writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ files, items: manifest }, null, 2));
  return { directory, files };
}

async function deleteImportedSales(db: Db) {
  const salesBatchIds = (
    await db.autopartImportBatch.findMany({
      where: { kind: { in: [...SALES_BATCH_KINDS] } },
      select: { id: true },
    })
  ).map((batch) => batch.id);

  const diagnostics = await db.autopartImportDiagnostic.deleteMany();
  const lines = await db.autopartSalesLine.deleteMany();
  const documents = await db.autopartSalesDocument.deleteMany();
  const runs = await db.autopartCustomerImportRun.deleteMany();
  const stagedLines = await db.autopartHistoryStagedLine.deleteMany();
  const stagedDocuments = await db.autopartHistoryStagedDocument.deleteMany();
  const reviews = await db.autopartHistoryReviewAccount.deleteMany();
  const gaps = await db.autopartHistorySnapshotGap.deleteMany();
  const history = await db.autopartHistoryAllImport.deleteMany();
  await db.autopartHistoryImportLock.updateMany({
    data: { owner: null, importId: null, heartbeatAt: null },
  });
  const matches = await db.autopartDocumentMatch.deleteMany();
  const invoiceLines = await db.autopartInvoiceLine.deleteMany();
  const ledger = await db.autopartLedgerTransaction.deleteMany();
  const issues =
    salesBatchIds.length === 0
      ? { count: 0 }
      : await db.autopartImportIssue.deleteMany({ where: { batchId: { in: salesBatchIds } } });
  if (salesBatchIds.length > 0) {
    await db.autopartAccount.updateMany({
      where: { lastImportBatchId: { in: salesBatchIds } },
      data: { lastImportBatchId: null },
    });
  }
  const batches = await db.autopartImportBatch.deleteMany({
    where: { kind: { in: [...SALES_BATCH_KINDS] } },
  });
  const receipts = await db.stockEmailReceipt.deleteMany({
    where: { receiptKey: { startsWith: "ongoing-hash:" } },
  });
  const cutovers = await db.customerSalesCutover.deleteMany();

  return {
    diagnostics: diagnostics.count,
    lines: lines.count,
    documents: documents.count,
    runs: runs.count,
    stagedLines: stagedLines.count,
    stagedDocuments: stagedDocuments.count,
    reviews: reviews.count,
    gaps: gaps.count,
    historyImports: history.count,
    documentMatches: matches.count,
    invoiceLines: invoiceLines.count,
    ledgerTransactions: ledger.count,
    salesIssues: issues.count,
    salesBatches: batches.count,
    ongoingHashReceipts: receipts.count,
    cutovers: cutovers.count,
  };
}

export async function executeImportedSalesReset(input: {
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
}) {
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
  const archive = input.db ? { directory: salesArchiveDirectory(), files: 0 } : await archiveSourceReports();
  await prisma.autopartOngoingSalesFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default", enabled: false, configured: true, fulfilmentMode: "OFF" },
    update: { enabled: false },
  });

  const deleted = input.db
    ? await deleteImportedSales(input.db)
    : await prisma.$transaction((tx) => deleteImportedSales(tx), { timeout: 180_000 });
  const after = await tableCounts(db);
  const feed = await prisma.autopartOngoingSalesFeedSettings.findUnique({
    where: { id: "default" },
    select: { enabled: true },
  });

  const report = {
    mode: "execute" as const,
    deleted,
    planned: before.counts.removed,
    preservedBefore: before.counts.preserved,
    preservedAfter: after.preserved,
    removedAfter: after.removed,
    orderReferences: before.orderReferences,
    feedEnabledBefore: before.feedEnabled,
    feedEnabledAfter: feed?.enabled ?? false,
    archive,
  };

  if (input.db == null) {
    await recordAuditEvent({
      action: "autopart.imported_sales_reset_executed",
      entityType: "AutopartSalesDocument",
      entityId: null,
      actorUserId: input.actorUserId ?? null,
      metadata: {
        deleted,
        feedEnabledBefore: report.feedEnabledBefore,
        feedEnabledAfter: report.feedEnabledAfter,
        archiveDirectory: archive.directory,
        archiveFiles: archive.files,
        orderReferences: before.orderReferences.length,
      },
    });
  }

  return { ok: true as const, mode: "execute" as const, report };
}
