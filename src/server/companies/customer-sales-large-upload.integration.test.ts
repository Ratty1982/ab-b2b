import "@/server/testing/use-protect-integration-database";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import {
  acknowledgeCustomerSalesHistoryReview,
  previewCustomerSalesHistory,
  startCustomerSalesHistoryBaseline,
} from "@/server/companies/customer-sales-history-import";
import { previewCustomerSalesImport } from "@/server/companies/customer-sales-import";
import {
  confirmCustomerSalesHistoryUpload,
  confirmCustomerSalesImportUpload,
  previewCustomerSalesHistoryUpload,
  previewCustomerSalesImportUpload,
  saveCustomerSalesUpload,
} from "@/server/companies/customer-sales-upload";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const account = `RT${stamp.slice(0, 8)}`;
const alias = `RA${stamp.slice(0, 8)}`;
const otherAccount = `RX${stamp.slice(0, 8)}`;
const HISTORY_LIMIT = 8_000_000;
const ONGOING_LIMIT = 5_000_000;

let adminId = "";
let strangerId = "";
let companyId = "";
let otherCompanyId = "";
let baselineCompanyId = "";
let uploadDir = "";
let orderNumber = "";
let otherOrderNumber = "";

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

function retailBlock(line: string, minimumChars: number, prefix: string): string {
  const repeats = Math.ceil(minimumChars / line.length) + 2;
  return prefix + line.repeat(repeats);
}

async function uniqueOrderNumber() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const n = String((100000 + ((Date.now() + attempt * 7919) % 900000)) % 1000000).padStart(6, "0");
    const candidate = `AB-${n}`;
    const existing = await prisma.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  throw new Error("Could not allocate an order number");
}

beforeAll(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), "customer-sales-upload-"));
  process.env["CUSTOMER_SALES_UPLOAD_DIR"] = uploadDir;
  await bootstrapRbac(prisma);
  const user = await prisma.user.create({
    data: {
      email: `large-sales.${stamp}@example.invalid`,
      name: "Large sales importer",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const stranger = await prisma.user.create({
    data: {
      email: `large-sales-stranger.${stamp}@example.invalid`,
      name: "No sales permission",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  adminId = user.id;
  strangerId = stranger.id;
  const company = await prisma.company.create({ data: { name: `Retail ${stamp}`, status: "ACTIVE" } });
  const other = await prisma.company.create({ data: { name: `Other retail ${stamp}`, status: "ACTIVE" } });
  const baseline = await prisma.company.create({ data: { name: `Baseline retail ${stamp}`, status: "ACTIVE" } });
  companyId = company.id;
  otherCompanyId = other.id;
  baselineCompanyId = baseline.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code: account });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: otherCompanyId, code: otherAccount });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: baselineCompanyId, code: `RB${stamp.slice(0, 8)}` });
  await prisma.autopartCustomerAccountAlias.create({
    data: { companyId, alias, verifiedById: adminId },
  });
  orderNumber = await uniqueOrderNumber();
  otherOrderNumber = await uniqueOrderNumber();
  await prisma.order.create({
    data: {
      companyId,
      orderNumber,
      status: "CONFIRMED",
      subtotal: "10.00",
      vatTotal: "2.00",
      grandTotal: "12.00",
      deliveryAddress: { line1: "1 Test Street", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
      contactSnapshot: { name: "Buyer", email: "buyer@example.invalid", phone: "01130000000" },
    },
  });
  await prisma.order.create({
    data: {
      companyId: otherCompanyId,
      orderNumber: otherOrderNumber,
      status: "CONFIRMED",
      subtotal: "5.00",
      vatTotal: "1.00",
      grandTotal: "6.00",
      deliveryAddress: { line1: "2 Test Street", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
      contactSnapshot: { name: "Other", email: "other@example.invalid", phone: "01130000001" },
    },
  });
}, 120_000);

afterAll(async () => {
  const ids = [companyId, otherCompanyId, baselineCompanyId].filter(Boolean);
  if (ids.length) {
    await prisma.autopartSalesLine.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.customerSalesCutover.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.autopartCustomerImportRun.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.order.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.company.deleteMany({ where: { id: { in: ids } } });
  }
  if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
  await prisma.$disconnect();
}, 120_000);

describe("large retail sales uploads", () => {
  it("rejects an inline report above the old limit and an upload above the byte cap", async () => {
    await expect(
      previewCustomerSalesHistory(adminId, { companyId, text561l: "x".repeat(HISTORY_LIMIT + 1) }),
    ).rejects.toThrow(/too large to preview/);
    await expect(
      previewCustomerSalesImport(adminId, {
        companyId,
        accountCode: account,
        text: "x".repeat(ONGOING_LIMIT + 1),
      }),
    ).rejects.toThrow(/too large to preview/);
    const before = await readdir(uploadDir);
    await expect(
      saveCustomerSalesUpload({
        actorUserId: adminId,
        companyId,
        filename: "too-big.csv",
        role: "HISTORY_561L",
        body: streamFromString("x".repeat(2048)),
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/upload limit is 1,024 bytes/);
    expect(await readdir(uploadDir)).toEqual(before);
    await expect(
      saveCustomerSalesUpload({
        actorUserId: strangerId,
        companyId,
        filename: "nope.csv",
        role: "HISTORY_561L",
        body: streamFromString("Acct.,Inv & Ln,Part Number,Description,Units,Sales\n"),
      }),
    ).rejects.toBeInstanceOf(AuthError);
  }, 120_000);

  it("previews and confirms a Retail 561L and SLRB file larger than both old limits", async () => {
    const otherLine = `${otherAccount},I/OTHKEEP/1,PART,Other customer sales row,1,"£1.00"\n`;
    const own = [
      `${account},I/INVKEEP/1,WIDGET,Widget,2,"£20.00"`,
      `${account},I/INVKEEP/2,WIDGET,Widget again,1,"£5.00"`,
      `,I/INVKEEP/3,WIDGET,Continuation,1,"£6.00"`,
      `${account},C/CRKEEP/1,WIDGET,Credit,1,"£4.00"`,
      `${alias},I/ALIAS1/1,ALSKU,Alias line,1,"£3.00"`,
      `${account},I/BADLINE,MISSING,Bad identity,1,"£1.00"`,
    ].join("\n");
    const text561 = retailBlock(
      otherLine,
      HISTORY_LIMIT + 1,
      `Acct.,Inv & Ln,Part Number,Description,Units,Sales\n${own}\n`,
    );
    expect(text561.length).toBeGreaterThan(HISTORY_LIMIT);
    expect(text561.length).toBeGreaterThan(ONGOING_LIMIT);
    const ledgerOwn = [
      `${account},INV,INVKEEP,06 Oct 26,"£31.00","£6.20","£37.20","£37.20"`,
      `${account},CRN,CRKEEP,07 Oct 26,"-£4.00","-£0.80","-£4.80","£32.40"`,
      `${account},PAY,PAYKEEP,08 Oct 26,"£0.00","£0.00","-£10.00","£22.40"`,
    ].join("\n");
    const ledger = retailBlock(
      `${otherAccount},INV,OTHKEEP,01 Oct 26,"£1.00","£0.20","£1.20","£1.20"\n`,
      HISTORY_LIMIT + 1,
      `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal\n${ledgerOwn}\n`,
    );
    expect(ledger.length).toBeGreaterThan(HISTORY_LIMIT);
    const linesBefore = await prisma.autopartSalesLine.count({ where: { companyId } });
    const saved561 = await saveCustomerSalesUpload({
      actorUserId: adminId,
      companyId,
      filename: "retail-561l.csv",
      role: "HISTORY_561L",
      body: streamFromString(text561),
    });
    const savedLedger = await saveCustomerSalesUpload({
      actorUserId: adminId,
      companyId,
      filename: "retail-slrb.csv",
      role: "HISTORY_SLRB",
      body: streamFromString(ledger),
    });
    expect(saved561.bytes).toBeGreaterThan(HISTORY_LIMIT);
    const preview = await previewCustomerSalesHistoryUpload(adminId, {
      companyId,
      upload561lId: saved561.uploadId,
      uploadSlrbId: savedLedger.uploadId,
      samplePage: 1,
      samplePageSize: 25,
    });
    expect(await prisma.autopartSalesLine.count({ where: { companyId } })).toBe(linesBefore);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId } })).toBe(0);
    expect(preview.rowsRead).toBeGreaterThan(1000);
    expect(preview.otherCustomerRows).toBeGreaterThan(1000);
    expect(preview.counts.import).toBeGreaterThan(0);
    expect(preview.counts.rejected).toBeGreaterThan(0);
    expect(preview.counts.ledger).toBeGreaterThan(0);
    expect(preview.completion).toBe("REVIEW");
    expect(preview.message).toMatch(/does not create sales records/);
    expect(preview.rows.some((row) => row.account === otherAccount)).toBe(false);
    expect(preview.rows.some((row) => row.disposition === "rejected")).toBe(true);
    expect(preview.byteSize).toBeGreaterThan(HISTORY_LIMIT);

    const imported = await confirmCustomerSalesHistoryUpload(adminId, {
      companyId,
      upload561lId: saved561.uploadId,
      uploadSlrbId: savedLedger.uploadId,
    });
    expect(imported.rowsImported).toBeGreaterThan(0);
    expect(imported.historyStatus).toBe("REVIEW");
    const lines = await prisma.autopartSalesLine.findMany({ where: { companyId } });
    expect(lines.every((line) => line.companyId === companyId && line.source === "561L")).toBe(true);
    expect(lines.some((line) => line.autopartCustomerCode === otherAccount)).toBe(false);
    expect(await prisma.autopartSalesLine.count({ where: { companyId, documentReference: "INVKEEP", sku: "WIDGET" } })).toBe(3);
    expect(await prisma.autopartSalesLine.count({ where: { companyId, documentReference: "ALIAS1", sku: "ALSKU" } })).toBe(1);
    const credit = lines.find((line) => line.documentReference === "CRKEEP");
    expect(Number(credit?.salesNet)).toBeLessThan(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId, documentReference: "BADLINE" } })).toBe(0);
    expect(await prisma.autopartSalesDocument.count({ where: { documentReference: "OTHKEEP" } })).toBe(0);
    const payment = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId, documentReference: "PAYKEEP", documentType: "PAYMENT" },
    });
    expect(payment.goodsNet).toBeNull();
    expect(await prisma.autopartSalesLine.count({ where: { companyId, documentType: "PAYMENT" } })).toBe(0);
    const header = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId, documentReference: "INVKEEP", documentType: "INVOICE" },
    });
    expect(Number(header.goodsNet)).toBeCloseTo(31, 2);
    const cutover = await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId } });
    expect(cutover.historyStatus).toBe("REVIEW");
    expect(cutover.evidence).toMatchObject({ kind: "561L_SLRB", sha256561l: saved561.sha256 });

    const stored = await prisma.autopartSalesLine.count({ where: { companyId } });
    const again = await confirmCustomerSalesHistoryUpload(adminId, {
      companyId,
      upload561lId: saved561.uploadId,
      uploadSlrbId: savedLedger.uploadId,
    });
    expect(again.rowsImported).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId } })).toBe(stored);
    expect((await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId } })).historyStatus).toBe("REVIEW");

    const filePath = (await prisma.customerSalesUpload.findUniqueOrThrow({ where: { id: saved561.uploadId } })).storagePath;
    await writeFile(filePath, "tampered\n");
    await expect(
      previewCustomerSalesHistoryUpload(adminId, { companyId, upload561lId: saved561.uploadId }),
    ).rejects.toThrow(/hash does not match/);
    expect(await prisma.autopartSalesLine.count({ where: { companyId } })).toBe(stored);
    await expect(
      previewCustomerSalesHistoryUpload(adminId, { companyId: otherCompanyId, upload561lId: savedLedger.uploadId }),
    ).rejects.toThrow(/different customer/);
    await prisma.customerSalesUpload.update({
      where: { id: savedLedger.uploadId },
      data: { storagePath: "/tmp/not-private-sales-upload.csv" },
    });
    await expect(
      previewCustomerSalesHistoryUpload(adminId, { companyId, uploadSlrbId: savedLedger.uploadId }),
    ).rejects.toThrow(/private storage/);
  }, 180_000);

  it("keeps a new sales baseline distinct until a real history file is confirmed", async () => {
    const code = `RB${stamp.slice(0, 8)}`;
    const started = await startCustomerSalesHistoryBaseline(adminId, baselineCompanyId);
    expect(started.kind).toBe("PRELAUNCH_HISTORY_DISCARDED");
    const text = `Acct.,Inv & Ln,Part Number,Description,Units,Sales\n${code},I/BASEKEEP/1,WIDGET,Baseline,1,"£4.00"\n`;
    const saved = await saveCustomerSalesUpload({
      actorUserId: adminId,
      companyId: baselineCompanyId,
      filename: "baseline-561l.csv",
      role: "HISTORY_561L",
      body: streamFromString(text),
    });
    const preview = await previewCustomerSalesHistoryUpload(adminId, {
      companyId: baselineCompanyId,
      upload561lId: saved.uploadId,
    });
    expect(preview.counts.import).toBe(1);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: baselineCompanyId } })).toBe(0);
    const imported = await confirmCustomerSalesHistoryUpload(adminId, {
      companyId: baselineCompanyId,
      upload561lId: saved.uploadId,
    });
    expect(imported.historyStatus).toBe("COMPLETE");
    const evidence = await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId: baselineCompanyId } });
    expect(evidence.evidence).toMatchObject({ kind: "561L_SLRB" });
    expect(evidence.evidence).not.toMatchObject({ kind: "NO_HISTORICAL_SALES" });
    await expect(startCustomerSalesHistoryBaseline(adminId, baselineCompanyId)).rejects.toThrow(/already/);
  }, 120_000);

  it("imports a large 504 and TRM21QC report only for the selected customer", async () => {
    const feedEnabledBefore =
      (await prisma.autopartOngoingSalesFeedSettings.findUnique({ where: { id: "default" } }))?.enabled ?? false;
    await acknowledgeCustomerSalesHistoryReview(adminId, companyId);
    const trmOther = `${otherAccount},GRP,TRMOTH,29/09/2026,PART-X,Other,1,5.00,2.00,3.00,60.000\n`;
    const trm = retailBlock(
      trmOther,
      HISTORY_LIMIT + 1,
      `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%\n${account},GRP,TRMKEEP,29/09/2026,PART-1,Widget,2,10.00,4.00,6.00,60.000\n${alias},GRP,TRMALS,29/09/2026,PART-2,Alias,1,3.00,1.00,2.00,66.000\n`,
    );
    expect(trm.length).toBeGreaterThan(ONGOING_LIMIT);
    const savedTrm = await saveCustomerSalesUpload({
      actorUserId: adminId,
      companyId,
      filename: "TRM21QC.csv",
      role: "ONGOING",
      body: streamFromString(trm),
    });
    const before = await prisma.autopartSalesLine.count({ where: { documentReference: "TRMKEEP" } });
    const preview = await previewCustomerSalesImportUpload(adminId, {
      companyId,
      accountCode: account,
      uploadId: savedTrm.uploadId,
    });
    expect(preview.kind).toBe("TRM21QC");
    expect(preview.canCommit).toBe(true);
    expect(preview.counts.import).toBe(1);
    expect(preview.counts.rejected).toBe(1);
    expect(preview.otherCustomerRows).toBeGreaterThan(1000);
    expect(preview.rows.some((row) => row.account === otherAccount)).toBe(false);
    expect(preview.rows.some((row) => row.account === alias && row.disposition === "rejected")).toBe(true);
    expect(await prisma.autopartSalesLine.count({ where: { documentReference: "TRMKEEP" } })).toBe(before);
    const imported = await confirmCustomerSalesImportUpload(adminId, {
      companyId,
      accountCode: account,
      uploadId: savedTrm.uploadId,
    });
    expect(imported.rowsImported).toBe(1);
    const mine = await prisma.autopartSalesLine.findMany({ where: { documentReference: "TRMKEEP" } });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.companyId).toBe(companyId);
    expect(mine[0]?.source).toBe("ONGOING_TRM21QC");
    expect(await prisma.autopartSalesLine.count({ where: { documentReference: "TRMOTH" } })).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { documentReference: "TRMALS" } })).toBe(0);
    const second = await confirmCustomerSalesImportUpload(adminId, {
      companyId,
      accountCode: account,
      uploadId: savedTrm.uploadId,
    });
    expect(second.rowsImported).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { documentReference: "TRMKEEP" } })).toBe(1);

    const report504 = retailBlock(
      `ACCOUNT,DOCOTH,29/09/2026,13:06,OTHER SALES,5.00,1.00,6.00,WR,${otherOrderNumber}\n`,
      ONGOING_LIMIT + 1,
      `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number\nACCOUNT,DOCKEEP,29/09/2026,13:05,CUSTOMER SALES,10.00,2.00,12.00,WR,${orderNumber}\n`,
    );
    expect(report504.length).toBeGreaterThan(ONGOING_LIMIT);
    const saved504 = await saveCustomerSalesUpload({
      actorUserId: adminId,
      companyId,
      filename: "504.csv",
      role: "ONGOING",
      body: streamFromString(report504),
    });
    const headerPreview = await previewCustomerSalesImportUpload(adminId, {
      companyId,
      accountCode: account,
      uploadId: saved504.uploadId,
    });
    expect(headerPreview.kind).toBe("504");
    expect(headerPreview.counts.import + headerPreview.counts.update).toBe(1);
    expect(headerPreview.otherCustomerRows).toBeGreaterThan(1000);
    expect(await prisma.autopartSalesDocument.count({ where: { documentReference: "DOCKEEP", companyId } })).toBe(0);
    await confirmCustomerSalesImportUpload(adminId, {
      companyId,
      accountCode: account,
      uploadId: saved504.uploadId,
    });
    expect(await prisma.autopartSalesDocument.count({ where: { documentReference: "DOCKEEP", companyId } })).toBe(1);
    expect(await prisma.autopartSalesDocument.count({ where: { documentReference: "DOCOTH" } })).toBe(0);
    const feed = await prisma.autopartOngoingSalesFeedSettings.findUnique({ where: { id: "default" } });
    expect(feed?.enabled ?? false).toBe(feedEnabledBefore);
  }, 180_000);
});
