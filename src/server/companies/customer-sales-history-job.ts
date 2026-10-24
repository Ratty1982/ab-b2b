/**
 * Durable customer-history confirmation.
 * Rows are staged first. Live sales and the customer cutover change only when
 * publication commits, so a failed or interrupted job cannot look complete.
 */
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type CustomerSalesHistoryJob } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError } from "@/server/rbac/guards";
import {
  loadCustomerSalesHistoryTarget,
  prepareCustomerSalesHistory,
  requireHistoryImporterForCompany,
  type CustomerSalesHistoryCounts,
} from "@/server/companies/customer-sales-history-import";
import {
  claimCustomerSalesUploads,
  markCustomerSalesUploads,
  readVerifiedCustomerSalesUpload,
} from "@/server/companies/customer-sales-upload";
import { streamFilterReport } from "@/server/companies/customer-sales-report-filter";

export const CUSTOMER_SALES_HISTORY_STAGE_BATCH = 1_000;
/** Staging / queued lease. A fresh heartbeat blocks a second worker. */
export const CUSTOMER_SALES_HISTORY_STALE_HEARTBEAT_MS = 120_000;
/** Publication can run for PUBLISH_TIMEOUT_MS; do not reclaim sooner. */
/** Large 100k+ publishes need headroom on slower CI/dev hosts. */
export const CUSTOMER_SALES_HISTORY_PUBLISH_TIMEOUT_MS = 600_000;
export const CUSTOMER_SALES_HISTORY_PUBLISH_STALE_MS =
  CUSTOMER_SALES_HISTORY_PUBLISH_TIMEOUT_MS + 30_000;
export const CUSTOMER_SALES_HISTORY_FINGERPRINT_INDEX =
  "AutopartSalesLine_company_561l_fingerprint_uidx";

const STALE_HEARTBEAT_MS = CUSTOMER_SALES_HISTORY_STALE_HEARTBEAT_MS;
const PUBLISH_TIMEOUT_MS = CUSTOMER_SALES_HISTORY_PUBLISH_TIMEOUT_MS;
const PUBLISH_STALE_MS = CUSTOMER_SALES_HISTORY_PUBLISH_STALE_MS;

const running = new Set<string>();
const preparedPlans = new Map<string, Awaited<ReturnType<typeof prepareCustomerSalesHistory>>>();
const reportCache = new Map<string, FilteredReport>();
const runIds = new Map<string, string>();

/** Test/process-crash helper: drop the in-memory runner reservation without failing the job. */
export function releaseLocalCustomerSalesHistoryRunner(jobId: string) {
  running.delete(jobId);
}

export function localCustomerSalesHistoryRunnerActive(jobId: string) {
  return running.has(jobId);
}

class RunnerAbandonedError extends Error {
  constructor() {
    super("Import runner abandoned the job without failing it.");
    this.name = "RunnerAbandonedError";
  }
}

type FilteredReport = {
  text561l?: string;
  textSlrb?: string;
  rowsRead: number;
  matchingRows: number;
  otherCustomerRows: number;
};

type StageWork = {
  seq: number;
  kind: "DOCUMENT" | "LINE";
  duplicate: boolean;
  documentType: string;
  documentReference: string;
  lineNumber: number;
  fingerprint: string;
  account: string;
  sku: string | null;
  description: string | null;
  units: string | null;
  salesNet: string | null;
  goodsNet: string | null;
  vat: string | null;
  grossTotal: string | null;
  documentDate: Date | null;
  rawInvAndLn: string | null;
  source: string;
  matchedVariantId: string | null;
  matchStatus: string | null;
};

export type CustomerSalesHistoryJobView = {
  jobId: string;
  companyId: string;
  status: CustomerSalesHistoryJob["status"];
  phase: string;
  rowsProcessed: number;
  rowsStaged: number;
  rowsStored: number;
  rowsImported: number;
  duplicates: number;
  rejected: number;
  failed: number;
  productLines: number;
  supportingDocuments: number;
  ledgerRows: number;
  rowsRead: number;
  matchingRows: number;
  otherCustomerRows: number;
  historyFrom: string | null;
  historyTo: string | null;
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE" | null;
  error: string | null;
  runId: string | null;
  filename561l: string | null;
  filenameSlrb: string | null;
  abandoned: boolean;
  sourceAvailable: boolean;
  sourceExpired: boolean;
  canRetry: boolean;
  sourceMessage: string | null;
};

export type CustomerSalesHistoryJobHooks = {
  maxBatches?: number;
  failBeforePublish?: boolean;
  /** Leave the job in PUBLISHING with a live token, as if the process died mid-publication. */
  abandonDuringPublish?: boolean;
};

type HistoryInput = {
  companyId: string;
  text561l?: string;
  textSlrb?: string;
  filename561l?: string;
  filenameSlrb?: string;
};

type HistoryOptions = {
  bounded?: boolean;
  sourceSha256561l?: string | null;
  sourceSha256Slrb?: string | null;
  rowsRead?: number;
  otherCustomerRows?: number;
};

function hashText(text: string | undefined): string | null {
  if (!text) return null;
  return createHash("sha256").update(text).digest("hex");
}

function utcNoon(dateOnly: string | null): Date | null {
  if (!dateOnly) return null;
  return new Date(`${dateOnly}T12:00:00.000Z`);
}

function classifiedCount(counts: CustomerSalesHistoryCounts) {
  return counts.import + counts.duplicate + counts.ledger + counts.rejected;
}

function historyStatusOf(value: string | null): CustomerSalesHistoryJobView["historyStatus"] {
  if (value === "NOT_STARTED" || value === "REVIEW" || value === "COMPLETE") return value;
  return null;
}

function dayOf(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function staleCutoff(status: CustomerSalesHistoryJob["status"]) {
  return status === "PUBLISHING" ? PUBLISH_STALE_MS : STALE_HEARTBEAT_MS;
}

export function customerSalesHistoryJobAbandoned(job: {
  status: CustomerSalesHistoryJob["status"];
  runnerToken: string | null;
  heartbeatAt: Date | null;
}) {
  if (job.status !== "STAGING" && job.status !== "PUBLISHING") return false;
  if (!job.runnerToken && !job.heartbeatAt) return true;
  if (!job.heartbeatAt) return Boolean(job.runnerToken);
  return Date.now() - job.heartbeatAt.getTime() >= staleCutoff(job.status);
}

async function inspectJobSource(job: CustomerSalesHistoryJob): Promise<{
  sourceAvailable: boolean;
  sourceExpired: boolean;
  sourceMessage: string | null;
}> {
  if (!job.upload561lId && !job.uploadSlrbId) {
    return { sourceAvailable: true, sourceExpired: false, sourceMessage: null };
  }
  const ids = uploadIds(job);
  const uploads = await prisma.customerSalesUpload.findMany({ where: { id: { in: ids } } });
  if (uploads.length !== ids.length) {
    return {
      sourceAvailable: false,
      sourceExpired: true,
      sourceMessage: "The uploaded report is no longer stored. Upload it again.",
    };
  }
  for (const upload of uploads) {
    if (upload.status === "EXPIRED" || upload.expiresAt.getTime() <= Date.now()) {
      return {
        sourceAvailable: false,
        sourceExpired: true,
        sourceMessage: "This upload has expired. Upload the report again. No sales records were written.",
      };
    }
    if (!upload.storagePath) {
      return {
        sourceAvailable: false,
        sourceExpired: true,
        sourceMessage: "The uploaded report is no longer stored. Upload it again.",
      };
    }
    if (job.upload561lId === upload.id && job.sha256561l && upload.sha256 !== job.sha256561l) {
      return {
        sourceAvailable: false,
        sourceExpired: false,
        sourceMessage: "Uploaded file hash does not match the stored file. No sales records were written.",
      };
    }
    if (job.uploadSlrbId === upload.id && job.sha256Slrb && upload.sha256 !== job.sha256Slrb) {
      return {
        sourceAvailable: false,
        sourceExpired: false,
        sourceMessage: "Uploaded file hash does not match the stored file. No sales records were written.",
      };
    }
  }
  return { sourceAvailable: true, sourceExpired: false, sourceMessage: null };
}

async function toProgress(
  job: CustomerSalesHistoryJob,
  runId: string | null,
  source?: { sourceAvailable: boolean; sourceExpired: boolean; sourceMessage: string | null },
): Promise<CustomerSalesHistoryJobView> {
  const inspected = source ?? (await inspectJobSource(job));
  const abandoned = customerSalesHistoryJobAbandoned(job);
  const canRetry =
    (job.status === "FAILED" || abandoned) &&
    inspected.sourceAvailable &&
    Boolean(job.upload561lId || job.uploadSlrbId);
  return {
    jobId: job.id,
    companyId: job.companyId,
    status: job.status,
    phase: job.phase,
    rowsProcessed: job.rowsProcessed,
    rowsStaged: job.rowsStaged,
    rowsStored: job.rowsStored,
    rowsImported: job.rowsStored,
    duplicates: job.duplicates,
    rejected: job.rejected,
    failed: job.failed,
    productLines: job.productLines,
    supportingDocuments: job.supportingDocuments,
    ledgerRows: job.ledgerRows,
    rowsRead: job.rowsRead,
    matchingRows: reportCache.get(job.id)?.matchingRows ?? Math.max(0, job.rowsRead - job.otherCustomerRows),
    otherCustomerRows: job.otherCustomerRows,
    historyFrom: dayOf(job.historyFrom),
    historyTo: dayOf(job.historyTo),
    historyStatus: historyStatusOf(job.historyStatus),
    error: job.error ?? inspected.sourceMessage,
    runId: runId ?? runIds.get(job.id) ?? null,
    filename561l: job.filename561l,
    filenameSlrb: job.filenameSlrb,
    abandoned,
    sourceAvailable: inspected.sourceAvailable,
    sourceExpired: inspected.sourceExpired,
    canRetry,
    sourceMessage: inspected.sourceMessage,
  };
}

export async function reportCustomerSalesHistoryIndexHealth() {
  const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE indexname = ${CUSTOMER_SALES_HISTORY_FINGERPRINT_INDEX}
  `;
  const fingerprintIndexPresent = rows.length > 0;
  if (!fingerprintIndexPresent) {
    console.error("[ab:history-import]", {
      event: "HISTORY_FINGERPRINT_INDEX_MISSING",
      index: CUSTOMER_SALES_HISTORY_FINGERPRINT_INDEX,
      note: "The unique 561L fingerprint index is absent. Duplicate company fingerprints likely blocked creation; retries may not be fully protected until duplicates are resolved and the index is created.",
    });
  }
  return { fingerprintIndexPresent, indexName: CUSTOMER_SALES_HISTORY_FINGERPRINT_INDEX };
}

function uploadIds(job: { upload561lId: string | null; uploadSlrbId: string | null }) {
  return [job.upload561lId, job.uploadSlrbId].filter((id): id is string => Boolean(id));
}

function sameUploads(
  job: { upload561lId: string | null; uploadSlrbId: string | null },
  input: { upload561lId?: string; uploadSlrbId?: string },
) {
  return (job.upload561lId ?? null) === (input.upload561lId ?? null) && (job.uploadSlrbId ?? null) === (input.uploadSlrbId ?? null);
}

export function scheduleCustomerSalesHistoryJob(jobId: string) {
  if (running.has(jobId)) return false;
  running.add(jobId);
  setTimeout(() => {
    void runCustomerSalesHistoryJob(jobId, { reserved: true }).catch((error: unknown) => {
      console.error("[ab:history-import]", {
        event: "HISTORY_JOB_FAILED",
        jobId,
        error: error instanceof Error ? error.message : error,
      });
    });
  }, 0);
  return true;
}

/**
 * Find unfinished history jobs left after a crash or restart and schedule them.
 * Does not enable mailbox/ongoing imports. FAILED jobs need an explicit staff retry.
 */
export async function recoverAbandonedCustomerSalesHistoryJobs(options?: {
  limit?: number;
  now?: Date;
}) {
  const limit = Math.max(1, Math.min(options?.limit ?? 5, 25));
  const now = options?.now ?? new Date();
  const stagingStale = new Date(now.getTime() - STALE_HEARTBEAT_MS);
  const publishStale = new Date(now.getTime() - PUBLISH_STALE_MS);
  const jobs = await prisma.customerSalesHistoryJob.findMany({
    where: {
      OR: [
        {
          status: "QUEUED",
          OR: [{ runnerToken: null }, { heartbeatAt: null }, { heartbeatAt: { lt: stagingStale } }],
        },
        {
          status: "STAGING",
          OR: [{ runnerToken: null }, { heartbeatAt: null }, { heartbeatAt: { lt: stagingStale } }],
        },
        {
          status: "PUBLISHING",
          OR: [{ runnerToken: null }, { heartbeatAt: null }, { heartbeatAt: { lt: publishStale } }],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, status: true, companyId: true },
  });
  const scheduled: string[] = [];
  for (const job of jobs) {
    releaseLocalCustomerSalesHistoryRunner(job.id);
    if (scheduleCustomerSalesHistoryJob(job.id)) {
      scheduled.push(job.id);
      console.info("[ab:history-import]", {
        event: "HISTORY_JOB_RECOVERED",
        jobId: job.id,
        companyId: job.companyId,
        status: job.status,
      });
    }
  }
  return scheduled;
}

export async function getCustomerSalesHistoryJob(actorUserId: string, jobId: string) {
  const job = await prisma.customerSalesHistoryJob.findUnique({ where: { id: jobId } });
  if (!job) throw new AuthError("Import job was not found.", "NOT_FOUND", 404);
  await requireHistoryImporterForCompany(actorUserId, job.companyId);
  return toProgress(job, null);
}

export async function getLatestCustomerSalesHistoryJob(actorUserId: string, companyId: string) {
  await requireHistoryImporterForCompany(actorUserId, companyId);
  const active = await prisma.customerSalesHistoryJob.findFirst({
    where: {
      companyId,
      status: { in: ["QUEUED", "STAGING", "PUBLISHING", "FAILED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (active) return toProgress(active, null);
  const complete = await prisma.customerSalesHistoryJob.findFirst({
    where: { companyId, status: "COMPLETE" },
    orderBy: { createdAt: "desc" },
  });
  return complete ? toProgress(complete, null) : null;
}

export async function retryCustomerSalesHistoryJob(actorUserId: string, jobId: string) {
  const job = await prisma.customerSalesHistoryJob.findUnique({ where: { id: jobId } });
  if (!job) throw new AuthError("Import job was not found.", "NOT_FOUND", 404);
  await requireHistoryImporterForCompany(actorUserId, job.companyId);
  if (job.status === "COMPLETE") {
    return toProgress(job, null);
  }
  const source = await inspectJobSource(job);
  if (!source.sourceAvailable) {
    await prisma.customerSalesHistoryJob.updateMany({
      where: { id: job.id, status: { not: "COMPLETE" } },
      data: {
        status: "FAILED",
        error: (source.sourceMessage ?? "Upload the report again.").slice(0, 500),
        runnerToken: null,
        heartbeatAt: null,
        completedAt: new Date(),
      },
    });
    const failed = await prisma.customerSalesHistoryJob.findUniqueOrThrow({ where: { id: job.id } });
    return toProgress(failed, null, source);
  }
  const abandoned = customerSalesHistoryJobAbandoned(job);
  if (
    (job.status === "QUEUED" || job.status === "STAGING" || job.status === "PUBLISHING") &&
    !abandoned &&
    job.runnerToken &&
    job.heartbeatAt &&
    Date.now() - job.heartbeatAt.getTime() < staleCutoff(job.status)
  ) {
    return toProgress(job, null, source);
  }
  if (job.status === "FAILED" || abandoned) {
    await prisma.customerSalesHistoryJob.updateMany({
      where: { id: job.id, status: { in: ["FAILED", "STAGING", "PUBLISHING", "QUEUED"] } },
      data: {
        status: job.status === "FAILED" ? "FAILED" : job.status,
        error: null,
        completedAt: null,
        runnerToken: null,
        heartbeatAt: null,
      },
    });
  }
  const ids = uploadIds(job);
  if (ids.length) {
    try {
      await claimCustomerSalesUploads(ids);
    } catch (error) {
      if (job.status === "FAILED" || abandoned) throw error;
    }
  }
  releaseLocalCustomerSalesHistoryRunner(job.id);
  scheduleCustomerSalesHistoryJob(job.id);
  const current = await prisma.customerSalesHistoryJob.findUniqueOrThrow({ where: { id: job.id } });
  return toProgress(current, null, source);
}

export async function publishPreparedCustomerSalesHistory(args: {
  actorUserId: string;
  input: HistoryInput;
  options?: HistoryOptions;
  prepared: Awaited<ReturnType<typeof prepareCustomerSalesHistory>>;
}) {
  const options = args.options;
  const job = await prisma.customerSalesHistoryJob.create({
    data: {
      companyId: args.prepared.target.companyId,
      actorUserId: args.actorUserId,
      status: "QUEUED",
      filename561l: args.input.filename561l ?? null,
      filenameSlrb: args.input.filenameSlrb ?? null,
      sha256561l: options?.sourceSha256561l ?? hashText(args.input.text561l),
      sha256Slrb: options?.sourceSha256Slrb ?? hashText(args.input.textSlrb),
      countedFileRows: options?.rowsRead != null,
      rowsRead: options?.rowsRead ?? 0,
      otherCustomerRows: options?.otherCustomerRows ?? 0,
    },
  });
  preparedPlans.set(job.id, args.prepared);
  try {
    const progress = await runCustomerSalesHistoryJob(job.id);
    if (progress.status === "FAILED") {
      throw new AuthError(progress.error ?? "Import failed. No completed history was saved.", "VALIDATION", 400);
    }
    if (progress.status !== "COMPLETE") {
      throw new AuthError("Import did not finish. Customer history was not changed.", "VALIDATION", 409);
    }
    return {
      runId: progress.runId,
      rowsImported: progress.rowsStored,
      duplicates: progress.duplicates,
      historyFrom: progress.historyFrom,
      historyTo: progress.historyTo,
      historyStatus: progress.historyStatus ?? args.prepared.preview.historyStatus,
    };
  } finally {
    preparedPlans.delete(job.id);
  }
}

export async function enqueueCustomerSalesHistoryUpload(
  actorUserId: string,
  input: { companyId: string; upload561lId?: string; uploadSlrbId?: string },
) {
  await requireHistoryImporterForCompany(actorUserId, input.companyId);
  if (!input.upload561lId && !input.uploadSlrbId) {
    throw new AuthError("Choose a 561L report, an SLRB report, or both.", "VALIDATION", 400);
  }
  const active = await prisma.customerSalesHistoryJob.findMany({
    where: {
      companyId: input.companyId,
      status: { in: ["QUEUED", "STAGING", "PUBLISHING", "FAILED"] },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const same = active.find((job) => sameUploads(job, input));
  const blocker = active.find((job) => job.status !== "FAILED" && job.id !== same?.id);
  if (blocker) {
    throw new AuthError(
      "An import is already running for this customer. Wait for it to finish. No extra sales records were written.",
      "VALIDATION",
      409,
    );
  }

  const upload561l = input.upload561lId
    ? await readVerifiedCustomerSalesUpload(
        { actorUserId, uploadId: input.upload561lId, companyId: input.companyId, role: "HISTORY_561L" },
        { allowProcessing: Boolean(same) },
      )
    : null;
  const uploadSlrb = input.uploadSlrbId
    ? await readVerifiedCustomerSalesUpload(
        { actorUserId, uploadId: input.uploadSlrbId, companyId: input.companyId, role: "HISTORY_SLRB" },
        { allowProcessing: Boolean(same) },
      )
    : null;
  const ids = [upload561l?.id, uploadSlrb?.id].filter((id): id is string => Boolean(id));
  const byteSize = (upload561l?.byteSize ?? 0) + (uploadSlrb?.byteSize ?? 0);
  if (same) {
    if (upload561l && same.sha256561l && upload561l.sha256 !== same.sha256561l) {
      throw new AuthError(
        "Uploaded file hash does not match the stored file. No sales records were written.",
        "VALIDATION",
        409,
      );
    }
    if (uploadSlrb && same.sha256Slrb && uploadSlrb.sha256 !== same.sha256Slrb) {
      throw new AuthError(
        "Uploaded file hash does not match the stored file. No sales records were written.",
        "VALIDATION",
        409,
      );
    }
    try {
      await claimCustomerSalesUploads(ids);
    } catch (error) {
      if (same.status === "FAILED") throw error;
    }
    return { jobId: same.id, byteSize };
  }

  let claimed = false;
  try {
    await claimCustomerSalesUploads(ids);
    claimed = true;
    const job = await prisma.customerSalesHistoryJob.create({
      data: {
        companyId: input.companyId,
        actorUserId,
        status: "QUEUED",
        upload561lId: upload561l?.id ?? null,
        uploadSlrbId: uploadSlrb?.id ?? null,
        sha256561l: upload561l?.sha256 ?? null,
        sha256Slrb: uploadSlrb?.sha256 ?? null,
        filename561l: upload561l?.filename ?? null,
        filenameSlrb: uploadSlrb?.filename ?? null,
        countedFileRows: true,
      },
    });
    return { jobId: job.id, byteSize };
  } catch (error) {
    if (claimed) await markCustomerSalesUploads(ids, "PREVIEWED");
    throw error;
  }
}

export async function enqueueAndScheduleCustomerSalesHistoryUpload(
  actorUserId: string,
  input: { companyId: string; upload561lId?: string; uploadSlrbId?: string },
) {
  const enqueued = await enqueueCustomerSalesHistoryUpload(actorUserId, input);
  scheduleCustomerSalesHistoryJob(enqueued.jobId);
  const job = await prisma.customerSalesHistoryJob.findUniqueOrThrow({ where: { id: enqueued.jobId } });
  return toProgress(job, null);
}

export async function runCustomerSalesHistoryJob(
  jobId: string,
  hooks?: CustomerSalesHistoryJobHooks & { reserved?: boolean },
) {
  if (running.has(jobId) && !hooks?.reserved) {
    const job = await prisma.customerSalesHistoryJob.findUnique({ where: { id: jobId } });
    if (!job) throw new AuthError("Import job was not found.", "NOT_FOUND", 404);
    return toProgress(job, null);
  }
  running.add(jobId);
  try {
    return await executeCustomerSalesHistoryJob(jobId, hooks);
  } finally {
    running.delete(jobId);
    const current = await prisma.customerSalesHistoryJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (current?.status === "COMPLETE") reportCache.delete(jobId);
  }
}

async function claimCustomerSalesHistoryJob(jobId: string) {
  const token = randomUUID();
  const stagingStale = new Date(Date.now() - STALE_HEARTBEAT_MS);
  const publishStale = new Date(Date.now() - PUBLISH_STALE_MS);
  const claimedStaging = await prisma.customerSalesHistoryJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["QUEUED", "STAGING", "FAILED"] },
      OR: [{ runnerToken: null }, { heartbeatAt: null }, { heartbeatAt: { lt: stagingStale } }],
    },
    data: {
      runnerToken: token,
      heartbeatAt: new Date(),
      status: "STAGING",
      error: null,
      completedAt: null,
    },
  });
  if (claimedStaging.count === 1) return token;
  const claimedPublish = await prisma.customerSalesHistoryJob.updateMany({
    where: {
      id: jobId,
      status: "PUBLISHING",
      OR: [{ runnerToken: null }, { heartbeatAt: null }, { heartbeatAt: { lt: publishStale } }],
    },
    data: {
      runnerToken: token,
      heartbeatAt: new Date(),
      status: "STAGING",
      error: null,
      completedAt: null,
    },
  });
  return claimedPublish.count === 1 ? token : null;
}

async function failOwnedJob(jobId: string, token: string, message: string) {
  await prisma.customerSalesHistoryJob.updateMany({
    where: { id: jobId, runnerToken: token, status: { not: "COMPLETE" } },
    data: {
      status: "FAILED",
      error: message.slice(0, 500),
      runnerToken: null,
      heartbeatAt: null,
      completedAt: new Date(),
    },
  });
  const job = await prisma.customerSalesHistoryJob.findUnique({ where: { id: jobId } });
  if (job) await markCustomerSalesUploads(uploadIds(job), "FAILED");
}

async function executeCustomerSalesHistoryJob(jobId: string, hooks?: CustomerSalesHistoryJobHooks) {
  const existing = await prisma.customerSalesHistoryJob.findUnique({ where: { id: jobId } });
  if (!existing) throw new AuthError("Import job was not found.", "NOT_FOUND", 404);
  if (existing.status === "COMPLETE") return toProgress(existing, null);

  const token = await claimCustomerSalesHistoryJob(jobId);
  if (!token) {
    const current = await prisma.customerSalesHistoryJob.findUnique({ where: { id: jobId } });
    if (!current) throw new AuthError("Import job was not found.", "NOT_FOUND", 404);
    return toProgress(current, null);
  }

  try {
    const job = await prisma.customerSalesHistoryJob.findUniqueOrThrow({ where: { id: jobId } });
    const prepared = await loadPrepared(job);
    const counts = prepared.planned.counts;
    const total = classifiedCount(counts);
    await prisma.customerSalesHistoryJob.updateMany({
      where: { id: jobId, runnerToken: token },
      data: {
        phase: "STAGING",
        heartbeatAt: new Date(),
        duplicates: counts.duplicate,
        rejected: counts.rejected,
        failed: counts.failed,
        productLines: counts.productLines,
        supportingDocuments: counts.supportingDocuments,
        ledgerRows: counts.ledger,
      },
    });

    if (!prepared.preview.canCommit && counts.duplicate === 0) {
      throw new AuthError(prepared.preview.message ?? "Nothing can be imported.", "VALIDATION", 400);
    }
    if (!prepared.preview.canCommit) {
      const cutover = await prisma.customerSalesCutover.findUnique({ where: { companyId: job.companyId } });
      await prisma.customerSalesHistoryJob.updateMany({
        where: { id: jobId, runnerToken: token },
        data: {
          status: "COMPLETE",
          phase: "PUBLISH",
          rowsProcessed: total,
          rowsStored: 0,
          historyFrom: cutover?.historyFrom ?? null,
          historyTo: cutover?.historyTo ?? null,
          historyStatus: cutover?.historyStatus ?? prepared.preview.historyStatus,
          completedAt: new Date(),
          runnerToken: null,
          heartbeatAt: null,
          error: null,
        },
      });
      const finished = await prisma.customerSalesHistoryJob.findUniqueOrThrow({ where: { id: jobId } });
      await markCustomerSalesUploads(uploadIds(finished), "COMMITTED");
      await prisma.customerSalesHistoryStage.deleteMany({ where: { jobId } });
      return toProgress(finished, null);
    }

    const items = buildWork(prepared);
    let cursor = job.stageCursor;
    let staged = job.rowsStaged;
    let batches = 0;
    while (cursor < items.length) {
      if (hooks?.maxBatches != null && batches >= hooks.maxBatches) {
        await prisma.customerSalesHistoryJob.updateMany({
          where: { id: jobId, runnerToken: token },
          data: {
            status: "STAGING",
            phase: "STAGING",
            runnerToken: null,
            heartbeatAt: null,
            stageCursor: cursor,
            rowsProcessed: total === 0 ? 0 : Math.min(total, Math.round((cursor / items.length) * total)),
          },
        });
        const paused = await prisma.customerSalesHistoryJob.findUniqueOrThrow({ where: { id: jobId } });
        return toProgress(paused, null);
      }
      const batch = items.slice(cursor, cursor + CUSTOMER_SALES_HISTORY_STAGE_BATCH);
      await attachVariants(batch);
      const inserted = await prisma.customerSalesHistoryStage.createMany({
        data: batch.map((item) => ({
          jobId,
          seq: item.seq,
          kind: item.kind,
          duplicate: item.duplicate,
          documentType: item.documentType,
          documentReference: item.documentReference,
          lineNumber: item.lineNumber,
          fingerprint: item.fingerprint,
          accountCode: item.account,
          sku: item.sku,
          description: item.description,
          units: item.units,
          salesNet: item.salesNet,
          goodsNet: item.goodsNet,
          vat: item.vat,
          grossTotal: item.grossTotal,
          documentDate: item.documentDate,
          rawInvAndLn: item.rawInvAndLn,
          source: item.source,
          matchedVariantId: item.matchedVariantId,
          matchStatus: item.matchStatus,
        })),
        skipDuplicates: true,
      });
      cursor += batch.length;
      batches += 1;
      staged += inserted.count;
      const beat = await prisma.customerSalesHistoryJob.updateMany({
        where: { id: jobId, runnerToken: token },
        data: {
          status: "STAGING",
          phase: "STAGING",
          stageCursor: cursor,
          rowsStaged: staged,
          rowsProcessed: Math.min(total, Math.round((cursor / items.length) * total)),
          heartbeatAt: new Date(),
        },
      });
      if (beat.count !== 1) throw new Error("Import runner lost the job lock.");
    }

    if (hooks?.failBeforePublish) {
      await prisma.customerSalesHistoryJob.updateMany({
        where: { id: jobId, runnerToken: token },
        data: {
          status: "FAILED",
          phase: "PUBLISH",
          error: "Stopped before publication.",
          rowsProcessed: total,
          runnerToken: null,
          heartbeatAt: null,
          completedAt: null,
        },
      });
      const paused = await prisma.customerSalesHistoryJob.findUniqueOrThrow({ where: { id: jobId } });
      return toProgress(paused, null);
    }

    if (hooks?.abandonDuringPublish) {
      await prisma.customerSalesHistoryJob.updateMany({
        where: { id: jobId, runnerToken: token },
        data: {
          status: "PUBLISHING",
          phase: "PUBLISH",
          rowsProcessed: total,
          heartbeatAt: new Date(),
        },
      });
      throw new RunnerAbandonedError();
    }

    const published = await publishStagedHistory(jobId, token, prepared);
    return published;
  } catch (error) {
    const current = await prisma.customerSalesHistoryJob.findUnique({ where: { id: jobId } });
    if (current?.status === "COMPLETE") return toProgress(current, null);
    if (error instanceof RunnerAbandonedError) {
      return toProgress(current ?? existing, null);
    }
    if (current?.runnerToken === token) {
      const message = error instanceof Error ? error.message : "Import failed.";
      await failOwnedJob(jobId, token, message);
    }
    throw error;
  }
}

async function loadPrepared(job: CustomerSalesHistoryJob) {
  const ready = preparedPlans.get(job.id);
  if (ready) return ready;
  const report = await loadReport(job);
  await prisma.customerSalesHistoryJob.update({
    where: { id: job.id },
    data: {
      rowsRead: report.rowsRead,
      otherCustomerRows: report.otherCustomerRows,
      countedFileRows: true,
      heartbeatAt: new Date(),
    },
  });
  return prepareCustomerSalesHistory(
    job.actorUserId,
    {
      companyId: job.companyId,
      ...(report.text561l ? { text561l: report.text561l } : {}),
      ...(report.textSlrb ? { textSlrb: report.textSlrb } : {}),
      ...(job.filename561l ? { filename561l: job.filename561l } : {}),
      ...(job.filenameSlrb ? { filenameSlrb: job.filenameSlrb } : {}),
    },
    { bounded: true, sampleLimit: 1 },
  );
}

async function loadReport(job: CustomerSalesHistoryJob): Promise<FilteredReport> {
  const cached = reportCache.get(job.id);
  if (cached) return cached;
  if (!job.upload561lId && !job.uploadSlrbId) {
    throw new AuthError("This import has no report to read. No sales records were written.", "VALIDATION", 400);
  }
  const target = await loadCustomerSalesHistoryTarget(job.companyId);
  let rowsRead = 0;
  let matchingRows = 0;
  let otherCustomerRows = 0;
  let text561l: string | undefined;
  let textSlrb: string | undefined;
  if (job.upload561lId) {
    const upload = await readVerifiedCustomerSalesUpload(
      { actorUserId: job.actorUserId, uploadId: job.upload561lId, companyId: job.companyId, role: "HISTORY_561L" },
      { allowProcessing: true },
    );
    if (job.sha256561l && upload.sha256 !== job.sha256561l) {
      throw new AuthError(
        "Uploaded file hash does not match the stored file. No sales records were written.",
        "VALIDATION",
        409,
      );
    }
    const filtered = await streamFilterReport({
      filePath: upload.storagePath,
      mode: "HISTORY_561L",
      accountCodes: target.codes,
    });
    text561l = filtered.text;
    rowsRead += filtered.rowsRead;
    matchingRows += filtered.matchingRows;
    otherCustomerRows += filtered.otherCustomerRows;
  }
  if (job.uploadSlrbId) {
    const upload = await readVerifiedCustomerSalesUpload(
      { actorUserId: job.actorUserId, uploadId: job.uploadSlrbId, companyId: job.companyId, role: "HISTORY_SLRB" },
      { allowProcessing: true },
    );
    if (job.sha256Slrb && upload.sha256 !== job.sha256Slrb) {
      throw new AuthError(
        "Uploaded file hash does not match the stored file. No sales records were written.",
        "VALIDATION",
        409,
      );
    }
    const filtered = await streamFilterReport({
      filePath: upload.storagePath,
      mode: "HISTORY_SLRB",
      accountCodes: target.codes,
    });
    textSlrb = filtered.text;
    rowsRead += filtered.rowsRead;
    matchingRows += filtered.matchingRows;
    otherCustomerRows += filtered.otherCustomerRows;
  }
  const report: FilteredReport = {
    ...(text561l ? { text561l } : {}),
    ...(textSlrb ? { textSlrb } : {}),
    rowsRead,
    matchingRows,
    otherCustomerRows,
  };
  reportCache.set(job.id, report);
  return report;
}

function buildWork(prepared: Awaited<ReturnType<typeof prepareCustomerSalesHistory>>): StageWork[] {
  const items: StageWork[] = [];
  for (const doc of prepared.planned.documents) {
    if (doc.duplicate && doc.source !== "SLRB") continue;
    items.push({
      seq: items.length,
      kind: "DOCUMENT",
      duplicate: doc.duplicate,
      documentType: doc.documentType,
      documentReference: doc.documentReference,
      lineNumber: 0,
      fingerprint: `doc:${doc.documentType}|${doc.documentReference}`,
      account: doc.account,
      sku: null,
      description: null,
      units: null,
      salesNet: null,
      goodsNet: doc.goodsNet,
      vat: doc.vat,
      grossTotal: doc.grossTotal,
      documentDate: utcNoon(doc.documentDate),
      rawInvAndLn: null,
      source: doc.source,
      matchedVariantId: null,
      matchStatus: null,
    });
  }
  for (const line of prepared.planned.lines) {
    if (line.duplicate) continue;
    items.push({
      seq: items.length,
      kind: "LINE",
      duplicate: false,
      documentType: line.documentType,
      documentReference: line.documentReference,
      lineNumber: line.lineNumber,
      fingerprint: line.fingerprint,
      account: line.account,
      sku: line.sku,
      description: line.description,
      units: line.units,
      salesNet: line.salesNet,
      goodsNet: null,
      vat: null,
      grossTotal: null,
      documentDate: null,
      rawInvAndLn: line.rawInvAndLn,
      source: "561L",
      matchedVariantId: null,
      matchStatus: "NOT_IN_AB_CATALOGUE",
    });
  }
  return items;
}

async function attachVariants(items: StageWork[]) {
  const skus = [...new Set(items.filter((item) => item.kind === "LINE" && item.sku).map((item) => item.sku!.toUpperCase()))];
  if (!skus.length) return;
  const found = await prisma.$queryRaw<Array<{ id: string; sku: string }>>(
    Prisma.sql`SELECT id, UPPER(sku) AS sku FROM "ProductVariant" WHERE UPPER(sku) IN (${Prisma.join(skus)})`,
  );
  const bySku = new Map(found.map((row) => [row.sku.toUpperCase(), row.id]));
  for (const item of items) {
    if (item.kind !== "LINE" || !item.sku) continue;
    const variantId = bySku.get(item.sku.toUpperCase()) ?? null;
    item.matchedVariantId = variantId;
    item.matchStatus = variantId ? "MATCHED" : "NOT_IN_AB_CATALOGUE";
  }
}

function countFrom(rows: Array<{ count: bigint | number }>) {
  return Number(rows[0]?.count ?? 0);
}

async function publishStagedHistory(
  jobId: string,
  token: string,
  prepared: Awaited<ReturnType<typeof prepareCustomerSalesHistory>>,
) {
  const published = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${jobId}))`;
      const owned = await tx.customerSalesHistoryJob.updateMany({
        where: {
          id: jobId,
          runnerToken: token,
          status: { in: ["QUEUED", "STAGING", "FAILED", "PUBLISHING"] },
        },
        data: { status: "PUBLISHING", phase: "PUBLISH", heartbeatAt: new Date() },
      });
      if (owned.count !== 1) throw new Error("Import publication is already in progress.");

      const job = await tx.customerSalesHistoryJob.findUniqueOrThrow({ where: { id: jobId } });
      const existingCutover = await tx.customerSalesCutover.findUnique({ where: { companyId: job.companyId } });
      const run = await tx.autopartCustomerImportRun.create({
        data: {
          companyId: job.companyId,
          type: "HISTORY_561L_SLRB",
          status: "COMMITTED",
          filename: job.filename561l,
          filenameSlrb: job.filenameSlrb,
          fileHash: job.sha256561l,
          fileHashSlrb: job.sha256Slrb,
          dryRun: false,
          createdById: job.actorUserId,
          completedAt: new Date(),
          rowsRead: prepared.planned.documents.length + prepared.planned.lines.length,
        },
      });

      const insertedDocs = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        WITH inserted AS (
          INSERT INTO "AutopartSalesDocument" (
            "id", "companyId", "autopartCustomerCode", "documentType", "documentReference",
            "documentDate", "goodsNet", "vat", "grossTotal", "source", "importRunId",
            "has504", "hasTrm21qc", "createdAt", "updatedAt"
          )
          SELECT
            gen_random_uuid()::text,
            ${job.companyId},
            s."accountCode",
            s."documentType"::"AutopartHistoricDocumentType",
            s."documentReference",
            s."documentDate",
            s."goodsNet",
            s."vat",
            s."grossTotal",
            s."source",
            ${run.id},
            false,
            false,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          FROM "CustomerSalesHistoryStage" s
          WHERE s."jobId" = ${jobId}
            AND s.kind = 'DOCUMENT'
            AND s.duplicate = false
          ON CONFLICT ("companyId", "documentType", "documentReference") DO NOTHING
          RETURNING 1
        )
        SELECT COUNT(*)::bigint AS count FROM inserted
      `);

      // Fill only NULL financials/dates on existing rows. Drive one indexed update per
      // SLRB stage document so a large 561L publication cannot seq-scan the document table.
      const slrbHeaders = await tx.$queryRaw<
        Array<{
          documentType: string;
          documentReference: string;
          documentDate: Date | null;
          goodsNet: Prisma.Decimal | null;
          vat: Prisma.Decimal | null;
          grossTotal: Prisma.Decimal | null;
        }>
      >(Prisma.sql`
        SELECT "documentType", "documentReference", "documentDate", "goodsNet", "vat", "grossTotal"
        FROM "CustomerSalesHistoryStage"
        WHERE "jobId" = ${jobId}
          AND kind = 'DOCUMENT'
          AND source = 'SLRB'
      `);
      for (const header of slrbHeaders) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "AutopartSalesDocument"
          SET
            "documentDate" = COALESCE("documentDate", ${header.documentDate}),
            "goodsNet" = COALESCE("goodsNet", ${header.goodsNet}),
            "vat" = COALESCE("vat", ${header.vat}),
            "grossTotal" = COALESCE("grossTotal", ${header.grossTotal}),
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "companyId" = ${job.companyId}
            AND "documentType" = ${header.documentType}::"AutopartHistoricDocumentType"
            AND "documentReference" = ${header.documentReference}
        `);
      }

      const insertedLines = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        WITH inserted AS (
          INSERT INTO "AutopartSalesLine" (
            "id", "companyId", "documentId", "autopartCustomerCode", "documentType", "documentReference",
            "lineNumber", "sku", "descriptionSnapshot", "units", "salesNet", "matchedVariantId", "matchStatus",
            "rawInvAndLn", "sourceFingerprint", "source", "importRunId", "createdAt", "updatedAt"
          )
          SELECT
            gen_random_uuid()::text,
            ${job.companyId},
            d.id,
            s."accountCode",
            s."documentType"::"AutopartHistoricDocumentType",
            s."documentReference",
            s."lineNumber",
            s.sku,
            s.description,
            s.units,
            s."salesNet",
            s."matchedVariantId",
            COALESCE(s."matchStatus", 'NOT_IN_AB_CATALOGUE')::"AutopartHistoricLineMatchStatus",
            s."rawInvAndLn",
            NULLIF(s.fingerprint, ''),
            '561L',
            ${run.id},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          FROM (
            SELECT *
            FROM "CustomerSalesHistoryStage"
            WHERE "jobId" = ${jobId}
              AND kind = 'LINE'
              AND duplicate = false
          ) s
          LEFT JOIN "AutopartSalesDocument" d
            ON d."companyId" = ${job.companyId}
           AND d."documentType" = s."documentType"::"AutopartHistoricDocumentType"
           AND d."documentReference" = s."documentReference"
          -- Skip only when the same product fingerprint is already stored. A colliding
          -- lineNumber for a different SKU must not silently drop the staged row.
          WHERE NOT EXISTS (
              SELECT 1
              FROM "AutopartSalesLine" l
              WHERE l."companyId" = ${job.companyId}
                AND l."source" = '561L'
                AND l."sourceFingerprint" = s.fingerprint
                AND s.fingerprint <> ''
            )
          ON CONFLICT ("companyId", "documentType", "documentReference", "lineNumber") DO NOTHING
          RETURNING 1
        )
        SELECT COUNT(*)::bigint AS count FROM inserted
      `);

      const missingDocs = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "CustomerSalesHistoryStage" s
        WHERE s."jobId" = ${jobId}
          AND s.kind = 'DOCUMENT'
          AND s.duplicate = false
          AND NOT EXISTS (
            SELECT 1
            FROM "AutopartSalesDocument" d
            WHERE d."companyId" = ${job.companyId}
              AND d."documentType" = s."documentType"::"AutopartHistoricDocumentType"
              AND d."documentReference" = s."documentReference"
          )
      `);
      // A staged product is present only when fingerprint or full product identity matches.
      // Sharing a lineNumber with a different SKU is not proof the intended row was stored.
      const missingLines = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "CustomerSalesHistoryStage" s
        WHERE s."jobId" = ${jobId}
          AND s.kind = 'LINE'
          AND s.duplicate = false
          AND NOT EXISTS (
            SELECT 1
            FROM "AutopartSalesLine" l
            WHERE l."companyId" = ${job.companyId}
              AND l."source" = '561L'
              AND l."sourceFingerprint" = s.fingerprint
              AND s.fingerprint <> ''
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "AutopartSalesLine" l
            WHERE l."companyId" = ${job.companyId}
              AND l."documentType" = s."documentType"::"AutopartHistoricDocumentType"
              AND l."documentReference" = s."documentReference"
              AND l."lineNumber" = s."lineNumber"
              AND UPPER(btrim(l.sku)) = UPPER(btrim(s.sku))
              AND l.units = s.units
              AND l."salesNet" = s."salesNet"
          )
      `);
      if (countFrom(missingDocs) > 0 || countFrom(missingLines) > 0) {
        throw new Error(
          "Publication did not store every staged product line with a matching source fingerprint or product identity. The import was rolled back and the customer cutover was not changed.",
        );
      }

      const imported = countFrom(insertedDocs) + countFrom(insertedLines);
      const previouslyAccepted =
        existingCutover?.historyStatus === "COMPLETE" &&
        existingCutover.evidence != null &&
        typeof existingCutover.evidence === "object" &&
        !Array.isArray(existingCutover.evidence) &&
        (existingCutover.evidence as { resolution?: string }).resolution === "EXCEPTIONS_ACCEPTED";
      const hasExceptions = prepared.planned.counts.rejected > 0 && !(previouslyAccepted && imported === 0);
      const historyStatus = hasExceptions ? "REVIEW" : "COMPLETE";
      const incomingDates = prepared.planned.dates
        .map((date) => utcNoon(date))
        .filter((date): date is Date => date != null);
      const range = [
        ...incomingDates,
        ...(existingCutover?.historyFrom ? [existingCutover.historyFrom] : []),
        ...(existingCutover?.historyTo ? [existingCutover.historyTo] : []),
      ];
      const historyFrom = range.length ? new Date(Math.min(...range.map((date) => date.getTime()))) : null;
      const historyTo = range.length ? new Date(Math.max(...range.map((date) => date.getTime()))) : null;
      const evidence = {
        kind: "561L_SLRB",
        filename561l: job.filename561l,
        filenameSlrb: job.filenameSlrb,
        sha256561l: job.sha256561l,
        sha256Slrb: job.sha256Slrb,
        imported,
        duplicates: prepared.planned.counts.duplicate,
        rejected: prepared.planned.counts.rejected,
        ...(job.countedFileRows ? { rowsRead: job.rowsRead, otherCustomerRows: job.otherCustomerRows } : {}),
        completion: historyStatus,
      };
      await tx.customerSalesCutover.upsert({
        where: { companyId: job.companyId },
        create: {
          companyId: job.companyId,
          historyStatus,
          historyFrom,
          historyTo,
          completedAt: hasExceptions ? null : new Date(),
          completedById: hasExceptions ? null : job.actorUserId,
          evidence,
        },
        update: {
          historyStatus,
          historyFrom,
          historyTo,
          completedAt: hasExceptions ? null : new Date(),
          completedById: hasExceptions ? null : job.actorUserId,
          evidence,
        },
      });
      await tx.autopartCustomerImportRun.update({
        where: { id: run.id },
        data: {
          rowsImported: imported,
          rowsSkipped: prepared.planned.counts.duplicate + prepared.planned.counts.rejected,
          rowsValid: imported,
        },
      });
      const ids = uploadIds(job);
      if (ids.length) {
        await tx.customerSalesUpload.updateMany({ where: { id: { in: ids } }, data: { status: "COMMITTED" } });
      }
      await tx.customerSalesHistoryJob.update({
        where: { id: jobId },
        data: {
          status: "COMPLETE",
          phase: "PUBLISH",
          rowsStored: imported,
          rowsProcessed: classifiedCount(prepared.planned.counts),
          duplicates: prepared.planned.counts.duplicate,
          rejected: prepared.planned.counts.rejected,
          failed: prepared.planned.counts.failed,
          productLines: prepared.planned.counts.productLines,
          supportingDocuments: prepared.planned.counts.supportingDocuments,
          ledgerRows: prepared.planned.counts.ledger,
          historyFrom,
          historyTo,
          historyStatus,
          completedAt: new Date(),
          runnerToken: null,
          heartbeatAt: null,
          error: null,
        },
      });
      // Staging is not sales evidence. Drop it once publication has committed its checks.
      await tx.customerSalesHistoryStage.deleteMany({ where: { jobId } });
      runIds.set(jobId, run.id);
      return { runId: run.id, evidence, imported, companyId: job.companyId };
    },
    { timeout: PUBLISH_TIMEOUT_MS, maxWait: 20_000 },
  );

  const job = await prisma.customerSalesHistoryJob.findUniqueOrThrow({ where: { id: jobId } });
  await recordAuditEvent({
    action: "autopart.customer_sales_history_committed",
    entityType: "AutopartCustomerImportRun",
    entityId: published.runId,
    actorUserId: job.actorUserId,
    metadata: {
      companyId: published.companyId,
      imported: published.imported,
      duplicates: prepared.planned.counts.duplicate,
      evidence: published.evidence,
    },
  });
  return toProgress(job, published.runId);
}
