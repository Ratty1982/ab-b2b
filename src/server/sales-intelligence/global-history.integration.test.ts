/**
 * Retired global 561L sales must not be returned as a zero dashboard.
 * Dated Sales Enquiry still reads the ongoing TRM21QC line.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { parseSalesEnquiryUrlSearch } from "@/domain/sales-intelligence";
import { AuthError } from "@/server/rbac/guards";
import { previewSalesIntelligenceFollowUp } from "@/server/sales-intelligence/followup";
import { getCustomerSalesEnquiry } from "@/server/sales-intelligence/enquiry";
import { requireSalesIntelligence } from "@/server/sales-intelligence/global-history";
import { createCrmOpportunity } from "@/server/crm/opportunities";

const prisma = new PrismaClient();
const stamp = `GH${Date.now().toString(36).slice(-6).toUpperCase()}`;
const secretName = `SECRET${stamp} GARAGE`;
const matchSku = `GH-MATCH-${stamp}`;
const otherSku = `GH-OTHER-${stamp}`;
const zeroSku = `GH-ZERO-${stamp}`;
const siblingSku = `GH-SIB-${stamp}`;
const secretSku = `GH-SECRET-${stamp}`;

let adminId = "";
let repUserId = "";
let accountsId = "";
let tradeId = "";
let companyAId = "";
let companyBId = "";
let companyCId = "";
let groupId = "";
let brandId = "";
let repId = "";
let batchId = "";
const codeA1 = `${stamp}A1`;
const codeA2 = `${stamp}A2`;
const codeB = `${stamp}B`;
const codeSecret = `${stamp}Z`;

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
  const user = await prisma.user.create({
    data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType, emailVerified: true },
  });
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user.id;
}

async function line(input: {
  accountCode: string;
  accountId: string;
  rawInvAndLn: string;
  documentReference: string | null;
  documentType: string;
  partNumber: string;
  quantity: string;
  salesAmount: string;
  description: string;
}) {
  await prisma.autopartInvoiceLine.create({
    data: {
      sourceIdentity: `${stamp}-${input.rawInvAndLn}-${input.partNumber}`,
      accountCode: input.accountCode,
      accountId: input.accountId,
      rawInvAndLn: input.rawInvAndLn,
      documentReference: input.documentReference,
      documentType: input.documentType,
      partNumber: input.partNumber,
      description: input.description,
      quantity: input.quantity,
      salesAmount: input.salesAmount,
      salesMeasure: "NET_EX_VAT",
      importBatchId: batchId,
      rawSource: { synthetic: true },
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`gh.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  repUserId = await ensureUser(`gh.rep.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  accountsId = await ensureUser(`gh.accounts.${stamp}@example.invalid`, ["ACCOUNTS"]);
  tradeId = await ensureUser(`gh.trade.${stamp}@example.invalid`, [], "TRADE");
  const rep = await prisma.salesRep.create({
    data: { userId: repUserId, code: `GH-${stamp}`, displayName: `Rep ${stamp}`, active: true },
  });
  repId = rep.id;

  const brand = await prisma.brand.create({ data: { name: `GH Brand ${stamp}`, slug: `gh-brand-${stamp}` } });
  brandId = brand.id;
  const category = await prisma.category.create({
    data: { name: `GH Cat ${stamp}`, slug: `gh-cat-${stamp}` },
  });
  const group = await prisma.customerGroup.create({ data: { name: `GH Group ${stamp}`, active: true } });
  groupId = group.id;

  const companyA = await prisma.company.create({
    data: { name: `GH Prospect ${stamp}`, status: "PROSPECT", customerGroupId: groupId },
  });
  companyAId = companyA.id;
  const companyB = await prisma.company.create({
    data: { name: `GH Other ${stamp}`, status: "ACTIVE" },
  });
  companyBId = companyB.id;
  const companyC = await prisma.company.create({
    data: { name: `GH Quiet ${stamp}`, status: "PROSPECT", customerGroupId: groupId },
  });
  companyCId = companyC.id;
  await prisma.companyAssignment.createMany({
    data: [
      { companyId: companyAId, salesRepId: repId },
      { companyId: companyCId, salesRepId: repId },
    ],
  });

  const product = await prisma.product.create({
    data: {
      slug: `gh-pad-${stamp}`,
      name: `GH Pad ${stamp}`,
      brandId,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
      variants: {
        create: { sku: matchSku, tradePrice: "12.3400", isDefault: true, isActive: true },
      },
    },
    include: { variants: true },
  });
  const variant = product.variants[0]!;
  await prisma.product.create({
    data: {
      slug: `gh-sib-${stamp}`,
      name: `GH Sibling ${stamp}`,
      brandId,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
      variants: { create: { sku: siblingSku, tradePrice: "4.0000", isDefault: true, isActive: true } },
    },
  });
  await prisma.customerPrice.create({
    data: { companyId: companyAId, variantId: variant.id, unitPrice: "7.5000" },
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "AUTOPART" },
    update: {},
    create: { code: "AUTOPART", name: "Autopart", isDefault: true },
  });
  await prisma.inventory.create({
    data: { variantId: variant.id, warehouseId: warehouse.id, qtyOnHand: 7, externalSyncedAt: new Date() },
  });
  await prisma.autopartProduct.create({
    data: {
      sku: matchSku,
      matchKey: matchSku.toUpperCase(),
      description: `GH Pad ${stamp}`,
      availQty: 4,
      presentInLatestFeed: true,
      catalogueVariantId: variant.id,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });

  const batch = await prisma.autopartImportBatch.create({
    data: {
      kind: "INVOICE_LINES",
      status: "COMMITTED",
      filename: `gh-${stamp}.csv`,
      fileHash: `gh-${stamp}`,
      dryRun: false,
      createdById: adminId,
    },
  });
  batchId = batch.id;

  async function account(accountCode: string, companyId: string | null, originalName: string) {
    return prisma.autopartAccount.create({
      data: {
        accountCode,
        originalName,
        classification: "TRADE_CANDIDATE",
        companyId,
      },
    });
  }
  const accountA1 = await account(codeA1, companyAId, `Linked ${stamp}`);
  const accountA2 = await account(codeA2, companyAId, `Second ${stamp}`);
  const accountB = await account(codeB, companyBId, `Other ${stamp}`);
  const accountSecret = await account(codeSecret, null, secretName);

  await line({
    accountCode: codeA1,
    accountId: accountA1.id,
    rawInvAndLn: `I/${stamp}/1`,
    documentReference: `INV1-${stamp}`,
    documentType: "INVOICE",
    partNumber: matchSku,
    quantity: "0.10",
    salesAmount: "0.10",
    description: "Pad",
  });
  await line({
    accountCode: codeA1,
    accountId: accountA1.id,
    rawInvAndLn: `I/${stamp}/2`,
    documentReference: `INV1-${stamp}`,
    documentType: "INVOICE",
    partNumber: matchSku,
    quantity: "0.20",
    salesAmount: "0.20",
    description: "Pad",
  });
  await line({
    accountCode: codeA1,
    accountId: accountA1.id,
    rawInvAndLn: `C/${stamp}/1`,
    documentReference: `CR1-${stamp}`,
    documentType: "CREDIT",
    partNumber: otherSku,
    quantity: "-1.000",
    salesAmount: "-1.00",
    description: `GH Brand ${stamp} text only`,
  });
  await line({
    accountCode: codeA1,
    accountId: accountA1.id,
    rawInvAndLn: `I/${stamp}/3`,
    documentReference: `INV2-${stamp}`,
    documentType: "INVOICE",
    partNumber: zeroSku,
    quantity: "0.000",
    salesAmount: "0.00",
    description: "Zero",
  });
  await line({
    accountCode: codeA2,
    accountId: accountA2.id,
    rawInvAndLn: `I/${stamp}/4`,
    documentReference: `INV3-${stamp}`,
    documentType: "INVOICE",
    partNumber: matchSku,
    quantity: "1.000",
    salesAmount: "0.20",
    description: "Pad",
  });
  await line({
    accountCode: codeA1,
    accountId: accountA1.id,
    rawInvAndLn: `I/${stamp}/5`,
    documentReference: null,
    documentType: "INVOICE",
    partNumber: matchSku,
    quantity: "1.000",
    salesAmount: "1.00",
    description: "Undocumented pad",
  });
  await line({
    accountCode: codeB,
    accountId: accountB.id,
    rawInvAndLn: `I/${stamp}/B`,
    documentReference: `INVB-${stamp}`,
    documentType: "INVOICE",
    partNumber: matchSku,
    quantity: "4.000",
    salesAmount: "1000.00",
    description: "Other customer pad",
  });
  await line({
    accountCode: codeSecret,
    accountId: accountSecret.id,
    rawInvAndLn: `I/${stamp}/Z`,
    documentReference: `INVZ-${stamp}`,
    documentType: "INVOICE",
    partNumber: secretSku,
    quantity: "1.000",
    salesAmount: "50.00",
    description: "Secret only",
  });
  await prisma.autopartLedgerTransaction.create({
    data: {
      sourceIdentity: `${stamp}-ledger`,
      accountCode: codeA1,
      accountId: accountA1.id,
      rawType: "CSH",
      ledgerKind: "PAYMENT",
      reference: `PAY-${stamp}`,
      goodsAmount: "-10.00",
      totalAmount: "-10.00",
      runningBalance: "0.00",
      importBatchId: batchId,
      rawSource: { synthetic: true },
    },
  });

  const run = await prisma.autopartCustomerImportRun.create({
    data: { companyId: companyAId, type: "HISTORY_561L_SLRB", status: "COMMITTED", dryRun: false },
  });
  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId: companyAId,
      autopartCustomerCode: codeA1,
      documentType: "INVOICE",
      documentReference: `DATED-${stamp}`,
      documentDate: new Date("2026-03-10T12:00:00.000Z"),
      source: "ONGOING_TRM21QC",
      hasTrm21qc: true,
      importRunId: run.id,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: companyAId,
      documentId: doc.id,
      autopartCustomerCode: codeA1,
      documentType: "INVOICE",
      documentReference: `DATED-${stamp}`,
      lineNumber: 1,
      sku: matchSku,
      units: "1",
      salesNet: "999.00",
      source: "ONGOING_TRM21QC",
      importRunId: run.id,
    },
  });
});

afterAll(async () => {
  await prisma.autopartInvoiceLine.deleteMany({
    where: { accountCode: { in: [codeA1, codeA2, codeB, codeSecret] } },
  });
  await prisma.autopartLedgerTransaction.deleteMany({
    where: { accountCode: { in: [codeA1, codeA2, codeB, codeSecret] } },
  });
  await prisma.autopartAccount.deleteMany({
    where: { accountCode: { in: [codeA1, codeA2, codeB, codeSecret] } },
  });
  await prisma.autopartProduct.deleteMany({ where: { matchKey: matchSku.toUpperCase() } });
  await prisma.activity.deleteMany({ where: { companyId: { in: [companyAId, companyBId, companyCId] } } });
  await prisma.opportunity.deleteMany({ where: { companyId: { in: [companyAId, companyBId, companyCId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId, companyCId] } } });
  await prisma.customerGroup.deleteMany({ where: { id: groupId } });
  await prisma.product.deleteMany({ where: { slug: { in: [`gh-pad-${stamp}`, `gh-sib-${stamp}`] } } });
  await prisma.category.deleteMany({ where: { slug: `gh-cat-${stamp}` } });
  await prisma.brand.deleteMany({ where: { id: brandId } });
  await prisma.autopartImportBatch.deleteMany({ where: { id: batchId } });
  await prisma.$disconnect();
});

describe("retired global Autopart sales", () => {
  it("ignores a historical sales bookmark and keeps dated Sales Enquiry", () => {
    const dated = parseSalesEnquiryUrlSearch({ period: "LAST_30", mode: "customers" });
    expect(dated.source).toBeUndefined();
    expect(dated.period).toBe("LAST_30");
    expect(parseSalesEnquiryUrlSearch({ source: "global" }).source).toBeUndefined();
    const serverFns = readFileSync("src/server/phase2/fns.ts", "utf8");
    expect(serverFns).not.toContain("getGlobalAutopartSalesDashboardFn");
    expect(serverFns).not.toContain("exportGlobalAutopartSalesCsvFn");
    const history = readFileSync("src/server/sales-intelligence/global-history.ts", "utf8");
    expect(history).not.toContain("AutopartInvoiceLine");
    expect(history).not.toContain("WHERE FALSE");
  });

  it("counts the ongoing TRM21QC line and does not report the retired invoice lines as zero sales", async () => {
    const storedHistory = await prisma.autopartInvoiceLine.count({
      where: { accountCode: { in: [codeA1, codeA2] } },
    });
    expect(storedHistory).toBeGreaterThan(0);

    const dated = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(dated.summary.netSales).toBe("999.00");
    expect(dated.dataSource).not.toMatch(/561L \+ SLRB/);
    await expect(requireSalesIntelligence(tradeId)).rejects.toBeInstanceOf(AuthError);
  });

  it("creates a follow-up from the ongoing sales snapshot without a stopped-buying claim", async () => {
    const preview = await previewSalesIntelligenceFollowUp(adminId, {
      sourceModule: "SALES_ENQUIRY",
      sourceReason: "CROSS_SELL",
      companyId: companyAId,
      sku: siblingSku,
      historySource: "global",
    });
    expect(preview.snapshot.selectedPeriod.from).toBeNull();
    expect(preview.snapshot.sourceReason).toBe("CUSTOMER");
    expect(preview.title.toLowerCase()).not.toContain("stopped");
    expect(preview.snapshot.metrics["Dated invoiced sales ex VAT"]).toBe("999.00");
    expect(preview.snapshot.metrics["Invoice dates"]).toBeUndefined();
    expect(JSON.stringify(preview.snapshot.metrics)).not.toMatch(/561L/);

    const before = await prisma.company.findUniqueOrThrow({ where: { id: companyAId } });
    const opportunity = await createCrmOpportunity(adminId, {
      companyId: companyAId,
      title: `Ongoing sales — GH Prospect ${stamp}`,
      description: "Ongoing 504 and TRM21QC sales. No customer message was sent.",
    });
    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyAId } });
    expect(after.status).toBe(before.status);
    expect(after.status).toBe("PROSPECT");
    expect(opportunity.id).toBeTruthy();
  });
});
