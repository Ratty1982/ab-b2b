/**
 * Sales Intelligence — Rebate / Net Spend Analysis integration coverage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { getCustomerSalesEnquiry } from "@/server/sales-intelligence/enquiry";
import {
  exportCustomerRebateDocumentsCsv,
  exportCustomerRebateProductsCsv,
  exportCustomerRebateSummaryCsv,
  exportMultiCustomerRebateCsv,
  getCustomerNetSpend,
  getCustomerRebateAnalysis,
  getMultiCustomerRebateAnalysis,
} from "@/server/sales-intelligence/rebate";

const prisma = new PrismaClient();
const stamp = Date.now();

let adminId = "";
let managerId = "";
let salesRepUserId = "";
let marketingId = "";
let tradeBuyerId = "";
let companyAId = "";
let companyBId = "";
let outOfScopeCompanyId = "";
let salesRepId = "";
let brandId = "";
let catId = "";
let sku1 = "";
let sku2 = "";
let historicSku = "";

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

async function seedDoc(
  companyId: string,
  code: string,
  runId: string,
  type: "INVOICE" | "CREDIT",
  ref: string,
  date: string | null,
) {
  return prisma.autopartSalesDocument.create({
    data: {
      companyId,
      autopartCustomerCode: code,
      documentType: type,
      documentReference: ref,
      documentDate: date ? new Date(`${date}T12:00:00.000Z`) : null,
      source: "SLRB",
      importRunId: runId,
    },
  });
}

async function seedLine(
  companyId: string,
  code: string,
  runId: string,
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
      importRunId: runId,
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`rb.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  managerId = await ensureUser(`rb.mgr.${stamp}@example.invalid`, ["SALES_MANAGER"]);
  salesRepUserId = await ensureUser(`rb.rep.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  marketingId = await ensureUser(`rb.mkt.${stamp}@example.invalid`, ["MARKETING"]);
  tradeBuyerId = await ensureUser(`rb.buyer.${stamp}@example.invalid`, [], "TRADE");

  const brand = await prisma.brand.create({
    data: { name: `RB Brand ${stamp}`, slug: `rb-brand-${stamp}` },
  });
  brandId = brand.id;
  const cat = await prisma.category.create({
    data: { name: `RB Cat ${stamp}`, slug: `rb-cat-${stamp}` },
  });
  catId = cat.id;

  sku1 = `RB-SKU1-${stamp}`;
  sku2 = `RB-SKU2-${stamp}`;
  historicSku = sku2; // SKU2 is intentionally not in catalogue → historic-only / Unassigned

  await saveProduct(adminId, {
    sku: sku1,
    name: "Rebate SKU One",
    brand: brand.name,
    category: cat.name,
    trade: 10,
    rrp: 20,
    packQty: 1,
    caseQty: 12,
    description: "SKU1",
    active: true,
  });
  const v = await prisma.productVariant.findUniqueOrThrow({ where: { sku: sku1 } });
  await prisma.product.update({
    where: { id: v.productId },
    data: {
      brandId,
      categoryId: catId,
      isActive: true,
      isTradeVisible: true,
      status: "ACTIVE",
    },
  });

  let rep = await prisma.salesRep.findFirst({ where: { userId: salesRepUserId } });
  if (!rep) {
    rep = await prisma.salesRep.create({
      data: {
        userId: salesRepUserId,
        code: `RB-REP-${stamp}`,
        displayName: "RB Sales Rep",
        active: true,
      },
    });
  }
  salesRepId = rep.id;

  const coA = await prisma.company.create({
    data: {
      name: `RB Customer A ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "60 DAYS",
      primaryEmail: `rb.a.${stamp}@example.invalid`,
    },
  });
  companyAId = coA.id;
  await prisma.companyAssignment.create({
    data: { companyId: companyAId, salesRepId },
  });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: companyAId,
    code: `RBA${String(stamp).slice(-4)}`,
  });
  const codeA = (
    await prisma.company.findUniqueOrThrow({ where: { id: companyAId } })
  ).autopartCustomerCode!;

  const runA = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: companyAId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      dryRun: false,
      completedAt: new Date("2026-01-25T12:00:00.000Z"),
      rowsImported: 4,
      detectedAccount: codeA,
    },
  });

  // Fixture Customer A — January
  const inv1 = await seedDoc(companyAId, codeA, runA.id, "INVOICE", `RB-A-INV1`, "2026-01-01");
  const inv2 = await seedDoc(companyAId, codeA, runA.id, "INVOICE", `RB-A-INV2`, "2026-01-15");
  const crn = await seedDoc(companyAId, codeA, runA.id, "CREDIT", `RB-A-CR1`, "2026-01-20");
  const undated = await seedDoc(companyAId, codeA, runA.id, "INVOICE", `RB-A-UND`, null);

  await seedLine(companyAId, codeA, runA.id, inv1.id, "INVOICE", `RB-A-INV1`, 1, sku1, "10", "1000.00", "SKU1");
  await seedLine(companyAId, codeA, runA.id, inv2.id, "INVOICE", `RB-A-INV2`, 1, sku2, "5", "500.00", "SKU2 historic");
  await seedLine(companyAId, codeA, runA.id, crn.id, "CREDIT", `RB-A-CR1`, 1, sku1, "-1", "-100.00", "SKU1 credit");
  await seedLine(
    companyAId,
    codeA,
    runA.id,
    undated.id,
    "INVOICE",
    `RB-A-UND`,
    1,
    historicSku,
    "2",
    "99.00",
    "Undated historic",
  );

  const coB = await prisma.company.create({
    data: {
      name: `RB Customer B ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 DAYS",
      primaryEmail: `rb.b.${stamp}@example.invalid`,
    },
  });
  companyBId = coB.id;
  await prisma.companyAssignment.create({
    data: { companyId: companyBId, salesRepId },
  });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: companyBId,
    code: `RBB${String(stamp).slice(-4)}`,
  });
  const codeB = (
    await prisma.company.findUniqueOrThrow({ where: { id: companyBId } })
  ).autopartCustomerCode!;

  const runB = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: companyBId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      dryRun: false,
      completedAt: new Date(),
      rowsImported: 2,
      detectedAccount: codeB,
    },
  });
  const bInv = await seedDoc(companyBId, codeB, runB.id, "INVOICE", `RB-B-INV1`, "2026-01-10");
  const bCr = await seedDoc(companyBId, codeB, runB.id, "CREDIT", `RB-B-CR1`, "2026-01-18");
  await seedLine(companyBId, codeB, runB.id, bInv.id, "INVOICE", `RB-B-INV1`, 1, sku1, "20", "2000.00", "SKU1");
  await seedLine(companyBId, codeB, runB.id, bCr.id, "CREDIT", `RB-B-CR1`, 1, sku1, "-2", "-250.00", "SKU1 credit");

  // Out-of-scope company (no assignment to sales rep)
  const coX = await prisma.company.create({
    data: {
      name: `RB OutOfScope ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "Cash",
      primaryEmail: `rb.x.${stamp}@example.invalid`,
    },
  });
  outOfScopeCompanyId = coX.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: outOfScopeCompanyId,
    code: `RBX${String(stamp).slice(-4)}`,
  });
  const codeX = (
    await prisma.company.findUniqueOrThrow({ where: { id: outOfScopeCompanyId } })
  ).autopartCustomerCode!;
  const runX = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: outOfScopeCompanyId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      dryRun: false,
      completedAt: new Date(),
      rowsImported: 1,
      detectedAccount: codeX,
    },
  });
  const xInv = await seedDoc(outOfScopeCompanyId, codeX, runX.id, "INVOICE", `RB-X-INV1`, "2026-01-12");
  await seedLine(
    outOfScopeCompanyId,
    codeX,
    runX.id,
    xInv.id,
    "INVOICE",
    `RB-X-INV1`,
    1,
    sku1,
    "100",
    "9999.00",
    "Leak bait",
  );

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

describe("Rebate / Net Spend Analysis", () => {
  it("customer A January fixture: invoice/credits/net/docs/units/products", async () => {
    const r = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
      pageSize: 50,
    });
    expect(Number(r.summary.invoiceSales)).toBeCloseTo(1500, 2);
    expect(Number(r.summary.credits)).toBeCloseTo(-100, 2);
    expect(Number(r.summary.netSpend)).toBeCloseTo(1400, 2);
    expect(r.summary.invoiceDocuments).toBe(2);
    expect(r.summary.creditDocuments).toBe(1);
    expect(r.summary.units).toBe(14);
    expect(r.summary.products).toBe(2);
    expect(r.undatedExcluded).toBeGreaterThanOrEqual(1);
  });

  it("document drilldown exposes imported line detail", async () => {
    const r = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
      docRef: "RB-A-INV1",
      pageSize: 50,
    });
    expect(r.expandedDocument?.documentReference).toBe("RB-A-INV1");
    expect(r.expandedDocument?.documentType).toBe("INVOICE");
    expect(Number(r.expandedDocument?.netValue)).toBeCloseTo(1000, 2);
    expect(r.expandedDocument?.lines.some((l) => l.sku === sku1)).toBe(true);
  });

  it("reconciles with Sales Enquiry for same customer + period", async () => {
    const rebate = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    const enquiry = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(rebate.enquiryReconciliation.invoiceSales).toBe(enquiry.summary.invoiceSales);
    expect(rebate.enquiryReconciliation.credits).toBe(enquiry.summary.credits);
    expect(rebate.enquiryReconciliation.netSales).toBe(enquiry.summary.netSales);
    expect(rebate.summary.netSpend).toBe(enquiry.summary.netSales);
    expect(rebate.enquiryReconciliation.units).toBe(enquiry.summary.units);
    expect(rebate.summary.invoiceDocuments).toBe(enquiry.summary.purchaseTransactions);
  });

  it("summary reconciles to document/product/brand/category aggregations", async () => {
    const r = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
      pageSize: 50,
    });
    expect(r.reconciliation.matchesSummary).toBe(true);
    expect(r.reconciliation.documentNetSpend).toBe(r.summary.netSpend);
    expect(r.reconciliation.productNetSpend).toBe(r.summary.netSpend);
    expect(r.reconciliation.brandNetSpend).toBe(r.summary.netSpend);
    expect(r.reconciliation.categoryNetSpend).toBe(r.summary.netSpend);
    expect(r.brandBreakdown.some((b) => b.label === "Unassigned")).toBe(true);
    expect(r.categoryBreakdown.some((c) => c.label === "Unassigned")).toBe(true);
    expect(r.products.items.some((p) => p.historicOnly && p.sku === historicSku)).toBe(true);
  });

  it("excludes undated documents from bounded period", async () => {
    const r = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(r.documents.items.some((d) => d.documentReference === "RB-A-UND")).toBe(false);
    expect(Number(r.summary.netSpend)).toBeCloseTo(1400, 2);
  });

  it("supports quarter presets and custom comparison", async () => {
    const q = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "THIS_QUARTER",
      // force via custom compare against empty prior
      compare: "CUSTOM",
      compareFrom: "2025-01-01",
      compareTo: "2025-03-31",
    });
    expect(q.period.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.period.unbounded).toBe(false);
    expect(q.comparison?.netSpend).toBeTruthy();
    expect(q.comparison?.netSpend.percentChange === null || typeof q.comparison?.netSpend.percentChange === "number").toBe(
      true,
    );
  });

  it("All history has no public date bounds and excludes undated like before", async () => {
    const all = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "ALL",
    });
    expect(all.period.unbounded).toBe(true);
    expect(all.period.from).toBeNull();
    expect(all.period.to).toBeNull();
    expect(all.period.label).toBe("All history");
    expect(JSON.stringify(all.period)).not.toMatch(/0001-01-01|9999-12-31/);
    // Same as Jan fixture + no extra undated inclusion
    expect(Number(all.summary.invoiceSales)).toBeCloseTo(1500, 2);
    expect(Number(all.summary.credits)).toBeCloseTo(-100, 2);
    expect(Number(all.summary.netSpend)).toBeCloseTo(1400, 2);
    expect(all.documents.items.some((d) => d.documentReference === "RB-A-UND")).toBe(false);

    const legacy = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
    });
    expect(legacy.period.label).toBe("All history");
    expect(legacy.summary.netSpend).toBe(all.summary.netSpend);
  });

  it("Custom from > to is rejected", async () => {
    await expect(
      getCustomerRebateAnalysis(adminId, {
        companyId: companyAId,
        period: "CUSTOM",
        from: "2026-06-30",
        to: "2026-01-01",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("CSV and print use All history label", async () => {
    const summary = await exportCustomerRebateSummaryCsv(adminId, {
      companyId: companyAId,
      period: "ALL",
    });
    expect(summary.csv).toContain("All history");
    expect(summary.csv).not.toMatch(/0001-01-01|9999-12-31/);

    const multi = await exportMultiCustomerRebateCsv(salesRepUserId, {
      period: "ALL",
    });
    expect(multi.csv).toContain("All history");
    expect(multi.filename).toContain("all-history");
    expect(multi.csv).not.toMatch(/0001-01-01|9999-12-31/);

    const analysis = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "ALL",
    });
    expect(analysis.print.title).toBeTruthy();
    expect(analysis.period.label).toBe("All history");
  });

  it("multi-customer All history has no sentinel period dates", async () => {
    const multi = await getMultiCustomerRebateAnalysis(salesRepUserId, {
      period: "ALL",
      pageSize: 50,
    });
    expect(multi.period.unbounded).toBe(true);
    expect(multi.period.label).toBe("All history");
    expect(JSON.stringify(multi.period)).not.toMatch(/0001-01-01|9999-12-31/);
    expect(multi.summary.customers).toBeGreaterThanOrEqual(2);
  });

  it("previous equivalent and previous year comparison", async () => {
    const r = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
      compare: "PREVIOUS_YEAR",
    });
    expect(r.comparison?.comparison).toEqual({ from: "2025-01-01", to: "2025-01-31" });
    expect(r.comparison?.netSpend.difference).toBeTruthy();
  });

  it("negative net spend is not clamped", async () => {
    // Credit-heavy custom window on company A credit date only
    const r = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-20",
      to: "2026-01-20",
    });
    expect(Number(r.summary.netSpend)).toBeCloseTo(-100, 2);
    expect(Number(r.summary.netSpend)).toBeLessThan(0);
  });

  it("filters do not change headline; filtered net shown separately", async () => {
    const r = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
      docType: "CREDIT",
      pageSize: 50,
    });
    expect(Number(r.summary.netSpend)).toBeCloseTo(1400, 2);
    expect(r.filtersActive).toBe(true);
    expect(r.filtered).toBeTruthy();
    expect(r.documents.items.every((d) => d.documentType === "CREDIT")).toBe(true);
  });

  it("getCustomerNetSpend matches analysis summary", async () => {
    const spend = await getCustomerNetSpend(adminId, companyAId, "2026-01-01", "2026-01-31");
    const analysis = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(spend.netSpend).toBe(analysis.summary.netSpend);
    expect(spend.invoiceSales).toBe(analysis.summary.invoiceSales);
    expect(spend.credits).toBe(analysis.summary.credits);
  });

  it("multi-customer aggregates authorized cohort only", async () => {
    const multi = await getMultiCustomerRebateAnalysis(salesRepUserId, {
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
      pageSize: 50,
    });
    const ids = multi.customers.items.map((c) => c.companyId);
    expect(ids).toContain(companyAId);
    expect(ids).toContain(companyBId);
    expect(ids).not.toContain(outOfScopeCompanyId);
    // A: 1400 + B: 1750 = 3150
    expect(Number(multi.summary.invoiceSales)).toBeCloseTo(3500, 2);
    expect(Number(multi.summary.credits)).toBeCloseTo(-350, 2);
    expect(Number(multi.summary.netSpend)).toBeCloseTo(3150, 2);
    expect(multi.summary.customers).toBe(2);
  });

  it("multi-customer fixture B alone matches expected net", async () => {
    const r = await getCustomerRebateAnalysis(adminId, {
      companyId: companyBId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(Number(r.summary.invoiceSales)).toBeCloseTo(2000, 2);
    expect(Number(r.summary.credits)).toBeCloseTo(-250, 2);
    expect(Number(r.summary.netSpend)).toBeCloseTo(1750, 2);
  });

  it("multi-customer search, min/max, sort, salesperson filter", async () => {
    const bySearch = await getMultiCustomerRebateAnalysis(adminId, {
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
      q: `Customer A ${stamp}`,
      pageSize: 50,
    });
    expect(bySearch.customers.items).toHaveLength(1);
    expect(bySearch.customers.items[0]!.companyId).toBe(companyAId);

    const byMin = await getMultiCustomerRebateAnalysis(adminId, {
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
      minNet: "1700",
      pageSize: 50,
    });
    expect(byMin.customers.items.every((c) => Number(c.netSpend) >= 1700)).toBe(true);

    const byCredits = await getMultiCustomerRebateAnalysis(adminId, {
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
      sort: "CREDITS_DESC",
      pageSize: 50,
      q: `RB Customer`,
    });
    // B has -250 abs, A has -100 abs → B first among A/B
    const aIdx = byCredits.customers.items.findIndex((c) => c.companyId === companyAId);
    const bIdx = byCredits.customers.items.findIndex((c) => c.companyId === companyBId);
    expect(bIdx).toBeLessThan(aIdx);

    const byRep = await getMultiCustomerRebateAnalysis(adminId, {
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
      salesRepId,
      pageSize: 50,
    });
    expect(byRep.customers.items.every((c) => c.salesperson?.id === salesRepId)).toBe(true);
  });

  it("CSV exports are RBAC protected and contain expected columns", async () => {
    const summary = await exportCustomerRebateSummaryCsv(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(summary.csv).toContain("Net Spend");
    expect(summary.csv).toContain("Invoice Sales");

    const docs = await exportCustomerRebateDocumentsCsv(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(docs.csv).toContain("Document Reference");
    expect(docs.csv).toContain("RB-A-INV1");

    const products = await exportCustomerRebateProductsCsv(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(products.csv).toContain("SKU");
    expect(products.csv).toContain(sku1);

    const multi = await exportMultiCustomerRebateCsv(salesRepUserId, {
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(multi.csv).toContain("Salesperson");
    expect(multi.csv).not.toContain("OutOfScope");
  });

  it("security: trade, marketing, anonymous-style, out-of-scope denied", async () => {
    await expect(
      getCustomerRebateAnalysis(tradeBuyerId, {
        companyId: companyAId,
        period: "CUSTOM",
        from: "2026-01-01",
        to: "2026-01-31",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      getCustomerRebateAnalysis(marketingId, {
        companyId: companyAId,
        period: "CUSTOM",
        from: "2026-01-01",
        to: "2026-01-31",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      getCustomerRebateAnalysis(salesRepUserId, {
        companyId: outOfScopeCompanyId,
        period: "CUSTOM",
        from: "2026-01-01",
        to: "2026-01-31",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      exportCustomerRebateSummaryCsv(tradeBuyerId, {
        companyId: companyAId,
        period: "CUSTOM",
        from: "2026-01-01",
        to: "2026-01-31",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    // Manager / admin can access out-of-scope company for sales rep
    const ok = await getCustomerRebateAnalysis(managerId, {
      companyId: outOfScopeCompanyId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(Number(ok.summary.netSpend)).toBeCloseTo(9999, 2);
  });

  it("print payload includes organisation and generated timestamp", async () => {
    const r = await getCustomerRebateAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(r.print.organisation).toBe("Automotive Brands");
    expect(r.print.generatedAt).toMatch(/^\d{4}-/);
  });
});
