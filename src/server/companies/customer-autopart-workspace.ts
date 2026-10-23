/**
 * Read model for the customer Autopart workspace.
 * Does not import files, change cutover, or enable automatic feeds.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import {
  customerAutopartPrimaryAction,
  customerAutopartStages,
  historicalSalesStatusLabel,
  type AutopartPrimaryAction,
  type CustomerAutopartStage,
} from "@/domain/customer-autopart-workspace";
import { foreignAutopartClaims, resolveAutopartCodeOwnership } from "@/server/companies/autopart-account-verification";
import { AuthError, requireCompanyAccess } from "@/server/rbac/guards";
import { grants } from "@/server/rbac/access";

const ACTIVITY_STATUSES = ["COMMITTED", "FAILED", "BLOCKED", "PROCESSING"] as const;

function historyKind(evidence: Prisma.JsonValue | null | undefined): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const kind = evidence["kind"];
  return typeof kind === "string" ? kind : null;
}

export async function getCustomerAutopartWorkspace(actorUserId: string, companyId: string) {
  const profile = await requireCompanyAccess(actorUserId, companyId);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      accountNumber: true,
      status: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      autopartAccountAliases: { select: { alias: true }, orderBy: { alias: "asc" } },
      salesCutover: true,
    },
  });
  if (!company) throw new AuthError("Customer not found", "NOT_FOUND", 404);

  const canViewMaster = profile.permissions.has("autopart.customer.view");
  const canImport = grants(profile, "admin.access", "orders.edit");
  const [masterAccounts, feed, latestHistory, latestOngoing, ongoingImportCount, productLineCount, documentCount] =
    await Promise.all([
      canViewMaster
        ? prisma.autopartAccount.findMany({
            where: { companyId },
            orderBy: { accountCode: "asc" },
            select: {
              id: true,
              accountCode: true,
              originalName: true,
              areaCode: true,
              repCode: true,
              classification: true,
            },
          })
        : Promise.resolve([]),
      prisma.autopartOngoingSalesFeedSettings.findUnique({
        where: { id: "default" },
        select: { enabled: true },
      }),
      prisma.autopartCustomerImportRun.findFirst({
        where: { companyId, type: "HISTORY_561L_SLRB", status: "COMMITTED", dryRun: false },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        select: { completedAt: true, createdAt: true },
      }),
      prisma.autopartCustomerImportRun.findFirst({
        where: {
          companyId,
          type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] },
          status: "COMMITTED",
          dryRun: false,
        },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        select: { completedAt: true, createdAt: true },
      }),
      prisma.autopartCustomerImportRun.count({
        where: {
          companyId,
          type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] },
          status: "COMMITTED",
          dryRun: false,
        },
      }),
      prisma.autopartSalesLine.count({ where: { companyId } }),
      prisma.autopartSalesDocument.count({ where: { companyId } }),
    ]);

  const code = company.autopartCustomerCode?.trim() || null;
  const verified = Boolean(code && company.autopartCustomerCodeVerifiedAt);
  let ownershipAmbiguous = false;
  let ownershipNote: string | null = null;
  if (code) {
    const ownership = await resolveAutopartCodeOwnership(code);
    const foreign = await foreignAutopartClaims(code, company.id);
    if (ownership.authority === "ambiguous" || (ownership.companyId && ownership.companyId !== company.id) || foreign.length > 0) {
      ownershipAmbiguous = true;
      ownershipNote = "This Autopart account is also connected to another customer. Resolve that before importing sales.";
    } else if (!verified) {
      ownershipNote = "An account code is saved, but it has not been verified for this customer.";
    }
  }

  const storedHistory = company.salesCutover?.historyStatus ?? "NOT_STARTED";
  const kind = historyKind(company.salesCutover?.evidence ?? null);
  const stageInput = {
    companyStatus: company.status,
    verified,
    hasAccountCode: Boolean(code),
    ownershipAmbiguous,
    historyStatus: storedHistory,
    ongoingImportCount,
  };

  return {
    company: {
      id: company.id,
      name: company.name,
      accountNumber: company.accountNumber,
      status: company.status,
    },
    salesAccount: {
      code,
      verified,
      verifiedAt: company.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
      aliases: company.autopartAccountAliases.map((alias) => alias.alias),
      ownershipAmbiguous,
      ownershipNote,
    },
    master: {
      restricted: !canViewMaster,
      linked: masterAccounts.length > 0,
      accounts: masterAccounts.map((account) => ({
        id: account.id,
        code: account.accountCode,
        name: account.originalName,
        areaCode: account.areaCode,
        repCode: account.repCode,
        classification: account.classification,
      })),
    },
    history: {
      status: storedHistory,
      kind,
      label: historicalSalesStatusLabel({ historyStatus: storedHistory, historyKind: kind }),
      from: company.salesCutover?.historyFrom?.toISOString().slice(0, 10) ?? null,
      to: company.salesCutover?.historyTo?.toISOString().slice(0, 10) ?? null,
      completedAt: company.salesCutover?.completedAt?.toISOString() ?? null,
      latestImportAt: (latestHistory?.completedAt ?? latestHistory?.createdAt)?.toISOString() ?? null,
    },
    ongoing: {
      latestImportAt: (latestOngoing?.completedAt ?? latestOngoing?.createdAt)?.toISOString() ?? null,
      committedCount: ongoingImportCount,
    },
    coverage: {
      productLineCount,
      documentCount,
    },
    automaticImportEnabled: Boolean(feed?.enabled),
    canImport,
    stages: customerAutopartStages(stageInput) satisfies CustomerAutopartStage[],
    primaryAction: customerAutopartPrimaryAction(stageInput) satisfies AutopartPrimaryAction,
  };
}

export async function listCustomerAutopartImportActivity(actorUserId: string, companyId: string) {
  await requireCompanyAccess(actorUserId, companyId);
  const runs = await prisma.autopartCustomerImportRun.findMany({
    where: { companyId, dryRun: false, status: { in: [...ACTIVITY_STATUSES] } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      type: true,
      status: true,
      filename: true,
      filenameSlrb: true,
      rowsImported: true,
      rowsUpdated: true,
      rowsSkipped: true,
      rowsUnmatched: true,
      createdAt: true,
      completedAt: true,
      createdBy: { select: { name: true, email: true } },
    },
  });
  return {
    items: runs.map((run) => ({
      id: run.id,
      type: run.type,
      status: run.status,
      filename: [run.filename, run.filenameSlrb].filter(Boolean).join(" · ") || "—",
      importedBy: run.createdBy?.name || run.createdBy?.email || "—",
      at: (run.completedAt ?? run.createdAt).toISOString(),
      imported: run.rowsImported,
      updated: run.rowsUpdated,
      skipped: run.rowsSkipped,
      unmatched: run.rowsUnmatched,
    })),
  };
}

export async function listCustomerAutopartImportDetails(
  actorUserId: string,
  raw: { companyId: string; runId: string; filter?: string },
) {
  await requireCompanyAccess(actorUserId, raw.companyId);
  const run = await prisma.autopartCustomerImportRun.findFirst({
    where: { id: raw.runId, companyId: raw.companyId },
    select: { id: true, type: true, status: true, issues: true, filename: true },
  });
  if (!run) throw new AuthError("Import not found", "NOT_FOUND", 404);

  const filter = (raw.filter ?? "ALL").toUpperCase();
  const where: Prisma.AutopartImportDiagnosticWhereInput = { importRunId: run.id };
  if (filter === "REJECTED" || filter === "ERRORS") where.status = "ERROR";
  else if (filter === "SKIPPED" || filter === "DUPLICATE") where.status = "SKIPPED";
  else if (filter === "NEW" || filter === "INSERTED") where.status = "INSERTED";
  else if (filter === "UPDATED") where.status = "UPDATED";

  const total = await prisma.autopartImportDiagnostic.count({ where: { importRunId: run.id } });
  const items =
    total === 0
      ? []
      : await prisma.autopartImportDiagnostic.findMany({
          where,
          orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }],
          take: 50,
          select: {
            id: true,
            status: true,
            reasonCode: true,
            reason: true,
            rowNumber: true,
            documentReference: true,
            documentDate: true,
            sku: true,
            customerAccount: true,
          },
        });

  return {
    runId: run.id,
    type: run.type,
    status: run.status,
    filename: run.filename,
    hasRowDiagnostics: total > 0,
    total,
    items,
    storedIssue:
      total > 0
        ? null
        : run.issues && typeof run.issues === "object" && !Array.isArray(run.issues) && typeof run.issues["error"] === "string"
          ? run.issues["error"]
          : null,
  };
}
