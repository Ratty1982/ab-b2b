/**
 * Customer-scoped ongoing 504/TRM21QC activity for the Autopart workspace.
 *
 * Scheduled mailbox polls create report-level AutopartCustomerImportRun rows with
 * companyId = null. Attribution lives on AutopartSalesDocument / AutopartSalesLine /
 * AutopartImportDiagnostic rows for each customer in the file.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import {
  AUTOPART_IMPORT_REASON_LABELS,
  type AutopartImportReasonCode,
} from "@/domain/autopart-import-diagnostics";

export type CustomerOngoingSalesActivity = {
  latest504At: string | null;
  latestTrm21qcAt: string | null;
  latestImportAt: string | null;
  companionStatus: "ready" | "awaiting_504" | "awaiting_trm21qc" | "awaiting_both" | "not_ready";
  companionNote: string | null;
  outstandingIssue: string | null;
  hasOutstandingIssues: boolean;
  issueKind:
    | "none"
    | "failed_import"
    | "not_active"
    | "history_incomplete"
    | "unverified"
    | "ownership"
    | "data_error"
    | "other";
};

type StampRow = { at: Date | null };

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function maxIso(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

/**
 * Latest successful feed time for one customer.
 *
 * Scheduled polls store AutopartCustomerImportRun.companyId = null. Companion TRM
 * imports also overwrite AutopartSalesDocument.importRunId, so document→run joins
 * alone miss 504 activity. Successful INSERTED/UPDATED/UNCHANGED diagnostics keep
 * per-customer attribution to the correct committed run.
 */
async function latestCommittedFeedAt(
  companyId: string,
  type: "ONGOING_504" | "ONGOING_TRM21QC",
): Promise<string | null> {
  const rows = await prisma.$queryRaw<StampRow[]>(Prisma.sql`
    SELECT MAX(at) AS at
    FROM (
      SELECT COALESCE(r."completedAt", r."createdAt") AS at
      FROM "AutopartCustomerImportRun" r
      WHERE r."companyId" = ${companyId}
        AND r.type = CAST(${type} AS "AutopartCustomerImportType")
        AND r.status = CAST('COMMITTED' AS "AutopartCustomerImportStatus")
        AND r."dryRun" = false
      UNION ALL
      SELECT COALESCE(r."completedAt", r."createdAt") AS at
      FROM "AutopartImportDiagnostic" d
      INNER JOIN "AutopartCustomerImportRun" r ON r.id = d."importRunId"
      WHERE d."companyId" = ${companyId}
        AND d.status IN (
          CAST('INSERTED' AS "AutopartImportDiagnosticStatus"),
          CAST('UPDATED' AS "AutopartImportDiagnosticStatus"),
          CAST('UNCHANGED' AS "AutopartImportDiagnosticStatus")
        )
        AND r.type = CAST(${type} AS "AutopartCustomerImportType")
        AND r.status = CAST('COMMITTED' AS "AutopartCustomerImportStatus")
        AND r."dryRun" = false
      UNION ALL
      SELECT COALESCE(r."completedAt", r."createdAt") AS at
      FROM "AutopartSalesDocument" doc
      INNER JOIN "AutopartCustomerImportRun" r ON r.id = doc."importRunId"
      WHERE doc."companyId" = ${companyId}
        AND r.type = CAST(${type} AS "AutopartCustomerImportType")
        AND r.status = CAST('COMMITTED' AS "AutopartCustomerImportStatus")
        AND r."dryRun" = false
      UNION ALL
      SELECT COALESCE(r."completedAt", r."createdAt") AS at
      FROM "AutopartSalesLine" l
      INNER JOIN "AutopartCustomerImportRun" r ON r.id = l."importRunId"
      WHERE l."companyId" = ${companyId}
        AND r.type = CAST(${type} AS "AutopartCustomerImportType")
        AND r.status = CAST('COMMITTED' AS "AutopartCustomerImportStatus")
        AND r."dryRun" = false
    ) stamps
  `);
  return iso(rows[0]?.at ?? null);
}

async function latestCommitted504At(companyId: string): Promise<string | null> {
  return latestCommittedFeedAt(companyId, "ONGOING_504");
}

async function latestCommittedTrm21qcAt(companyId: string): Promise<string | null> {
  return latestCommittedFeedAt(companyId, "ONGOING_TRM21QC");
}

const ELIGIBILITY_SKIP_CODES = new Set([
  "NOT_ACTIVE",
  "HISTORY_CUTOVER_INCOMPLETE",
  "OWNERSHIP_NOT_UNIQUE",
  "AMBIGUOUS_CUSTOMER_ACCOUNT",
  "UNMAPPED_CUSTOMER",
]);

const DATA_ERROR_CODES = new Set([
  "MALFORMED_ROW",
  "PARSE_ERROR",
  "INVALID_NET_SALES",
  "INVALID_QUANTITY",
  "MISSING_DOCUMENT",
  "MISSING_PART_NUMBER",
  "INVALID_DOCUMENT",
  "ONGOING_DOCUMENT_CONFLICT",
  "MIXED_DOCUMENT_TYPE",
  "MIXED_CUSTOMER_DOCUMENT",
]);

export type CustomerOngoingEligibilityContext = {
  companyStatus: string;
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
  verified: boolean;
  ownershipAmbiguous: boolean;
};

function issueStillOutstanding(
  reasonCode: string,
  status: string,
  ctx: CustomerOngoingEligibilityContext,
): { outstanding: boolean; kind: CustomerOngoingSalesActivity["issueKind"] } {
  if (status === "ERROR") {
    return { outstanding: true, kind: DATA_ERROR_CODES.has(reasonCode) ? "data_error" : "failed_import" };
  }
  if (status !== "SKIPPED" && status !== "WARNING") {
    return { outstanding: false, kind: "none" };
  }
  switch (reasonCode) {
    case "NOT_ACTIVE":
      return {
        outstanding: ctx.companyStatus !== "ACTIVE",
        kind: "not_active",
      };
    case "HISTORY_CUTOVER_INCOMPLETE":
      return {
        outstanding: ctx.historyStatus !== "COMPLETE",
        kind: "history_incomplete",
      };
    case "OWNERSHIP_NOT_UNIQUE":
    case "AMBIGUOUS_CUSTOMER_ACCOUNT":
      return {
        outstanding: ctx.ownershipAmbiguous || !ctx.verified,
        kind: "ownership",
      };
    case "UNMAPPED_CUSTOMER":
      return {
        outstanding: !ctx.verified,
        kind: "unverified",
      };
    case "CUSTOMER_OUT_OF_SCOPE":
    case "ALREADY_IMPORTED":
    case "BLANK_ROW":
    case "UNRECOGNISED_ROW_TYPE":
    case "NOT_IN_AB_CATALOGUE":
    case "PROTECTED_ONGOING_LINE":
    case "PROTECTED_ONGOING_DOCUMENT":
    case "HISTORIC_COMPANY_REFERENCE":
      return { outstanding: false, kind: "none" };
    default:
      if (DATA_ERROR_CODES.has(reasonCode) || ELIGIBILITY_SKIP_CODES.has(reasonCode)) {
        return { outstanding: true, kind: DATA_ERROR_CODES.has(reasonCode) ? "data_error" : "other" };
      }
      return { outstanding: false, kind: "none" };
  }
}

function companionFor(
  latest504At: string | null,
  latestTrm21qcAt: string | null,
  ctx: CustomerOngoingEligibilityContext,
): Pick<CustomerOngoingSalesActivity, "companionStatus" | "companionNote"> {
  const eligible =
    ctx.companyStatus === "ACTIVE" &&
    ctx.verified &&
    !ctx.ownershipAmbiguous &&
    ctx.historyStatus === "COMPLETE";
  if (!eligible) {
    return { companionStatus: "not_ready", companionNote: null };
  }
  if (!latest504At && !latestTrm21qcAt) {
    return {
      companionStatus: "awaiting_both",
      companionNote: "Awaiting first 504 and TRM21QC reports for this customer.",
    };
  }
  if (!latest504At) {
    return {
      companionStatus: "awaiting_504",
      companionNote: "Awaiting companion 504 report.",
    };
  }
  if (!latestTrm21qcAt) {
    return {
      companionStatus: "awaiting_trm21qc",
      companionNote: "Awaiting companion TRM21QC report.",
    };
  }
  return { companionStatus: "ready", companionNote: null };
}

async function latestOutstandingCustomerIssue(
  companyId: string,
  ctx: CustomerOngoingEligibilityContext,
): Promise<Pick<CustomerOngoingSalesActivity, "outstandingIssue" | "hasOutstandingIssues" | "issueKind">> {
  // Prefer recent diagnostics attributed to this company (poll runs keep companyId null).
  const diagnostics = await prisma.autopartImportDiagnostic.findMany({
    where: {
      companyId,
      status: { in: ["ERROR", "SKIPPED", "WARNING"] },
      importRun: {
        type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] },
        dryRun: false,
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 40,
    select: {
      status: true,
      reasonCode: true,
      reason: true,
      importRun: { select: { type: true, filename: true, status: true } },
    },
  });

  for (const row of diagnostics) {
    const verdict = issueStillOutstanding(row.reasonCode, row.status, ctx);
    if (!verdict.outstanding) continue;
    const feed = row.importRun.type === "ONGOING_504" ? "504" : "TRM21QC";
    const label =
      AUTOPART_IMPORT_REASON_LABELS[row.reasonCode as AutopartImportReasonCode] ?? row.reason;
    const file = row.importRun.filename ? ` (${row.importRun.filename})` : "";
    return {
      hasOutstandingIssues: true,
      issueKind: verdict.kind,
      outstandingIssue: `${feed}: ${label}${file}`,
    };
  }

  return {
    hasOutstandingIssues: false,
    issueKind: "none",
    outstandingIssue: null,
  };
}

export async function loadCustomerOngoingSalesActivity(
  companyId: string,
  ctx: CustomerOngoingEligibilityContext,
): Promise<CustomerOngoingSalesActivity> {
  const [latest504At, latestTrm21qcAt, issue] = await Promise.all([
    latestCommitted504At(companyId),
    latestCommittedTrm21qcAt(companyId),
    latestOutstandingCustomerIssue(companyId, ctx),
  ]);
  const companion = companionFor(latest504At, latestTrm21qcAt, ctx);
  return {
    latest504At,
    latestTrm21qcAt,
    latestImportAt: maxIso(latest504At, latestTrm21qcAt),
    ...companion,
    ...issue,
  };
}

/** Import runs that touched this customer (scoped runs or attributed docs/lines/diagnostics). */
export async function listCustomerTouchedOngoingImportRunIds(
  companyId: string,
  take = 20,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM (
      SELECT r.id, COALESCE(r."completedAt", r."createdAt") AS at
      FROM "AutopartCustomerImportRun" r
      WHERE r."companyId" = ${companyId}
        AND r."dryRun" = false
        AND r.type IN (
          CAST('ONGOING_504' AS "AutopartCustomerImportType"),
          CAST('ONGOING_TRM21QC' AS "AutopartCustomerImportType"),
          CAST('HISTORY_561L_SLRB' AS "AutopartCustomerImportType")
        )
      UNION
      SELECT r.id, COALESCE(r."completedAt", r."createdAt") AS at
      FROM "AutopartSalesDocument" d
      INNER JOIN "AutopartCustomerImportRun" r ON r.id = d."importRunId"
      WHERE d."companyId" = ${companyId}
        AND r."dryRun" = false
      UNION
      SELECT r.id, COALESCE(r."completedAt", r."createdAt") AS at
      FROM "AutopartSalesLine" l
      INNER JOIN "AutopartCustomerImportRun" r ON r.id = l."importRunId"
      WHERE l."companyId" = ${companyId}
        AND r."dryRun" = false
      UNION
      SELECT r.id, COALESCE(r."completedAt", r."createdAt") AS at
      FROM "AutopartImportDiagnostic" d
      INNER JOIN "AutopartCustomerImportRun" r ON r.id = d."importRunId"
      WHERE d."companyId" = ${companyId}
        AND r."dryRun" = false
    ) touched
    ORDER BY at DESC NULLS LAST
    LIMIT ${take}
  `);
  return rows.map((row) => row.id);
}

export async function customerTouchedImportRun(
  companyId: string,
  runId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>(Prisma.sql`
    SELECT 1 AS ok
    WHERE EXISTS (
      SELECT 1 FROM "AutopartCustomerImportRun" r
      WHERE r.id = ${runId} AND r."companyId" = ${companyId}
    )
    OR EXISTS (
      SELECT 1 FROM "AutopartSalesDocument" d
      WHERE d."importRunId" = ${runId} AND d."companyId" = ${companyId}
    )
    OR EXISTS (
      SELECT 1 FROM "AutopartSalesLine" l
      WHERE l."importRunId" = ${runId} AND l."companyId" = ${companyId}
    )
    OR EXISTS (
      SELECT 1 FROM "AutopartImportDiagnostic" d
      WHERE d."importRunId" = ${runId} AND d."companyId" = ${companyId}
    )
    LIMIT 1
  `);
  return rows.length > 0;
}
