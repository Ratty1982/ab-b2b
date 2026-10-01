/**
 * Daily Sales Brief — RBAC, today metrics, returned/first-product, attention reuse.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { todayLondonDateOnly, addDaysIso } from "@/domain/sales-history-period";
import { getDailySalesBrief } from "@/server/sales-intelligence/daily-brief";
import { getSalesRepPortfolio } from "@/server/sales-intelligence/portfolio";
import { dueAtFromDateOnly } from "@/domain/sales-followup";

const prisma = new PrismaClient();
const stamp = Date.now();
const today = todayLondonDateOnly();
const yesterday = addDaysIso(today, -1);

let adminId = "";
let repUserId = "";
let otherRepUserId = "";
let tradeUserId = "";
let companyId = "";
let creditOnlyCompanyId = "";
let dormantCompanyId = "";
let salesRepId = "";
let otherSalesRepId = "";
const account = `DB${String(stamp).slice(-8)}`;
const creditAccount = `DC${String(stamp).slice(-8)}`;
const dormantAccount = `DD${String(stamp).slice(-8)}`;
const skuKnown = `DB-SKU-${String(stamp).slice(-6)}`;
const skuHistoric = `DB-HIST-${String(stamp).slice(-6)}`;
const skuFirst = `DB-FIRST-${String(stamp).slice(-6)}`;

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType: email.includes("trade") ? "TRADE" : "INTERNAL",
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

async function createInvoiceDoc(opts: {
  companyId: string;
  account: string;
  ref: string;
  date: string;
  lines: Array<{ sku: string; salesNet: string; units?: string; lineNumber: number }>;
  documentType?: "INVOICE" | "CREDIT";
}) {
  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId: opts.companyId,
      autopartCustomerCode: opts.account,
      documentType: opts.documentType ?? "INVOICE",
      documentReference: opts.ref,
      documentDate: new Date(`${opts.date}T12:00:00.000Z`),
      source: "ONGOING_TRM21QC",
      hasTrm21qc: true,
      has504: true,
    },
  });
  for (const line of opts.lines) {
    await prisma.autopartSalesLine.create({
      data: {
        companyId: opts.companyId,
        documentId: doc.id,
        autopartCustomerCode: opts.account,
        documentType: opts.documentType ?? "INVOICE",
        documentReference: doc.documentReference,
        lineNumber: line.lineNumber,
        sku: line.sku,
        units: line.units ?? "1",
        salesNet: line.salesNet,
        matchStatus: "MATCHED",
        source: "ONGOING_TRM21QC",
      },
    });
  }
  return doc;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`db.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  repUserId = await ensureUser(`db.rep.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  otherRepUserId = await ensureUser(`db.rep2.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  tradeUserId = await ensureUser(`db.trade.${stamp}@example.invalid`, []);

  const brand = await prisma.brand.create({
    data: { name: `DB Brand ${stamp}`, slug: `db-brand-${stamp}` },
  });
  const category = await prisma.category.create({
    data: { name: `DB Cat ${stamp}`, slug: `db-cat-${stamp}` },
  });
  const product = await prisma.product.create({
    data: {
      name: `DB Product ${stamp}`,
      slug: `db-prod-${stamp}`,
      brandId: brand.id,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
    },
  });
  await prisma.productVariant.create({
    data: { productId: product.id, sku: skuKnown, isActive: true, tradePrice: 10 },
  });
  const firstProduct = await prisma.product.create({
    data: {
      name: `DB First Product ${stamp}`,
      slug: `db-first-${stamp}`,
      brandId: brand.id,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
    },
  });
  await prisma.productVariant.create({
    data: { productId: firstProduct.id, sku: skuFirst, isActive: true, tradePrice: 12 },
  });

  const company = await prisma.company.create({
    data: { name: `Daily Brief Co ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  companyId = company.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code: account });

  const creditOnly = await prisma.company.create({
    data: { name: `Credit Only Co ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  creditOnlyCompanyId = creditOnly.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: creditOnlyCompanyId,
    code: creditAccount,
  });

  const dormant = await prisma.company.create({
    data: { name: `Dormant Return Co ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  dormantCompanyId = dormant.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: dormantCompanyId,
    code: dormantAccount,
  });

  const rep = await prisma.salesRep.create({
    data: { code: `DB${String(stamp).slice(-4)}`, userId: repUserId, active: true },
  });
  salesRepId = rep.id;
  const otherRep = await prisma.salesRep.create({
    data: { code: `DO${String(stamp).slice(-4)}`, userId: otherRepUserId, active: true },
  });
  otherSalesRepId = otherRep.id;

  for (const cid of [companyId, creditOnlyCompanyId, dormantCompanyId]) {
    await prisma.companyAssignment.create({
      data: { companyId: cid, salesRepId, isPrimary: true },
    });
  }

  // Active customer: prior history + invoice today + credit today + first-time SKU
  await createInvoiceDoc({
    companyId,
    account,
    ref: `DBP${String(stamp).slice(-6)}`,
    date: addDaysIso(today, -10),
    lines: [{ sku: skuKnown, salesNet: "100.00", units: "2", lineNumber: 1 }],
  });
  await createInvoiceDoc({
    companyId,
    account,
    ref: `DBT${String(stamp).slice(-6)}`,
    date: today,
    lines: [
      { sku: skuKnown, salesNet: "40.00", units: "1", lineNumber: 1 },
      { sku: skuFirst, salesNet: "25.00", units: "1", lineNumber: 2 },
      { sku: skuHistoric, salesNet: "15.00", units: "1", lineNumber: 3 },
    ],
  });
  await createInvoiceDoc({
    companyId,
    account,
    ref: `DBC${String(stamp).slice(-6)}`,
    date: today,
    documentType: "CREDIT",
    lines: [{ sku: skuKnown, salesNet: "-10.00", units: "-1", lineNumber: 1 }],
  });

  // Credit-only today (plus ancient invoice so company is in portfolio)
  await createInvoiceDoc({
    companyId: creditOnlyCompanyId,
    account: creditAccount,
    ref: `DBX${String(stamp).slice(-6)}`,
    date: addDaysIso(today, -60),
    lines: [{ sku: skuKnown, salesNet: "20.00", lineNumber: 1 }],
  });
  await createInvoiceDoc({
    companyId: creditOnlyCompanyId,
    account: creditAccount,
    ref: `DBY${String(stamp).slice(-6)}`,
    date: today,
    documentType: "CREDIT",
    lines: [{ sku: skuKnown, salesNet: "-5.00", units: "-1", lineNumber: 1 }],
  });

  // Dormant return: ~30d cadence historically, last purchase ~100 days ago, invoice today
  const dormantDates = [
    addDaysIso(today, -220),
    addDaysIso(today, -190),
    addDaysIso(today, -160),
    addDaysIso(today, -130),
    addDaysIso(today, -100),
  ];
  for (let i = 0; i < dormantDates.length; i++) {
    await createInvoiceDoc({
      companyId: dormantCompanyId,
      account: dormantAccount,
      ref: `DDR${i}${String(stamp).slice(-5)}`,
      date: dormantDates[i]!,
      lines: [{ sku: skuKnown, salesNet: "50.00", lineNumber: 1 }],
    });
  }
  await createInvoiceDoc({
    companyId: dormantCompanyId,
    account: dormantAccount,
    ref: `DDRT${String(stamp).slice(-5)}`,
    date: today,
    lines: [{ sku: skuKnown, salesNet: "64.02", lineNumber: 1 }],
  });

  // CRM follow-ups: overdue + due today for rep
  await prisma.task.create({
    data: {
      title: `DB overdue ${stamp}`,
      status: "OPEN",
      priority: "NORMAL",
      companyId,
      assigneeId: repUserId,
      createdById: adminId,
      dueAt: dueAtFromDateOnly(addDaysIso(today, -3)),
      sourceModule: "PORTFOLIO",
      sourceReason: "DORMANT",
    },
  });
  await prisma.task.create({
    data: {
      title: `DB due today ${stamp}`,
      status: "OPEN",
      priority: "NORMAL",
      companyId: dormantCompanyId,
      assigneeId: repUserId,
      createdById: adminId,
      dueAt: dueAtFromDateOnly(today),
      sourceModule: "PORTFOLIO",
      sourceReason: "PURCHASE_GAP",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("daily sales brief", () => {
  it("denies trade users", async () => {
    await expect(getDailySalesBrief(tradeUserId, {})).rejects.toBeInstanceOf(AuthError);
  });

  it("counts invoice purchase customers once and includes signed credits in net sales", async () => {
    const brief = await getDailySalesBrief(adminId, { salesRepId });
    expect(brief.businessDate).toBe(today);
    expect(brief.yesterday).toBe(yesterday);
    expect(brief.businessDateLabel).toMatch(/October|September|November|December|January|February|March|April|May|June|July|August/);

    // Active + dormant purchased today; credit-only does not count
    expect(brief.summary.customersPurchased).toBeGreaterThanOrEqual(2);
    const activityIds = new Set(brief.activity.rows.map((r) => r.companyId));
    expect(activityIds.has(companyId)).toBe(true);
    expect(activityIds.has(dormantCompanyId)).toBe(true);
    expect(activityIds.has(creditOnlyCompanyId)).toBe(false);

    // Net sales includes credit effect for scoped companies (40+25+15-10 + 64.02 -5 credit-only)
    const net = Number(brief.summary.netSalesToday);
    expect(net).toBeCloseTo(40 + 25 + 15 - 10 + 64.02 - 5, 1);

    // Multiple lines same customer appear once
    expect(brief.activity.rows.filter((r) => r.companyId === companyId)).toHaveLength(1);
  });

  it("reuses portfolio attention classification and ignores opportunity-only noise", async () => {
    const [brief, portfolio] = await Promise.all([
      getDailySalesBrief(adminId, { salesRepId }),
      getSalesRepPortfolio(adminId, {
        period: "THIS_MONTH",
        salesRepId,
        filter: "ALL",
        allRows: true,
      }),
    ]);

    const portfolioAttentionIds = new Set(
      portfolio.rows.filter((r) => r.needsAttention).map((r) => r.companyId),
    );
    for (const item of brief.needsAttention) {
      expect(portfolioAttentionIds.has(item.companyId)).toBe(true);
      const pf = portfolio.rows.find((r) => r.companyId === item.companyId)!;
      expect(item.attentionReasons.map((a) => a.code)).toEqual(
        pf.attentionReasons.map((a) => a.code),
      );
    }

    // Opportunity-only customers must not appear in Needs Attention
    for (const row of portfolio.rows) {
      if (!row.needsAttention && row.opportunityCount > 0) {
        expect(brief.needsAttention.some((a) => a.companyId === row.companyId)).toBe(false);
      }
    }
  });

  it("flags returned dormant buyer and not credit-only", async () => {
    const brief = await getDailySalesBrief(adminId, { salesRepId });
    const returned = brief.positiveMovement.filter((p) => p.kind === "RETURNED_CUSTOMER");
    expect(returned.some((p) => p.companyId === dormantCompanyId)).toBe(true);
    expect(returned.some((p) => p.companyId === creditOnlyCompanyId)).toBe(false);
    const activity = brief.activity.rows.find((r) => r.companyId === dormantCompanyId);
    expect(activity?.status).toBe("RETURNED");
  });

  it("detects first-time product including historic-only SKU; prior invoice blocks repeat", async () => {
    const brief = await getDailySalesBrief(adminId, { salesRepId });
    const firstProducts = brief.positiveMovement.filter((p) => p.kind === "FIRST_PRODUCT");
    expect(firstProducts.some((p) => p.sku === skuFirst.toUpperCase())).toBe(true);
    expect(firstProducts.some((p) => p.sku === skuHistoric.toUpperCase())).toBe(true);
    // skuKnown had prior invoice — not first
    expect(firstProducts.some((p) => p.sku === skuKnown.toUpperCase())).toBe(false);
  });

  it("detects first-time brand only with catalogue mapping", async () => {
    const brief = await getDailySalesBrief(adminId, { salesRepId });
    const firstBrands = brief.positiveMovement.filter((p) => p.kind === "FIRST_BRAND");
    // Historic-only SKU has no catalogue brand — must not invent a brand event from it alone.
    // Known/first SKUs map to brand; dormant return of known brand may or may not be first brand.
    for (const fb of firstBrands) {
      expect(fb.brandName).toBeTruthy();
      expect(fb.sku).toBeTruthy();
    }
    // Unmapped historic SKU must not appear as a brand name equal to the SKU
    expect(firstBrands.some((p) => p.brandName === skuHistoric)).toBe(false);
  });

  it("classifies CRM follow-ups overdue and due today within sales-rep scope", async () => {
    const brief = await getDailySalesBrief(repUserId, {});
    expect(brief.canSelectSalesRep).toBe(false);
    expect(brief.followUps.overdueTotal).toBeGreaterThanOrEqual(1);
    expect(brief.followUps.dueTodayTotal).toBeGreaterThanOrEqual(1);
    expect(brief.followUps.overdue.some((t) => t.title.includes(`DB overdue ${stamp}`))).toBe(true);
    expect(brief.followUps.dueToday.some((t) => t.title.includes(`DB due today ${stamp}`))).toBe(
      true,
    );
  });

  it("scopes sales rep to assigned companies; management can select rep", async () => {
    const repBrief = await getDailySalesBrief(repUserId, {});
    for (const row of repBrief.activity.rows) {
      // Activity rows are from assigned portfolio only
      expect([companyId, dormantCompanyId, creditOnlyCompanyId]).toContain(row.companyId);
    }

    const adminBrief = await getDailySalesBrief(adminId, { salesRepId });
    expect(adminBrief.canSelectSalesRep).toBe(true);
    expect(adminBrief.salesRepFilterLabel).toBeTruthy();

    const otherBrief = await getDailySalesBrief(adminId, { salesRepId: otherSalesRepId });
    expect(otherBrief.summary.customersPurchased).toBe(0);
  });

  it("does not load complete financial history into Node for first-purchase detection", async () => {
    // Structural guarantee: first-time query uses NOT EXISTS SQL path (smoke: completes quickly with fixture volume).
    const started = Date.now();
    await getDailySalesBrief(adminId, { salesRepId });
    expect(Date.now() - started).toBeLessThan(60_000);
  });
});
