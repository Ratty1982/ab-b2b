/**
 * Proves the imported-sales reset and a customer reimport on an isolated database.
 * Refuses every database name except automotive_brands_sales_reset_test.
 *
 * The database must already contain the application schema. This script creates
 * its own fixtures, deletes only the removable ongoing sales it created, and
 * reimports one TRM21QC line for that customer.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { databaseNameFromUrl } from "../src/domain/customer-data-reset";
import { IMPORTED_SALES_RESET_CONFIRMATION } from "../src/domain/imported-sales-reset";
import { bootstrapRbac } from "../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "../src/server/companies/autopart-account";
import { confirmCustomerSalesImport } from "../src/server/companies/customer-sales-import";
import { executeImportedSalesReset, planImportedSalesReset } from "../src/server/maintenance/imported-sales-reset";

const REQUIRED_DATABASE = "automotive_brands_sales_reset_test";
const prisma = new PrismaClient();

function assertIsolatedDatabase() {
  const name = databaseNameFromUrl(process.env.DATABASE_URL ?? "");
  if (name !== REQUIRED_DATABASE) {
    throw new Error(`Refusing to prove the reset on database ${name ?? "unknown"}.`);
  }
}

async function main() {
  assertIsolatedDatabase();
  await prisma.autopartSalesLine.deleteMany();
  await prisma.autopartSalesDocument.deleteMany();
  await prisma.autopartCustomerImportRun.deleteMany();
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
  await linkAndVerifyCompanyAutopartCustomerCode(admin.id, { companyId: company.id, code: account });
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

  await prisma.autopartOngoingSalesFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default", enabled: false, fulfilmentMode: "OFF" },
    update: { fulfilmentMode: "OFF" },
  });

  const protectedRef = `SSPW${stamp.slice(0, 8).toUpperCase()}`;
  const removableRef = `SSRM${stamp.slice(0, 8).toUpperCase()}`;
  const historicalRef = `SSHX${stamp.slice(0, 8).toUpperCase()}`;
  const protectedRun = await prisma.autopartCustomerImportRun.create({
    data: { type: "ONGOING_504", status: "COMMITTED", filename: "protected-504.txt", companyId: company.id, dryRun: false },
  });
  const removableRun = await prisma.autopartCustomerImportRun.create({
    data: { type: "ONGOING_504", status: "COMMITTED", filename: "removable-504.txt", companyId: company.id, dryRun: false },
  });
  const protectedDoc = await prisma.autopartSalesDocument.create({
    data: {
      companyId: company.id,
      autopartCustomerCode: account,
      documentType: "INVOICE",
      documentReference: protectedRef,
      documentDate: new Date("2026-10-10T12:00:00.000Z"),
      goodsNet: "10.00",
      vat: "2.00",
      grossTotal: "12.00",
      source: "ONGOING_504",
      has504: true,
      hasTrm21qc: false,
      importRunId: protectedRun.id,
    },
  });
  const removableDoc = await prisma.autopartSalesDocument.create({
    data: {
      companyId: company.id,
      autopartCustomerCode: account,
      documentType: "INVOICE",
      documentReference: removableRef,
      documentDate: new Date("2026-09-01T12:00:00.000Z"),
      goodsNet: "4.00",
      vat: "0.80",
      grossTotal: "4.80",
      source: "ONGOING_504",
      has504: true,
      hasTrm21qc: true,
      importRunId: removableRun.id,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: company.id,
      documentId: removableDoc.id,
      autopartCustomerCode: account,
      documentType: "INVOICE",
      documentReference: removableRef,
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
      source: "561L",
      has504: false,
      hasTrm21qc: false,
    },
  });

  const dryRun = await planImportedSalesReset(prisma);
  if (dryRun.mode !== "dry-run") throw new Error("Plan was not a dry-run.");
  if (!dryRun.protectedDocuments.some((doc) => doc.documentReference === protectedRef)) {
    throw new Error("Dry-run did not protect the recovery-window document.");
  }
  if (!dryRun.removableDocuments.some((doc) => doc.documentReference === removableRef)) {
    throw new Error("Dry-run did not propose removal of the ongoing document outside the recovery window.");
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

  const protectedAfter = await prisma.autopartSalesDocument.findUnique({ where: { id: protectedDoc.id } });
  const removableAfter = await prisma.autopartSalesDocument.findUnique({ where: { id: removableDoc.id } });
  const historicalAfter = await prisma.autopartSalesDocument.findFirst({ where: { documentReference: historicalRef } });
  const orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const stockAfter = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
  if (!protectedAfter) throw new Error("Recovery-window document was deleted.");
  if (!(await prisma.autopartCustomerImportRun.findUnique({ where: { id: protectedRun.id } }))) {
    throw new Error("Import run for the recovery document was deleted.");
  }
  if (await prisma.autopartCustomerImportRun.findUnique({ where: { id: removableRun.id } })) {
    throw new Error("Import run for the removed document was kept.");
  }
  if (removableAfter) throw new Error("Ongoing document outside the recovery window was kept.");
  if (!historicalAfter) throw new Error("Historical 561L document was deleted.");
  if (orderAfter.status !== "CONFIRMED") throw new Error("B2B order changed.");
  if (stockAfter.qtyOnHand !== 7 || stockAfter.qtyReserved !== 1) throw new Error("Stock changed.");
  if ((await prisma.company.count({ where: { id: { in: [company.id, prospect.id] } } })) !== 2) {
    throw new Error("Customer or prospect was deleted.");
  }
  if ((await prisma.autopartAccount.count({ where: { accountCode: account } })) !== 1) {
    throw new Error("407EXP account was deleted.");
  }
  if ((await prisma.customerPrice.count({ where: { companyId: company.id } })) !== 1) {
    throw new Error("Customer price was deleted.");
  }

  const replacement = `SRE${stamp.slice(0, 8).toUpperCase()}`;
  const text = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,${replacement},02/09/2026,${variant.sku},Widget,1,8.00,3.00,5.00,62.500
`;
  const imported = await confirmCustomerSalesImport(admin.id, {
    companyId: company.id,
    accountCode: account,
    text,
    filename: "TRM21QC.csv",
  });
  if (imported.rowsImported !== 1) throw new Error(`Reimport stored ${imported.rowsImported} rows.`);
  const line = await prisma.autopartSalesLine.findFirst({
    where: { documentReference: replacement, companyId: company.id },
  });
  if (!line || line.autopartCustomerCode !== account) throw new Error("Reimport did not store the customer line.");
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
        protectedDocument: protectedRef,
        removedDocument: removableRef,
        historicalDocument: historicalRef,
        reimportedDocument: replacement,
        orderStatus: orderAfter.status,
        stockOnHand: stockAfter.qtyOnHand,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
