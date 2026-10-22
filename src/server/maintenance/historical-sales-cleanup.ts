/**
 * Read-only inventory of historical Autopart sales, plus an apply path that
 * refuses to run unless backup gates pass. Not imported by server startup,
 * the container entrypoint, or a route.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import {
  PRESERVED,
  REMOVED_WHEN_APPLIED,
  evaluateHistoricalCleanupGates,
  type BackupAttestation,
} from "@/domain/historical-sales-cleanup";
import { ONGOING_DOCUMENT_SOURCES, ONGOING_LINE_SOURCE } from "@/domain/ongoing-sales-scope";

export type CleanupCount = {
  table: string;
  records: number;
  amount: string | null;
  amountLabel: string | null;
  note: string;
};

export type HistoricalCleanupPlan = {
  mode: "dry-run";
  database: string | null;
  generatedAt: string;
  preserved: readonly string[];
  removedWhenApplied: readonly string[];
  counts: CleanupCount[];
  companiesTouchingHistoricalDocuments: Array<{ companyId: string; name: string; documents: number }>;
  files: string[];
  foreignKeys: string[];
  ongoingDiscrepantDocuments: number;
  gates: ReturnType<typeof evaluateHistoricalCleanupGates>;
};

function money(value: Prisma.Decimal | null | undefined): string {
  return value?.toFixed(2) ?? "0.00";
}

async function databaseName(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  return rows[0]?.name ?? null;
}

async function foreignKeys(): Promise<string[]> {
  const rows = await prisma.$queryRaw<
    Array<{ child: string; parent: string; column: string }>
  >`
    SELECT c.relname AS child, p.relname AS parent, a.attname AS column
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_class p ON p.oid = k.confrelid
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
    WHERE k.contype = 'f'
      AND (
        c.relname LIKE 'AutopartHistory%'
        OR c.relname IN (
          'AutopartInvoiceLine',
          'AutopartLedgerTransaction',
          'AutopartDocumentMatch',
          'AutopartImportIssue',
          'AutopartSalesDocument',
          'AutopartSalesLine',
          'AutopartImportDiagnostic'
        )
        OR p.relname LIKE 'AutopartHistory%'
        OR p.relname IN (
          'AutopartInvoiceLine',
          'AutopartImportBatch',
          'AutopartCustomerImportRun',
          'AutopartSalesDocument'
        )
      )
    ORDER BY c.relname, a.attname
  `;
  return rows.map((row) => `${row.child}.${row.column} -> ${row.parent}`);
}

export async function planHistoricalSalesCleanup(input?: {
  apply?: boolean;
  confirmation?: string | null;
  attestation?: BackupAttestation | null;
}): Promise<HistoricalCleanupPlan> {
  const gates = evaluateHistoricalCleanupGates({
    apply: input?.apply === true,
    confirmation: input?.confirmation ?? null,
    attestation: input?.attestation ?? null,
  });

  const [
    database,
    invoiceLines,
    invoiceSales,
    ledgerRows,
    ledgerGoods,
    matches,
    historyBatches,
    masterBatches,
    allImports,
    reviews,
    stagedDocs,
    stagedLines,
    gaps,
    locks,
    historicalDocuments,
    historicalDocumentGoods,
    preservedSourceDocuments,
    ongoingDocuments,
    discrepantOngoing,
    historicalLines,
    preservedSourceLines,
    ongoingLines,
    historyRuns,
    companies,
    fileRows,
    keys,
  ] = await Promise.all([
    databaseName(),
    prisma.autopartInvoiceLine.count(),
    prisma.autopartInvoiceLine.aggregate({ _sum: { salesAmount: true } }),
    prisma.autopartLedgerTransaction.count(),
    prisma.autopartLedgerTransaction.aggregate({ _sum: { goodsAmount: true, totalAmount: true } }),
    prisma.autopartDocumentMatch.count(),
    prisma.autopartImportBatch.count({ where: { kind: { in: ["INVOICE_LINES", "LEDGER"] } } }),
    prisma.autopartImportBatch.count({ where: { kind: "CUSTOMER_MASTER" } }),
    prisma.autopartHistoryAllImport.count(),
    prisma.autopartHistoryReviewAccount.count(),
    prisma.autopartHistoryStagedDocument.count(),
    prisma.autopartHistoryStagedLine.count(),
    prisma.autopartHistorySnapshotGap.count(),
    prisma.autopartHistoryImportLock.count(),
    prisma.autopartSalesDocument.count({
      where: {
        source: { in: ["561L", "SLRB"] },
        has504: false,
        hasTrm21qc: false,
        NOT: { source: { in: [...ONGOING_DOCUMENT_SOURCES] } },
      },
    }),
    prisma.autopartSalesDocument.aggregate({
      where: { source: { in: ["561L", "SLRB"] }, has504: false, hasTrm21qc: false },
      _sum: { goodsNet: true, grossTotal: true },
    }),
    prisma.autopartSalesDocument.count({
      where: {
        source: { in: ["561L", "SLRB"] },
        OR: [{ has504: true }, { hasTrm21qc: true }],
      },
    }),
    prisma.autopartSalesDocument.count({
      where: {
        OR: [
          { has504: true },
          { hasTrm21qc: true },
          { source: { in: [...ONGOING_DOCUMENT_SOURCES] } },
        ],
      },
    }),
    prisma.autopartSalesDocument.count({
      where: {
        has504: true,
        valueMismatchMinor: { not: null },
      },
    }),
    prisma.autopartSalesLine.count({
      where: {
        source: "561L",
        OR: [
          { documentId: null },
          { document: { is: { has504: false, hasTrm21qc: false, source: { in: ["561L", "SLRB"] } } } },
        ],
      },
    }),
    prisma.autopartSalesLine.count({
      where: {
        source: "561L",
        document: { is: { OR: [{ has504: true }, { hasTrm21qc: true }] } },
      },
    }),
    prisma.autopartSalesLine.count({ where: { source: ONGOING_LINE_SOURCE } }),
    prisma.autopartCustomerImportRun.count({ where: { type: "HISTORY_561L_SLRB" } }),
    prisma.$queryRaw<Array<{ companyId: string; name: string; documents: number }>>`
      SELECT d."companyId" AS "companyId", c.name AS name, COUNT(*)::int AS documents
      FROM "AutopartSalesDocument" d
      JOIN "Company" c ON c.id = d."companyId"
      WHERE d."companyId" IS NOT NULL
        AND d.source IN ('561L', 'SLRB')
        AND d."has504" = FALSE
        AND d."hasTrm21qc" = FALSE
      GROUP BY d."companyId", c.name
      ORDER BY documents DESC, c.name ASC
      LIMIT 50
    `,
    prisma.$queryRaw<Array<{ path: string }>>`
      SELECT path FROM (
        SELECT "storagePath" AS path FROM "AutopartImportBatch"
        WHERE kind IN ('INVOICE_LINES', 'LEDGER') AND "storagePath" IS NOT NULL
        UNION
        SELECT "storagePath561l" FROM "AutopartHistoryAllImport" WHERE "storagePath561l" IS NOT NULL
        UNION
        SELECT "storagePathSlrb" FROM "AutopartHistoryAllImport" WHERE "storagePathSlrb" IS NOT NULL
      ) files
      WHERE path IS NOT NULL
      ORDER BY path
    `,
    foreignKeys(),
  ]);

  const counts: CleanupCount[] = [
    {
      table: "AutopartInvoiceLine",
      records: invoiceLines,
      amount: money(invoiceSales._sum.salesAmount),
      amountLabel: "salesAmount NET_EX_VAT",
      note: "Global 561L product lines. Removed on apply.",
    },
    {
      table: "AutopartLedgerTransaction",
      records: ledgerRows,
      amount: money(ledgerGoods._sum.goodsAmount),
      amountLabel: "goodsAmount (total " + money(ledgerGoods._sum.totalAmount) + ")",
      note: "Global SLRB ledger. Not customer debt. Removed on apply.",
    },
    {
      table: "AutopartDocumentMatch",
      records: matches,
      amount: null,
      amountLabel: null,
      note: "Historical 561L/SLRB reconciliation. Removed on apply.",
    },
    {
      table: "AutopartImportBatch INVOICE_LINES or LEDGER",
      records: historyBatches,
      amount: null,
      amountLabel: null,
      note: "Historical file batches. CUSTOMER_MASTER batches are not in this count.",
    },
    {
      table: "AutopartImportBatch CUSTOMER_MASTER",
      records: masterBatches,
      amount: null,
      amountLabel: null,
      note: "Preserved 407EXP master batches.",
    },
    {
      table: "AutopartHistoryAllImport",
      records: allImports,
      amount: null,
      amountLabel: null,
      note: "561L-ALL / SLRB-ALL uploads, including stored file bytes.",
    },
    {
      table: "AutopartHistoryReviewAccount",
      records: reviews,
      amount: null,
      amountLabel: null,
      note: "Historical matching queue.",
    },
    {
      table: "AutopartHistoryStagedDocument",
      records: stagedDocs,
      amount: null,
      amountLabel: null,
      note: "Staged historical documents.",
    },
    {
      table: "AutopartHistoryStagedLine",
      records: stagedLines,
      amount: null,
      amountLabel: null,
      note: "Staged historical lines.",
    },
    {
      table: "AutopartHistorySnapshotGap",
      records: gaps,
      amount: null,
      amountLabel: null,
      note: "Snapshot replacement gaps.",
    },
    {
      table: "AutopartHistoryImportLock",
      records: locks,
      amount: null,
      amountLabel: null,
      note: "Historical import lock row.",
    },
    {
      table: "AutopartSalesDocument historical-only",
      records: historicalDocuments,
      amount: money(historicalDocumentGoods._sum.goodsNet),
      amountLabel: "goodsNet (gross " + money(historicalDocumentGoods._sum.grossTotal) + ")",
      note: "Source 561L or SLRB with has504 and hasTrm21qc both false.",
    },
    {
      table: "AutopartSalesDocument original 561L/SLRB now ongoing",
      records: preservedSourceDocuments,
      amount: null,
      amountLabel: null,
      note: "Preserved. Live 504/TRM processing uses these rows.",
    },
    {
      table: "AutopartSalesDocument ongoing",
      records: ongoingDocuments,
      amount: null,
      amountLabel: null,
      note: "Preserved operational documents.",
    },
    {
      table: "AutopartSalesDocument ongoing with valueMismatchMinor",
      records: discrepantOngoing,
      amount: null,
      amountLabel: null,
      note: "Preserved for the separate 504 financial recovery. Not deleted here.",
    },
    {
      table: "AutopartSalesLine historical-only",
      records: historicalLines,
      amount: null,
      amountLabel: null,
      note: "Source 561L and not attached to an ongoing document.",
    },
    {
      table: "AutopartSalesLine source 561L on an ongoing document",
      records: preservedSourceLines,
      amount: null,
      amountLabel: null,
      note: "Preserved with the live document.",
    },
    {
      table: "AutopartSalesLine ONGOING_TRM21QC",
      records: ongoingLines,
      amount: null,
      amountLabel: null,
      note: "Preserved product lines.",
    },
    {
      table: "AutopartCustomerImportRun HISTORY_561L_SLRB",
      records: historyRuns,
      amount: null,
      amountLabel: null,
      note: "Runs still referenced by a preserved document or line are kept.",
    },
  ];

  return {
    mode: "dry-run",
    database,
    generatedAt: new Date().toISOString(),
    preserved: PRESERVED,
    removedWhenApplied: REMOVED_WHEN_APPLIED,
    counts,
    companiesTouchingHistoricalDocuments: companies,
    files: fileRows.map((row) => row.path),
    foreignKeys: keys,
    ongoingDiscrepantDocuments: discrepantOngoing,
    gates,
  };
}
