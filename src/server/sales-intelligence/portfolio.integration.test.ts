/**
 * Sales Rep Portfolio — ACTIVE-only eligibility, account class, RBAC, KPI/CSV.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type CompanyStatus } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import {
  exportSalesRepPortfolioCsv,
  getSalesRepPortfolio,
} from "@/server/sales-intelligence/portfolio";

const prisma = new PrismaClient();
const stamp = Date.now();
let adminId = "";
let repUserId = "";
let tradeUserId = "";
let companyId = "";
let zeroSalesActiveId = "";
let retailActiveId = "";
let unassignedActiveId = "";
let prospectAssignedId = "";
let prospectHistoryId = "";
let pendingId = "";
let onHoldId = "";
let closedId = "";
let salesRepId = "";
const account = `PF${String(stamp).slice(-8)}`;
const sku = `PF-SKU-${String(stamp).slice(-6)}`;

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

async function makeCompany(name: string, status: CompanyStatus) {
  const company = await prisma.company.create({
    data: { name, status, paymentTerms: "30 Days" },
  });
  return company.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`pf.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  repUserId = await ensureUser(`pf.rep.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  tradeUserId = await ensureUser(`pf.trade.${stamp}@example.invalid`, []);

  const company = await prisma.company.create({
    data: {
      name: `Portfolio Co ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
    },
  });
  companyId = company.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code: account });
  await prisma.autopartAccount.upsert({
    where: { sourceSystem_accountCode: { sourceSystem: "AUTOPART", accountCode: account } },
    create: {
      accountCode: account,
      originalName: `Portfolio Co ${stamp}`,
      classification: "TRADE_CANDIDATE",
      companyId,
    },
    update: { classification: "TRADE_CANDIDATE", companyId },
  });

  zeroSalesActiveId = await makeCompany(`PF Zero Sales ${stamp}`, "ACTIVE");
  retailActiveId = await makeCompany(`PF Retail Amazon ${stamp}`, "ACTIVE");
  unassignedActiveId = await makeCompany(`PF Unassigned Active ${stamp}`, "ACTIVE");
  prospectAssignedId = await makeCompany(`PF Prospect Assigned ${stamp}`, "PROSPECT");
  prospectHistoryId = await makeCompany(`PF Prospect History ${stamp}`, "PROSPECT");
  pendingId = await makeCompany(`PF Pending ${stamp}`, "PENDING_APPROVAL");
  onHoldId = await makeCompany(`PF On Hold ${stamp}`, "ON_HOLD");
  closedId = await makeCompany(`PF Closed ${stamp}`, "CLOSED");

  const retailCode = `PFR${String(stamp).slice(-7)}`;
  await prisma.autopartAccount.create({
    data: {
      accountCode: retailCode,
      originalName: `RETAIL AMAZON ${stamp}`,
      classification: "INTERNAL",
      companyId: retailActiveId,
    },
  });
  await prisma.company.update({
    where: { id: retailActiveId },
    data: { autopartCustomerCode: retailCode },
  });

  const brand = await prisma.brand.create({
    data: { name: `PF Brand ${stamp}`, slug: `pf-brand-${stamp}` },
  });
  const category = await prisma.category.create({
    data: { name: `PF Cat ${stamp}`, slug: `pf-cat-${stamp}` },
  });
  const product = await prisma.product.create({
    data: {
      name: `PF Product ${stamp}`,
      slug: `pf-prod-${stamp}`,
      brandId: brand.id,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
    },
  });
  await prisma.productVariant.create({
    data: { productId: product.id, sku, isActive: true, tradePrice: 10 },
  });

  const rep = await prisma.salesRep.create({
    data: {
      code: `PF${String(stamp).slice(-4)}`,
      userId: repUserId,
      active: true,
    },
  });
  salesRepId = rep.id;

  for (const id of [
    companyId,
    zeroSalesActiveId,
    retailActiveId,
    prospectAssignedId,
    prospectHistoryId,
    pendingId,
    onHoldId,
    closedId,
  ]) {
    await prisma.companyAssignment.create({
      data: { companyId: id, salesRepId, isPrimary: true },
    });
  }

  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId,
      autopartCustomerCode: account,
      documentType: "INVOICE",
      documentReference: `SSPF${String(stamp).slice(-6)}`,
      documentDate: new Date("2026-09-10T12:00:00.000Z"),
      source: "ONGOING_TRM21QC",
      hasTrm21qc: true,
      has504: true,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId,
      documentId: doc.id,
      autopartCustomerCode: account,
      documentType: "INVOICE",
      documentReference: doc.documentReference,
      lineNumber: 1,
      sku,
      units: "2",
      salesNet: "40.00",
      matchStatus: "MATCHED",
      source: "ONGOING_TRM21QC",
    },
  });

  const prospectCode = `PFP${String(stamp).slice(-7)}`;
  const prospectDoc = await prisma.autopartSalesDocument.create({
    data: {
      companyId: prospectHistoryId,
      autopartCustomerCode: prospectCode,
      documentType: "INVOICE",
      documentReference: `SSPH${String(stamp).slice(-6)}`,
      documentDate: new Date("2026-08-01T12:00:00.000Z"),
      source: "ONGOING_TRM21QC",
      hasTrm21qc: true,
      has504: true,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: prospectHistoryId,
      documentId: prospectDoc.id,
      autopartCustomerCode: prospectCode,
      documentType: "INVOICE",
      documentReference: prospectDoc.documentReference,
      lineNumber: 1,
      sku,
      units: "1",
      salesNet: "12.00",
      matchStatus: "MATCHED",
      source: "ONGOING_TRM21QC",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function rowIds(data: Awaited<ReturnType<typeof getSalesRepPortfolio>>) {
  return new Set(data.rows.map((r) => r.companyId));
}

describe("sales rep portfolio", () => {
  it("denies trade users", async () => {
    await expect(getSalesRepPortfolio(tradeUserId, { period: "THIS_MONTH" })).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("includes ACTIVE with sales and ACTIVE without sales; excludes non-ACTIVE", async () => {
    const data = await getSalesRepPortfolio(adminId, {
      period: "LAST_365",
      salesRepId,
      accountClass: "ALL",
      page: 1,
      pageSize: 200,
      allRows: true,
    });
    const ids = rowIds(data);
    expect(ids.has(companyId)).toBe(true);
    expect(ids.has(zeroSalesActiveId)).toBe(true);
    expect(ids.has(retailActiveId)).toBe(true);
    expect(ids.has(prospectAssignedId)).toBe(false);
    expect(ids.has(prospectHistoryId)).toBe(false);
    expect(ids.has(pendingId)).toBe(false);
    expect(ids.has(onHoldId)).toBe(false);
    expect(ids.has(closedId)).toBe(false);
  });

  it("defaults to trade and excludes Autopart INTERNAL retail/internal accounts", async () => {
    const trade = await getSalesRepPortfolio(adminId, {
      period: "LAST_365",
      salesRepId,
      page: 1,
      pageSize: 200,
      allRows: true,
    });
    expect(trade.accountClass).toBe("TRADE");
    const tradeIds = rowIds(trade);
    expect(tradeIds.has(companyId)).toBe(true);
    expect(tradeIds.has(zeroSalesActiveId)).toBe(true);
    expect(tradeIds.has(retailActiveId)).toBe(false);

    const retail = await getSalesRepPortfolio(adminId, {
      period: "LAST_365",
      salesRepId,
      accountClass: "RETAIL_INTERNAL",
      page: 1,
      pageSize: 200,
      allRows: true,
    });
    expect(retail.accountClass).toBe("RETAIL_INTERNAL");
    const retailIds = rowIds(retail);
    expect(retailIds.has(retailActiveId)).toBe(true);
    expect(retailIds.has(companyId)).toBe(false);
  });

  it("lists unassigned ACTIVE customers only", async () => {
    const data = await getSalesRepPortfolio(adminId, {
      period: "LAST_365",
      unassigned: true,
      accountClass: "ALL",
      page: 1,
      pageSize: 200,
      allRows: true,
    });
    const ids = rowIds(data);
    expect(ids.has(unassignedActiveId)).toBe(true);
    expect(ids.has(companyId)).toBe(false);
    expect(ids.has(prospectAssignedId)).toBe(false);
  });

  it("scopes sales rep to assigned ACTIVE companies only", async () => {
    const data = await getSalesRepPortfolio(repUserId, {
      period: "LAST_365",
      accountClass: "ALL",
      page: 1,
      pageSize: 200,
      allRows: true,
    });
    expect(data.canSelectSalesRep).toBe(false);
    const ids = rowIds(data);
    expect(ids.has(companyId)).toBe(true);
    expect(ids.has(zeroSalesActiveId)).toBe(true);
    expect(ids.has(unassignedActiveId)).toBe(false);
    expect(ids.has(prospectAssignedId)).toBe(false);
    for (const row of data.rows) {
      if (row.salesRepId) expect(row.salesRepId).toBe(salesRepId);
    }
  });

  it("keeps KPI Active Customers aligned with My Customers / CSV and never dormants zero-history", async () => {
    const data = await getSalesRepPortfolio(adminId, {
      period: "LAST_365",
      salesRepId,
      accountClass: "TRADE",
      filter: "ALL",
      page: 1,
      pageSize: 200,
      allRows: true,
    });
    expect(data.kpis.activeCustomers).toBe(data.total);
    expect(data.kpis.activeCustomers).toBe(data.rows.length);
    const zeroRow = data.rows.find((r) => r.companyId === zeroSalesActiveId);
    expect(zeroRow).toBeDefined();
    expect(zeroRow!.dormant).toBe(false);
    expect(Number(zeroRow!.currentNetSales)).toBe(0);

    const csv = await exportSalesRepPortfolioCsv(adminId, {
      period: "LAST_365",
      salesRepId,
      accountClass: "TRADE",
    });
    expect(csv.split("\n")[0]).toContain("Customer");
    expect(csv).toContain("Current Net Sales");
    expect(csv).toContain(`Portfolio Co ${stamp}`);
    expect(csv).toContain(`PF Zero Sales ${stamp}`);
    expect(csv).not.toContain(`PF Prospect Assigned ${stamp}`);
    expect(csv).not.toContain(`PF Retail Amazon ${stamp}`);
  });

  it("lets management see portfolio methodology for ACTIVE eligibility", async () => {
    const data = await getSalesRepPortfolio(adminId, {
      period: "LAST_365",
      salesRepId,
      page: 1,
      pageSize: 50,
    });
    expect(data.canSelectSalesRep).toBe(true);
    expect(data.methodology.eligibility).toMatch(/ACTIVE/i);
    expect(data.methodology.activeCustomersKpi).toMatch(/eligible ACTIVE/i);
    expect(data.methodology.dormant).toMatch(/Insufficient history/i);
  });
});
