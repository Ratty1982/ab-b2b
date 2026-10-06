/**
 * Ongoing Autopart 504 + TRM21QC import / reconciliation / SI integration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  confirmAutopart504Import,
  confirmAutopartTrm21qcImport,
  previewAutopart504Import,
  previewAutopartTrm21qcImport,
} from "@/server/companies/autopart-ongoing-sales";
import {
  exportOngoingSalesImportDiagnosticsCsv,
  getOngoingSalesImportRunDetail,
  listOngoingSalesImportDiagnostics,
} from "@/server/companies/autopart-ongoing-sales-diagnostics";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { AuthError } from "@/server/rbac/guards";
import { loadHistoricSalesLines, summarizeHistoricLines } from "@/server/sales-intelligence/historic-lines";
import { isAutopart504Report } from "@/domain/autopart-504";
import { AUTOPART_504C_REPORT_TITLE } from "@/domain/autopart-504c";
import { AUTOPART_504C_HEADER } from "@/domain/autopart-504c-fixture";
import { processOngoingSalesEmailBatch } from "@/server/companies/autopart-ongoing-sales-poll";
import { emailReceiptKey } from "@/domain/stock-email";

const prisma = new PrismaClient();

let adminId = "";
let companyId = "";
let account = "";
let orderNumber = "";
let orderId = "";
const stamp = Date.now();
const skuA = `SKU-OG-A-${String(stamp).slice(-6)}`;
const skuB = `SKU-OG-B-${String(stamp).slice(-6)}`;
const skuC = `SKU-OG-C-${String(stamp).slice(-6)}`;
const docInv = `SSOG${String(stamp).slice(-6)}`;
const docCr = `SCOG${String(stamp).slice(-6)}`;
const docMam = `SSOM${String(stamp).slice(-6)}`;
const docWait = `SSOW${String(stamp).slice(-6)}`;

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
      },
    });
  }
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  return user.id;
}

async function uniqueAbOrderNumber(): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const n = String((100000 + ((Date.now() + attempt * 7919) % 900000)) % 1000000).padStart(6, "0");
    const orderNumber = `AB-${n}`;
    const existing = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } });
    if (!existing) return orderNumber;
  }
  throw new Error("Could not allocate AB order number");
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`og-sales.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  account = `OG${String(stamp).slice(-8)}`;

  const company = await prisma.company.create({
    data: {
      name: `Ongoing Sales Co ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
    },
  });
  companyId = company.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId,
    code: account,
  });

  const brand = await prisma.brand.create({
    data: { name: `OG Brand ${stamp}`, slug: `og-brand-${stamp}` },
  });
  const category = await prisma.category.create({
    data: { name: `OG Cat ${stamp}`, slug: `og-cat-${stamp}` },
  });
  for (const [sku, name] of [
    [skuA, "Widget A"],
    [skuB, "Widget B"],
  ] as const) {
    const product = await prisma.product.create({
      data: {
        name: `${name} ${stamp}`,
        slug: `og-${sku.toLowerCase()}`,
        brandId: brand.id,
        categoryId: category.id,
        status: "ACTIVE",
        isActive: true,
        isTradeVisible: true,
      },
    });
    await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku,
        isActive: true,
        tradePrice: 10,
      },
    });
  }

  orderNumber = await uniqueAbOrderNumber();
  const order = await prisma.order.create({
    data: {
      companyId,
      orderNumber,
      status: "CONFIRMED",
      subtotal: "303.00",
      vatTotal: "60.60",
      deliveryTotal: "0.00",
      grandTotal: "363.60",
      placedAt: new Date("2026-09-29T12:00:00.000Z"),
      autopartExportStatus: "EXPORTED",
      autopartAccountLinked: true,
      autopartCustomerCodeSnapshot: account,
      deliveryAddress: {
        line1: "1 Test Street",
        town: "Leeds",
        postcode: "LS1 1AA",
        country: "GB",
      },
      contactSnapshot: { name: "Buyer", email: `buyer-${stamp}@example.test`, phone: "01130000000" },
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function sample504(opts?: { creditOnly?: boolean }) {
  if (opts?.creditOnly) {
    return `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${docCr},29/09/2026,14:10,EXAMPLE MOTOR FACTORS,-33.33,-6.66,-39.99,WR,${orderNumber}
`;
  }
  return `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${docInv},29/09/2026,13:05,EXAMPLE MOTOR FACTORS,303.00,60.60,363.60,WR,${orderNumber}
ACCOUNT,${docCr},29/09/2026,14:10,EXAMPLE MOTOR FACTORS,-33.33,-6.66,-39.99,WR,${orderNumber}
ACCOUNT,${docMam},29/09/2026,15:00,DIRECT MAM CUST,50.00,10.00,60.00,DM,MAM-ONLY-1
`;
}

function sampleTrm() {
  return `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,${docInv},29/09/2026,${skuA},Widget A,2,200.00,100.00,100.00,50.000
${account},GRP,${docInv},29/09/2026,${skuB},Widget B,1,103.00,50.00,53.00,51.456
${account},GRP,${docCr},29/09/2026,${skuA},Widget A,-1,-33.33,16.00,-17.33,-108.312
${account},GRP,${docMam},29/09/2026,${skuC},Unknown Part,1,50.00,20.00,30.00,60.000
`;
}

describe("ongoing 504 + TRM21QC", () => {
  it("imports 504 then TRM21QC and reconciles NET goods to line sales", async () => {
    const run504 = await confirmAutopart504Import(adminId, {
      text: sample504(),
      filename: "504.csv",
      source: "MANUAL",
    });
    expect(run504.status).toBe("COMMITTED");

    const invoice = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: docInv },
    });
    expect(invoice?.has504).toBe(true);
    expect(Number(invoice?.goodsNet)).toBe(303);
    expect(invoice?.abOrderNumber).toBe(orderNumber);
    expect(invoice?.reconciliationStatus).toBe("AWAITING_LINES");

    const credit = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: docCr },
    });
    expect(credit?.documentType).toBe("CREDIT");
    expect(Number(credit?.goodsNet)).toBeCloseTo(-33.33, 2);

    const runTrm = await confirmAutopartTrm21qcImport(adminId, {
      text: sampleTrm(),
      filename: "TRM21QC.csv",
      source: "MANUAL",
    });
    expect(runTrm.status).toBe("COMMITTED");

    const invoiceAfter = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: docInv },
      include: { lines: true },
    });
    expect(invoiceAfter?.hasTrm21qc).toBe(true);
    expect(invoiceAfter?.lines).toHaveLength(2);
    expect(["MATCHED", "COMPLETE"]).toContain(invoiceAfter?.reconciliationStatus);

    const creditAfter = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: docCr },
      include: { lines: true },
    });
    expect(Number(creditAfter?.lines[0]?.units)).toBe(-1);
    expect(Number(creditAfter?.lines[0]?.salesNet)).toBeCloseTo(-33.33, 2);
    expect(["MATCHED", "COMPLETE"]).toContain(creditAfter?.reconciliationStatus);

    // Idempotent overlap re-import
    const again = await confirmAutopart504Import(adminId, {
      text: sample504(),
      filename: "504-overlap.csv",
      source: "MANUAL",
    });
    expect(again.status).toBe("COMMITTED");
    const docs = await prisma.autopartSalesDocument.count({
      where: { documentReference: { in: [docInv, docCr, docMam] } },
    });
    expect(docs).toBe(3);

    const lines = await loadHistoricSalesLines({
      companyId,
      range: { from: "2026-09-01", to: "2026-09-30" },
    });
    const totals = summarizeHistoricLines(lines);
    // 303 + 50 - 33.33 = 319.67 — VAT excluded; Money scale is 4dp.
    expect(totals.netSalesMinor).toBe(3_196_700n);
    const creditLines = lines.filter((l) => l.documentType === "CREDIT");
    expect(creditLines.length).toBeGreaterThan(0);

    const unknown = await prisma.autopartSalesLine.findFirst({
      where: { documentReference: docMam, sku: skuC },
    });
    expect(unknown?.matchStatus).toBe("NOT_IN_AB_CATALOGUE");
  });

  it("credit-only 504 does not despatch the AB order", async () => {
    // Reset order to CONFIRMED for credit-only path using a fresh order
    const creditOrderNumber = await uniqueAbOrderNumber();
    const creditOrder = await prisma.order.create({
      data: {
        companyId,
        orderNumber: creditOrderNumber,
        status: "CONFIRMED",
        subtotal: "33.33",
        vatTotal: "6.66",
        deliveryTotal: "0.00",
        grandTotal: "39.99",
        placedAt: new Date("2026-09-29T12:00:00.000Z"),
        autopartExportStatus: "EXPORTED",
        autopartAccountLinked: true,
        autopartCustomerCodeSnapshot: account,
        deliveryAddress: {
          line1: "1 Test Street",
          town: "Leeds",
          postcode: "LS1 1AA",
          country: "GB",
        },
        contactSnapshot: { name: "Buyer", email: `cr-${stamp}@example.test`, phone: "01130000000" },
      },
    });
    // 504C bridge pads Document to 10 chars — keep credit refs within that width.
    const creditDoc = `SC${String(stamp).slice(-8)}`;
    const text = `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${creditDoc},29/09/2026,14:10,EXAMPLE MOTOR FACTORS,-33.33,-6.66,-39.99,WR,${creditOrderNumber}
`;
    await confirmAutopart504Import(adminId, {
      text,
      filename: "504-credit-only.csv",
      source: "MANUAL",
    });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: creditOrder.id } });
    expect(after.status).not.toBe("DISPATCHED");
    expect(after.status).toBe("CONFIRMED");

    const inv = await prisma.invoice.findFirst({ where: { externalRef: creditDoc } });
    expect(inv?.autopartDocumentKind).toBe("CREDIT");
  });

  it("awaits companion report without failing", async () => {
    // AB-linked 504 so company maps; companion TRM21QC not yet present.
    const waitDoc = `SSW${String(stamp).slice(-7)}`;
    const only504 = `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${waitDoc},29/09/2026,13:00,EXAMPLE,10.00,2.00,12.00,WR,${orderNumber}
`;
    await confirmAutopart504Import(adminId, {
      text: only504,
      filename: "504-wait.csv",
      source: "MANUAL",
    });
    const doc = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: waitDoc },
    });
    expect(doc?.reconciliationStatus).toBe("AWAITING_LINES");
  });

  it("preview does not commit and matches commit classification for 504/TRM21QC", async () => {
    const docP = `SSP${String(stamp).slice(-7)}`;
    const text504 = `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${docP},29/09/2026,13:05,EXAMPLE MOTOR FACTORS,10.00,2.00,12.00,WR,${orderNumber}
`;
    const beforeDocs = await prisma.autopartSalesDocument.count({
      where: { documentReference: docP },
    });
    const preview = await previewAutopart504Import(adminId, {
      text: text504,
      filename: "504-preview.csv",
    });
    expect(preview.wouldInsert).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.autopartSalesDocument.count({ where: { documentReference: docP } }),
    ).toBe(beforeDocs);

    const committed = await confirmAutopart504Import(adminId, {
      text: text504,
      filename: "504-preview.csv",
      source: "MANUAL",
    });
    expect(committed.rowsImported).toBe(preview.wouldInsert);

    const diag = await prisma.autopartImportDiagnostic.findMany({
      where: { importRunId: committed.id },
    });
    expect(diag.length).toBeGreaterThan(0);
    expect(diag.every((d) => d.reasonCode)).toBe(true);
    const tally = diag.reduce(
      (acc, d) => {
        acc[d.status] = (acc[d.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(tally["INSERTED"] ?? 0).toBe(committed.rowsImported);
    expect(tally["UPDATED"] ?? 0).toBe(committed.rowsUpdated);

    const unmappedAcct = `ZZ${String(stamp).slice(-6)}`;
    const docT = `SST${String(stamp).slice(-7)}`;
    const textTrm = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${unmappedAcct},GRP,${docT},29/09/2026,${skuA},Widget A,1,10.00,5.00,5.00,50.000
${account},GRP,${docInv},29/09/2026,${skuA},Widget A,2,200.00,100.00,100.00,50.000
`;
    const linesBefore = await prisma.autopartSalesLine.count({
      where: { documentReference: docT },
    });
    const trmPreview = await previewAutopartTrm21qcImport(adminId, {
      text: textTrm,
      filename: "trm-preview.csv",
    });
    expect(trmPreview.wouldSkip).toBeGreaterThanOrEqual(1);
    expect(trmPreview.diagnostics.some((d) => d.reasonCode === "UNMAPPED_CUSTOMER")).toBe(true);
    expect(
      await prisma.autopartSalesLine.count({ where: { documentReference: docT } }),
    ).toBe(linesBefore);

    const trmRun = await confirmAutopartTrm21qcImport(adminId, {
      text: textTrm,
      filename: "trm-preview.csv",
      source: "MANUAL",
    });
    expect(trmRun.rowsSkipped).toBeGreaterThanOrEqual(1);
    const skipped = await prisma.autopartImportDiagnostic.findMany({
      where: { importRunId: trmRun.id, reasonCode: "UNMAPPED_CUSTOMER" },
    });
    expect(skipped.length).toBeGreaterThanOrEqual(1);
    expect(Number(skipped[0]?.salesNet)).toBeCloseTo(10, 2);

    // Idempotent re-import — financial rows not duplicated; unchanged diagnostics appear
    const again = await confirmAutopartTrm21qcImport(adminId, {
      text: textTrm,
      filename: "trm-preview-again.csv",
      source: "MANUAL",
    });
    const unchanged = await prisma.autopartImportDiagnostic.count({
      where: { importRunId: again.id, status: "UNCHANGED" },
    });
    expect(unchanged).toBeGreaterThanOrEqual(1);
    const lineCount = await prisma.autopartSalesLine.count({
      where: { companyId, documentReference: docInv, sku: skuA },
    });
    expect(lineCount).toBe(1);

    const detail = await getOngoingSalesImportRunDetail(adminId, trmRun.id);
    expect(detail.hasRowDiagnostics).toBe(true);
    expect(detail.counts.skipped).toBeGreaterThanOrEqual(1);

    const csv = await exportOngoingSalesImportDiagnosticsCsv(adminId, trmRun.id);
    expect(csv.csv).toContain("Reason Code");
    expect(csv.csv).toContain("UNMAPPED_CUSTOMER");
    expect(csv.csv).not.toContain("unit-test-secret");
  });

  it("run detail RBAC blocks trade users; historic run without diagnostics does not fabricate rows", async () => {
    const trade = await ensureUser(`og-sales.trade.${stamp}@example.invalid`, []);
    await prisma.user.update({
      where: { id: trade },
      data: { actorType: "TRADE" },
    });
    const run = await prisma.autopartCustomerImportRun.create({
      data: {
        type: "ONGOING_TRM21QC",
        status: "COMMITTED",
        filename: "historic-no-diag.csv",
        dryRun: false,
        rowsRead: 177,
        rowsImported: 110,
        rowsUpdated: 0,
        rowsSkipped: 67,
        rowsUnmatched: 12,
        diagnostics: { source: "MANUAL" },
        completedAt: new Date(),
      },
    });
    const detail = await getOngoingSalesImportRunDetail(adminId, run.id);
    expect(detail.hasRowDiagnostics).toBe(false);
    expect(detail.aggregateNote).toContain("Detailed row diagnostics were not recorded");
    expect(detail.aggregateNote).toContain("67");
    const list = await listOngoingSalesImportDiagnostics(adminId, { runId: run.id });
    expect(list.hasRowDiagnostics).toBe(false);
    expect(list.items).toHaveLength(0);

    await expect(getOngoingSalesImportRunDetail(trade, run.id)).rejects.toBeInstanceOf(AuthError);
    await expect(
      exportOngoingSalesImportDiagnosticsCsv(trade, run.id),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("keeps 504 distinct from 504C content detection", () => {
    const text504 = sample504();
    expect(isAutopart504Report(text504)).toBe(true);
    expect(text504.toUpperCase()).not.toContain("504C");
    expect(text504.toUpperCase()).not.toContain(AUTOPART_504C_REPORT_TITLE.toUpperCase());
  });
});

describe("ongoing 504 TXT email poll", () => {
  const txtStamp = `${stamp}txt`;
  const txtInv = `SSTX${String(stamp).slice(-6)}`;
  const txtCr = `SCTX${String(stamp).slice(-6)}`;
  const txtTrmSku = `SKU-TX-${String(stamp).slice(-6)}`;

  function sample504Txt() {
    return `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${txtInv},29/09/2026,13:05,EXAMPLE MOTOR FACTORS,80.00,16.00,96.00,WR,${orderNumber}
ACCOUNT,${txtCr},29/09/2026,14:10,EXAMPLE MOTOR FACTORS,-8.00,-1.60,-9.60,WR,${orderNumber}
`;
  }

  function sampleTrmTxtCompanion() {
    return `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,${txtInv},29/09/2026,${txtTrmSku},Torch,2,80.00,40.00,40.00,50.000
${account},GRP,${txtCr},29/09/2026,${txtTrmSku},Torch credit,-1,-8.00,4.00,-4.00,-100.000
`;
  }

  it("imports 504.TXT through the existing ongoing importer and does not duplicate TRM", async () => {
    const text504 = sample504Txt();
    const textTrm = sampleTrmTxtCompanion();
    const email = {
      uid: `uid-504-txt-${txtStamp}`,
      messageId: `<504-txt-${txtStamp}@example.invalid>`,
      from: "reports@example.invalid",
      subject: "Day end reports",
      receivedAt: new Date(),
      attachments: [
        { filename: "504.TXT", content: Buffer.from(text504), contentType: "text/plain" },
        { filename: "TRM21QC.csv", content: Buffer.from(textTrm), contentType: "text/csv" },
      ],
    };

    const first = await processOngoingSalesEmailBatch({
      emails: [email],
      actorUserId: adminId,
      source: "EMAIL",
      autoArchive: false,
    });
    expect(first.processed504).toBe(1);
    expect(first.processedTrm21qc).toBe(1);
    expect(first.attachments.find((a) => a.filename === "504.TXT")?.detectedType).toBe("ONGOING_504");
    expect(first.attachments.find((a) => a.filename === "504.TXT")?.result).toBe("imported");

    const invoice = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: txtInv },
    });
    expect(invoice?.has504).toBe(true);
    expect(Number(invoice?.goodsNet)).toBe(80);
    const credit = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: txtCr },
    });
    expect(credit?.documentType).toBe("CREDIT");
    expect(Number(credit?.goodsNet)).toBeCloseTo(-8, 2);

    const again = await processOngoingSalesEmailBatch({
      emails: [email],
      actorUserId: adminId,
      source: "EMAIL",
      autoArchive: false,
    });
    expect(again.processed504).toBe(0);
    expect(again.processedTrm21qc).toBe(0);
    expect(again.duplicatesIgnored).toBe(2);
    const docs = await prisma.autopartSalesDocument.count({
      where: { documentReference: { in: [txtInv, txtCr] } },
    });
    expect(docs).toBe(2);
  });

  it("reconsiders a previously ignored 504 TXT after an email-level TRM consume", async () => {
    const lateInv = `SSL8${String(stamp).slice(-6)}`;
    const text504 = `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${lateInv},29/09/2026,18:00,EXAMPLE MOTOR FACTORS,12.00,2.40,14.40,WR,MAM-ONLY-TXT
`;
    const textTrm = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,${lateInv},29/09/2026,${txtTrmSku},Late line,1,12.00,6.00,6.00,50.000
`;
    const email = {
      uid: `uid-ignored-504-${txtStamp}`,
      messageId: `<ignored-504-${txtStamp}@example.invalid>`,
      from: "reports@example.invalid",
      subject: "Autopart day end",
      receivedAt: new Date(),
      attachments: [
        { filename: "504.TXT", content: Buffer.from(text504), contentType: "application/octet-stream" },
        { filename: "TRM21QC.CSV", content: Buffer.from(textTrm), contentType: "text/csv" },
      ],
    };

    await confirmAutopartTrm21qcImport(adminId, {
      text: textTrm,
      filename: "TRM21QC.CSV",
      source: "EMAIL",
    });
    const oldKey = emailReceiptKey(email.messageId, email.uid);
    expect(oldKey).toBeTruthy();
    await prisma.stockEmailReceipt.upsert({
      where: { receiptKey: oldKey! },
      create: {
        receiptKey: oldKey!,
        emailUid: email.uid,
        emailMessageId: email.messageId,
        fromAddress: email.from,
        subject: email.subject,
        receivedAt: email.receivedAt,
        consumed: true,
        attachmentFilename: "TRM21QC.CSV",
      },
      update: { consumed: true, attachmentFilename: "TRM21QC.CSV" },
    });

    const poll = await processOngoingSalesEmailBatch({
      emails: [email],
      actorUserId: adminId,
      source: "EMAIL",
      autoArchive: false,
    });
    expect(poll.processed504).toBe(1);
    expect(poll.processedTrm21qc).toBe(0);
    expect(poll.duplicatesIgnored).toBe(1);
    expect(poll.attachments.find((a) => a.filename === "504.TXT")?.result).toBe("imported");
    expect(poll.attachments.find((a) => a.filename.toUpperCase() === "TRM21QC.CSV")?.result).toBe(
      "duplicate",
    );

    const doc = await prisma.autopartSalesDocument.findFirst({ where: { documentReference: lateInv } });
    expect(doc?.has504).toBe(true);
    expect(doc?.hasTrm21qc).toBe(true);
  });

  it("skips legacy 504C TXT, arbitrary TXT, and malformed 504 without a financial import", async () => {
    const bogusDoc = `SSBG${String(stamp).slice(-6)}`;
    const emails = [
      {
        uid: `uid-504c-${txtStamp}`,
        messageId: `<504c-${txtStamp}@example.invalid>`,
        from: "reports@example.invalid",
        subject: "504C",
        receivedAt: new Date(),
        attachments: [
          {
            filename: "504.TXT",
            content: Buffer.from(`${AUTOPART_504C_REPORT_TITLE}\n${AUTOPART_504C_HEADER}\n`),
            contentType: "text/plain",
          },
        ],
      },
      {
        uid: `uid-notes-${txtStamp}`,
        messageId: `<notes-${txtStamp}@example.invalid>`,
        from: "reports@example.invalid",
        subject: "notes",
        receivedAt: new Date(),
        attachments: [
          { filename: "notes.txt", content: Buffer.from("not a report"), contentType: "text/plain" },
          {
            filename: "payload.bin",
            content: Buffer.from("zzzz"),
            contentType: "application/octet-stream",
          },
        ],
      },
      {
        uid: `uid-malformed-${txtStamp}`,
        messageId: `<malformed-${txtStamp}@example.invalid>`,
        from: "reports@example.invalid",
        subject: "almost 504",
        receivedAt: new Date(),
        attachments: [
          {
            filename: "504.TXT",
            content: Buffer.from(`Hello\nDocument ${bogusDoc} but no Customer Order Number header\n`),
            contentType: "text/plain",
          },
        ],
      },
    ];
    const poll = await processOngoingSalesEmailBatch({
      emails,
      actorUserId: adminId,
      source: "EMAIL",
      autoArchive: false,
    });
    expect(poll.processed504).toBe(0);
    expect(poll.processedTrm21qc).toBe(0);
    expect(poll.attachments.some((a) => a.detectedType === "LEGACY_504C" && a.result === "skipped")).toBe(
      true,
    );
    expect(poll.attachments.some((a) => a.filename === "notes.txt" && a.detectedType === "UNKNOWN")).toBe(
      true,
    );
    expect(poll.attachments.some((a) => a.filename === "payload.bin" && a.candidate === false)).toBe(true);
    expect(
      poll.attachments.some(
        (a) => a.filename === "504.TXT" && a.detectedType === "UNKNOWN" && a.skipReason?.includes("not recognised"),
      ),
    ).toBe(true);
    expect(await prisma.autopartSalesDocument.count({ where: { documentReference: bogusDoc } })).toBe(0);
  });
});
