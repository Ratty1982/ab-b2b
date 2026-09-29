/**
 * Sales Intelligence — Sales Enquiry (customer + product) integration coverage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import {
  exportCustomerSalesEnquiryCsv,
  exportProductSalesEnquiryCsv,
  getCustomerNetSales,
  getCustomerSalesEnquiry,
  getProductSalesEnquiry,
  searchSalesIntelligenceCustomers,
  searchSalesIntelligenceProducts,
} from "@/server/sales-intelligence/enquiry";

const prisma = new PrismaClient();
const stamp = Date.now();

let adminId = "";
let managerId = "";
let marketingId = "";
let tradeBuyerId = "";
let companyAId = "";
let companyBId = "";
let brandPowerId = "";
let catCleanId = "";
let salesRepId = "";
let matchSku = "";
let goneSku = "";

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType,
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

async function seedLines(companyId: string, code: string) {
  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      dryRun: false,
      completedAt: new Date("2026-06-15T12:00:00.000Z"),
      rowsImported: 1,
      detectedAccount: code,
    },
  });

  async function doc(type: "INVOICE" | "CREDIT", ref: string, date: string | null) {
    return prisma.autopartSalesDocument.create({
      data: {
        companyId,
        autopartCustomerCode: code,
        documentType: type,
        documentReference: ref,
        documentDate: date ? new Date(`${date}T12:00:00.000Z`) : null,
        source: "SLRB",
        importRunId: run.id,
      },
    });
  }

  const inv1 = await doc("INVOICE", `SI-${code}-1`, "2026-03-10");
  const inv2 = await doc("INVOICE", `SI-${code}-2`, "2025-06-20");
  const crn = await doc("CREDIT", `SI-${code}-C1`, "2026-03-20");
  const undated = await doc("INVOICE", `SI-${code}-U`, null);

  async function line(
    documentId: string,
    type: "INVOICE" | "CREDIT",
    ref: string,
    lineNumber: number,
    sku: string,
    units: string,
    salesNet: string,
    desc: string,
  ) {
    await prisma.autopartSalesLine.create({
      data: {
        companyId,
        documentId,
        autopartCustomerCode: code,
        documentType: type,
        documentReference: ref,
        lineNumber,
        sku,
        descriptionSnapshot: desc,
        units,
        salesNet,
        matchStatus: "NOT_IN_AB_CATALOGUE",
        source: "561L",
        importRunId: run.id,
      },
    });
  }

  await line(inv1.id, "INVOICE", `SI-${code}-1`, 1, matchSku, "8", "80.00", "Cleaner A");
  await line(inv1.id, "INVOICE", `SI-${code}-1`, 2, matchSku, "1", "10.00", "Cleaner A bottle");
  await line(crn.id, "CREDIT", `SI-${code}-C1`, 1, matchSku, "-2", "-20.00", "Cleaner A credit");
  await line(inv2.id, "INVOICE", `SI-${code}-2`, 1, matchSku, "5", "50.00", "Cleaner A");
  await line(inv2.id, "INVOICE", `SI-${code}-2`, 2, goneSku, "3", "30.00", "Legacy Degreaser");
  await line(undated.id, "INVOICE", `SI-${code}-U`, 1, goneSku, "2", "15.00", "Legacy Degreaser");
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`si.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  managerId = await ensureUser(`si.mgr.${stamp}@example.invalid`, ["SALES_MANAGER"]);
  marketingId = await ensureUser(`si.mkt.${stamp}@example.invalid`, ["MARKETING"]);
  tradeBuyerId = await ensureUser(`si.buyer.${stamp}@example.invalid`, [], "TRADE");

  const brand = await prisma.brand.create({
    data: { name: `SI Power ${stamp}`, slug: `si-power-${stamp}` },
  });
  brandPowerId = brand.id;
  const cat = await prisma.category.create({
    data: { name: `SI Clean ${stamp}`, slug: `si-clean-${stamp}` },
  });
  catCleanId = cat.id;

  matchSku = `SI-MATCH-A-${stamp}`;
  goneSku = `SI-GONE-${stamp}`;

  const existingVariant = await prisma.productVariant.findUnique({ where: { sku: matchSku } });
  if (!existingVariant) {
    await saveProduct(adminId, {
      sku: matchSku,
      name: "SI All Purpose Cleaner 5L",
      brand: brand.name,
      category: cat.name,
      trade: 5,
      rrp: 10,
      packQty: 1,
      caseQty: 12,
      description: "SI cleaner",
      active: true,
    });
  }
  const v = await prisma.productVariant.findUniqueOrThrow({ where: { sku: matchSku } });
  await prisma.product.update({
    where: { id: v.productId },
    data: {
      brandId: brandPowerId,
      categoryId: catCleanId,
      isActive: true,
      isTradeVisible: true,
      status: "ACTIVE",
    },
  });

  let rep = await prisma.salesRep.findFirst({ where: { userId: managerId } });
  if (!rep) {
    rep = await prisma.salesRep.create({
      data: {
        userId: managerId,
        code: `SI-REP-${stamp}`,
        displayName: "SI Manager Rep",
        active: true,
      },
    });
  }
  salesRepId = rep.id;

  const coA = await prisma.company.create({
    data: {
      name: `SI Customer Alpha ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 days",
      primaryEmail: `si.alpha.${stamp}@example.invalid`,
    },
  });
  companyAId = coA.id;
  await prisma.companyAssignment.create({
    data: { companyId: companyAId, salesRepId },
  });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: companyAId,
    code: `SIALPH${String(stamp).slice(-3)}`,
  });
  const codeA = (
    await prisma.company.findUniqueOrThrow({ where: { id: companyAId } })
  ).autopartCustomerCode!;
  await seedLines(companyAId, codeA);

  const coB = await prisma.company.create({
    data: {
      name: `SI Customer Beta ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "Cash",
      primaryEmail: `si.beta.${stamp}@example.invalid`,
    },
  });
  companyBId = coB.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: companyBId,
    code: `SIBETA${String(stamp).slice(-3)}`,
  });
  const codeB = (
    await prisma.company.findUniqueOrThrow({ where: { id: companyBId } })
  ).autopartCustomerCode!;
  // Beta only has older invoice for MATCH-A
  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: companyBId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      dryRun: false,
      completedAt: new Date(),
      rowsImported: 1,
      detectedAccount: codeB,
    },
  });
  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId: companyBId,
      autopartCustomerCode: codeB,
      documentType: "INVOICE",
      documentReference: `SI-${codeB}-1`,
      documentDate: new Date("2026-03-05T12:00:00.000Z"),
      source: "SLRB",
      importRunId: run.id,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: companyBId,
      documentId: doc.id,
      autopartCustomerCode: codeB,
      documentType: "INVOICE",
      documentReference: `SI-${codeB}-1`,
      lineNumber: 1,
      sku: matchSku,
      descriptionSnapshot: "Cleaner A",
      units: "4",
      salesNet: "40.00",
      matchStatus: "MATCHED",
      source: "561L",
      importRunId: run.id,
    },
  });

  await prisma.companyUser.create({
    data: {
      companyId: companyAId,
      userId: tradeBuyerId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Sales Intelligence Sales Enquiry", () => {
  it("customer search finds name and Autopart account", async () => {
    const byName = await searchSalesIntelligenceCustomers(adminId, {
      q: `Alpha ${stamp}`,
    });
    expect(byName.items.some((i) => i['id'] === companyAId)).toBe(true);
    const co = await prisma.company.findUniqueOrThrow({ where: { id: companyAId } });
    const byCode = await searchSalesIntelligenceCustomers(adminId, {
      q: co.autopartCustomerCode!,
    });
    expect(byCode.items.some((i) => i['id'] === companyAId)).toBe(true);
  });

  it("customer summary recalculates invoice/credits/net/units/transactions for a period", async () => {
    const r = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
      pageSize: 50,
    });
    expect(r.company.id).toBe(companyAId);
    expect(r.company.salesperson?.name).toBeTruthy();
    expect(Number(r.summary.invoiceSales)).toBeCloseTo(90, 2);
    expect(Number(r.summary.credits)).toBeCloseTo(-20, 2);
    expect(Number(r.summary.netSales)).toBeCloseTo(70, 2);
    expect(r.summary.units).toBe(7);
    expect(r.summary.purchaseTransactions).toBe(1);
    expect(r.summary.productsPurchased).toBe(1);
    expect(r.products.items.map((i) => i.sku.toUpperCase())).toEqual([matchSku.toUpperCase()]);
    const row = r.products.items[0]!;
    expect(row.purchaseCount).toBe(1);
    expect(row.units).toBe(7);
    expect(Number(row.netSales)).toBeCloseTo(70, 2);
    expect(row.lastPurchasedDate).toBe("2026-03-10");
  });

  it("credits do not count as purchase transactions; undated excluded from bounded period", async () => {
    const mar = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(mar.summary.purchaseTransactions).toBe(1);
    expect(mar.products.items.some((i) => i.sku.toUpperCase() === goneSku.toUpperCase())).toBe(false);

    const anyish = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2020-01-01",
      to: "2026-12-31",
      pageSize: 50,
    });
    // Undated still excluded because query requires documentDate bounds
    expect(anyish.products.items.some((i) => i.sku.toUpperCase() === goneSku.toUpperCase())).toBe(true);
    const gone = anyish.products.items.find((i) => i.sku.toUpperCase() === goneSku.toUpperCase())!;
    expect(gone.purchaseCount).toBe(1); // only dated inv2 line
    expect(gone.units).toBe(3);
  });

  it("brand/category filters and brand breakdown", async () => {
    const r = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2025-01-01",
      to: "2026-12-31",
      brandId: brandPowerId,
      pageSize: 50,
    });
    expect(r.products.items.every((i) => i.brandId === brandPowerId)).toBe(true);
    expect(r.brandBreakdown.some((b) => b.key === brandPowerId)).toBe(true);
  });

  it("transaction drilldown for a SKU", async () => {
    const r = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
      txSku: matchSku,
    });
    expect(r.transactions?.total).toBe(3); // 2 invoice lines + 1 credit
    expect(r.transactions?.items.some((t) => t.documentType === "CREDIT")).toBe(true);
  });

  it("getCustomerNetSales is auditable for rebate foundation", async () => {
    const net = await getCustomerNetSales(adminId, companyAId, "2026-03-01", "2026-03-31");
    expect(Number(net.netSales)).toBeCloseTo(70, 2);
    expect(net.purchaseTransactions).toBe(1);
  });

  it("product search includes historic-only SKU", async () => {
    const r = await searchSalesIntelligenceProducts(adminId, { q: goneSku });
    expect(r.items.some((i) => String(i['sku']).toUpperCase() === goneSku.toUpperCase() && !i['inCatalogue'])).toBe(true);
    const byName = await searchSalesIntelligenceProducts(adminId, { q: "All Purpose Cleaner" });
    expect(byName.items.some((i) => String(i['sku']).toUpperCase() === matchSku.toUpperCase())).toBe(true);
  });

  it("product summary and customer breakdown", async () => {
    const r = await getProductSalesEnquiry(adminId, {
      sku: matchSku,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
      pageSize: 50,
    });
    expect(r.summary.customers).toBe(2);
    expect(r.summary.purchaseTransactions).toBe(2);
    expect(Number(r.summary.netSales)).toBeCloseTo(70 + 40, 2);
    expect(r.customers.items.map((c) => c.companyId).sort()).toEqual(
      [companyAId, companyBId].sort(),
    );
  });

  it("product transaction drilldown and CSV export", async () => {
    const r = await getProductSalesEnquiry(adminId, {
      sku: matchSku,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
      txCompanyId: companyAId,
    });
    expect(r.transactions?.total).toBeGreaterThanOrEqual(2);

    const csv = await exportProductSalesEnquiryCsv(adminId, {
      sku: matchSku,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(csv.csv).toContain("Net Sales");
    expect(csv.csv).toContain(matchSku);
    expect(csv.filename).toContain("sales-enquiry-product");
  });

  it("customer CSV export includes period and metrics", async () => {
    const csv = await exportCustomerSalesEnquiryCsv(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(csv.csv).toContain("2026-03-01");
    expect(csv.csv).toContain(matchSku);
    expect(csv.csv).toContain("Invoice Sales");
  });

  it("comparison previous period returns factual movement without Infinity", async () => {
    const r = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
      compare: "PREVIOUS",
    });
    expect(r.comparison).not.toBeNull();
    expect(r.comparison!.netSales.percentChange === null || Number.isFinite(r.comparison!.netSales.percentChange)).toBe(
      true,
    );
    // Comparison window has no Alpha activity in prior equivalent → base 0
    expect(Number(r.comparison!.netSales.comparison)).toBe(0);
    expect(r.comparison!.netSales.percentChange).toBeNull();
  });

  it("custom comparison period", async () => {
    const r = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
      compare: "CUSTOM",
      compareFrom: "2025-06-01",
      compareTo: "2025-06-30",
    });
    expect(r.comparison?.comparison).toEqual({ from: "2025-06-01", to: "2025-06-30" });
    expect(Number(r.comparison!.netSales.comparison)).toBeCloseTo(80, 2); // 50 + 30 from June
  });

  it("denies trade, marketing; allows sales manager", async () => {
    await expect(
      getCustomerSalesEnquiry(tradeBuyerId, {
        companyId: companyAId,
        period: "LAST_30",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      searchSalesIntelligenceCustomers(marketingId, { q: "Alpha" }),
    ).rejects.toBeInstanceOf(AuthError);

    const ok = await getCustomerSalesEnquiry(managerId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(ok.summary.productsPurchased).toBe(1);

    await expect(
      exportCustomerSalesEnquiryCsv(tradeBuyerId, {
        companyId: companyAId,
        period: "LAST_30",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("negative net period when credits exceed invoices", async () => {
    // Use credit-only slice for Alpha MATCH-A credit date
    const r = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-03-15",
      to: "2026-03-25",
    });
    expect(Number(r.summary.netSales)).toBeCloseTo(-20, 2);
    expect(r.summary.purchaseTransactions).toBe(0);
    expect(r.summary.units).toBe(-2);
  });
});
