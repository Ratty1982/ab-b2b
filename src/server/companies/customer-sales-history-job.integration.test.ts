import "@/server/testing/use-protect-integration-database";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import {
  confirmCustomerSalesHistory,
  previewCustomerSalesHistory,
} from "@/server/companies/customer-sales-history-import";
import { saveCustomerSalesUpload } from "@/server/companies/customer-sales-upload";
import {
  CUSTOMER_SALES_HISTORY_STAGE_BATCH,
  enqueueCustomerSalesHistoryUpload,
  runCustomerSalesHistoryJob,
} from "@/server/companies/customer-sales-history-job";

const prisma = new PrismaClient();
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const largeAccount = `LH${stamp.slice(0, 6).toUpperCase()}`;
const smallAccount = `SM${stamp.slice(0, 6).toUpperCase()}`;
const QUALIFYING_LINES = 100_000;
const INTERRUPT_LINES = CUSTOMER_SALES_HISTORY_STAGE_BATCH + 500;

let adminId = "";
let largeCompanyId = "";
let smallCompanyId = "";
let previewCompanyId = "";
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

beforeAll(async () => {
  previousUploadDir = process.env["CUSTOMER_SALES_UPLOAD_DIR"];
  uploadDir = await mkdtemp(path.join(tmpdir(), "history-job-"));
  process.env["CUSTOMER_SALES_UPLOAD_DIR"] = uploadDir;
  await bootstrapRbac(prisma);
  const user = await prisma.user.create({
    data: {
      email: `history-job.${stamp}@example.invalid`,
      name: "History job importer",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  adminId = user.id;
  const large = await prisma.company.create({ data: { name: `History scale ${stamp}`, status: "ACTIVE" } });
  const small = await prisma.company.create({ data: { name: `History interrupt ${stamp}`, status: "ACTIVE" } });
  const preview = await prisma.company.create({ data: { name: `History preview ${stamp}`, status: "ACTIVE" } });
  largeCompanyId = large.id;
  smallCompanyId = small.id;
  previewCompanyId = preview.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: largeCompanyId, code: largeAccount });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: smallCompanyId, code: smallAccount });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: previewCompanyId, code: `PV${stamp.slice(0, 6).toUpperCase()}` });
}, 120_000);

afterAll(async () => {
  const ids = [largeCompanyId, smallCompanyId, previewCompanyId].filter(Boolean);
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

describe("large historical sales confirmation", () => {
  it("groups every rejected row and separates product lines from supporting documents", async () => {
    const account = `PV${stamp.slice(0, 6).toUpperCase()}`;
    const text561l = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${account},I/KEEP/1,SKU,Kept,1,"£4.00"
${account},I/BADONE,MISSING,Bad identity,1,"£1.00"
${account},I/MISS1/1,SKU,Missing amount,,"£2.00"
${account},I/MISS2/1,SKU,Missing amount,,"£3.00"
`;
    const textSlrb = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${account},INV,KEEP,19 Aug 15,"£4.00","£0.80","£4.80","£4.80"
${account},PAY,PAY1,20 Aug 15,,,,"£0.00"
`;
    const firstPage = await previewCustomerSalesHistory(
      adminId,
      { companyId: previewCompanyId, text561l, textSlrb },
      { sampleLimit: 1, rejectedPage: 1, rejectedPageSize: 1 },
    );
    const preview = await previewCustomerSalesHistory(
      adminId,
      { companyId: previewCompanyId, text561l, textSlrb },
      { sampleLimit: 1, rejectedPage: 2, rejectedPageSize: 1 },
    );
    expect(preview.rows.length).toBeLessThanOrEqual(1);
    expect(preview.counts.rejected).toBeGreaterThanOrEqual(3);
    expect(preview.rejectedTotal).toBe(preview.counts.rejected);
    expect(preview.rejectionGroups.reduce((sum, group) => sum + group.count, 0)).toBe(preview.rejectedTotal);
    expect(preview.rejectionGroups.some((group) => group.count >= 2)).toBe(true);
    expect(preview.rejectedPage).toBe(2);
    expect(preview.rejectedExamples).toHaveLength(1);
    expect(preview.rejectedExamples[0]?.document).not.toBe(firstPage.rejectedExamples[0]?.document);
    expect(preview.counts.productLines).toBe(1);
    expect(preview.counts.supportingDocuments).toBe(1);
    expect(preview.counts.ledger).toBe(1);
    expect(preview.counts.import).toBe(preview.counts.productLines + preview.counts.supportingDocuments);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: previewCompanyId } })).toBe(0);
    expect(await prisma.customerSalesCutover.findUnique({ where: { companyId: previewCompanyId } })).toBeNull();
  });

  it("publishes at least 100,000 qualifying lines and keeps retries from duplicating or overwriting them", async () => {
    const feedBefore = await prisma.autopartOngoingSalesFeedSettings.findUnique({ where: { id: "default" } });
    const lines = productReport(largeAccount, QUALIFYING_LINES);
    lines.push(`${largeAccount},I/D000001/2,SKU1,Same sku,2,"£2.50"`);
    lines.push(`${largeAccount},I/D000001/1,SKU1,Widget,1,"£1.00"`);
    lines.push(`${largeAccount},I/D000002/2,ZERO,Zero value,0,"£0.00"`);
    lines.push(`${largeAccount},I/BADLINE,MISSING,Bad identity,1,"£1.00"`);
    const text561l = lines.join("\n");

    const imported = await confirmCustomerSalesHistory(
      adminId,
      { companyId: largeCompanyId, text561l, filename561l: "synthetic-100k.csv" },
      { bounded: true },
    );
    expect(imported.rowsImported).toBeGreaterThanOrEqual(QUALIFYING_LINES);
    expect(imported.historyStatus).toBe("REVIEW");
    const stored = await prisma.autopartSalesLine.count({ where: { companyId: largeCompanyId, source: "561L" } });
    expect(stored).toBe(QUALIFYING_LINES + 2);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: largeCompanyId, documentReference: "D000001", lineNumber: 1 } })).toBe(1);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: largeCompanyId, documentReference: "D000001", lineNumber: 2 } })).toBe(1);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: largeCompanyId, documentReference: "BADLINE" } })).toBe(0);
    const zero = await prisma.autopartSalesLine.findFirstOrThrow({
      where: { companyId: largeCompanyId, documentReference: "D000002", lineNumber: 2 },
    });
    expect(Number(zero.units)).toBe(0);
    expect(Number(zero.salesNet)).toBe(0);
    const cutover = await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId: largeCompanyId } });
    expect(cutover.historyStatus).toBe("REVIEW");
    const job = await prisma.customerSalesHistoryJob.findFirstOrThrow({
      where: { companyId: largeCompanyId, status: "COMPLETE" },
      orderBy: { createdAt: "desc" },
    });
    expect(job.rowsStored).toBe(imported.rowsImported);
    expect(job.rejected).toBeGreaterThan(0);
    expect(job.productLines).toBe(QUALIFYING_LINES + 2);

    await prisma.autopartSalesDocument.update({
      where: {
        companyId_documentType_documentReference: {
          companyId: largeCompanyId,
          documentType: "INVOICE",
          documentReference: "D000001",
        },
      },
      data: { goodsNet: "123.45" },
    });
    const again = await confirmCustomerSalesHistory(
      adminId,
      { companyId: largeCompanyId, text561l, filename561l: "synthetic-100k.csv" },
      { bounded: true },
    );
    expect(again.rowsImported).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: largeCompanyId } })).toBe(stored);
    const sentinel = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: largeCompanyId, documentReference: "D000001", documentType: "INVOICE" },
    });
    expect(Number(sentinel.goodsNet)).toBeCloseTo(123.45, 2);
    expect((await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId: largeCompanyId } })).historyStatus).toBe("REVIEW");

    const feedAfter = await prisma.autopartOngoingSalesFeedSettings.findUnique({ where: { id: "default" } });
    expect(feedAfter?.enabled ?? false).toBe(feedBefore?.enabled ?? false);
    expect(feedAfter?.fulfilmentMode ?? "OFF").toBe(feedBefore?.fulfilmentMode ?? "OFF");
  }, 600_000);

  it("resumes an interrupted import without publishing a partial history", async () => {
    const lines = productReport(smallAccount, INTERRUPT_LINES);
    lines.push(`${smallAccount},I/D000001/2,PART,Same sku,1,"£1.00"`);
    lines.push(`${smallAccount},I/D000001/1,PART,Line,1,"£1.00"`);
    lines.push(`${smallAccount},I/D000002/2,PART,Zero,0,"£0.00"`);
    lines.push(`${smallAccount},I/BADLINE,MISSING,Bad identity,1,"£1.00"`);
    const saved = await saveCustomerSalesUpload({
      actorUserId: adminId,
      companyId: smallCompanyId,
      filename: "interrupt-561l.csv",
      role: "HISTORY_561L",
      body: streamFromString(lines.join("\n")),
    });
    const enqueued = await enqueueCustomerSalesHistoryUpload(adminId, {
      companyId: smallCompanyId,
      upload561lId: saved.uploadId,
    });
    const paused = await runCustomerSalesHistoryJob(enqueued.jobId, { maxBatches: 1 });
    expect(paused.status).toBe("STAGING");
    expect(paused.rowsStaged).toBeGreaterThan(0);
    expect(paused.rowsStored).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: smallCompanyId } })).toBe(0);
    expect(await prisma.customerSalesCutover.findUnique({ where: { companyId: smallCompanyId } })).toBeNull();

    const failed = await runCustomerSalesHistoryJob(enqueued.jobId, { failBeforePublish: true });
    expect(failed.status).toBe("FAILED");
    expect(failed.rowsStored).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: smallCompanyId } })).toBe(0);
    expect(await prisma.customerSalesCutover.findUnique({ where: { companyId: smallCompanyId } })).toBeNull();

    const finished = await runCustomerSalesHistoryJob(enqueued.jobId);
    expect(finished.status).toBe("COMPLETE");
    expect(finished.historyStatus).toBe("REVIEW");
    const stored = await prisma.autopartSalesLine.count({ where: { companyId: smallCompanyId, source: "561L" } });
    // productReport lines + D000001/2 PART + D000001/1 PART (distinct SKU on shared /1) + D000002/2 zero.
    expect(stored).toBe(INTERRUPT_LINES + 3);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: smallCompanyId, documentReference: "D000001" } })).toBe(3);
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId: smallCompanyId, documentReference: "D000001", sku: "PART" },
      }),
    ).toBe(2);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: smallCompanyId, documentReference: "D000001", lineNumber: 2 } })).toBe(1);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: smallCompanyId, documentReference: "BADLINE" } })).toBe(0);
    const zero = await prisma.autopartSalesLine.findFirstOrThrow({
      where: { companyId: smallCompanyId, documentReference: "D000002", lineNumber: 2 },
    });
    expect(Number(zero.units)).toBe(0);
    const cutover = await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId: smallCompanyId } });
    expect(cutover.historyStatus).toBe("REVIEW");

    const retry = await enqueueCustomerSalesHistoryUpload(adminId, {
      companyId: smallCompanyId,
      upload561lId: saved.uploadId,
    });
    const again = await runCustomerSalesHistoryJob(retry.jobId);
    expect(again.status).toBe("COMPLETE");
    expect(again.rowsStored).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: smallCompanyId } })).toBe(stored);
    expect((await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId: smallCompanyId } })).historyStatus).toBe("REVIEW");

    await prisma.autopartSalesDocument.update({
      where: {
        companyId_documentType_documentReference: {
          companyId: smallCompanyId,
          documentType: "INVOICE",
          documentReference: "D000003",
        },
      },
      data: { goodsNet: "123.45" },
    });
    const ledger = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${smallAccount},INV,D000003,19 Aug 15,"£9.00","£1.80","£10.80","£10.80"
${smallAccount},INV,D000004,19 Aug 15,"£4.00","£0.80","£4.80","£4.80"
${smallAccount},PAY,PAYKEEP,20 Aug 15,,,,"£0.00"
`;
    const filled = await confirmCustomerSalesHistory(adminId, {
      companyId: smallCompanyId,
      textSlrb: ledger,
      filenameSlrb: "fill-slrb.csv",
    });
    expect(filled.rowsImported).toBeGreaterThan(0);
    const protectedHeader = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: smallCompanyId, documentReference: "D000003", documentType: "INVOICE" },
    });
    expect(Number(protectedHeader.goodsNet)).toBeCloseTo(123.45, 2);
    const filledHeader = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: smallCompanyId, documentReference: "D000004", documentType: "INVOICE" },
    });
    expect(Number(filledHeader.goodsNet)).toBeCloseTo(4, 2);
    const payment = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: smallCompanyId, documentReference: "PAYKEEP", documentType: "PAYMENT" },
    });
    expect(payment.goodsNet).toBeNull();
    expect(await prisma.autopartSalesLine.count({ where: { companyId: smallCompanyId, documentType: "PAYMENT" } })).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: smallCompanyId } })).toBe(stored);
  }, 180_000);
});
