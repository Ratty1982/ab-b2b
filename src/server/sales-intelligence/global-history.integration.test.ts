/**
 * All Historical Autopart Sales uses linked AutopartInvoiceLine rows only.
 * Dated Sales Enquiry totals stay on AutopartSalesLine.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { parseSalesEnquiryUrlSearch } from "@/domain/sales-intelligence";
import { AuthError } from "@/server/rbac/guards";
import { previewSalesIntelligenceFollowUp } from "@/server/sales-intelligence/followup";
import { getCustomerSalesEnquiry } from "@/server/sales-intelligence/enquiry";
import {
  exportGlobalAutopartSalesCsv,
  getGlobalAutopartSalesDashboard,
  getGlobalCustomerSalesEnquiry,
  getGlobalProductSalesEnquiry,
  searchGlobalAutopartSales,
} from "@/server/sales-intelligence/global-history";
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
      source: "SLRB",
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
      source: "561L",
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

describe("All Historical Autopart Sales", () => {
  it("keeps the dated enquiry URL on dated sales and labels the historical mode", () => {
    const dated = parseSalesEnquiryUrlSearch({ period: "LAST_30", mode: "customers" });
    expect(dated.source).toBeUndefined();
    expect(dated.period).toBe("LAST_30");
    expect(parseSalesEnquiryUrlSearch({ source: "global" }).source).toBe("global");
  });

  it("sums linked undated invoice lines without ledger, dated feeds, or blank-reference invoices", async () => {
    const dashboard = await getGlobalAutopartSalesDashboard(adminId, {
      customerGroupId: groupId,
    });
    expect(dashboard.period.label).toBe("All Available History");
    expect(dashboard.overlapNote).toMatch(/do not share a transaction identity/);
    expect(dashboard.summary.netSales).toBe("0.50");
    expect(dashboard.summary.grossSales).toBe("1.50");
    expect(dashboard.summary.credits).toBe("-1.00");
    expect(dashboard.summary.lineCount).toBe(6);
    expect(dashboard.summary.invoiceCount).toBe(4);
    expect(dashboard.summary.productCount).toBe(3);
    expect(dashboard.summary.units).toBe("1.300");
    expect(dashboard.summary.customersRepresented).toBe(1);
    expect(dashboard.summary.customersWithoutLinkedHistory).toBe(1);

    const branded = await getGlobalAutopartSalesDashboard(adminId, {
      customerGroupId: groupId,
      brandId,
    });
    expect(branded.summary.netSales).toBe("1.50");
    expect(branded.summary.credits).toBe("0.00");
    expect(branded.summary.productCount).toBe(1);

    const customer = await getGlobalCustomerSalesEnquiry(adminId, { companyId: companyAId });
    expect(customer.company.status).toBe("PROSPECT");
    expect(customer.company.linkedAccountCodes).toEqual([codeA1, codeA2]);
    expect(customer.summary.netSales).toBe("0.50");
    expect(customer.purchasedSkus).toContain(matchSku);
    expect(customer.crossSell.items.map((item) => item.sku)).toContain(siblingSku);
    expect(customer.crossSell.note).toMatch(/stopped buying/);
    const pad = customer.products.items.find((item) => item.sku === matchSku);
    expect(pad?.inCatalogue).toBe(true);
    expect(pad?.tradePrice).toBe("12.34");
    expect(pad?.customerPrice).toBe("7.50");
    expect(pad?.studleyAvailableQty).toBe(7);

    const dated = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(dated.summary.netSales).toBe("999.00");
    expect(customer.summary.netSales).not.toBe(dated.summary.netSales);
  });

  it("hides other customers, unlinked names, prices, and stock outside the actor's permission", async () => {
    const repProduct = await getGlobalProductSalesEnquiry(repUserId, { sku: matchSku });
    expect(repProduct.summary.netSales).toBe("1.50");
    expect(repProduct.customers.items.map((item) => item.companyId)).toEqual([companyAId]);
    expect(JSON.stringify(repProduct)).not.toContain(`GH Other ${stamp}`);

    await expect(getGlobalCustomerSalesEnquiry(repUserId, { companyId: companyBId })).rejects.toBeInstanceOf(
      AuthError,
    );
    const restricted = await searchGlobalAutopartSales(repUserId, { q: codeB });
    expect(restricted.companies).toEqual([]);
    expect(restricted.account).toEqual({ state: "restricted", accountCode: codeB });
    expect(JSON.stringify(restricted)).not.toContain(`GH Other ${stamp}`);

    const secret = await searchGlobalAutopartSales(adminId, { q: secretName });
    expect(secret.companies).toEqual([]);
    expect(JSON.stringify(secret)).not.toContain(secretName);
    const secretCode = await searchGlobalAutopartSales(adminId, { q: codeSecret });
    expect(secretCode.account).toEqual({ state: "unlinked", accountCode: codeSecret });
    expect(JSON.stringify(secretCode)).not.toContain(secretName);
    const secretSkuSearch = await searchGlobalAutopartSales(adminId, { q: secretSku });
    expect(secretSkuSearch.products.some((item) => item.sku === secretSku)).toBe(false);

    const accounts = await getGlobalCustomerSalesEnquiry(accountsId, { companyId: companyAId });
    expect(accounts.pricingPermitted).toBe(false);
    expect(accounts.studleyStockPermitted).toBe(false);
    expect(accounts.products.items.every((item) => item.tradePrice == null && item.studleyAvailableQty == null)).toBe(
      true,
    );
    await expect(getGlobalAutopartSalesDashboard(tradeId, {})).rejects.toBeInstanceOf(AuthError);

    const csv = await exportGlobalAutopartSalesCsv(repUserId, { kind: "product", sku: matchSku });
    expect(csv.csv).not.toContain(`GH Other ${stamp}`);
    expect(csv.csv).toContain(matchSku);
    const customerCsv = await exportGlobalAutopartSalesCsv(adminId, { kind: "customer", companyId: companyAId });
    expect(customerCsv.csv).toContain("'-1.00");
  });

  it("creates a follow-up and opportunity from undated history without a stopped-buying claim", async () => {
    const preview = await previewSalesIntelligenceFollowUp(adminId, {
      sourceModule: "SALES_ENQUIRY",
      sourceReason: "CROSS_SELL",
      companyId: companyAId,
      sku: siblingSku,
      historySource: "global",
    });
    expect(preview.snapshot.selectedPeriod.label).toBe("All Available History");
    expect(preview.snapshot.selectedPeriod.from).toBeNull();
    expect(preview.snapshot.sourceReason).toBe("CROSS_SELL");
    expect(preview.title.toLowerCase()).not.toContain("stopped");
    expect(preview.snapshot.metrics["Invoice dates"]).toMatch(/Not available/);

    const before = await prisma.company.findUniqueOrThrow({ where: { id: companyAId } });
    const opportunity = await createCrmOpportunity(adminId, {
      companyId: companyAId,
      title: `Historical Autopart sales — GH Prospect ${stamp}`,
      description: "Undated history. No customer message was sent.",
    });
    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyAId } });
    expect(after.status).toBe(before.status);
    expect(after.status).toBe("PROSPECT");
    expect(opportunity.id).toBeTruthy();
  });
});
