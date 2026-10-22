/**
 * Proves the pre-launch imported-sales reset on an isolated database, then
 * rebuilds one Active customer's history and ongoing sales.
 * Refuses every database name except automotive_brands_sales_reset_test.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { databaseNameFromUrl } from "../src/domain/customer-data-reset";
import { IMPORTED_SALES_RESET_CONFIRMATION } from "../src/domain/imported-sales-reset";
import { bootstrapRbac } from "../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "../src/server/companies/autopart-account";
import { confirmCustomerSalesImport } from "../src/server/companies/customer-sales-import";
import {
  acknowledgeCustomerSalesHistoryReview,
  completeCustomerSalesCutoverWithoutHistory,
  confirmCustomerSalesHistory,
  previewCustomerSalesHistory,
} from "../src/server/companies/customer-sales-history-import";
import { executeImportedSalesReset, planImportedSalesReset } from "../src/server/maintenance/imported-sales-reset";

const REQUIRED_DATABASE = "automotive_brands_sales_reset_test";
const prisma = new PrismaClient();

function assertIsolatedDatabase() {
  const name = databaseNameFromUrl(process.env.DATABASE_URL ?? "");
  if (name !== REQUIRED_DATABASE) {
    throw new Error(`Refusing to prove the reset on database ${name ?? "unknown"}.`);
  }
}

async function ensureCutoverTable() {
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "CustomerSalesHistoryStatus" AS ENUM ('NOT_STARTED', 'REVIEW', 'COMPLETE');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`ALTER TYPE "CustomerSalesHistoryStatus" ADD VALUE IF NOT EXISTS 'REVIEW'`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CustomerSalesCutover" (
      "companyId" TEXT NOT NULL,
      "historyStatus" "CustomerSalesHistoryStatus" NOT NULL DEFAULT 'NOT_STARTED',
      "historyFrom" TIMESTAMP(3),
      "historyTo" TIMESTAMP(3),
      "completedAt" TIMESTAMP(3),
      "completedById" TEXT,
      "evidence" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "CustomerSalesCutover_pkey" PRIMARY KEY ("companyId")
    );
  `);
}

async function main() {
  assertIsolatedDatabase();
  await ensureCutoverTable();
  await prisma.autopartSalesLine.deleteMany();
  await prisma.autopartSalesDocument.deleteMany();
  await prisma.autopartCustomerImportRun.deleteMany();
  await prisma.customerSalesCutover.deleteMany();
  await bootstrapRbac(prisma);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const admin = await prisma.user.create({
    data: {
      email: `reset-proof.${stamp}@example.invalid`,
      name: "Reset proof",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });

  const account = `RP${stamp.slice(0, 8).toUpperCase()}`;
  const company = await prisma.company.create({
    data: { name: `Reset Customer ${stamp}`, status: "ACTIVE", accountNumber: `AC${stamp}` },
  });
  const prospect = await prisma.company.create({
    data: { name: `Reset Prospect ${stamp}`, status: "PROSPECT" },
  });
  const prospectAccount = `RX${stamp.slice(0, 8).toUpperCase()}`;
  await linkAndVerifyCompanyAutopartCustomerCode(admin.id, { companyId: company.id, code: account });
  await linkAndVerifyCompanyAutopartCustomerCode(admin.id, { companyId: prospect.id, code: prospectAccount });
  await prisma.autopartCustomerAccountAlias.create({
    data: { companyId: company.id, alias: `RA${stamp.slice(0, 8).toUpperCase()}`, verifiedById: admin.id },
  });
  await prisma.autopartAccount.create({
    data: {
      accountCode: account,
      originalName: company.name,
      classification: "TRADE_CANDIDATE",
      companyId: company.id,
    },
  });

  const brand = await prisma.brand.create({ data: { name: `Reset Brand ${stamp}`, slug: `reset-brand-${stamp}` } });
  const category = await prisma.category.create({
    data: { name: `Reset Category ${stamp}`, slug: `reset-category-${stamp}` },
  });
  const product = await prisma.product.create({
    data: {
      name: `Reset Product ${stamp}`,
      slug: `reset-product-${stamp}`,
      brandId: brand.id,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
    },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, sku: `RSKU${stamp.slice(0, 8).toUpperCase()}`, isActive: true, tradePrice: 12 },
  });
  const warehouse = await prisma.warehouse.create({
    data: { code: `RW${stamp.slice(0, 8).toUpperCase()}`, name: `Reset warehouse ${stamp}` },
  });
  const inventory = await prisma.inventory.create({
    data: { variantId: variant.id, warehouseId: warehouse.id, qtyOnHand: 7, qtyReserved: 1 },
  });
  await prisma.customerPrice.create({
    data: { companyId: company.id, variantId: variant.id, unitPrice: "9.5000" },
  });
  let orderNumber = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `AB-${String(Math.floor(100000 + Math.random() * 900000))}`;
    const taken = await prisma.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } });
    if (!taken) {
      orderNumber = candidate;
      break;
    }
  }
  if (!orderNumber) throw new Error("Could not allocate an order number");
  const order = await prisma.order.create({
    data: {
      companyId: company.id,
      orderNumber,
      status: "CONFIRMED",
      subtotal: "12.00",
      vatTotal: "2.40",
      grandTotal: "14.40",
      deliveryAddress: { line1: "1 Reset Street", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
      contactSnapshot: { name: "Buyer", email: "buyer@example.invalid", phone: "01130000000" },
    },
  });
  await prisma.orderStockReservation.create({
    data: { orderId: order.id, variantId: variant.id, inventoryId: inventory.id, quantity: 1, status: "ACTIVE" },
  });
  await prisma.orderFulfilmentEvent.create({
    data: {
      orderId: order.id,
      kind: "NOTE",
      summary: "Proof fulfilment evidence",
      source: "MANUAL",
    },
  });
  await prisma.autopartOngoingSalesFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default", enabled: true, fulfilmentMode: "OFF" },
    update: { enabled: true, fulfilmentMode: "OFF" },
  });
  await prisma.autopartImportBatch.create({
    data: { kind: "CUSTOMER_MASTER", status: "COMMITTED", filename: `master-${stamp}.csv`, fileHash: stamp },
  });
  const salesBatch = await prisma.autopartImportBatch.create({
    data: { kind: "INVOICE_LINES", status: "COMMITTED", filename: `lines-${stamp}.csv`, fileHash: `${stamp}-lines` },
  });
  const archiveDir = `/tmp/ab-sales-archive-${stamp}`;
  process.env["AUTOPART_SALES_ARCHIVE_DIR"] = archiveDir;
  const historyBody = Buffer.from("historical bytes");
  const historyHash = createHash("sha256").update(historyBody).digest("hex");
  await prisma.autopartHistoryAllImport.create({
    data: {
      status: "COMMITTED",
      filename561l: "missing.csv",
      fileHash561l: historyHash,
      storagePath561l: `/tmp/missing-561l-${stamp}.csv`,
    },
  });
  await prisma.stockEmailReceipt.create({
    data: {
      receiptKey: `ongoing-hash:ONGOING_504:${stamp}`,
      emailUid: stamp,
      fromAddress: "reports@example.invalid",
      subject: "504",
      receivedAt: new Date(),
      consumed: true,
    },
  });

  const octoberRef = `SSPW${stamp.slice(0, 8).toUpperCase()}`;
  const ongoingRef = `SSRM${stamp.slice(0, 8).toUpperCase()}`;
  const historicalRef = `SSHX${stamp.slice(0, 8).toUpperCase()}`;
  const octoberRun = await prisma.autopartCustomerImportRun.create({
    data: { type: "ONGOING_504", status: "COMMITTED", filename: "october-504.txt", companyId: company.id, dryRun: false },
  });
  await prisma.autopartSalesDocument.create({
    data: {
      companyId: company.id,
      autopartCustomerCode: account,
      documentType: "INVOICE",
      documentReference: octoberRef,
      documentDate: new Date("2026-10-10T12:00:00.000Z"),
      goodsNet: "10.00",
      vat: "2.00",
      grossTotal: "12.00",
      source: "ONGOING_504",
      has504: true,
      abOrderId: order.id,
      abOrderNumber: orderNumber,
      importRunId: octoberRun.id,
    },
  });
  const ongoingDoc = await prisma.autopartSalesDocument.create({
    data: {
      companyId: company.id,
      autopartCustomerCode: account,
      documentType: "INVOICE",
      documentReference: ongoingRef,
      documentDate: new Date("2026-09-01T12:00:00.000Z"),
      goodsNet: "4.00",
      source: "ONGOING_504",
      has504: true,
      hasTrm21qc: true,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: company.id,
      documentId: ongoingDoc.id,
      autopartCustomerCode: account,
      documentType: "INVOICE",
      documentReference: ongoingRef,
      lineNumber: 1,
      sku: variant.sku,
      units: "1",
      salesNet: "4.00",
      source: "ONGOING_TRM21QC",
    },
  });
  await prisma.autopartSalesDocument.create({
    data: {
      companyId: company.id,
      autopartCustomerCode: account,
      documentType: "INVOICE",
      documentReference: historicalRef,
      documentDate: new Date("2020-01-15T12:00:00.000Z"),
      goodsNet: "8.00",
      source: "SLRB",
    },
  });

  const beforeOrders = await prisma.order.count();
  const beforeCompanies = await prisma.company.count();
  const dryRun = await planImportedSalesReset(prisma);
  if (dryRun.mode !== "dry-run") throw new Error("Plan was not a dry-run.");
  if (!dryRun.orderReferences.some((doc) => doc.documentReference === octoberRef && doc.abOrderNumber === orderNumber)) {
    throw new Error("Dry-run did not report the order linked to an imported document.");
  }
  if ((await prisma.autopartSalesDocument.count()) < 3) throw new Error("Dry-run deleted documents.");
  if ((await prisma.autopartOngoingSalesFeedSettings.findUniqueOrThrow({ where: { id: "default" } })).enabled !== true) {
    throw new Error("Dry-run changed the feed switch.");
  }

  const backupPath = `/tmp/imported-sales-reset-${stamp}.txt`;
  const backupBody = `isolated reset proof ${stamp}\n`;
  writeFileSync(backupPath, backupBody);
  const backupSha256 = createHash("sha256").update(backupBody).digest("hex");
  const restore = new PrismaClient({
    datasources: { db: { url: "postgresql://ab:ab@localhost:5432/automotive_brands_sales_reset_restore" } },
  });
  let restoreCheckOk = false;
  try {
    await restore.$queryRaw`SELECT 1`;
    restoreCheckOk = true;
  } finally {
    await restore.$disconnect();
  }

  const blockedArchive = await executeImportedSalesReset({
    confirmation: IMPORTED_SALES_RESET_CONFIRMATION,
    targetDatabase: REQUIRED_DATABASE,
    actualDatabase: REQUIRED_DATABASE,
    backupProof: {
      backupPath,
      backupBytes: Buffer.byteLength(backupBody),
      backupSha256,
      sourceDatabase: REQUIRED_DATABASE,
      restoredDatabase: "automotive_brands_sales_reset_restore",
      restoredAt: new Date().toISOString(),
    },
    restoreCheckOk,
    duringBootstrap: false,
    allowProductionDatabase: false,
    actorUserId: admin.id,
  });
  if (blockedArchive.ok) throw new Error("Reset deleted sales without an archived source file.");
  if ((await prisma.autopartSalesDocument.count()) < 3) throw new Error("Failed archive still deleted documents.");
  if ((await prisma.autopartOngoingSalesFeedSettings.findUniqueOrThrow({ where: { id: "default" } })).enabled !== true) {
    throw new Error("Failed archive switched the feed off.");
  }
  await prisma.autopartHistoryAllImport.deleteMany();
  const archivedHistory = await prisma.autopartHistoryAllImport.create({
    data: {
      status: "COMMITTED",
      filename561l: "561L.csv",
      fileHash561l: historyHash,
      fileBody561l: historyBody,
    },
  });

  const executed = await executeImportedSalesReset({
    confirmation: IMPORTED_SALES_RESET_CONFIRMATION,
    targetDatabase: REQUIRED_DATABASE,
    actualDatabase: REQUIRED_DATABASE,
    backupProof: {
      backupPath,
      backupBytes: Buffer.byteLength(backupBody),
      backupSha256,
      sourceDatabase: REQUIRED_DATABASE,
      restoredDatabase: "automotive_brands_sales_reset_restore",
      restoredAt: new Date().toISOString(),
    },
    restoreCheckOk,
    duringBootstrap: false,
    allowProductionDatabase: false,
    actorUserId: admin.id,
  });
  if (!executed.ok) throw new Error(executed.reason);

  if ((await prisma.autopartSalesDocument.count()) !== 0) throw new Error("Imported documents remained.");
  if ((await prisma.autopartSalesLine.count()) !== 0) throw new Error("Imported lines remained.");
  if ((await prisma.autopartCustomerImportRun.count()) !== 0) throw new Error("Import runs remained.");
  if ((await prisma.autopartHistoryAllImport.count()) !== 0) throw new Error("Historical staging remained.");
  const archivedPath = `${executed.report.archive.directory}/history/${archivedHistory.id}/561l.bin`;
  if (!existsSync(archivedPath)) throw new Error("Archived 561L file is missing.");
  const archivedBytes = readFileSync(archivedPath);
  if (archivedBytes.length !== historyBody.length) throw new Error("Archived 561L size does not match.");
  if (createHash("sha256").update(archivedBytes).digest("hex") !== historyHash) {
    throw new Error("Archived 561L hash does not match.");
  }
  if ((await prisma.stockEmailReceipt.count({ where: { receiptKey: { startsWith: "ongoing-hash:" } } })) !== 0) {
    throw new Error("Ongoing duplicate receipts remained.");
  }
  if ((await prisma.autopartImportBatch.count({ where: { id: salesBatch.id } })) !== 0) {
    throw new Error("Sales import batch remained.");
  }
  if ((await prisma.autopartImportBatch.count({ where: { kind: "CUSTOMER_MASTER" } })) < 1) {
    throw new Error("Customer-master batch was deleted.");
  }
  const orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const stockAfter = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
  if (orderAfter.status !== "CONFIRMED") throw new Error("B2B order changed.");
  if ((await prisma.orderFulfilmentEvent.count({ where: { orderId: order.id } })) !== 1) {
    throw new Error("Fulfilment evidence changed.");
  }
  if ((await prisma.orderStockReservation.count({ where: { orderId: order.id, status: "ACTIVE" } })) !== 1) {
    throw new Error("Stock reservation changed.");
  }
  if (stockAfter.qtyOnHand !== 7 || stockAfter.qtyReserved !== 1) throw new Error("Stock changed.");
  if ((await prisma.order.count()) !== beforeOrders) throw new Error("Order count changed.");
  if ((await prisma.company.count()) !== beforeCompanies) throw new Error("Company count changed.");
  if ((await prisma.company.count({ where: { id: { in: [company.id, prospect.id] } } })) !== 2) {
    throw new Error("Customer or prospect was deleted.");
  }
  if ((await prisma.autopartAccount.count({ where: { accountCode: account } })) !== 1) {
    throw new Error("407EXP account was deleted.");
  }
  if ((await prisma.customerPrice.count({ where: { companyId: company.id } })) !== 1) {
    throw new Error("Customer price was deleted.");
  }
  if ((await prisma.autopartOngoingSalesFeedSettings.findUniqueOrThrow({ where: { id: "default" } })).enabled !== false) {
    throw new Error("Automatic importing was left on.");
  }
  if (executed.report.preservedAfter["orders"] !== executed.report.preservedBefore["orders"]) {
    throw new Error("Protected order count changed.");
  }

  const history561 = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${account},I/${historicalRef}/1,${variant.sku},Widget,2,"£20.00"
${account},I/${historicalRef}/2,${variant.sku},Widget again,3,"£6.00"
${account},C/SC${stamp.slice(0, 6).toUpperCase()}/1,${variant.sku},Widget,1,"£4.00"
`;
  const creditRef = `SC${stamp.slice(0, 6).toUpperCase()}`;
  const historySlrb = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${account},INV,${historicalRef},15 Jan 20,"£20.00","£4.00","£24.00","£24.00"
${account},CRN,${creditRef},16 Jan 20,"-£4.00","-£0.80","-£4.80","£19.20"
${account},PAY,REC${stamp.slice(0, 4).toUpperCase()},17 Jan 20,"£0.00","£0.00","-£10.00","£9.20"
${prospectAccount},INV,SXOTHER01,18 Jan 20,"£9.00","£1.80","£10.80","£10.80"
`;
  const preview = await previewCustomerSalesHistory(admin.id, {
    companyId: company.id,
    text561l: history561,
    textSlrb: historySlrb,
    filename561l: "561L.csv",
    filenameSlrb: "SLRB.csv",
  });
  if (preview.counts.rejected < 1) throw new Error("Foreign history row was not rejected.");
  const history = await confirmCustomerSalesHistory(admin.id, {
    companyId: company.id,
    text561l: history561,
    textSlrb: historySlrb,
    filename561l: "561L.csv",
    filenameSlrb: "SLRB.csv",
  });
  if (history.rowsImported < 1) throw new Error("History import stored nothing.");
  if (history.historyStatus !== "REVIEW") throw new Error("Rejected history row was marked complete.");
  let zeroHistoryRefused = false;
  try {
    await completeCustomerSalesCutoverWithoutHistory(admin.id, company.id);
  } catch (error) {
    zeroHistoryRefused = error instanceof Error && error.message.includes("not a zero-history");
  }
  if (!zeroHistoryRefused) throw new Error("Zero history was accepted while exceptions were open.");
  await acknowledgeCustomerSalesHistoryReview(admin.id, company.id);
  if ((await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId: company.id } })).historyStatus !== "COMPLETE") {
    throw new Error("Reviewed history did not complete.");
  }
  if ((await prisma.autopartSalesLine.count({ where: { companyId: company.id, documentReference: historicalRef, source: "561L" } })) !== 2) {
    throw new Error("Repeated SKU lines were collapsed.");
  }
  const credit = await prisma.autopartSalesLine.findFirstOrThrow({
    where: { companyId: company.id, documentReference: creditRef },
  });
  if (Number(credit.units) >= 0 || Number(credit.salesNet) >= 0) throw new Error("Credit was not stored as negative.");
  const payment = await prisma.autopartSalesDocument.findFirstOrThrow({
    where: { companyId: company.id, documentType: "PAYMENT" },
  });
  if (payment.goodsNet != null) throw new Error("Payment was stored as goods.");
  if ((await prisma.autopartSalesLine.count({ where: { documentType: "PAYMENT" } })) !== 0) {
    throw new Error("Payment created a product line.");
  }
  if ((await prisma.autopartSalesDocument.count({ where: { autopartCustomerCode: prospectAccount } })) !== 0) {
    throw new Error("Prospect history was stored on the Active import.");
  }
  const repeated = await confirmCustomerSalesHistory(admin.id, {
    companyId: company.id,
    text561l: history561,
    textSlrb: historySlrb,
  });
  if (repeated.rowsImported !== 0) throw new Error("Repeated history import stored more rows.");

  const caughtUp = `SSCU${stamp.slice(0, 6).toUpperCase()}`;
  const trm = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,${caughtUp},02/10/2026,${variant.sku},Widget,1,8.00,3.00,5.00,62.500
${prospectAccount},GRP,SXPROSPECT,02/10/2026,${variant.sku},Widget,1,3.00,1.00,2.00,66.000
${account},GRP,${historicalRef},15/01/2020,${variant.sku},Widget,2,20.00,8.00,12.00,60.000
`;
  const imported = await confirmCustomerSalesImport(admin.id, {
    companyId: company.id,
    accountCode: account,
    text: trm,
    filename: "TRM21QC.csv",
  });
  if (imported.rowsImported !== 1) throw new Error(`Catch-up stored ${imported.rowsImported} rows.`);
  if ((await prisma.autopartSalesLine.count({ where: { documentReference: caughtUp, companyId: company.id } })) !== 1) {
    throw new Error("Catch-up line missing.");
  }
  if ((await prisma.autopartSalesLine.count({ where: { documentReference: "SXPROSPECT" } })) !== 0) {
    throw new Error("Prospect ongoing line was stored.");
  }
  if ((await prisma.autopartSalesLine.count({ where: { documentReference: historicalRef, source: "561L" } })) !== 2) {
    throw new Error("Historical lines were duplicated or removed.");
  }
  if ((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status !== "CONFIRMED") {
    throw new Error("Reimport changed the B2B order.");
  }
  if ((await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).qtyOnHand !== 7) {
    throw new Error("Reimport changed stock.");
  }

  console.log(
    JSON.stringify(
      {
        database: REQUIRED_DATABASE,
        deleted: executed.report.deleted,
        feedEnabledAfter: executed.report.feedEnabledAfter,
        orderStatus: orderAfter.status,
        stockOnHand: stockAfter.qtyOnHand,
        historyImported: history.rowsImported,
        catchUpDocument: caughtUp,
        removedOctoberDocument: octoberRef,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
