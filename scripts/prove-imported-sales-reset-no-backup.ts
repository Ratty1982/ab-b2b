/**
 * Proves --accept-no-backup-risk on a local database named automotivebrands.
 * Refuses any host other than localhost. Does not run against production.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { describeDatabaseUrl } from "../src/domain/customer-data-reset";
import {
  IMPORTED_SALES_NO_BACKUP_ACKNOWLEDGEMENT,
  IMPORTED_SALES_NO_BACKUP_DATABASE,
  IMPORTED_SALES_RESET_CONFIRMATION,
  IMPORTED_SALES_RESET_TRANSACTION_TIMEOUT_MS,
  importedSalesResetTransactionOptions,
} from "../src/domain/imported-sales-reset";
import { bootstrapRbac } from "../prisma/bootstrap/rbac";
import { deleteImportedSalesAndVerify, planImportedSalesReset } from "../src/server/maintenance/imported-sales-reset";

const SCALE = 20_000;
const prisma = new PrismaClient();
const root = path.resolve(import.meta.dirname, "..");
const bundle = path.join(root, "scripts/maintenance/imported-sales-reset.mjs");

function assertLocalProductionName() {
  const url = process.env["DATABASE_URL"] ?? "";
  const described = describeDatabaseUrl(url);
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = "";
  }
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`Refusing no-backup proof on host ${hostname || "unknown"}.`);
  }
  if (described.database !== IMPORTED_SALES_NO_BACKUP_DATABASE) {
    throw new Error(`Refusing no-backup proof on database ${described.database ?? "unknown"}.`);
  }
}

function buildRunner() {
  const built = spawnSync(
    "bun",
    [
      "build",
      "./scripts/imported-sales-reset.ts",
      "--outfile",
      bundle,
      "--target",
      "node",
      "--external",
      "@prisma/client",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (built.status !== 0) {
    throw new Error(built.stderr || built.stdout || "Could not build the maintenance runner.");
  }
}

function runCli(args: string[], extra: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["AB_RESET_RESTORE_URL"];
  delete env["AB_RESET_INJECT_DELETE_FAILURE"];
  delete env["AB_RESET_DURING_BOOT"];
  delete env["AB_ENTRYPOINT"];
  delete env["npm_lifecycle_event"];
  delete env["npm_lifecycle_script"];
  for (const [key, value] of Object.entries(extra)) {
    if (value == null) delete env[key];
    else env[key] = value;
  }
  return spawnSync("node", [bundle, ...args], { cwd: root, env, encoding: "utf8" });
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
  assertLocalProductionName();
  buildRunner();
  await ensureCutoverTable();
  await bootstrapRbac(prisma);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const archiveDir = `/tmp/ab-nobackup-archive-${stamp}`;
  const admin = await prisma.user.create({
    data: {
      email: `nobackup.${stamp}@example.invalid`,
      name: "No-backup proof",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });
  const company = await prisma.company.create({
    data: { name: `No-backup Customer ${stamp}`, status: "ACTIVE", accountNumber: `NB${stamp}` },
  });
  const account = `NB${stamp.slice(0, 8).toUpperCase()}`;
  await prisma.autopartAccount.create({
    data: {
      accountCode: account,
      originalName: company.name,
      classification: "TRADE_CANDIDATE",
      companyId: company.id,
    },
  });
  const brand = await prisma.brand.create({ data: { name: `No-backup Brand ${stamp}`, slug: `nb-brand-${stamp}` } });
  const category = await prisma.category.create({
    data: { name: `No-backup Category ${stamp}`, slug: `nb-category-${stamp}` },
  });
  const product = await prisma.product.create({
    data: {
      name: `No-backup Product ${stamp}`,
      slug: `nb-product-${stamp}`,
      brandId: brand.id,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
    },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, sku: `NBSKU${stamp.slice(0, 8).toUpperCase()}`, isActive: true, tradePrice: 12 },
  });
  const warehouse = await prisma.warehouse.create({
    data: { code: `NW${stamp.slice(0, 8).toUpperCase()}`, name: `No-backup warehouse ${stamp}` },
  });
  const inventory = await prisma.inventory.create({
    data: { variantId: variant.id, warehouseId: warehouse.id, qtyOnHand: 7, qtyReserved: 1 },
  });
  await prisma.customerPrice.create({
    data: { companyId: company.id, variantId: variant.id, unitPrice: "9.5000" },
  });
  const orderNumber = `AB-${stamp.slice(0, 6).toUpperCase()}`;
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
  await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-${stamp}`,
      companyId: company.id,
      orderId: order.id,
      subtotal: "12.00",
      vatTotal: "2.40",
      grandTotal: "14.40",
    },
  });
  await prisma.emailSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", enabled: false },
    update: {},
  });
  await prisma.orderStockReservation.create({
    data: { orderId: order.id, variantId: variant.id, inventoryId: inventory.id, quantity: 1, status: "ACTIVE" },
  });
  await prisma.orderFulfilmentEvent.create({
    data: { orderId: order.id, kind: "NOTE", summary: "No-backup proof", source: "MANUAL" },
  });
  const historyBody = Buffer.from(`historical bytes ${stamp}`);
  const historyHash = createHash("sha256").update(historyBody).digest("hex");
  const history = await prisma.autopartHistoryAllImport.create({
    data: {
      status: "COMMITTED",
      filename561l: "561L.csv",
      fileHash561l: historyHash,
      fileBody561l: historyBody,
    },
  });
  await prisma.autopartSalesDocument.create({
    data: {
      companyId: company.id,
      autopartCustomerCode: account,
      documentType: "INVOICE",
      documentReference: `SSNB${stamp.slice(0, 8).toUpperCase()}`,
      abOrderNumber: orderNumber,
      goodsNet: "12.00",
      source: "ONGOING_504",
      has504: true,
    },
  });
  await prisma.autopartOngoingSalesFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default", enabled: true, fulfilmentMode: "OFF" },
    update: { enabled: true, fulfilmentMode: "OFF" },
  });

  const baseEnv = {
    AUTOPART_SALES_ARCHIVE_DIR: archiveDir,
    AB_RESET_CONFIRM: IMPORTED_SALES_RESET_CONFIRMATION,
    AB_RESET_TARGET: IMPORTED_SALES_NO_BACKUP_DATABASE,
    AB_RESET_NO_BACKUP_ACK: IMPORTED_SALES_NO_BACKUP_ACKNOWLEDGEMENT,
  };
  const refused = runCli(["--execute", "--accept-no-backup-risk", "--allow-production-database"], {
    ...baseEnv,
    AB_RESET_NO_BACKUP_ACK: "I accept the risk",
  });
  if (refused.status === 0) throw new Error("A wrong acknowledgement was accepted.");
  if ((await prisma.autopartSalesDocument.count()) < 1) throw new Error("Wrong acknowledgement deleted sales.");
  if ((await prisma.autopartOngoingSalesFeedSettings.findUniqueOrThrow({ where: { id: "default" } })).enabled !== true) {
    throw new Error("Wrong acknowledgement switched the feed off.");
  }
  const backupRequired = runCli(["--execute", "--allow-production-database"], {
    ...baseEnv,
    AB_RESET_NO_BACKUP_ACK: undefined,
  });
  if (backupRequired.status === 0) throw new Error("Execute without a backup or the no-backup flag was accepted.");
  if (!`${backupRequired.stderr}`.includes("backup")) {
    throw new Error(backupRequired.stderr || backupRequired.stdout || "Missing backup refusal.");
  }
  const missing = await prisma.autopartHistoryAllImport.create({
    data: {
      status: "COMMITTED",
      filename561l: "missing.csv",
      fileHash561l: historyHash,
      storagePath561l: `/tmp/missing-561l-${stamp}.csv`,
    },
  });
  const blockedArchive = runCli(["--execute", "--accept-no-backup-risk", "--allow-production-database"], baseEnv);
  if (blockedArchive.status === 0) throw new Error("No-backup mode deleted sales without an archived source.");
  if ((await prisma.autopartSalesDocument.count()) < 1) throw new Error("A missing source file was still deleted.");
  if ((await prisma.autopartOngoingSalesFeedSettings.findUniqueOrThrow({ where: { id: "default" } })).enabled !== true) {
    throw new Error("A missing source file switched the feed off.");
  }
  await prisma.autopartHistoryAllImport.delete({ where: { id: missing.id } });

  await prisma.$executeRawUnsafe(`
    INSERT INTO "AutopartSalesDocument"
      ("id", "autopartCustomerCode", "documentType", "documentReference", "source", "has504", "hasTrm21qc", "createdAt", "updatedAt")
    SELECT 'nbdoc${stamp}' || g::text, 'NBULK', 'INVOICE', 'NB${stamp}' || g::text, 'SLRB', false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM generate_series(1, ${SCALE}) AS g
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "AutopartSalesLine"
      ("id", "autopartCustomerCode", "documentType", "documentReference", "lineNumber", "sku", "units", "salesNet", "source", "createdAt", "updatedAt")
    SELECT 'nbline${stamp}' || g::text, 'NBULK', 'INVOICE', 'NB${stamp}' || g::text, 1, 'NB-SKU', 1, 1, '561L', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM generate_series(1, ${SCALE}) AS g
  `);
  const beforeDelete = await prisma.autopartSalesDocument.count();
  if (beforeDelete < SCALE) throw new Error(`Expected at least ${SCALE} documents, found ${beforeDelete}.`);
  const preserved = (await planImportedSalesReset(prisma)).counts.preserved;
  let rolledBack = false;
  try {
    await prisma.$transaction(async (tx) => {
      await deleteImportedSalesAndVerify(tx, preserved);
      throw new Error("forced rollback");
    }, importedSalesResetTransactionOptions);
  } catch (error) {
    rolledBack = error instanceof Error && error.message.includes("forced rollback");
    if (!rolledBack) throw error;
  }
  if (!rolledBack) throw new Error("Rollback did not run.");
  if ((await prisma.autopartSalesDocument.count()) !== beforeDelete) {
    throw new Error("Rollback did not restore imported sales.");
  }
  if ((await prisma.autopartOngoingSalesFeedSettings.findUniqueOrThrow({ where: { id: "default" } })).enabled !== true) {
    throw new Error("In-transaction rollback switched the feed off.");
  }

  const injected = runCli(["--execute", "--accept-no-backup-risk", "--allow-production-database"], {
    ...baseEnv,
    AB_RESET_INJECT_DELETE_FAILURE: "1",
  });
  if (injected.status === 0) throw new Error("Injected delete failure was treated as success.");
  if (!`${injected.stderr}`.includes("rolled back")) throw new Error(injected.stderr || "Rollback was not reported.");
  if ((await prisma.autopartSalesDocument.count()) !== beforeDelete) {
    throw new Error("Execute did not roll the delete back.");
  }
  if ((await prisma.autopartOngoingSalesFeedSettings.findUniqueOrThrow({ where: { id: "default" } })).enabled !== false) {
    throw new Error("A failed delete left automatic importing enabled.");
  }
  const injectedIdentity = injected.stdout.indexOf("Database identity");
  const injectedCount = injected.stdout.indexOf(`salesDocuments: ${beforeDelete}`);
  if (injectedIdentity < 0 || injectedCount < injectedIdentity) {
    throw new Error("The failed run did not print the database identity and before-reset counts.");
  }

  const executed = runCli(["--execute", "--accept-no-backup-risk", "--allow-production-database"], baseEnv);
  if (executed.status !== 0) {
    throw new Error(executed.stderr || executed.stdout || "No-backup execute failed.");
  }
  const marker = executed.stdout.indexOf("IMPORTED_SALES_RESET_REPORT");
  const identityAt = executed.stdout.indexOf("Database identity");
  const nameAt = executed.stdout.indexOf(`name: ${IMPORTED_SALES_NO_BACKUP_DATABASE}`);
  const countAt = executed.stdout.indexOf(`salesDocuments: ${beforeDelete}`);
  if (marker < 0 || identityAt < 0 || nameAt < 0 || countAt < 0 || nameAt > marker || countAt > marker) {
    throw new Error("The success run did not print identity and before-reset counts before deletion.");
  }
  const report = JSON.parse(executed.stdout.slice(marker + "IMPORTED_SALES_RESET_REPORT".length)) as {
    backup: string;
    database: string | null;
    host: string | null;
    deleted: { documents: number; lines: number };
    preservedBefore: Record<string, number>;
    preservedAfter: Record<string, number>;
    removedAfter: Record<string, number>;
    feedEnabledAfter: boolean;
    archiveDirectory: string;
    auditReportPath: string | null;
    deleteTransactionMs: number;
    statementTimeout: string;
    transactionTimeoutMs: number;
  };
  if (report.backup !== "waived") throw new Error("Report did not record the backup waiver.");
  if (report.database !== IMPORTED_SALES_NO_BACKUP_DATABASE) throw new Error("Report database name is wrong.");
  if (!report.host) throw new Error("Report is missing the database host.");
  if (report.feedEnabledAfter !== false) throw new Error("Automatic importing was left on.");
  if (report.deleteTransactionMs >= IMPORTED_SALES_RESET_TRANSACTION_TIMEOUT_MS) {
    throw new Error(`Delete took ${report.deleteTransactionMs}ms, which exceeds the transaction budget.`);
  }
  if (report.transactionTimeoutMs !== IMPORTED_SALES_RESET_TRANSACTION_TIMEOUT_MS) {
    throw new Error("Report used a different transaction budget.");
  }
  if (!report.statementTimeout || report.statementTimeout === "0") {
    throw new Error(`Statement timeout was not applied inside the delete transaction (${report.statementTimeout}).`);
  }
  for (const [name, count] of Object.entries(report.removedAfter)) {
    if (count !== 0) throw new Error(`${name} still has ${count} rows.`);
  }
  for (const [name, count] of Object.entries(report.preservedBefore)) {
    if (report.preservedAfter[name] !== count) throw new Error(`Preserved ${name} changed.`);
  }
  if (report.deleted.documents < SCALE || report.deleted.lines < SCALE) {
    throw new Error("The production-sized delete did not remove the loaded rows.");
  }
  if ((await prisma.company.count({ where: { id: company.id } })) !== 1) throw new Error("Company was deleted.");
  if ((await prisma.autopartAccount.count({ where: { accountCode: account } })) !== 1) {
    throw new Error("Autopart account was deleted.");
  }
  if ((await prisma.customerPrice.count({ where: { companyId: company.id } })) !== 1) throw new Error("Price was deleted.");
  if ((await prisma.product.count({ where: { id: product.id } })) !== 1) throw new Error("Product was deleted.");
  if ((await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).qtyOnHand !== 7) {
    throw new Error("Stock changed.");
  }
  if ((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status !== "CONFIRMED") {
    throw new Error("B2B order changed.");
  }
  if ((await prisma.invoice.count({ where: { companyId: company.id } })) !== 1) throw new Error("Invoice was deleted.");
  if ((await prisma.user.count({ where: { id: admin.id } })) !== 1) throw new Error("User was deleted.");
  if ((await prisma.permission.count()) !== preserved.permissions) throw new Error("Permissions changed.");
  if ((await prisma.role.count()) !== preserved.roles) throw new Error("Roles changed.");
  if ((await prisma.emailSettings.count()) !== 1) throw new Error("Email settings changed.");
  const archivedPath = path.join(report.archiveDirectory, "history", history.id, "561l.bin");
  if (!existsSync(archivedPath)) throw new Error("Archived 561L file is missing.");
  const archived = readFileSync(archivedPath);
  if (archived.length !== historyBody.length) throw new Error("Archived 561L size does not match.");
  if (createHash("sha256").update(archived).digest("hex") !== historyHash) {
    throw new Error("Archived 561L hash does not match.");
  }
  if (!report.auditReportPath || !existsSync(report.auditReportPath)) throw new Error("Audit report file is missing.");
  const audit = JSON.parse(readFileSync(report.auditReportPath, "utf8")) as {
    database?: string;
    deleted?: { documents?: number };
    preservedBefore?: { companies?: number };
    archiveDirectory?: string;
  };
  if (audit.database !== IMPORTED_SALES_NO_BACKUP_DATABASE) throw new Error("Audit database name is missing.");
  if ((audit.deleted?.documents ?? 0) < SCALE) throw new Error("Audit deleted counts are missing.");
  if ((audit.preservedBefore?.companies ?? 0) < 1) throw new Error("Audit preserved counts are missing.");
  if (audit.archiveDirectory !== report.archiveDirectory) throw new Error("Audit archive location is missing.");
  if (report.archiveDirectory.startsWith(root)) throw new Error("Archive is inside the application directory.");

  console.log(
    JSON.stringify(
      {
        database: report.database,
        host: report.host,
        backup: report.backup,
        deletedDocuments: report.deleted.documents,
        deletedLines: report.deleted.lines,
        feedEnabledAfter: report.feedEnabledAfter,
        deleteTransactionMs: report.deleteTransactionMs,
        statementTimeout: report.statementTimeout,
        archiveDirectory: report.archiveDirectory,
        auditReportPath: report.auditReportPath,
        orderStatus: "CONFIRMED",
        stockOnHand: 7,
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
