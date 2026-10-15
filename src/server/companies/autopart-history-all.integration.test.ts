/**
 * Reset and 561L-ALL / SLRB-ALL import on the dedicated test database.
 * Requires TEST_DATABASE_URL. Refuses the application database.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { databaseNameFromUrl, RESET_CONFIRMATION_PHRASE } from "@/domain/customer-data-reset";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { confirmAllHistoricImport } from "@/server/companies/autopart-history-all";
import { executeCustomerDataReset } from "@/server/maintenance/customer-data-reset";

const prisma = new PrismaClient();
const stamp = Date.now();
const acme = `AC${String(stamp).slice(-6)}`;
const beta = `BE${String(stamp).slice(-6)}`;
const waiting = `WA${String(stamp).slice(-6)}`;
const nobody = `NO${String(stamp).slice(-6)}`;
const shared = `SH${String(stamp).slice(-6)}`;
const ongoingRef = `ON${String(stamp).slice(-6)}`;
const fba = `FB${String(stamp).slice(-6)}`;
const credit = `CR${String(stamp).slice(-6)}`;

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];

let adminId = "";
let acmeId = "";
let betaId = "";
let orderId = "";
let inventoryId = "";

function files() {
  const file561l = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${acme},I/${shared}/1,SHARED-A,Shared,1,10.00
${acme},I/${fba}/1,FBA-A,Fba a,2,4.00
${acme},I/${fba}/1,FBA-B,Fba b,3,6.00
${acme},C/${credit}/1,CRED-A,Credit,-1,-2.50
${acme},I/${ongoingRef}/1,BLOCKED,Blocked,9,99.00
${beta},I/${shared}/1,SHARED-B,Other,1,7.00
${waiting},I/WAIT1/1,WAIT-SKU,Waiting,1,3.00
${nobody},I/NONE1/1,NONE-SKU,Unknown,1,1.00
`;
  const fileSlrb = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${acme},INV,${shared},15 Oct 26,10.00,0.00,10.00,10.00
${acme},INV,${fba},15 Oct 26,10.00,0.00,10.00,10.00
${acme},CRN,${credit},15 Oct 26,-2.50,0.00,-2.50,-2.50
${acme},INV,${ongoingRef},15 Oct 26,99.00,0.00,99.00,99.00
${acme},PAY,PAY1,15 Oct 26,10.00,0.00,10.00,0.00
${beta},INV,${shared},15 Oct 26,7.00,0.00,7.00,7.00
${waiting},INV,WAIT1,15 Oct 26,3.00,0.00,3.00,3.00
${nobody},INV,NONE1,15 Oct 26,1.00,0.00,1.00,1.00
`;
  return { file561l, fileSlrb, filename561l: "561L-ALL.CSV", filenameSlrb: "SLRB-ALL.CSV" };
}

async function ensureAdmin() {
  const user = await prisma.user.create({
    data: {
      email: `hist-all.${stamp}@example.invalid`,
      name: "Historic all",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  createdUserIds.push(user.id);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureAdmin();
  const acmeCompany = await prisma.company.create({
    data: {
      name: `All import acme ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: acme,
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const betaCompany = await prisma.company.create({
    data: {
      name: `All import beta ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: beta,
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  acmeId = acmeCompany.id;
  betaId = betaCompany.id;
  createdCompanyIds.push(acmeId, betaId);
  await prisma.autopartAccount.createMany({
    data: [
      { accountCode: acme, originalName: "Acme", classification: "TRADE_CANDIDATE", companyId: acmeId },
      { accountCode: beta, originalName: "Beta", classification: "TRADE_CANDIDATE", companyId: betaId },
      { accountCode: waiting, originalName: "Waiting", classification: "TRADE_CANDIDATE" },
    ],
  });
  const master = await prisma.autopartImportBatch.create({
    data: { kind: "CUSTOMER_MASTER", status: "COMMITTED", filename: "407EXP.txt", fileHash: `master-${stamp}` },
  });
  const invoiceBatch = await prisma.autopartImportBatch.create({
    data: { kind: "INVOICE_LINES", status: "COMMITTED", filename: "old-561.csv", fileHash: `old-${stamp}` },
  });
  await prisma.autopartInvoiceLine.create({
    data: {
      sourceIdentity: `old-${stamp}`,
      accountCode: acme,
      rawInvAndLn: `I/OLD/1`,
      documentReference: "OLD",
      documentType: "INVOICE",
      partNumber: "OLD-SKU",
      quantity: "1",
      salesAmount: "50.00",
      importBatchId: invoiceBatch.id,
      rawSource: {},
    },
  });
  await prisma.autopartAccount.updateMany({
    where: { accountCode: acme },
    data: { lastImportBatchId: invoiceBatch.id },
  });
  const ongoingDoc = await prisma.autopartSalesDocument.create({
    data: {
      companyId: acmeId,
      autopartCustomerCode: acme,
      documentType: "INVOICE",
      documentReference: ongoingRef,
      source: "ONGOING_504",
      has504: true,
      goodsNet: "11.00",
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: acmeId,
      documentId: ongoingDoc.id,
      autopartCustomerCode: acme,
      documentType: "INVOICE",
      documentReference: ongoingRef,
      lineNumber: 1,
      sku: "LIVE-SKU",
      units: "2",
      salesNet: "11.00",
      source: "ONGOING_TRM21QC",
    },
  });
  const brand = await prisma.brand.create({ data: { slug: `brand-${stamp}`, name: `Brand ${stamp}` } });
  const product = await prisma.product.create({
    data: { slug: `product-${stamp}`, name: `Product ${stamp}`, brandId: brand.id },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, sku: `SKU-${stamp}` },
  });
  const warehouse = await prisma.warehouse.create({
    data: { code: `WH${String(stamp).slice(-6)}`, name: `Warehouse ${stamp}` },
  });
  const inventory = await prisma.inventory.create({
    data: { variantId: variant.id, warehouseId: warehouse.id, qtyOnHand: 10, qtyReserved: 4 },
  });
  inventoryId = inventory.id;
  const order = await prisma.order.create({
    data: {
      orderNumber: `AB-TEST-${stamp}`,
      companyId: acmeId,
      subtotal: "10.00",
      vatTotal: "2.00",
      grandTotal: "12.00",
      status: "CONFIRMED",
    },
  });
  orderId = order.id;
  await prisma.orderStockReservation.create({
    data: {
      orderId: order.id,
      variantId: variant.id,
      inventoryId: inventory.id,
      quantity: 4,
      status: "ACTIVE",
    },
  });
  void master;
});

afterAll(async () => {
  try {
    await prisma.autopartHistoryAllImport.deleteMany({ where: { createdById: { in: createdUserIds } } });
    await prisma.autopartSalesLine.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartCustomerImportRun.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartInvoiceLine.deleteMany({ where: { accountCode: { in: [acme, beta, waiting, nobody] } } });
    await prisma.autopartAccount.deleteMany({ where: { accountCode: { in: [acme, beta, waiting] } } });
    await prisma.autopartImportBatch.deleteMany({ where: { fileHash: { in: [`master-${stamp}`, `old-${stamp}`] } } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.inventory.deleteMany({ where: { id: inventoryId } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("historical all-file reset and import", () => {
  it("clears overlapping history, keeps the master and ongoing feed, then imports the ALL pair once", async () => {
    const beforeMaster = await prisma.autopartImportBatch.count({ where: { kind: "CUSTOMER_MASTER" } });
    const beforeOngoing = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: acmeId, documentReference: ongoingRef },
    });
    const result = await executeCustomerDataReset({
      startedBy: "cli",
      confirmation: RESET_CONFIRMATION_PHRASE,
      targetDatabase: databaseNameFromUrl(process.env["TEST_DATABASE_URL"] ?? ""),
      actualDatabase: databaseNameFromUrl(process.env["TEST_DATABASE_URL"] ?? ""),
      backupProof: {
        backupPath: "/tmp/ab-test-backup.dump",
        backupBytes: 10,
        backupSha256: "ab".repeat(32),
        sourceDatabase: "automotive_brands_test",
        restoredDatabase: "automotive_brands_restore",
        restoredAt: new Date().toISOString(),
      },
      restoreCheckOk: true,
      acknowledgeExportedOrders: false,
      includeB2bOrders: true,
      ongoingResetRequested: false,
    });
    expect(result.ok).toBe(true);
    expect(await prisma.autopartInvoiceLine.count({ where: { sourceIdentity: `old-${stamp}` } })).toBe(0);
    expect(await prisma.autopartImportBatch.count({ where: { kind: "CUSTOMER_MASTER" } })).toBe(beforeMaster);
    expect(await prisma.autopartAccount.count({ where: { accountCode: waiting } })).toBe(1);
    const kept = await prisma.autopartSalesDocument.findUniqueOrThrow({ where: { id: beforeOngoing.id } });
    expect(Number(kept.goodsNet)).toBe(11);
    expect(await prisma.order.count({ where: { id: orderId } })).toBe(0);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } })).qtyReserved).toBe(0);
    const masterAccount = await prisma.autopartAccount.findFirstOrThrow({ where: { accountCode: acme } });
    expect(masterAccount.lastImportBatchId).toBeNull();

    const imported = await confirmAllHistoricImport(adminId, files());
    expect(imported.status).toBe("COMMITTED");
    expect(imported.accountsCommitted).toBe(2);
    expect(imported.accountsReviewed).toBe(2);

    const acmeShared = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: acmeId, documentReference: shared },
    });
    const betaShared = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: betaId, documentReference: shared },
    });
    expect(Number(acmeShared.goodsNet)).toBe(10);
    expect(Number(betaShared.goodsNet)).toBe(7);
    const fbaLines = await prisma.autopartSalesLine.findMany({
      where: { companyId: acmeId, documentReference: fba },
      orderBy: { lineNumber: "asc" },
    });
    expect(fbaLines.map((line) => [line.sku, line.lineNumber])).toEqual([
      ["FBA-A", 1],
      ["FBA-B", 2],
    ]);
    const creditLine = await prisma.autopartSalesLine.findFirstOrThrow({
      where: { companyId: acmeId, documentReference: credit },
    });
    expect(Number(creditLine.salesNet)).toBe(-2.5);
    const stillOngoing = await prisma.autopartSalesDocument.findUniqueOrThrow({
      where: { id: beforeOngoing.id },
      include: { lines: true },
    });
    expect(Number(stillOngoing.goodsNet)).toBe(11);
    expect(stillOngoing.lines[0]?.sku).toBe("LIVE-SKU");
    expect(stillOngoing.lines[0]?.source).toBe("ONGOING_TRM21QC");
    expect(await prisma.autopartSalesDocument.count({ where: { autopartCustomerCode: nobody } })).toBe(0);
    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: { in: [acme, beta, waiting, nobody] } } })).toBe(0);

    const totals = async () =>
      prisma.autopartSalesLine.aggregate({
        where: { companyId: { in: [acmeId, betaId] }, source: "561L" },
        _sum: { salesNet: true },
        _count: true,
      });
    const firstTotals = await totals();
    await confirmAllHistoricImport(adminId, files());
    const secondTotals = await totals();
    expect(secondTotals._count).toBe(firstTotals._count);
    expect(secondTotals._sum.salesNet?.toString()).toBe(firstTotals._sum.salesNet?.toString());

    const activated = await prisma.company.create({
      data: { name: `All import waiting ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
    });
    createdCompanyIds.push(activated.id);
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: activated.id, code: waiting });
    const promoted = await prisma.autopartSalesLine.findFirst({
      where: { companyId: activated.id, sku: "WAIT-SKU" },
    });
    expect(promoted?.source).toBe("561L");
    expect(Number(promoted?.salesNet)).toBe(3);
    const review = await prisma.autopartHistoryReviewAccount.findFirst({
      where: { accountCode: waiting, status: "APPLIED" },
    });
    expect(review?.companyId).toBe(activated.id);
  });
});
