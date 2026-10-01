/**
 * Persist and query Autopart ongoing import row diagnostics.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { recordAuditEvent } from "@/server/audit/record";
import {
  AUTOPART_IMPORT_DIAGNOSTIC_STATUSES,
  emptyDiagnosticCounts,
  historicSkipAggregateMessage,
  sourceLabel,
  type AutopartImportDiagnosticCounts,
  type AutopartImportDiagnosticDraft,
  type AutopartImportDiagnosticStatus,
} from "@/domain/autopart-import-diagnostics";

async function requireOngoingSalesAdmin(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!hasPermission(profile, "admin.access") && !hasPermission(profile, "orders.edit")) {
    throw new AuthError("Not permitted to manage Autopart sales feeds", "FORBIDDEN", 403);
  }
  return profile;
}

export async function persistImportDiagnostics(
  importRunId: string,
  drafts: AutopartImportDiagnosticDraft[],
) {
  if (!drafts.length) return;
  const CHUNK = 200;
  for (let i = 0; i < drafts.length; i += CHUNK) {
    const slice = drafts.slice(i, i + CHUNK);
    await prisma.autopartImportDiagnostic.createMany({
      data: slice.map((d) => ({
        importRunId,
        status: d.status,
        reasonCode: d.reasonCode,
        reason: d.reason,
        rowNumber: d.rowNumber ?? null,
        customerAccount: d.customerAccount ?? null,
        documentReference: d.documentReference ?? null,
        documentDate: d.documentDate ?? null,
        sku: d.sku ?? null,
        description: d.description ?? null,
        quantity: d.quantity ?? null,
        salesNet: d.salesNet ?? null,
        abOrderReference: d.abOrderReference ?? null,
        customerOrderNumber: d.customerOrderNumber ?? null,
        companyId: d.companyId ?? null,
        abOrderId: d.abOrderId ?? null,
        isWarning: Boolean(d.isWarning),
      })),
    });
  }
}

export function countsFromDrafts(drafts: AutopartImportDiagnosticDraft[]): AutopartImportDiagnosticCounts {
  const counts = emptyDiagnosticCounts();
  for (const d of drafts) {
    switch (d.status) {
      case "INSERTED":
        counts.inserted += 1;
        break;
      case "UPDATED":
        counts.updated += 1;
        break;
      case "UNCHANGED":
        counts.unchanged += 1;
        break;
      case "SKIPPED":
        counts.skipped += 1;
        break;
      case "ERROR":
        counts.errors += 1;
        break;
      case "WARNING":
        counts.warnings += 1;
        break;
    }
    if (d.isWarning && d.status !== "WARNING" && d.status !== "ERROR") {
      counts.warnings += 1;
    }
  }
  return counts;
}

function durationSeconds(started: Date, finished: Date | null): number | null {
  if (!finished) return null;
  return Math.max(0, Math.round((finished.getTime() - started.getTime()) / 1000));
}

export async function getOngoingSalesImportRunDetail(actorUserId: string, runId: string) {
  await requireOngoingSalesAdmin(actorUserId);
  const run = await prisma.autopartCustomerImportRun.findFirst({
    where: { id: runId, type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] } },
  });
  if (!run) throw new AuthError("Import run not found", "NOT_FOUND", 404);

  const diagnosticCount = await prisma.autopartImportDiagnostic.count({
    where: { importRunId: run.id },
  });
  const hasRowDiagnostics = diagnosticCount > 0;
  const diagJson = (run.diagnostics ?? {}) as Record<string, unknown>;
  const summaryCounts = (diagJson["counts"] as AutopartImportDiagnosticCounts | undefined) ?? null;

  const statusCounts = hasRowDiagnostics
    ? await prisma.autopartImportDiagnostic.groupBy({
        by: ["status"],
        where: { importRunId: run.id },
        _count: { _all: true },
      })
    : [];
  const warningCount = hasRowDiagnostics
    ? await prisma.autopartImportDiagnostic.count({
        where: { importRunId: run.id, isWarning: true },
      })
    : (summaryCounts?.warnings ?? 0);

  const byStatus: Record<string, number> = {};
  for (const row of statusCounts) byStatus[row.status] = row._count._all;

  const feed = run.type === "ONGOING_504" ? "504" : "TRM21QC";
  const aggregateNote = historicSkipAggregateMessage({
    type: run.type as "ONGOING_504" | "ONGOING_TRM21QC",
    rowsSkipped: run.rowsSkipped,
    rowsUnmatched: run.rowsUnmatched,
    hasRowDiagnostics,
  });

  // Truthful aggregates from persisted documents/lines for this run when available.
  const docsForRun = await prisma.autopartSalesDocument.findMany({
    where: { importRunId: run.id },
    select: {
      id: true,
      has504: true,
      hasTrm21qc: true,
      documentType: true,
      companyId: true,
      abOrderNumber: true,
      reconciliationStatus: true,
    },
  });
  const linesForRun = await prisma.autopartSalesLine.findMany({
    where: { importRunId: run.id },
    select: { matchStatus: true, documentId: true },
  });

  const feedMetrics =
    run.type === "ONGOING_504"
      ? {
          documentsFound: docsForRun.length,
          invoices: docsForRun.filter((d) => d.documentType === "INVOICE").length,
          creditNotes: docsForRun.filter((d) => d.documentType === "CREDIT").length,
          abOriginatedDocuments: docsForRun.filter((d) => Boolean(d.abOrderNumber)).length,
          directAutopartDocuments: docsForRun.filter((d) => !d.abOrderNumber).length,
          matchedCustomers: docsForRun.filter((d) => Boolean(d.companyId)).length,
          unmappedCustomers: docsForRun.filter((d) => !d.companyId).length,
          awaitingLines: docsForRun.filter((d) => d.reconciliationStatus === "AWAITING_LINES")
            .length,
        }
      : {
          sourceRows: run.rowsRead,
          financialDocumentsRepresented: docsForRun.length,
          productLinesWritten: linesForRun.length,
          matchedSkus: linesForRun.filter((l) => l.matchStatus === "MATCHED").length,
          skusNotInCatalogue: linesForRun.filter((l) => l.matchStatus === "NOT_IN_AB_CATALOGUE")
            .length,
          matchedCustomers: docsForRun.filter((d) => Boolean(d.companyId)).length,
          unmappedCustomers: run.rowsUnmatched,
          documentsMatchedTo504: docsForRun.filter((d) => d.has504 && d.hasTrm21qc).length,
          documentsAwaiting504: docsForRun.filter((d) => d.reconciliationStatus === "AWAITING_504")
            .length,
        };

  return {
    id: run.id,
    feed,
    type: run.type,
    filename: run.filename,
    status: run.status,
    source: sourceLabel(diagJson["source"]),
    startedAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    durationSeconds: durationSeconds(run.createdAt, run.completedAt),
    dryRun: run.dryRun,
    rowsRead: run.rowsRead,
    rowsImported: run.rowsImported,
    rowsUpdated: run.rowsUpdated,
    rowsSkipped: run.rowsSkipped,
    rowsUnmatched: run.rowsUnmatched,
    rowsUnchanged: summaryCounts?.unchanged ?? byStatus["UNCHANGED"] ?? 0,
    warnings: warningCount,
    errors: summaryCounts?.errors ?? byStatus["ERROR"] ?? 0,
    hasRowDiagnostics,
    aggregateNote,
    parserErrors: Array.isArray(diagJson["errors"])
      ? (diagJson["errors"] as string[]).slice(0, 50)
      : [],
    feedMetrics,
    counts: summaryCounts ?? {
      inserted: run.rowsImported,
      updated: run.rowsUpdated,
      unchanged: byStatus["UNCHANGED"] ?? 0,
      skipped: run.rowsSkipped,
      warnings: warningCount,
      errors: byStatus["ERROR"] ?? 0,
    },
  };
}

export async function listOngoingSalesImportDiagnostics(
  actorUserId: string,
  raw: {
    runId: string;
    filter?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  },
) {
  await requireOngoingSalesAdmin(actorUserId);
  const run = await prisma.autopartCustomerImportRun.findFirst({
    where: { id: raw.runId, type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] } },
    select: { id: true, type: true },
  });
  if (!run) throw new AuthError("Import run not found", "NOT_FOUND", 404);

  const total = await prisma.autopartImportDiagnostic.count({ where: { importRunId: run.id } });
  if (total === 0) {
    return {
      hasRowDiagnostics: false as const,
      items: [] as const,
      page: 1,
      pageSize: 50,
      total: 0,
      filter: raw.filter ?? "ALL",
    };
  }

  const page = Math.max(1, raw.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, raw.pageSize ?? 50));
  const filter = (raw.filter ?? "ALL").toUpperCase();
  const q = raw.q?.trim();

  const where: Prisma.AutopartImportDiagnosticWhereInput = { importRunId: run.id };
  if (filter === "WARNINGS") where.isWarning = true;
  else if (filter === "ERRORS") where.status = "ERROR";
  else if (filter === "SKIPPED") where.status = "SKIPPED";
  else if (filter === "INSERTED" || filter === "IMPORTED") where.status = "INSERTED";
  else if (filter === "UPDATED") where.status = "UPDATED";
  else if (filter === "UNCHANGED") where.status = "UNCHANGED";
  else if (
    AUTOPART_IMPORT_DIAGNOSTIC_STATUSES.includes(filter as AutopartImportDiagnosticStatus)
  ) {
    where.status = filter as AutopartImportDiagnosticStatus;
  }

  if (q) {
    where.OR = [
      { documentReference: { contains: q, mode: "insensitive" } },
      { customerAccount: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { customerOrderNumber: { contains: q, mode: "insensitive" } },
      { abOrderReference: { contains: q, mode: "insensitive" } },
      { reasonCode: { contains: q, mode: "insensitive" } },
    ];
  }

  const [filteredTotal, items] = await Promise.all([
    prisma.autopartImportDiagnostic.count({ where }),
    prisma.autopartImportDiagnostic.findMany({
      where,
      orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    hasRowDiagnostics: true as const,
    feed: run.type === "ONGOING_504" ? "504" : "TRM21QC",
    page,
    pageSize,
    total: filteredTotal,
    filter,
    q: q ?? "",
    items: items.map((d) => ({
      id: d.id,
      status: d.status,
      reasonCode: d.reasonCode,
      reason: d.reason,
      rowNumber: d.rowNumber,
      customerAccount: d.customerAccount,
      documentReference: d.documentReference,
      documentDate: d.documentDate,
      sku: d.sku,
      description: d.description,
      quantity: d.quantity,
      salesNet: d.salesNet,
      abOrderReference: d.abOrderReference,
      customerOrderNumber: d.customerOrderNumber,
      companyId: d.companyId,
      abOrderId: d.abOrderId,
      isWarning: d.isWarning,
      links: {
        customer: d.companyId ? `/admin/customers/${d.companyId}` : null,
        productsSearch: d.sku
          ? `/admin/products?q=${encodeURIComponent(d.sku)}`
          : null,
        order: d.abOrderReference ? `/admin/orders?q=${encodeURIComponent(d.abOrderReference)}` : null,
      },
    })),
  };
}

function csvEscape(value: string | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportOngoingSalesImportDiagnosticsCsv(
  actorUserId: string,
  runId: string,
): Promise<{ filename: string; csv: string }> {
  await requireOngoingSalesAdmin(actorUserId);
  const run = await prisma.autopartCustomerImportRun.findFirst({
    where: { id: runId, type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] } },
  });
  if (!run) throw new AuthError("Import run not found", "NOT_FOUND", 404);

  const rows = await prisma.autopartImportDiagnostic.findMany({
    where: { importRunId: run.id },
    orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }],
    take: 50_000,
  });

  await recordAuditEvent({
    action: "autopart.ongoing_import_diagnostics_exported",
    entityType: "AutopartCustomerImportRun",
    entityId: run.id,
    actorUserId,
    metadata: { rowCount: rows.length, type: run.type, filename: run.filename },
  });

  const feed = run.type === "ONGOING_504" ? "504" : "TRM21QC";
  const header = [
    "Feed",
    "Filename",
    "Row",
    "Status",
    "Reason Code",
    "Reason",
    "Customer Account",
    "Document",
    "Date",
    "SKU",
    "Description",
    "Quantity",
    "Net Sales",
    "AB Order Reference",
    "Customer Order Number",
  ];
  const lines = [header.join(",")];
  if (!rows.length) {
    lines.push(
      [
        feed,
        csvEscape(run.filename),
        "",
        "NOTE",
        "NO_ROW_DIAGNOSTICS",
        csvEscape("Detailed diagnostics were not recorded for this import."),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(","),
    );
  } else {
    for (const d of rows) {
      lines.push(
        [
          feed,
          csvEscape(run.filename),
          d.rowNumber == null ? "" : String(d.rowNumber),
          d.status,
          csvEscape(d.reasonCode),
          csvEscape(d.reason),
          csvEscape(d.customerAccount),
          csvEscape(d.documentReference),
          csvEscape(d.documentDate),
          csvEscape(d.sku),
          csvEscape(d.description),
          csvEscape(d.quantity),
          csvEscape(d.salesNet),
          csvEscape(d.abOrderReference),
          csvEscape(d.customerOrderNumber),
        ].join(","),
      );
    }
  }

  const safeName = (run.filename ?? feed).replace(/[^\w.-]+/g, "_");
  return {
    filename: `autopart-${feed.toLowerCase()}-diagnostics-${safeName}.csv`,
    csv: lines.join("\n"),
  };
}
