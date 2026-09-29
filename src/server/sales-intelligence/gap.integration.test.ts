/**
 * Sales Intelligence — Gap Analysis integration + reconciliation coverage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { getCustomerSalesEnquiry, getProductSalesEnquiry } from "@/server/sales-intelligence/enquiry";
import {
  exportCustomerGapCsv,
  exportProductGapCsv,
  getCustomerGapAnalysis,
  getProductGapAnalysis,
} from "@/server/sales-intelligence/gap";

const prisma = new PrismaClient();
const stamp = Date.now();

let adminId = "";
let managerId = "";
let salesRepUserId = "";
let marketingId = "";
let tradeBuyerId = "";
let companyAId = "";
let companyBId = "";
let companyCId = "";
let brandPowerId = "";
let catCleanId = "";
let salesRepId = "";
let otherRepId = "";

const sku1 = `GAP-SKU1-${stamp}`;
const sku2 = `GAP-SKU2-${stamp}`;
const sku3 = `GAP-SKU3-${stamp}`;
const sku4 = `GAP-SKU4-${stamp}`;
const sku5 = `GAP-SKU5-${stamp}`;
const sku6 = `GAP-SKU6-${stamp}`;
const skuHist = `GAP-HIST-${stamp}`;

const SELECTED = { from: "2026-03-01", to: "2026-03-31" } as const;
const COMPARISON = { from: "2025-06-01", to: "2025-06-30" } as const;

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

async function ensureCatalogueSku(sku: string, name: string) {
  const existing = await prisma.productVariant.findUnique({ where: { sku } });
  if (!existing) {
    await saveProduct(adminId, {
      sku,
      name,
      brand: `Gap Brand ${stamp}`,
      category: `Gap Cat ${stamp}`,
      trade: 5,
      rrp: 10,
      packQty: 1,
      caseQty: 12,
      description: name,
      active: true,
    });
  }
  const v = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });
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
}

async function createCompany(name: string, email: string) {
  return prisma.company.create({
    data: {
      name,
      status: "ACTIVE",
      paymentTerms: "30 days",
      primaryEmail: email,
    },
  });
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
  adminId = await ensureUser(`gap.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  managerId = await ensureUser(`gap.mgr.${stamp}@example.invalid`, ["SALES_MANAGER"]);
  salesRepUserId = await ensureUser(`gap.rep.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  marketingId = await ensureUser(`gap.mkt.${stamp}@example.invalid`, ["MARKETING"]);
  tradeBuyerId = await ensureUser(`gap.buyer.${stamp}@example.invalid`, [], "TRADE");

  const brand = await prisma.brand.create({
    data: { name: `Gap Power ${stamp}`, slug: `gap-power-${stamp}` },
  });
  brandPowerId = brand.id;
  const cat = await prisma.category.create({
    data: { name: `Gap Clean ${stamp}`, slug: `gap-clean-${stamp}` },
  });
  catCleanId = cat.id;

  await ensureCatalogueSku(sku1, "Gap Stopped Cleaner");
  await ensureCatalogueSku(sku2, "Gap Decreased Cleaner");
  await ensureCatalogueSku(sku3, "Gap Increased Cleaner");
  await ensureCatalogueSku(sku4, "Gap New Cleaner");
  await ensureCatalogueSku(sku5, "Gap Unchanged Cleaner");
  await ensureCatalogueSku(sku6, "Gap Credit-Only Selected");

  let rep = await prisma.salesRep.findFirst({ where: { userId: salesRepUserId } });
  if (!rep) {
    rep = await prisma.salesRep.create({
      data: {
        userId: salesRepUserId,
        code: `GAP-REP-${stamp}`,
        displayName: "Gap Own Rep",
        active: true,
      },
    });
  }
  salesRepId = rep.id;

  let other = await prisma.salesRep.findFirst({ where: { userId: managerId } });
  if (!other) {
    other = await prisma.salesRep.create({
      data: {
        userId: managerId,
        code: `GAP-MGR-${stamp}`,
        displayName: "Gap Manager Rep",
        active: true,
      },
    });
  }
  otherRepId = other.id;

  const coA = await createCompany(`Gap Customer Alpha ${stamp}`, `gap.alpha.${stamp}@example.invalid`);
  companyAId = coA.id;
  await prisma.companyAssignment.create({
    data: { companyId: companyAId, salesRepId },
  });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: companyAId,
    code: `GAPA${String(stamp).slice(-4)}`,
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
      completedAt: new Date("2026-06-15T12:00:00.000Z"),
      rowsImported: 1,
      detectedAccount: codeA,
    },
  });

  // Comparison period invoices (June 2025)
  const cmpInv = await seedDoc(companyAId, codeA, runA.id, "INVOICE", `GAP-${codeA}-C1`, "2025-06-10");
  await seedLine(companyAId, codeA, runA.id, cmpInv.id, "INVOICE", `GAP-${codeA}-C1`, 1, sku1, "20", "200.00", "Stopped");
  await seedLine(companyAId, codeA, runA.id, cmpInv.id, "INVOICE", `GAP-${codeA}-C1`, 2, sku2, "20", "200.00", "Decreased");
  await seedLine(companyAId, codeA, runA.id, cmpInv.id, "INVOICE", `GAP-${codeA}-C1`, 3, sku3, "10", "100.00", "Increased");
  await seedLine(companyAId, codeA, runA.id, cmpInv.id, "INVOICE", `GAP-${codeA}-C1`, 4, sku5, "10", "100.00", "Unchanged");
  await seedLine(companyAId, codeA, runA.id, cmpInv.id, "INVOICE", `GAP-${codeA}-C1`, 5, sku6, "10", "100.00", "Credit stop");
  await seedLine(companyAId, codeA, runA.id, cmpInv.id, "INVOICE", `GAP-${codeA}-C1`, 6, skuHist, "7", "70.00", "Historic only");

  // Selected period (March 2026)
  const selInv = await seedDoc(companyAId, codeA, runA.id, "INVOICE", `GAP-${codeA}-S1`, "2026-03-14");
  await seedLine(companyAId, codeA, runA.id, selInv.id, "INVOICE", `GAP-${codeA}-S1`, 1, sku2, "10", "100.00", "Decreased");
  await seedLine(companyAId, codeA, runA.id, selInv.id, "INVOICE", `GAP-${codeA}-S1`, 2, sku3, "20", "200.00", "Increased");
  await seedLine(companyAId, codeA, runA.id, selInv.id, "INVOICE", `GAP-${codeA}-S1`, 3, sku4, "12", "120.00", "New");
  await seedLine(companyAId, codeA, runA.id, selInv.id, "INVOICE", `GAP-${codeA}-S1`, 4, sku5, "10", "100.00", "Unchanged");

  // SKU6 selected: credit only (no invoice) → STOPPED with negative selected net
  const selCr = await seedDoc(companyAId, codeA, runA.id, "CREDIT", `GAP-${codeA}-SC1`, "2026-03-20");
  await seedLine(companyAId, codeA, runA.id, selCr.id, "CREDIT", `GAP-${codeA}-SC1`, 1, sku6, "-2", "-20.00", "Credit stop");

  // Undated invoice must not appear in bounded periods
  const undated = await seedDoc(companyAId, codeA, runA.id, "INVOICE", `GAP-${codeA}-U`, null);
  await seedLine(companyAId, codeA, runA.id, undated.id, "INVOICE", `GAP-${codeA}-U`, 1, sku1, "99", "999.00", "Undated");

  // Company B — product gap counterpart (assigned to other rep)
  const coB = await createCompany(`Gap Customer Beta ${stamp}`, `gap.beta.${stamp}@example.invalid`);
  companyBId = coB.id;
  await prisma.companyAssignment.create({
    data: { companyId: companyBId, salesRepId: otherRepId },
  });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: companyBId,
    code: `GAPB${String(stamp).slice(-4)}`,
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
      rowsImported: 1,
      detectedAccount: codeB,
    },
  });
  const bCmp = await seedDoc(companyBId, codeB, runB.id, "INVOICE", `GAP-${codeB}-C1`, "2025-06-12");
  await seedLine(companyBId, codeB, runB.id, bCmp.id, "INVOICE", `GAP-${codeB}-C1`, 1, sku2, "15", "150.00", "Decreased");
  const bSel = await seedDoc(companyBId, codeB, runB.id, "INVOICE", `GAP-${codeB}-S1`, "2026-03-08");
  await seedLine(companyBId, codeB, runB.id, bSel.id, "INVOICE", `GAP-${codeB}-S1`, 1, sku2, "5", "50.00", "Decreased");

  // Company C — new buyer of sku2 in selected only (same own-rep as A for scope tests)
  const coC = await createCompany(`Gap Customer Gamma ${stamp}`, `gap.gamma.${stamp}@example.invalid`);
  companyCId = coC.id;
  await prisma.companyAssignment.create({
    data: { companyId: companyCId, salesRepId },
  });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: companyCId,
    code: `GAPC${String(stamp).slice(-4)}`,
  });
  const codeC = (
    await prisma.company.findUniqueOrThrow({ where: { id: companyCId } })
  ).autopartCustomerCode!;
  const runC = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: companyCId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      dryRun: false,
      completedAt: new Date(),
      rowsImported: 1,
      detectedAccount: codeC,
    },
  });
  const cSel = await seedDoc(companyCId, codeC, runC.id, "INVOICE", `GAP-${codeC}-S1`, "2026-03-18");
  await seedLine(companyCId, codeC, runC.id, cSel.id, "INVOICE", `GAP-${codeC}-S1`, 1, sku2, "8", "80.00", "New buyer");

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

describe("Sales Intelligence Gap Analysis", () => {
  it("classifies customer SKU gaps: stopped/decreased/increased/new/unchanged/credit-stopped", async () => {
    const r = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      status: "UNCHANGED",
      pageSize: 100,
    });
    expect(r.statusCounts.stopped).toBe(3); // sku1, sku6, skuHist
    expect(r.statusCounts.decreased).toBe(1);
    expect(r.statusCounts.increased).toBe(1);
    expect(r.statusCounts.new).toBe(1);
    expect(r.statusCounts.unchanged).toBe(1);

    const all = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      status: "ALL_CHANGES",
      pageSize: 100,
    });
    // ALL_CHANGES excludes UNCHANGED
    expect(all.items.items.some((i) => i.status === "UNCHANGED")).toBe(false);
    expect(all.items.total).toBe(
      r.statusCounts.stopped + r.statusCounts.decreased + r.statusCounts.increased + r.statusCounts.new,
    );

    const bySku = Object.fromEntries(
      (
        await getCustomerGapAnalysis(adminId, {
          companyId: companyAId,
          period: "CUSTOM",
          from: SELECTED.from,
          to: SELECTED.to,
          compare: "CUSTOM",
          compareFrom: COMPARISON.from,
          compareTo: COMPARISON.to,
          status: "UNCHANGED",
          pageSize: 100,
        })
      ).items.items
        .concat(
          (
            await getCustomerGapAnalysis(adminId, {
              companyId: companyAId,
              period: "CUSTOM",
              from: SELECTED.from,
              to: SELECTED.to,
              compare: "CUSTOM",
              compareFrom: COMPARISON.from,
              compareTo: COMPARISON.to,
              status: "ALL_CHANGES",
              pageSize: 100,
            })
          ).items.items,
        )
        .map((i) => [i.sku.toUpperCase(), i]),
    );

    expect(bySku[sku1.toUpperCase()]!.status).toBe("STOPPED");
    expect(bySku[sku1.toUpperCase()]!.lastPurchasedDate).toBe("2025-06-10");
    expect(bySku[sku2.toUpperCase()]!.status).toBe("DECREASED");
    expect(bySku[sku3.toUpperCase()]!.status).toBe("INCREASED");
    expect(bySku[sku4.toUpperCase()]!.status).toBe("NEW");
    expect(bySku[sku5.toUpperCase()]!.status).toBe("UNCHANGED");
    expect(bySku[sku6.toUpperCase()]!.status).toBe("STOPPED");
    expect(Number(bySku[sku6.toUpperCase()]!.selectedNetSales)).toBeCloseTo(-20, 2);
    expect(bySku[sku6.toUpperCase()]!.selectedQty).toBe(0);
    expect(bySku[skuHist.toUpperCase()]!.status).toBe("STOPPED");
    expect(bySku[skuHist.toUpperCase()]!.inCatalogue).toBe(false);
    expect(bySku[skuHist.toUpperCase()]!.availabilityLabel).toBe("Historic Only");
  });

  it("reconciles overall totals with Sales Enquiry for the same customer/period", async () => {
    const gap = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
    });
    const enquirySel = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
    });
    const enquiryCmp = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: COMPARISON.from,
      to: COMPARISON.to,
    });

    expect(gap.overall.selected.invoiceSales).toBe(enquirySel.summary.invoiceSales);
    expect(gap.overall.selected.credits).toBe(enquirySel.summary.credits);
    expect(gap.overall.selected.netSales).toBe(enquirySel.summary.netSales);
    expect(gap.overall.selected.units).toBe(enquirySel.summary.units);
    expect(gap.overall.selected.purchaseTransactions).toBe(enquirySel.summary.purchaseTransactions);

    expect(gap.overall.comparison.invoiceSales).toBe(enquiryCmp.summary.invoiceSales);
    expect(gap.overall.comparison.credits).toBe(enquiryCmp.summary.credits);
    expect(gap.overall.comparison.netSales).toBe(enquiryCmp.summary.netSales);
    expect(gap.overall.comparison.units).toBe(enquiryCmp.summary.units);
  });

  it("product gap classifies customers and reconciles with product enquiry", async () => {
    const gap = await getProductGapAnalysis(adminId, {
      sku: sku2,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      status: "ALL_CHANGES",
      pageSize: 100,
    });
    expect(gap.statusCounts.decreased).toBe(2); // A and B
    expect(gap.statusCounts.new).toBe(1); // C
    const byCo = Object.fromEntries(gap.items.items.map((i) => [i.companyId, i]));
    expect(byCo[companyAId]!.status).toBe("DECREASED");
    expect(byCo[companyBId]!.status).toBe("DECREASED");
    expect(byCo[companyCId]!.status).toBe("NEW");

    const enquirySel = await getProductSalesEnquiry(adminId, {
      sku: sku2,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
    });
    const enquiryCmp = await getProductSalesEnquiry(adminId, {
      sku: sku2,
      period: "CUSTOM",
      from: COMPARISON.from,
      to: COMPARISON.to,
    });
    expect(gap.overall.selected.netSales).toBe(enquirySel.summary.netSales);
    expect(gap.overall.selected.units).toBe(enquirySel.summary.units);
    expect(gap.overall.selected.customers).toBe(enquirySel.summary.customers);
    expect(gap.overall.comparison.netSales).toBe(enquiryCmp.summary.netSales);
    expect(gap.overall.comparison.units).toBe(enquiryCmp.summary.units);
    expect(gap.overall.comparison.customers).toBe(enquiryCmp.summary.customers);
  });

  it("filters by brand, category, status, search; sorts by net decrease", async () => {
    const brandFiltered = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      brandId: brandPowerId,
      status: "ALL_CHANGES",
      pageSize: 100,
    });
    expect(brandFiltered.items.items.every((i) => i.brandId === brandPowerId || !i.inCatalogue)).toBe(
      true,
    );
    // Historic-only has no brandId — brand filter excludes it
    expect(brandFiltered.items.items.every((i) => i.brandId === brandPowerId)).toBe(true);

    const stopped = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      status: "STOPPED",
      pageSize: 100,
    });
    expect(stopped.items.items.every((i) => i.status === "STOPPED")).toBe(true);

    const search = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      q: "SKU2",
      status: "ALL_CHANGES",
      pageSize: 100,
    });
    expect(search.items.items).toHaveLength(1);
    expect(search.items.items[0]!.sku.toUpperCase()).toBe(sku2.toUpperCase());

    const sorted = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      status: "ALL_CHANGES",
      sort: "NET_DECREASE",
      pageSize: 100,
    });
    const nets = sorted.items.items.map((i) => Number(i.netChange));
    for (let i = 1; i < nets.length; i++) {
      expect(nets[i]!).toBeGreaterThanOrEqual(nets[i - 1]!);
    }
  });

  it("same period previous year and previous equivalent resolve correctly", async () => {
    const prevYear = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-06-30",
      compare: "PREVIOUS_YEAR",
    });
    expect(prevYear.selectedPeriod).toEqual({ from: "2026-01-01", to: "2026-06-30" });
    expect(prevYear.comparisonPeriod).toEqual({ from: "2025-01-01", to: "2025-06-30" });

    const previous = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-01-01",
      to: "2026-06-30",
      compare: "PREVIOUS",
    });
    expect(previous.comparisonPeriod).toEqual({ from: "2025-07-04", to: "2025-12-31" });
  });

  it("exports customer and product CSV for full filtered set", async () => {
    const cust = await exportCustomerGapCsv(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      status: "ALL_CHANGES",
    });
    expect(cust.csv).toContain("Status");
    expect(cust.csv).toContain(sku1);
    expect(cust.csv).toContain("STOPPED");
    expect(cust.csv).toContain(SELECTED.from);

    const prod = await exportProductGapCsv(adminId, {
      sku: sku2,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
    });
    expect(prod.csv).toContain("Salesperson");
    expect(prod.csv).toContain(sku2);
  });

  it("denies trade/marketing; enforces sales assignment scope", async () => {
    await expect(
      getCustomerGapAnalysis(tradeBuyerId, {
        companyId: companyAId,
        period: "LAST_30",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      getCustomerGapAnalysis(marketingId, {
        companyId: companyAId,
        period: "LAST_30",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      exportCustomerGapCsv(tradeBuyerId, {
        companyId: companyAId,
        period: "LAST_30",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    // Own-rep can analyse assigned company A
    const own = await getCustomerGapAnalysis(salesRepUserId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
    });
    expect(own.statusCounts.stopped).toBeGreaterThan(0);

    // Own-rep cannot analyse company B (other rep)
    await expect(
      getCustomerGapAnalysis(salesRepUserId, {
        companyId: companyBId,
        period: "CUSTOM",
        from: SELECTED.from,
        to: SELECTED.to,
        compare: "CUSTOM",
        compareFrom: COMPARISON.from,
        compareTo: COMPARISON.to,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    // Product gap for own-rep must not leak company B figures
    const scopedProduct = await getProductGapAnalysis(salesRepUserId, {
      sku: sku2,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      status: "ALL_CHANGES",
      pageSize: 100,
    });
    expect(scopedProduct.items.items.some((i) => i.companyId === companyBId)).toBe(false);
    expect(scopedProduct.items.items.some((i) => i.companyId === companyAId)).toBe(true);
    expect(scopedProduct.items.items.some((i) => i.companyId === companyCId)).toBe(true);
    // Scoped totals must match enquiry under same actor scope
    const scopedEnquiry = await getProductSalesEnquiry(salesRepUserId, {
      sku: sku2,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
    });
    expect(scopedProduct.overall.selected.netSales).toBe(scopedEnquiry.summary.netSales);
    expect(scopedProduct.overall.selected.customers).toBe(scopedEnquiry.summary.customers);

    const managerOk = await getCustomerGapAnalysis(managerId, {
      companyId: companyBId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
    });
    expect(managerOk.company.id).toBe(companyBId);
  });

  it("salesperson filter on product gap", async () => {
    const r = await getProductGapAnalysis(adminId, {
      sku: sku2,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      salesRepId,
      status: "ALL_CHANGES",
      pageSize: 100,
    });
    expect(r.items.items.every((i) => i.salespersonId === salesRepId)).toBe(true);
    expect(r.items.items.some((i) => i.companyId === companyBId)).toBe(false);
  });

  it("pagination keeps full summary counts", async () => {
    const page1 = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      status: "ALL_CHANGES",
      page: 1,
      pageSize: 2,
    });
    expect(page1.items.items).toHaveLength(2);
    expect(page1.items.total).toBeGreaterThan(2);
    expect(page1.statusCounts.stopped + page1.statusCounts.decreased).toBeGreaterThan(2);
  });

  it("zero comparison percent is null; negative nets preserved", async () => {
    // Company C has selected activity for sku2 but no comparison → NEW; use sku4 on A for NEW with 0 comparison
    const r = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: "2024-01-01",
      compareTo: "2024-01-31",
      status: "ALL_CHANGES",
    });
    expect(r.overall.netSales.percentChange).toBeNull();
    expect(Number(r.overall.comparison.netSales)).toBe(0);

    const creditStop = await getCustomerGapAnalysis(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: "2026-03-15",
      to: "2026-03-25",
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      status: "STOPPED",
      pageSize: 100,
    });
    const sku6Row = creditStop.items.items.find((i) => i.sku.toUpperCase() === sku6.toUpperCase());
    expect(sku6Row).toBeTruthy();
    expect(Number(sku6Row!.selectedNetSales)).toBeLessThan(0);
  });
});
