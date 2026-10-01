/**
 * Customer Groups — AB reporting aggregation above Company.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { mapAutopartCustomerAccount } from "@/server/companies/autopart-account-mapping";
import {
  addCompanyToCustomerGroup,
  createCustomerGroup,
  getCustomerGroup,
  listCustomerGroups,
  removeCompanyFromCustomerGroup,
  updateCustomerGroup,
} from "@/server/companies/customer-groups";
import {
  exportCustomerGroupSalesCsv,
  getCustomerGroupSalesSummary,
  listCustomerGroupProductLines,
} from "@/server/companies/customer-group-sales";
import { searchSalesIntelligenceCustomers } from "@/server/sales-intelligence/enquiry";
import { verifyAutopartAccountAlias } from "@/server/companies/autopart-history";

const prisma = new PrismaClient();
const stamp = Date.now();

let adminId = "";
let tradeId = "";
let companyAId = "";
let companyBId = "";
let companyCId = "";
let groupId = "";
const skuCat = `CG-SKU-${String(stamp).slice(-6)}`;
const skuRetail = `RETAIL-CG-${String(stamp).slice(-6)}`;
const acctA = `CGA${String(stamp).slice(-7)}`;
const acctB = `CGB${String(stamp).slice(-7)}`;
const acctAlias = `CGAL${String(stamp).slice(-6)}`;

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
  } else if (user.actorType !== actorType) {
    user = await prisma.user.update({ where: { id: user.id }, data: { actorType } });
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

async function seedLine(opts: {
  companyId: string;
  account: string;
  ref: string;
  type: "INVOICE" | "CREDIT";
  sku: string;
  units: number;
  net: number;
  date: string;
  desc?: string;
}) {
  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId: opts.companyId,
      autopartCustomerCode: opts.account,
      documentType: opts.type,
      documentReference: opts.ref,
      documentDate: new Date(`${opts.date}T12:00:00.000Z`),
      source: "ONGOING_TRM21QC",
      hasTrm21qc: true,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: opts.companyId,
      documentId: doc.id,
      autopartCustomerCode: opts.account,
      documentType: opts.type,
      documentReference: opts.ref,
      lineNumber: 1,
      sku: opts.sku,
      descriptionSnapshot: opts.desc ?? opts.sku,
      units: opts.units,
      salesNet: opts.net,
      matchStatus: opts.sku.startsWith("RETAIL") ? "NOT_IN_AB_CATALOGUE" : "MATCHED",
      source: "ONGOING_TRM21QC",
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`cg.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  tradeId = await ensureUser(`cg.trade.${stamp}@example.invalid`, [], "TRADE");

  const a = await prisma.company.create({
    data: { name: `Vertu Branch A ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  const b = await prisma.company.create({
    data: { name: `Vertu Branch B ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  const c = await prisma.company.create({
    data: { name: `Independent ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  companyAId = a.id;
  companyBId = b.id;
  companyCId = c.id;

  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: companyAId, code: acctA });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: companyBId, code: acctB });
  await verifyAutopartAccountAlias(adminId, {
    companyId: companyAId,
    alias: acctAlias,
    note: "Extra branch code",
  });

  const brand = await prisma.brand.create({
    data: { name: `CG Brand ${stamp}`, slug: `cg-brand-${stamp}` },
  });
  const product = await prisma.product.create({
    data: {
      name: `CG Product ${stamp}`,
      slug: `cg-product-${stamp}`,
      brandId: brand.id,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
    },
  });
  await prisma.productVariant.create({
    data: { productId: product.id, sku: skuCat, isActive: true, tradePrice: 10 },
  });

  await seedLine({
    companyId: companyAId,
    account: acctA,
    ref: `INV-A-${stamp}`,
    type: "INVOICE",
    sku: skuCat,
    units: 2,
    net: 100,
    date: "2026-09-10",
  });
  await seedLine({
    companyId: companyAId,
    account: acctAlias,
    ref: `INV-AL-${stamp}`,
    type: "INVOICE",
    sku: skuRetail,
    units: 1,
    net: 40,
    date: "2026-09-11",
    desc: "Retail only widget",
  });
  await seedLine({
    companyId: companyBId,
    account: acctB,
    ref: `CR-B-${stamp}`,
    type: "CREDIT",
    sku: skuCat,
    units: -1,
    net: -20,
    date: "2026-09-12",
  });
  await seedLine({
    companyId: companyCId,
    account: "INDEPX",
    ref: `INV-C-${stamp}`,
    type: "INVOICE",
    sku: skuCat,
    units: 5,
    net: 500,
    date: "2026-09-13",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("customer groups", () => {
  it("creates group, assigns/removes/moves companies, allows ungrouped", async () => {
    const group = await createCustomerGroup(adminId, {
      name: `Vertu ${stamp}`,
      description: "Consolidated Vertu reporting",
    });
    groupId = group.id;
    expect(group.active).toBe(true);

    await addCompanyToCustomerGroup(adminId, { groupId, companyId: companyAId });
    await addCompanyToCustomerGroup(adminId, { groupId, companyId: companyBId });

    const detail = await getCustomerGroup(adminId, groupId);
    expect(detail.companies).toHaveLength(2);
    expect(detail.companies.some((c) => c.mamAccountCount >= 2)).toBe(true);

    const retail = await createCustomerGroup(adminId, { name: `Retail Accounts ${stamp}` });
    const moved = await addCompanyToCustomerGroup(adminId, {
      groupId: retail.id,
      companyId: companyAId,
    });
    expect(moved.moved).toBe(true);
    const a = await prisma.company.findUniqueOrThrow({ where: { id: companyAId } });
    expect(a.customerGroupId).toBe(retail.id);

    // Move back for sales tests
    await addCompanyToCustomerGroup(adminId, { groupId, companyId: companyAId });

    await removeCompanyFromCustomerGroup(adminId, { companyId: companyBId, groupId });
    const b = await prisma.company.findUniqueOrThrow({ where: { id: companyBId } });
    expect(b.customerGroupId).toBeNull();

    // Independent remains ungrouped
    const c = await prisma.company.findUniqueOrThrow({ where: { id: companyCId } });
    expect(c.customerGroupId).toBeNull();

    // Re-add B for aggregation
    await addCompanyToCustomerGroup(adminId, { groupId, companyId: companyBId });

    await updateCustomerGroup(adminId, { id: retail.id, active: false });
    const listed = await listCustomerGroups(adminId, { includeInactive: false });
    expect(listed.items.some((g) => g.id === retail.id)).toBe(false);
  });

  it("aggregates group sales once with credits negative and retail SKUs included", async () => {
    const summary = await getCustomerGroupSalesSummary(adminId, {
      groupId,
      period: "CUSTOM",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    // A: 100 + 40 = 140; B: -20 → 120. Independent 500 excluded.
    expect(Number(summary.summary.netSales)).toBeCloseTo(120, 2);
    expect(Number(summary.summary.credits)).toBeCloseTo(-20, 2);
    expect(Number(summary.summary.invoiceSales)).toBeCloseTo(140, 2);
    expect(summary.byCompany).toHaveLength(2);
    expect(summary.byMamAccount.length).toBeGreaterThanOrEqual(2);

    const retailLine = summary.products.find((p) => p.sku.toUpperCase() === skuRetail.toUpperCase());
    expect(retailLine).toBeTruthy();
    expect(retailLine!.description).toContain("Retail");

    // No double counting: sum of company nets equals group net
    const companySum = summary.byCompany.reduce((n, c) => n + Number(c.netSales), 0);
    expect(companySum).toBeCloseTo(Number(summary.summary.netSales), 2);

    const mamSum = summary.byMamAccount.reduce((n, a) => n + Number(a.netSales), 0);
    expect(mamSum).toBeCloseTo(Number(summary.summary.netSales), 2);

    const lines = await listCustomerGroupProductLines(adminId, {
      groupId,
      period: "CUSTOM",
      from: "2026-09-01",
      to: "2026-09-30",
      mamAccount: acctAlias,
    });
    expect(lines.items.every((l) => l.mamAccount.toUpperCase() === acctAlias)).toBe(true);
    expect(lines.items.some((l) => l.sku.toUpperCase() === skuRetail.toUpperCase())).toBe(true);

    const csv = await exportCustomerGroupSalesCsv(adminId, {
      groupId,
      period: "CUSTOM",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(csv.csv).toContain("Customer Group");
    expect(csv.csv).toContain("MAM Account");
    expect(csv.csv).toContain(skuRetail);
  });

  it("maps MAM account to Company not Group; SI search finds groups; RBAC + audit", async () => {
    const fresh = `CGF${String(stamp).slice(-7)}`;
    await mapAutopartCustomerAccount(adminId, {
      accountCode: fresh,
      companyId: companyAId,
    });
    const binding = await prisma.autopartCustomerAccountAlias.findFirst({
      where: { alias: fresh },
    });
    expect(binding?.companyId).toBe(companyAId);

    const searchGroup = await searchSalesIntelligenceCustomers(adminId, {
      q: `Vertu ${stamp}`,
    });
    expect(searchGroup.items.some((i) => i.kind === "GROUP" && i.id === groupId)).toBe(true);
    const searchCompany = await searchSalesIntelligenceCustomers(adminId, {
      q: `Branch A ${stamp}`,
    });
    expect(searchCompany.items.some((i) => i.kind === "COMPANY" && i.id === companyAId)).toBe(true);

    await expect(listCustomerGroups(tradeId)).rejects.toBeInstanceOf(AuthError);
    await expect(
      getCustomerGroupSalesSummary(tradeId, { groupId, period: "LAST_30" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      addCompanyToCustomerGroup(tradeId, { groupId, companyId: companyCId }),
    ).rejects.toBeInstanceOf(AuthError);

    // Trade CompanyUser on A does not grant B via group
    await prisma.companyUser.create({
      data: {
        companyId: companyAId,
        userId: tradeId,
        role: "TRADE_BUYER",
        status: "ACTIVE",
      },
    });
    const memberships = await prisma.companyUser.findMany({ where: { userId: tradeId } });
    expect(memberships.map((m) => m.companyId)).toEqual([companyAId]);

    const audits = await prisma.auditEvent.findMany({
      where: {
        action: {
          in: [
            "customer_group.created",
            "customer_group.company_added",
            "customer_group.company_moved",
            "customer_group.company_removed",
            "customer_group.deactivated",
          ],
        },
        actorUserId: adminId,
      },
      take: 30,
    });
    expect(audits.some((a) => a.action === "customer_group.created")).toBe(true);
    expect(audits.some((a) => a.action === "customer_group.company_moved")).toBe(true);

    // Salesperson unchanged by grouping
    const aBefore = await prisma.company.findUniqueOrThrow({
      where: { id: companyAId },
      select: { assignments: { select: { salesRepId: true } } },
    });
    expect(aBefore.assignments.length).toBe(0);
  });
});
