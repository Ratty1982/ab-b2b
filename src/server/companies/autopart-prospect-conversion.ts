/**
 * Bulk conversion of eligible Autopart accounts into CRM prospects.
 * Does not copy invoice or ledger rows, create logins, or send email.
 * A deploy does not start a run. An interrupted run resumes from durable state.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";

export const PROSPECT_CONVERSION_BATCH = 50;
const STALE_MS = 3 * 60 * 1000;
const ISSUE_CAP = 2000;

const EXCLUDED_CLASSIFICATIONS = [
  "INTERNAL",
  "STAFF",
  "CASH",
  "DO_NOT_USE",
  "OBSOLETE",
  "UNIDENTIFIED",
  "REQUIRES_REVIEW",
] as const;

const runningConversions = new Set<string>();

export type ProspectConversionSummary = {
  totalAccounts: number;
  eligible: number;
  alreadyLinked: number;
  eligibleAlreadyLinked: number;
  createExpected: number;
  reuseExpected: number;
  excludedByClassification: Record<string, number>;
  conflicts: number;
  nameDuplicateGroups: number;
  nameDuplicateAccounts: number;
  sameNameDifferentCode: number;
  eligibleWithInvoiceLines: number;
  eligibleWithoutInvoiceLines: number;
  eligibleWithLedger: number;
  unmatchedInvoiceCodes: number;
  unmatchedLedgerCodes: number;
  estimatedBatches: number;
  batchSize: number;
  reconciliation?: {
    eligibleLinked: number;
    eligibleUnlinked: number;
  };
};

async function requireConvert(actorUserId: string) {
  await requireSystemPermission(actorUserId, "autopart.mapping.manage");
  await requireSystemPermission(actorUserId, "companies.create");
}

function countRow(rows: Array<{ count: number }>): number {
  return Number(rows[0]?.count ?? 0);
}

export async function buildProspectConversionSummary(): Promise<ProspectConversionSummary> {
  const [grouped, alreadyLinked, eligibleAlreadyLinked, createExpected, reuseExpected, conflicts] =
    await Promise.all([
      prisma.autopartAccount.groupBy({
        by: ["classification"],
        _count: { _all: true },
      }),
      prisma.autopartAccount.count({ where: { companyId: { not: null } } }),
      prisma.autopartAccount.count({
        where: { classification: "TRADE_CANDIDATE", companyId: { not: null } },
      }),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM "AutopartAccount" a
        WHERE a."classification" = 'TRADE_CANDIDATE'
          AND a."companyId" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "Company" c WHERE c."autopartCustomerCode" = a."accountCode"
          )
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM "AutopartAccount" a
        JOIN "Company" c ON c."autopartCustomerCode" = a."accountCode"
        WHERE a."classification" = 'TRADE_CANDIDATE'
          AND a."companyId" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "AutopartAccount" other
            WHERE other."companyId" = c.id AND other.id <> a.id
          )
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM "AutopartAccount" a
        JOIN "Company" c ON c."autopartCustomerCode" = a."accountCode"
        WHERE a."classification" = 'TRADE_CANDIDATE'
          AND a."companyId" IS NULL
          AND EXISTS (
            SELECT 1 FROM "AutopartAccount" other
            WHERE other."companyId" = c.id AND other.id <> a.id
          )
      `),
    ]);
  const excludedByClassification: Record<string, number> = {};
  let totalAccounts = 0;
  let eligible = 0;
  for (const row of grouped) {
    totalAccounts += row._count._all;
    if (row.classification === "TRADE_CANDIDATE") eligible = row._count._all;
    else excludedByClassification[row.classification] = row._count._all;
  }
  for (const key of EXCLUDED_CLASSIFICATIONS) {
    excludedByClassification[key] = excludedByClassification[key] ?? 0;
  }
  const [nameDup, sameName, withLines, withLedger, unmatchedInvoice, unmatchedLedger] =
    await Promise.all([
      prisma.$queryRaw<Array<{ groups: number; accounts: number }>>`
        SELECT COUNT(*)::int AS groups, COALESCE(SUM(cnt), 0)::int AS accounts
        FROM (
          SELECT COUNT(*) AS cnt
          FROM "AutopartAccount"
          WHERE "classification" = 'TRADE_CANDIDATE'
            AND btrim("originalName") <> ''
          GROUP BY lower(btrim("originalName"))
          HAVING COUNT(*) > 1
        ) s
      `,
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM "AutopartAccount" a
        WHERE a."classification" = 'TRADE_CANDIDATE'
          AND btrim(a."originalName") <> ''
          AND EXISTS (
            SELECT 1 FROM "Company" c
            WHERE lower(btrim(c.name)) = lower(btrim(a."originalName"))
              AND (c."autopartCustomerCode" IS NULL OR c."autopartCustomerCode" <> a."accountCode")
          )
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM "AutopartAccount" a
        WHERE a."classification" = 'TRADE_CANDIDATE'
          AND EXISTS (
            SELECT 1 FROM "AutopartInvoiceLine" l WHERE l."accountCode" = a."accountCode"
          )
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM "AutopartAccount" a
        WHERE a."classification" = 'TRADE_CANDIDATE'
          AND EXISTS (
            SELECT 1 FROM "AutopartLedgerTransaction" l WHERE l."accountCode" = a."accountCode"
          )
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS count FROM (
          SELECT l."accountCode"
          FROM "AutopartInvoiceLine" l
          LEFT JOIN "AutopartAccount" a
            ON a."accountCode" = l."accountCode" AND a."sourceSystem" = 'AUTOPART'
          WHERE a.id IS NULL
          GROUP BY l."accountCode"
        ) u
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS count FROM (
          SELECT l."accountCode"
          FROM "AutopartLedgerTransaction" l
          LEFT JOIN "AutopartAccount" a
            ON a."accountCode" = l."accountCode" AND a."sourceSystem" = 'AUTOPART'
          WHERE a.id IS NULL
          GROUP BY l."accountCode"
        ) u
      `),
    ]);
  const actionable = createExpected + reuseExpected;
  return {
    totalAccounts,
    eligible,
    alreadyLinked,
    eligibleAlreadyLinked,
    createExpected,
    reuseExpected,
    excludedByClassification,
    conflicts,
    nameDuplicateGroups: Number(nameDup[0]?.groups ?? 0),
    nameDuplicateAccounts: Number(nameDup[0]?.accounts ?? 0),
    sameNameDifferentCode: sameName,
    eligibleWithInvoiceLines: withLines,
    eligibleWithoutInvoiceLines: eligible - withLines,
    eligibleWithLedger: withLedger,
    unmatchedInvoiceCodes: unmatchedInvoice,
    unmatchedLedgerCodes: unmatchedLedger,
    estimatedBatches: Math.ceil(actionable / PROSPECT_CONVERSION_BATCH),
    batchSize: PROSPECT_CONVERSION_BATCH,
  };
}

async function countQuery(query: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(query);
  return countRow(rows);
}

function asSummary(value: Prisma.JsonValue): ProspectConversionSummary {
  return value as ProspectConversionSummary;
}

function publicRun(run: {
  id: string;
  status: string;
  dryRun: boolean;
  summary: Prisma.JsonValue;
  processed: number;
  createdProspects: number;
  reusedCompanies: number;
  skippedLinked: number;
  conflicts: number;
  errors: number;
  cursorAccountId: string | null;
  errorSummary: string | null;
  cancelRequested: boolean;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}) {
  const summary = asSummary(run.summary);
  const planned = summary.createExpected + summary.reuseExpected + summary.conflicts;
  const percent =
    run.status === "COMMITTED"
      ? 100
      : planned === 0
        ? 100
        : Math.min(100, Math.round((run.processed / planned) * 100));
  return {
    id: run.id,
    status: run.status,
    dryRun: run.dryRun,
    summary,
    processed: run.processed,
    createdProspects: run.createdProspects,
    reusedCompanies: run.reusedCompanies,
    skippedLinked: run.skippedLinked,
    conflicts: run.conflicts,
    errors: run.errors,
    percent,
    cursorAccountId: run.cursorAccountId,
    errorSummary: run.errorSummary,
    cancelRequested: run.cancelRequested,
    startedAt: run.startedAt?.toISOString() ?? null,
    heartbeatAt: run.heartbeatAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

async function assertNoOtherRunning(runId?: string) {
  const running = await prisma.autopartProspectConversionRun.findFirst({
    where: { status: "RUNNING", ...(runId ? { id: { not: runId } } : {}) },
    select: { id: true },
  });
  if (running) {
    throw new AuthError(
      "A prospect conversion is already in progress. Resume that run instead of starting another.",
      "CONFLICT",
      409,
    );
  }
}

export async function previewAutopartProspectConversion(actorUserId: string) {
  await requireConvert(actorUserId);
  await assertNoOtherRunning();
  const summary = await buildProspectConversionSummary();
  const run = await prisma.autopartProspectConversionRun.create({
    data: {
      status: "PREVIEWED",
      dryRun: true,
      summary,
      createdById: actorUserId,
    },
  });
  await recordAuditEvent({
    action: "autopart_prospect_conversion_previewed",
    entityType: "AutopartProspectConversionRun",
    entityId: run.id,
    actorUserId,
    metadata: {
      createExpected: summary.createExpected,
      reuseExpected: summary.reuseExpected,
      excluded: Object.values(summary.excludedByClassification).reduce((sum, n) => sum + n, 0),
    },
  });
  return publicRun(run);
}

export async function getAutopartProspectConversion(actorUserId: string, runId: string) {
  await requireConvert(actorUserId);
  const run = await prisma.autopartProspectConversionRun.findUnique({ where: { id: runId } });
  if (!run) throw new AuthError("Conversion run was not found", "NOT_FOUND", 404);
  return publicRun(run);
}

export async function getLatestAutopartProspectConversion(actorUserId: string) {
  await requireConvert(actorUserId);
  const run = await prisma.autopartProspectConversionRun.findFirst({
    orderBy: { createdAt: "desc" },
  });
  return run ? publicRun(run) : null;
}

export async function confirmAutopartProspectConversion(
  actorUserId: string,
  input: { runId: string; confirmed: boolean },
) {
  const run = await beginAutopartProspectConversion(actorUserId, input);
  void executeAutopartProspectConversion(input.runId).catch(() => undefined);
  return run;
}

export async function beginAutopartProspectConversion(
  actorUserId: string,
  input: { runId: string; confirmed: boolean },
) {
  if (input.confirmed !== true) {
    throw new AuthError(
      "Confirm the dry-run summary before creating prospects. Deployment does not start a conversion.",
      "VALIDATION",
      400,
    );
  }
  const runId = input.runId;
  await requireConvert(actorUserId);
  await assertNoOtherRunning(runId);
  const claimed = await prisma.autopartProspectConversionRun.updateMany({
    where: { id: runId, status: "PREVIEWED" },
    data: {
      status: "RUNNING",
      dryRun: false,
      startedAt: new Date(),
      heartbeatAt: new Date(),
      cancelRequested: false,
      errorSummary: null,
    },
  });
  if (claimed.count !== 1) {
    throw new AuthError(
      "Preview the conversion and confirm that run before creating prospects",
      "VALIDATION",
      400,
    );
  }
  await recordAuditEvent({
    action: "autopart_prospect_conversion_started",
    entityType: "AutopartProspectConversionRun",
    entityId: runId,
    actorUserId,
  });
  return getAutopartProspectConversion(actorUserId, runId);
}

export async function resumeAutopartProspectConversion(actorUserId: string, runId: string) {
  await requireConvert(actorUserId);
  const run = await prisma.autopartProspectConversionRun.findUnique({ where: { id: runId } });
  if (!run) throw new AuthError("Conversion run was not found", "NOT_FOUND", 404);
  if (run.status === "COMMITTED" || run.status === "CANCELLED") return publicRun(run);
  if (run.status !== "RUNNING" && run.status !== "FAILED") {
    throw new AuthError("This conversion is not waiting to resume", "VALIDATION", 400);
  }
  if (runningConversions.has(runId)) {
    throw new AuthError("This conversion is already running", "CONFLICT", 409);
  }
  const fresh =
    run.heartbeatAt != null &&
    Date.now() - run.heartbeatAt.getTime() < STALE_MS &&
    run.status === "RUNNING";
  if (fresh) {
    throw new AuthError("This conversion is still reporting progress", "CONFLICT", 409);
  }
  await assertNoOtherRunning(runId);
  await prisma.autopartProspectConversionRun.update({
    where: { id: runId },
    data: {
      status: "RUNNING",
      heartbeatAt: new Date(),
      errorSummary: null,
      cancelRequested: false,
    },
  });
  void executeAutopartProspectConversion(runId).catch(() => undefined);
  return getAutopartProspectConversion(actorUserId, runId);
}

export async function cancelAutopartProspectConversion(actorUserId: string, runId: string) {
  await requireConvert(actorUserId);
  const run = await prisma.autopartProspectConversionRun.findUnique({ where: { id: runId } });
  if (!run) throw new AuthError("Conversion run was not found", "NOT_FOUND", 404);
  if (run.status === "COMMITTED") {
    throw new AuthError("A completed conversion is not cancelled", "VALIDATION", 400);
  }
  if (run.status === "RUNNING") {
    await prisma.autopartProspectConversionRun.update({
      where: { id: runId },
      data: { cancelRequested: true },
    });
    return { cancelled: false, requested: true };
  }
  await prisma.autopartProspectConversionRun.update({
    where: { id: runId },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
  return { cancelled: true, requested: false };
}

export async function executeAutopartProspectConversion(
  runId: string,
  opts?: { maxBatches?: number; batchSize?: number },
) {
  if (runningConversions.has(runId)) return;
  runningConversions.add(runId);
  const batchSize = opts?.batchSize ?? PROSPECT_CONVERSION_BATCH;
  try {
    let batches = 0;
    for (;;) {
      const run = await prisma.autopartProspectConversionRun.findUnique({ where: { id: runId } });
      if (!run || run.status !== "RUNNING") return;
      if (run.cancelRequested) {
        await prisma.autopartProspectConversionRun.update({
          where: { id: runId },
          data: { status: "CANCELLED", completedAt: new Date(), heartbeatAt: new Date() },
        });
        return;
      }
      const done = await processConversionBatch(runId, run.cursorAccountId, batchSize);
      batches += 1;
      if (done === "finished") return;
      if (opts?.maxBatches != null && batches >= opts.maxBatches) return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversion failed";
    await prisma.autopartProspectConversionRun.update({
      where: { id: runId },
      data: { status: "FAILED", errorSummary: message.slice(0, 500), heartbeatAt: new Date() },
    });
  } finally {
    runningConversions.delete(runId);
  }
}

async function processConversionBatch(
  runId: string,
  cursor: string | null,
  batchSize: number,
): Promise<"continue" | "finished"> {
  const accounts = await prisma.autopartAccount.findMany({
    where: {
      classification: "TRADE_CANDIDATE",
      companyId: null,
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: batchSize,
  });
  if (accounts.length === 0) {
    await finishConversion(runId);
    return "finished";
  }
  const reps = await prisma.salesRep.findMany({
    where: { active: true, code: { not: null } },
    select: { id: true, code: true },
  });
  const repByCode = new Map<string, string>();
  const ambiguousReps = new Set<string>();
  for (const rep of reps) {
    const key = rep.code?.trim().toUpperCase();
    if (!key) continue;
    if (repByCode.has(key) || ambiguousReps.has(key)) {
      repByCode.delete(key);
      ambiguousReps.add(key);
    } else {
      repByCode.set(key, rep.id);
    }
  }
  let created = 0;
  let reused = 0;
  let skipped = 0;
  let conflicts = 0;
  let errors = 0;
  let lastId = cursor;
  for (const account of accounts) {
    lastId = account.id;
    try {
      const outcome = await convertOneAccount(account, repByCode);
      if (outcome === "created") created += 1;
      else if (outcome === "reused") reused += 1;
      else if (outcome === "conflict") {
        conflicts += 1;
        await storeIssue(
          runId,
          account.accountCode,
          "CONFLICT",
          "WARNING",
          `Account ${account.accountCode} matches a company that is already linked to a different Autopart account.`,
        );
      } else skipped += 1;
    } catch (error) {
      errors += 1;
      const message = error instanceof Error ? error.message : "Conversion failed";
      await storeIssue(runId, account.accountCode, "ERROR", "ERROR", message.slice(0, 500));
    }
  }
  await prisma.autopartProspectConversionRun.update({
    where: { id: runId },
    data: {
      processed: { increment: accounts.length },
      createdProspects: { increment: created },
      reusedCompanies: { increment: reused },
      skippedLinked: { increment: skipped },
      conflicts: { increment: conflicts },
      errors: { increment: errors },
      cursorAccountId: lastId,
      heartbeatAt: new Date(),
    },
  });
  await recordAuditEvent({
    action: "autopart_prospect_conversion_batch",
    entityType: "AutopartProspectConversionRun",
    entityId: runId,
    metadata: { created, reused, skipped, conflicts, errors, cursor: lastId },
  });
  return "continue";
}

type ConvertAccount = {
  id: string;
  accountCode: string;
  originalName: string;
  nameTruncated: boolean;
  areaCode: string | null;
  repCode: string | null;
};

async function convertOneAccount(
  account: ConvertAccount,
  repByCode: Map<string, string>,
): Promise<"created" | "reused" | "skipped" | "conflict"> {
  return prisma.$transaction(async (tx) => {
    const fresh = await tx.autopartAccount.findUnique({
      where: { id: account.id },
      select: { companyId: true },
    });
    if (!fresh) return "skipped";
    if (fresh.companyId) return "skipped";
    const holder = await tx.company.findUnique({
      where: { autopartCustomerCode: account.accountCode },
      select: { id: true, status: true },
    });
    if (holder) {
      const other = await tx.autopartAccount.findFirst({
        where: { companyId: holder.id, id: { not: account.id } },
        select: { id: true },
      });
      if (other) return "conflict";
      const linked = await tx.autopartAccount.updateMany({
        where: { id: account.id, companyId: null },
        data: { companyId: holder.id, portalEligible: false, historicalAccessEnabled: false },
      });
      return linked.count === 1 ? "reused" : "skipped";
    }
    const name = account.originalName.trim().slice(0, 200) || account.accountCode;
    let companyId: string;
    try {
      const company = await tx.company.create({
        data: {
          name,
          status: "PROSPECT",
          autopartCustomerCode: account.accountCode,
          notes: provenanceNote(account),
        },
        select: { id: true },
      });
      companyId = company.id;
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const raced = await tx.company.findUnique({
        where: { autopartCustomerCode: account.accountCode },
        select: { id: true },
      });
      if (!raced) throw error;
      const other = await tx.autopartAccount.findFirst({
        where: { companyId: raced.id, id: { not: account.id } },
        select: { id: true },
      });
      if (other) return "conflict";
      const linked = await tx.autopartAccount.updateMany({
        where: { id: account.id, companyId: null },
        data: { companyId: raced.id, portalEligible: false, historicalAccessEnabled: false },
      });
      return linked.count === 1 ? "reused" : "skipped";
    }
    const linked = await tx.autopartAccount.updateMany({
      where: { id: account.id, companyId: null },
      data: { companyId, portalEligible: false, historicalAccessEnabled: false },
    });
    if (linked.count !== 1) {
      await tx.company.delete({ where: { id: companyId } });
      return "skipped";
    }
    const repId = account.repCode ? repByCode.get(account.repCode.trim().toUpperCase()) : undefined;
    if (repId) {
      await tx.companyAssignment.create({
        data: { companyId, salesRepId: repId, isPrimary: true },
      });
    }
    return "created";
  });
}

function provenanceNote(account: ConvertAccount): string {
  const area = account.areaCode?.trim() || "—";
  const rep = account.repCode?.trim() || "—";
  const truncated = account.nameTruncated ? " Name may be truncated by the Autopart export." : "";
  return `Created from the Autopart customer master. Account ${account.accountCode}. Area ${area}. Rep ${rep}. Source AUTOPART/407EXP.${truncated} No portal user was created.`;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function storeIssue(
  runId: string,
  accountCode: string,
  issueType: string,
  severity: string,
  explanation: string,
) {
  const count = await prisma.autopartProspectConversionIssue.count({ where: { runId } });
  if (count >= ISSUE_CAP) return;
  await prisma.autopartProspectConversionIssue.create({
    data: { runId, accountCode, issueType, severity, explanation: explanation.slice(0, 500) },
  });
}

async function finishConversion(runId: string) {
  const [eligibleLinked, eligibleUnlinked] = await Promise.all([
    prisma.autopartAccount.count({
      where: { classification: "TRADE_CANDIDATE", companyId: { not: null } },
    }),
    prisma.autopartAccount.count({
      where: { classification: "TRADE_CANDIDATE", companyId: null },
    }),
  ]);
  const current = await prisma.autopartProspectConversionRun.findUnique({ where: { id: runId } });
  if (!current || current.status !== "RUNNING") return;
  const summary = {
    ...asSummary(current.summary),
    reconciliation: { eligibleLinked, eligibleUnlinked },
  };
  await prisma.autopartProspectConversionRun.update({
    where: { id: runId },
    data: {
      status: "COMMITTED",
      summary,
      completedAt: new Date(),
      heartbeatAt: new Date(),
      dryRun: false,
    },
  });
  await recordAuditEvent({
    action: "autopart_prospect_conversion_completed",
    entityType: "AutopartProspectConversionRun",
    entityId: runId,
    metadata: {
      createdProspects: current.createdProspects,
      reusedCompanies: current.reusedCompanies,
      eligibleLinked,
      eligibleUnlinked,
    },
  });
}

export async function writeProspectConversionExceptions(
  actorUserId: string,
  runId: string,
  write: (chunk: string) => void,
) {
  await requireConvert(actorUserId);
  const run = await prisma.autopartProspectConversionRun.findUnique({ where: { id: runId } });
  if (!run) throw new AuthError("Conversion run was not found", "NOT_FOUND", 404);
  write("accountCode,name,classification,reason,detail\n");
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.autopartAccount.findMany({
      where: { classification: { not: "TRADE_CANDIDATE" } },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, accountCode: true, originalName: true, classification: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      write(
        csvLine([
          row.accountCode,
          row.originalName,
          row.classification,
          "EXCLUDED_CLASSIFICATION",
          "Not a trade candidate. Left unchanged for manual review.",
        ]),
      );
    }
    cursor = rows[rows.length - 1]?.id;
    if (rows.length < 200) break;
  }
  const issues = await prisma.autopartProspectConversionIssue.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    take: ISSUE_CAP,
  });
  for (const issue of issues) {
    write(csvLine([issue.accountCode ?? "", "", "", issue.issueType, issue.explanation]));
  }
  const nameRows = await prisma.$queryRaw<Array<{ accountCode: string; originalName: string }>>`
    SELECT a."accountCode", a."originalName"
    FROM "AutopartAccount" a
    JOIN (
      SELECT lower(btrim("originalName")) AS name
      FROM "AutopartAccount"
      WHERE "classification" = 'TRADE_CANDIDATE' AND btrim("originalName") <> ''
      GROUP BY 1
      HAVING COUNT(*) > 1
    ) d ON d.name = lower(btrim(a."originalName"))
    WHERE a."classification" = 'TRADE_CANDIDATE'
    ORDER BY a."originalName", a."accountCode"
  `;
  for (const row of nameRows) {
    write(
      csvLine([
        row.accountCode,
        row.originalName,
        "TRADE_CANDIDATE",
        "NAME_DUPLICATE",
        "Same Autopart name as another trade account. Companies were not merged.",
      ]),
    );
  }
  const companyNameRows = await prisma.$queryRaw<
    Array<{ accountCode: string; originalName: string; companyName: string }>
  >`
    SELECT a."accountCode", a."originalName", c.name AS "companyName"
    FROM "AutopartAccount" a
    JOIN "Company" c ON lower(btrim(c.name)) = lower(btrim(a."originalName"))
    WHERE a."classification" = 'TRADE_CANDIDATE'
      AND btrim(a."originalName") <> ''
      AND (c."autopartCustomerCode" IS NULL OR c."autopartCustomerCode" <> a."accountCode")
    ORDER BY a."accountCode"
  `;
  for (const row of companyNameRows) {
    write(
      csvLine([
        row.accountCode,
        row.originalName,
        "TRADE_CANDIDATE",
        "EXISTING_COMPANY_NAME",
        `Name matches CRM company ${row.companyName} with a different Autopart code. Not merged.`,
      ]),
    );
  }
  const unmatched = await prisma.$queryRaw<Array<{ accountCode: string; source: string }>>`
    SELECT "accountCode", 'INVOICE' AS source FROM (
      SELECT l."accountCode"
      FROM "AutopartInvoiceLine" l
      LEFT JOIN "AutopartAccount" a
        ON a."accountCode" = l."accountCode" AND a."sourceSystem" = 'AUTOPART'
      WHERE a.id IS NULL
      GROUP BY l."accountCode"
    ) i
    UNION
    SELECT "accountCode", 'LEDGER' AS source FROM (
      SELECT l."accountCode"
      FROM "AutopartLedgerTransaction" l
      LEFT JOIN "AutopartAccount" a
        ON a."accountCode" = l."accountCode" AND a."sourceSystem" = 'AUTOPART'
      WHERE a.id IS NULL
      GROUP BY l."accountCode"
    ) g
    ORDER BY 1, 2
  `;
  for (const row of unmatched) {
    write(
      csvLine([
        row.accountCode,
        "",
        "",
        "UNMATCHED_ACCOUNT_CODE",
        `${row.source} history has no Autopart customer-master account. No prospect was created.`,
      ]),
    );
  }
}

function csvLine(cells: string[]): string {
  return `${cells.map(csvCell).join(",")}\n`;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}
