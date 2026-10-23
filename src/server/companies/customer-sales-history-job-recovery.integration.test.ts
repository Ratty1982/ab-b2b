import "@/server/testing/use-protect-integration-database";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { AuthError } from "@/server/rbac/guards";
import { saveCustomerSalesUpload } from "@/server/companies/customer-sales-upload";
import {
  CUSTOMER_SALES_HISTORY_FINGERPRINT_INDEX,
  CUSTOMER_SALES_HISTORY_PUBLISH_STALE_MS,
  CUSTOMER_SALES_HISTORY_PUBLISH_TIMEOUT_MS,
  CUSTOMER_SALES_HISTORY_STAGE_BATCH,
  CUSTOMER_SALES_HISTORY_STALE_HEARTBEAT_MS,
  enqueueCustomerSalesHistoryUpload,
  getCustomerSalesHistoryJob,
  getLatestCustomerSalesHistoryJob,
  recoverAbandonedCustomerSalesHistoryJobs,
  releaseLocalCustomerSalesHistoryRunner,
  reportCustomerSalesHistoryIndexHealth,
  retryCustomerSalesHistoryJob,
  runCustomerSalesHistoryJob,
} from "@/server/companies/customer-sales-history-job";
import { confirmCustomerSalesHistory } from "@/server/companies/customer-sales-history-import";

const prisma = new PrismaClient();
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const recoverAccount = `RC${stamp.slice(0, 6).toUpperCase()}`;
const scaleAccount = `SC${stamp.slice(0, 6).toUpperCase()}`;
const MIXED_LINES = 200_000;
const INTERRUPT_LINES = CUSTOMER_SALES_HISTORY_STAGE_BATCH + 750;

let adminId = "";
let strangerId = "";
let recoverCompanyId = "";
let scaleCompanyId = "";
let uploadDir = "";
let previousUploadDir: string | undefined;

function streamFromString(text: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= encoded.length) {
        controller.close();
        return;
      }
      const end = Math.min(encoded.length, offset + 64 * 1024);
      controller.enqueue(encoded.subarray(offset, end));
      offset = end;
    },
  });
}

function productReport(account: string, count: number) {
  const lines = new Array<string>(count + 1);
  lines[0] = "Acct.,Inv & Ln,Part Number,Description,Units,Sales";
  for (let index = 1; index <= count; index += 1) {
    const ref = `D${String(index).padStart(6, "0")}`;
    lines[index] = `${account},I/${ref}/1,SKU${index % 40},Widget,1,"£1.00"`;
  }
  return lines;
}

async function waitForJob(
  jobId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 180_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await prisma.customerSalesHistoryJob.findUniqueOrThrow({ where: { id: jobId } });
    if (predicate(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const final = await prisma.customerSalesHistoryJob.findUniqueOrThrow({ where: { id: jobId } });
  throw new Error(`Timed out waiting for job ${jobId}; last status ${final.status}`);
}

beforeAll(async () => {
  previousUploadDir = process.env["CUSTOMER_SALES_UPLOAD_DIR"];
  uploadDir = await mkdtemp(path.join(tmpdir(), "history-recover-"));
  process.env["CUSTOMER_SALES_UPLOAD_DIR"] = uploadDir;
  await bootstrapRbac(prisma);
  const admin = await prisma.user.create({
    data: {
      email: `history-recover.${stamp}@example.invalid`,
      name: "History recover importer",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const stranger = await prisma.user.create({
    data: {
      email: `history-stranger.${stamp}@example.invalid`,
      name: "History stranger",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const superRole = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: superRole.id } });
  await prisma.userPermissionOverride.createMany({
    data: [
      { userId: stranger.id, permissionKey: "orders.view", effect: "ALLOW" },
      { userId: stranger.id, permissionKey: "orders.edit", effect: "ALLOW" },
    ],
  });
  adminId = admin.id;
  strangerId = stranger.id;
  const recover = await prisma.company.create({ data: { name: `History recover ${stamp}`, status: "ACTIVE" } });
  const scale = await prisma.company.create({ data: { name: `History scale200 ${stamp}`, status: "ACTIVE" } });
  recoverCompanyId = recover.id;
  scaleCompanyId = scale.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: recoverCompanyId, code: recoverAccount });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: scaleCompanyId, code: scaleAccount });
}, 120_000);

afterAll(async () => {
  const ids = [recoverCompanyId, scaleCompanyId].filter(Boolean);
  if (ids.length) {
    await prisma.autopartSalesLine.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.customerSalesCutover.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.autopartCustomerImportRun.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.customerSalesHistoryJob.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.company.deleteMany({ where: { id: { in: ids } } });
  }
  if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
  if (previousUploadDir === undefined) delete process.env["CUSTOMER_SALES_UPLOAD_DIR"];
  else process.env["CUSTOMER_SALES_UPLOAD_DIR"] = previousUploadDir;
  await prisma.$disconnect();
}, 180_000);

describe("customer sales history job recovery", () => {
  it("reports the 561L fingerprint unique index as present", async () => {
    const health = await reportCustomerSalesHistoryIndexHealth();
    expect(health.indexName).toBe(CUSTOMER_SALES_HISTORY_FINGERPRINT_INDEX);
    expect(health.fingerprintIndexPresent).toBe(true);
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE indexname = ${CUSTOMER_SALES_HISTORY_FINGERPRINT_INDEX}
    `;
    expect(rows).toHaveLength(1);
  });

  it("recovers a crashed staging worker without publishing a partial history, then finishes via recovery", async () => {
    const feedBefore = await prisma.autopartOngoingSalesFeedSettings.findUnique({ where: { id: "default" } });
    const lines = productReport(recoverAccount, INTERRUPT_LINES);
    lines.push(`${recoverAccount},I/D000001/2,PART,Same sku,1,"£1.00"`);
    lines.push(`${recoverAccount},I/BADLINE,MISSING,Bad identity,1,"£1.00"`);
    const saved = await saveCustomerSalesUpload({
      actorUserId: adminId,
      companyId: recoverCompanyId,
      filename: "recover-staging.csv",
      role: "HISTORY_561L",
      body: streamFromString(lines.join("\n")),
    });
    const enqueued = await enqueueCustomerSalesHistoryUpload(adminId, {
      companyId: recoverCompanyId,
      upload561lId: saved.uploadId,
    });
    const paused = await runCustomerSalesHistoryJob(enqueued.jobId, { maxBatches: 1 });
    expect(paused.status).toBe("STAGING");
    expect(paused.rowsStored).toBe(0);

    // Simulate a hard process crash: local runner gone, lease still held with a stale heartbeat.
    await prisma.customerSalesHistoryJob.update({
      where: { id: enqueued.jobId },
      data: {
        runnerToken: "dead-runner-token",
        heartbeatAt: new Date(Date.now() - CUSTOMER_SALES_HISTORY_STALE_HEARTBEAT_MS - 1_000),
        status: "STAGING",
      },
    });
    releaseLocalCustomerSalesHistoryRunner(enqueued.jobId);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: recoverCompanyId } })).toBe(0);
    expect(await prisma.customerSalesCutover.findUnique({ where: { companyId: recoverCompanyId } })).toBeNull();

    const latestWhileAbandoned = await getLatestCustomerSalesHistoryJob(adminId, recoverCompanyId);
    expect(latestWhileAbandoned?.jobId).toBe(enqueued.jobId);
    expect(latestWhileAbandoned?.abandoned).toBe(true);
    expect(latestWhileAbandoned?.canRetry).toBe(true);
    expect(latestWhileAbandoned?.rowsStaged).toBeGreaterThan(0);

    await expect(getCustomerSalesHistoryJob(strangerId, enqueued.jobId)).rejects.toBeInstanceOf(AuthError);
    await expect(getLatestCustomerSalesHistoryJob(strangerId, recoverCompanyId)).rejects.toBeInstanceOf(AuthError);

    const scheduled = await recoverAbandonedCustomerSalesHistoryJobs({ limit: 5 });
    expect(scheduled).toContain(enqueued.jobId);
    const finished = await waitForJob(enqueued.jobId, (status) => status === "COMPLETE" || status === "FAILED", 180_000);
    expect(finished.status).toBe("COMPLETE");
    expect(finished.historyStatus).toBe("REVIEW");
    const stored = await prisma.autopartSalesLine.count({ where: { companyId: recoverCompanyId, source: "561L" } });
    expect(stored).toBe(INTERRUPT_LINES + 1);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: recoverCompanyId, documentReference: "BADLINE" } })).toBe(0);

    const afterRefresh = await getLatestCustomerSalesHistoryJob(adminId, recoverCompanyId);
    expect(afterRefresh?.status).toBe("COMPLETE");
    expect(afterRefresh?.rowsStored).toBe(finished.rowsStored);

    const retried = await retryCustomerSalesHistoryJob(adminId, enqueued.jobId);
    expect(retried.status).toBe("COMPLETE");
    expect(await prisma.autopartSalesLine.count({ where: { companyId: recoverCompanyId } })).toBe(stored);

    const feedAfter = await prisma.autopartOngoingSalesFeedSettings.findUnique({ where: { id: "default" } });
    expect(feedAfter?.enabled ?? false).toBe(feedBefore?.enabled ?? false);
    expect(feedAfter?.fulfilmentMode ?? "OFF").toBe(feedBefore?.fulfilmentMode ?? "OFF");
  }, 240_000);

  it("recovers an interrupted publication through the recovery mechanism and supports repeated retry", async () => {
    const account = recoverAccount;
    const lines = productReport(account, CUSTOMER_SALES_HISTORY_STAGE_BATCH + 100);
    lines.push(`${account},I/D000001/1,PART,Dup,1,"£1.00"`);
    lines.push(`${account},C/C000001/1,PART,Credit,1,"£2.00"`);
    lines.push(`${account},I/BADLINE,MISSING,Bad,1,"£1.00"`);
    const ledger = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${account},INV,D000001,19 Aug 15,"£1.00","£0.20","£1.20","£1.20"
${account},CRN,C000001,20 Aug 15,"-£2.00","-£0.40","-£2.40","-£1.20"
${account},PAY,PAY1,20 Aug 15,,,,"£0.00"
`;
    const product = await saveCustomerSalesUpload({
      actorUserId: adminId,
      companyId: recoverCompanyId,
      filename: "recover-publish-561l.csv",
      role: "HISTORY_561L",
      body: streamFromString(lines.join("\n")),
    });
    const slrb = await saveCustomerSalesUpload({
      actorUserId: adminId,
      companyId: recoverCompanyId,
      filename: "recover-publish-slrb.csv",
      role: "HISTORY_SLRB",
      body: streamFromString(ledger),
    });

    // Fresh company slice: clear prior recover company sales so publication counts stay clear.
    await prisma.autopartSalesLine.deleteMany({ where: { companyId: recoverCompanyId } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: recoverCompanyId } });
    await prisma.customerSalesCutover.deleteMany({ where: { companyId: recoverCompanyId } });
    await prisma.customerSalesHistoryJob.deleteMany({ where: { companyId: recoverCompanyId } });

    const enqueued = await enqueueCustomerSalesHistoryUpload(adminId, {
      companyId: recoverCompanyId,
      upload561lId: product.uploadId,
      uploadSlrbId: slrb.uploadId,
    });
    const abandoned = await runCustomerSalesHistoryJob(enqueued.jobId, { abandonDuringPublish: true });
    expect(abandoned.status).toBe("PUBLISHING");
    expect(abandoned.rowsStored).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: recoverCompanyId } })).toBe(0);
    expect(await prisma.customerSalesCutover.findUnique({ where: { companyId: recoverCompanyId } })).toBeNull();

    await prisma.customerSalesHistoryJob.update({
      where: { id: enqueued.jobId },
      data: {
        heartbeatAt: new Date(Date.now() - CUSTOMER_SALES_HISTORY_PUBLISH_STALE_MS - 1_000),
      },
    });
    releaseLocalCustomerSalesHistoryRunner(enqueued.jobId);

    // A fresh publication lease must not be reclaimable yet.
    const stillFresh = await prisma.customerSalesHistoryJob.update({
      where: { id: enqueued.jobId },
      data: {
        status: "PUBLISHING",
        runnerToken: "live-publisher",
        heartbeatAt: new Date(),
      },
    });
    expect(stillFresh.status).toBe("PUBLISHING");
    const notYet = await recoverAbandonedCustomerSalesHistoryJobs({ limit: 10 });
    expect(notYet).not.toContain(enqueued.jobId);
    releaseLocalCustomerSalesHistoryRunner(enqueued.jobId);

    await prisma.customerSalesHistoryJob.update({
      where: { id: enqueued.jobId },
      data: {
        heartbeatAt: new Date(Date.now() - CUSTOMER_SALES_HISTORY_PUBLISH_STALE_MS - 1_000),
      },
    });
    const recovered = await recoverAbandonedCustomerSalesHistoryJobs({ limit: 10 });
    expect(recovered).toContain(enqueued.jobId);
    const finished = await waitForJob(enqueued.jobId, (status) => status === "COMPLETE" || status === "FAILED", 180_000);
    expect(finished.status).toBe("COMPLETE");
    const stored = await prisma.autopartSalesLine.count({ where: { companyId: recoverCompanyId } });
    expect(stored).toBeGreaterThan(CUSTOMER_SALES_HISTORY_STAGE_BATCH);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: recoverCompanyId, documentType: "PAYMENT" } })).toBe(1);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: recoverCompanyId, documentType: "CREDIT" } })).toBe(1);
    expect(await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId: recoverCompanyId } })).toMatchObject({
      historyStatus: "REVIEW",
    });

    const firstRetry = await retryCustomerSalesHistoryJob(adminId, enqueued.jobId);
    expect(firstRetry.status).toBe("COMPLETE");
    expect(firstRetry.rowsStored).toBe(finished.rowsStored);
    const secondRetry = await retryCustomerSalesHistoryJob(adminId, enqueued.jobId);
    expect(secondRetry.status).toBe("COMPLETE");
    expect(await prisma.autopartSalesLine.count({ where: { companyId: recoverCompanyId } })).toBe(stored);
    expect(CUSTOMER_SALES_HISTORY_PUBLISH_TIMEOUT_MS).toBe(300_000);
  }, 240_000);

  it("publishes a 200,000-row mixed history inside the publication timeout budget", async () => {
    await prisma.$executeRawUnsafe(`VACUUM (ANALYZE) "AutopartSalesDocument", "AutopartSalesLine", "CustomerSalesHistoryStage"`);
    const lines = productReport(scaleAccount, MIXED_LINES);
    lines.push(`${scaleAccount},I/D000001/2,SKU1,Same sku,1,"£2.00"`);
    lines.push(`${scaleAccount},I/D000001/1,SKU1,Dup invoice line,1,"£1.00"`);
    lines.push(`${scaleAccount},I/D000002/2,ZERO,Zero value,0,"£0.00"`);
    lines.push(`${scaleAccount},C/C000001/1,SKU1,Credit line,1,"£3.00"`);
    lines.push(`${scaleAccount},I/BADLINE,MISSING,Bad identity,1,"£1.00"`);
    for (let index = 1; index <= 20; index += 1) {
      lines.push(`${scaleAccount},I/MISS${String(index).padStart(3, "0")}/1,SKU,Missing units,,"£1.00"`);
    }
    const text561l = lines.join("\n");
    const ledger = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${scaleAccount},INV,D000001,19 Aug 15,"£3.00","£0.60","£3.60","£3.60"
${scaleAccount},INV,D000002,19 Aug 15,"£1.00","£0.20","£1.20","£4.80"
${scaleAccount},CRN,C000001,20 Aug 15,"-£3.00","-£0.60","-£3.60","£1.20"
${scaleAccount},PAY,PAYSCALE,20 Aug 15,,,,"£0.00"
${scaleAccount},INV,D000010,21 Aug 15,"£1.00","£0.20","£1.20","£2.40"
`;
    const feedBefore = await prisma.autopartOngoingSalesFeedSettings.findUnique({ where: { id: "default" } });
    const started = Date.now();
    const imported = await confirmCustomerSalesHistory(
      adminId,
      {
        companyId: scaleCompanyId,
        text561l,
        textSlrb: ledger,
        filename561l: "synthetic-200k.csv",
        filenameSlrb: "synthetic-200k-slrb.csv",
      },
      { bounded: true },
    );
    const elapsedMs = Date.now() - started;
    expect(imported.rowsImported).toBeGreaterThanOrEqual(MIXED_LINES);
    expect(imported.historyStatus).toBe("REVIEW");
    const stored = await prisma.autopartSalesLine.count({ where: { companyId: scaleCompanyId, source: "561L" } });
    expect(stored).toBe(MIXED_LINES + 3);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: scaleCompanyId, documentType: "CREDIT" } })).toBe(1);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: scaleCompanyId, documentType: "PAYMENT" } })).toBe(1);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: scaleCompanyId, documentReference: "BADLINE" } })).toBe(0);
    const job = await prisma.customerSalesHistoryJob.findFirstOrThrow({
      where: { companyId: scaleCompanyId, status: "COMPLETE" },
      orderBy: { createdAt: "desc" },
    });
    expect(job.rejected).toBeGreaterThanOrEqual(21);
    expect(job.duplicates).toBeGreaterThanOrEqual(1);
    // Whole confirm includes staging; publication alone must stay inside the 300s budget.
    expect(elapsedMs).toBeLessThan(CUSTOMER_SALES_HISTORY_PUBLISH_TIMEOUT_MS);
    const again = await confirmCustomerSalesHistory(
      adminId,
      {
        companyId: scaleCompanyId,
        text561l,
        textSlrb: ledger,
        filename561l: "synthetic-200k.csv",
        filenameSlrb: "synthetic-200k-slrb.csv",
      },
      { bounded: true },
    );
    expect(again.rowsImported).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: scaleCompanyId } })).toBe(stored);
    const feedAfter = await prisma.autopartOngoingSalesFeedSettings.findUnique({ where: { id: "default" } });
    expect(feedAfter?.enabled ?? false).toBe(feedBefore?.enabled ?? false);
  }, 900_000);
});
