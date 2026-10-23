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
  requireHistoryImporter,
  type CustomerSalesHistoryCounts,
} from "@/server/companies/customer-sales-history-import";
import {
  claimCustomerSalesUploads,
  markCustomerSalesUploads,
  readVerifiedCustomerSalesUpload,
} from "@/server/companies/customer-sales-upload";
import { streamFilterReport } from "@/server/companies/customer-sales-report-filter";

export const CUSTOMER_SALES_HISTORY_STAGE_BATCH = 1_000;
const STALE_HEARTBEAT_MS = 120_000;
const PUBLISH_TIMEOUT_MS = 300_000;

const running = new Set<string>();
const preparedPlans = new Map<string, Awaited<ReturnType<typeof prepareCustomerSalesHistory>>>();
const reportCache = new Map<string, FilteredReport>();
const runIds = new Map<string, string>();

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
};

export type CustomerSalesHistoryJobHooks = {
  maxBatches?: number;
  failBeforePublish?: boolean;
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

function toProgress(job: CustomerSalesHistoryJob, runId: string | null): CustomerSalesHistoryJobView {
  return {
    jobId: job.id,
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
    error: job.error,
    runId: runId ?? runIds.get(job.id) ?? null,
  };
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
  if (running.has(jobId)) return;
  running.add(jobId);
  setTimeout(() => {
    void runCustomerSalesHistoryJob(jobId, { reserved: true }).catch((error: unknown) => {
      console.error("customer sales history job failed", jobId, error);
    });
  }, 0);
}

export async function getCustomerSalesHistoryJob(actorUserId: string, jobId: string) {
  await requireHistoryImporter(actorUserId);
  const job = await prisma.customerSalesHistoryJob.findUnique({ where: { id: jobId } });
  if (!job) throw new AuthError("Import job was not found.", "NOT_FOUND", 404);
  return toProgress(job, null);
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

  const token = randomUUID();
  const staleBefore = new Date(Date.now() - STALE_HEARTBEAT_MS);
  const claimed = await prisma.customerSalesHistoryJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["QUEUED", "STAGING", "FAILED", "PUBLISHING"] },
      OR: [{ runnerToken: null }, { heartbeatAt: { lt: staleBefore } }],
    },
    data: { runnerToken: token, heartbeatAt: new Date(), status: "STAGING", error: null, completedAt: null },
  });
  if (claimed.count !== 1) {
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

    const published = await publishStagedHistory(jobId, token, prepared);
    return published;
  } catch (error) {
    const current = await prisma.customerSalesHistoryJob.findUnique({ where: { id: jobId } });
    if (current?.status === "COMPLETE") return toProgress(current, null);
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

      if (prepared.planned.documents.some((doc) => doc.source === "SLRB")) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "AutopartSalesDocument" d
          SET
            "documentDate" = COALESCE(d."documentDate", s."documentDate"),
            "goodsNet" = COALESCE(d."goodsNet", s."goodsNet"),
            "vat" = COALESCE(d."vat", s."vat"),
            "grossTotal" = COALESCE(d."grossTotal", s."grossTotal"),
            "updatedAt" = CURRENT_TIMESTAMP
          FROM (
            SELECT "documentType", "documentReference", "documentDate", "goodsNet", "vat", "grossTotal"
            FROM "CustomerSalesHistoryStage"
            WHERE "jobId" = ${jobId}
              AND kind = 'DOCUMENT'
              AND source = 'SLRB'
          ) s
          WHERE d."companyId" = ${job.companyId}
            AND d."documentType" = s."documentType"::"AutopartHistoricDocumentType"
            AND d."documentReference" = s."documentReference"
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
          WHERE NOT EXISTS (
              SELECT 1
              FROM "AutopartSalesLine" l
              WHERE l."companyId" = ${job.companyId}
                AND l."documentType" = s."documentType"::"AutopartHistoricDocumentType"
                AND l."documentReference" = s."documentReference"
                AND l."lineNumber" = s."lineNumber"
            )
            AND NOT EXISTS (
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
              AND l."documentType" = s."documentType"::"AutopartHistoricDocumentType"
              AND l."documentReference" = s."documentReference"
              AND l."lineNumber" = s."lineNumber"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "AutopartSalesLine" l
            WHERE l."companyId" = ${job.companyId}
              AND l."source" = '561L'
              AND l."sourceFingerprint" = s.fingerprint
              AND s.fingerprint <> ''
          )
      `);
      if (countFrom(missingDocs) > 0 || countFrom(missingLines) > 0) {
        throw new Error(
          "Publication did not store every staged row. The import was rolled back and the customer cutover was not changed.",
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
