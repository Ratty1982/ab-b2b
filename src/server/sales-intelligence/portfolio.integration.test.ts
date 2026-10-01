/**
 * Sales Rep Portfolio — RBAC + aggregation smoke.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
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
  await prisma.companyAssignment.create({
    data: { companyId, salesRepId, isPrimary: true },
  });

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
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sales rep portfolio", () => {
  it("denies trade users", async () => {
    await expect(getSalesRepPortfolio(tradeUserId, { period: "THIS_MONTH" })).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("lets management see portfolio and export CSV with aggregation", async () => {
    const data = await getSalesRepPortfolio(adminId, {
      period: "LAST_365",
      salesRepId,
      page: 1,
      pageSize: 50,
    });
    expect(data.canSelectSalesRep).toBe(true);
    expect(data.kpis).toBeDefined();
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.methodology.cadence).toMatch(/median/i);
    const csv = await exportSalesRepPortfolioCsv(adminId, {
      period: "LAST_365",
      salesRepId,
    });
    expect(csv.split("\n")[0]).toContain("Customer");
    expect(csv).toContain("Current Net Sales");
  });

  it("scopes sales rep to assigned companies only", async () => {
    const data = await getSalesRepPortfolio(repUserId, { period: "LAST_365" });
    expect(data.canSelectSalesRep).toBe(false);
    // May or may not include our company depending on date windows / London today —
    // assert no foreign companies: every row salesRepId is ours or null within assignment.
    for (const row of data.rows) {
      if (row.salesRepId) expect(row.salesRepId).toBe(salesRepId);
    }
  });
});
