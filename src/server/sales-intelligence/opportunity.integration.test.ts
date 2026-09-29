/**
 * Sales Intelligence — Range Opportunities integration coverage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { getCustomerSalesEnquiry } from "@/server/sales-intelligence/enquiry";
import {
  exportCustomerRangeOpportunitiesCsv,
  getCustomerRangeOpportunities,
} from "@/server/sales-intelligence/opportunity";
import { AUTOPART_WAREHOUSE_CODE } from "@/domain/stock";

const prisma = new PrismaClient();
const stamp = Date.now();

let adminId = "";
let salesRepUserId = "";
let marketingId = "";
let tradeBuyerId = "";
let companyAId = "";
let companyBId = "";
let companyCId = "";
let companyDId = "";
let companyEId = "";
let companyOutOfScopeId = "";
let salesRepId = "";
let otherRepId = "";
let brandPowerId = "";
let brandOtherId = "";
let catExteriorId = "";
let catOtherId = "";

const sku1 = `RO-SKU1-${stamp}`;
const sku2 = `RO-SKU2-${stamp}`;
const sku3 = `RO-SKU3-${stamp}`;
const sku4 = `RO-SKU4-${stamp}`;
const sku5 = `RO-SKU5-${stamp}`;
const sku6 = `RO-HIST-${stamp}`;
const sku7 = `RO-OOS-${stamp}`;
const skuCredit = `RO-CREDIT-${stamp}`;

const ANALYSIS = { from: "2025-10-01", to: "2026-09-29" } as const;

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

async function ensureCatalogueSku(
  sku: string,
  name: string,
  brandId: string,
  categoryId: string,
  opts?: { tradeVisible?: boolean; active?: boolean; backorderPolicy?: "ALLOW" | "DENY" | "INHERIT" },
) {
  const existing = await prisma.productVariant.findUnique({ where: { sku } });
  if (!existing) {
    await saveProduct(adminId, {
      sku,
      name,
      brand: `tmp-${sku}`,
      category: `tmp-c-${sku}`,
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
      brandId,
      categoryId,
      isActive: opts?.active ?? true,
      isTradeVisible: opts?.tradeVisible ?? true,
      status: "ACTIVE",
      name,
    },
  });
  await prisma.productVariant.update({
    where: { id: v.id },
    data: {
      isActive: opts?.active ?? true,
      backorderPolicy: opts?.backorderPolicy ?? "INHERIT",
    },
  });
  return v.id;
}

async function seedStock(variantId: string, avail: number) {
  const warehouse = await prisma.warehouse.upsert({
    where: { code: AUTOPART_WAREHOUSE_CODE },
    create: { code: AUTOPART_WAREHOUSE_CODE, name: "Autopart", isDefault: true },
    update: {},
  });
  await prisma.inventory.upsert({
    where: { variantId_warehouseId: { variantId, warehouseId: warehouse.id } },
    create: {
      variantId,
      warehouseId: warehouse.id,
      qtyOnHand: avail,
      qtyReserved: 0,
      status: avail >= 21 ? "IN_STOCK" : avail > 0 ? "LOW" : "OUT_OF_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: String(avail),
    },
    update: {
      qtyOnHand: avail,
      qtyReserved: 0,
      status: avail >= 21 ? "IN_STOCK" : avail > 0 ? "LOW" : "OUT_OF_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: String(avail),
    },
  });
  await prisma.stockSyncRun.create({
    data: {
      source: "231PO3NEW",
      mode: "live",
      status: "SUCCESS",
      trigger: "test",
      completedAt: new Date(),
      rowsRead: 1,
      matched: 1,
      updated: 1,
      unchanged: 0,
      unmatched: 0,
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

async function seedInvoice(
  companyId: string,
  code: string,
  ref: string,
  date: string,
  lines: Array<{ sku: string; units: string; salesNet: string; line: number }>,
) {
  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      dryRun: false,
      completedAt: new Date(),
      rowsImported: lines.length,
      detectedAccount: code,
    },
  });
  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId,
      autopartCustomerCode: code,
      documentType: "INVOICE",
      documentReference: ref,
      documentDate: new Date(`${date}T12:00:00.000Z`),
      source: "SLRB",
      importRunId: run.id,
    },
  });
  for (const l of lines) {
    await prisma.autopartSalesLine.create({
      data: {
        companyId,
        documentId: doc.id,
        autopartCustomerCode: code,
        documentType: "INVOICE",
        documentReference: ref,
        lineNumber: l.line,
        sku: l.sku,
        descriptionSnapshot: l.sku,
        units: l.units,
        salesNet: l.salesNet,
        matchStatus: "MATCHED",
        source: "561L",
        importRunId: run.id,
      },
    });
  }
}

async function seedCredit(
  companyId: string,
  code: string,
  ref: string,
  date: string,
  sku: string,
  units: string,
  salesNet: string,
) {
  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      dryRun: false,
      completedAt: new Date(),
      rowsImported: 1,
      detectedAccount: code,
    },
  });
  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId,
      autopartCustomerCode: code,
      documentType: "CREDIT",
      documentReference: ref,
      documentDate: new Date(`${date}T12:00:00.000Z`),
      source: "SLRB",
      importRunId: run.id,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId,
      documentId: doc.id,
      autopartCustomerCode: code,
      documentType: "CREDIT",
      documentReference: ref,
      lineNumber: 1,
      sku,
      descriptionSnapshot: sku,
      units,
      salesNet,
      matchStatus: "MATCHED",
      source: "561L",
      importRunId: run.id,
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`ro.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  salesRepUserId = await ensureUser(`ro.rep.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  marketingId = await ensureUser(`ro.mkt.${stamp}@example.invalid`, ["MARKETING"]);
  tradeBuyerId = await ensureUser(`ro.buyer.${stamp}@example.invalid`, [], "TRADE");

  const brand = await prisma.brand.create({
    data: { name: `RO Power ${stamp}`, slug: `ro-power-${stamp}` },
  });
  brandPowerId = brand.id;
  const brandOther = await prisma.brand.create({
    data: { name: `RO Other ${stamp}`, slug: `ro-other-${stamp}` },
  });
  brandOtherId = brandOther.id;
  const cat = await prisma.category.create({
    data: { name: `RO Exterior ${stamp}`, slug: `ro-exterior-${stamp}` },
  });
  catExteriorId = cat.id;
  const catOther = await prisma.category.create({
    data: { name: `RO Unrelated ${stamp}`, slug: `ro-unrelated-${stamp}` },
  });
  catOtherId = catOther.id;

  const v1 = await ensureCatalogueSku(sku1, "RO Multi Lube", brandPowerId, catExteriorId);
  const v2 = await ensureCatalogueSku(sku2, "RO Wheel Cleaner", brandPowerId, catExteriorId);
  const v3 = await ensureCatalogueSku(sku3, "RO Glass Cleaner", brandPowerId, catExteriorId);
  const v4 = await ensureCatalogueSku(sku4, "RO Brake Cleaner", brandPowerId, catExteriorId);
  const v5 = await ensureCatalogueSku(sku5, "RO Unrelated Grease", brandOtherId, catOtherId);
  const v7 = await ensureCatalogueSku(sku7, "RO Out Of Stock", brandPowerId, catExteriorId, {
    backorderPolicy: "DENY",
  });
  const vCredit = await ensureCatalogueSku(
    skuCredit,
    "RO Credit Only Cand",
    brandPowerId,
    catExteriorId,
  );

  await seedStock(v1, 50);
  await seedStock(v2, 50);
  await seedStock(v3, 50);
  await seedStock(v4, 40);
  await seedStock(v5, 40);
  await seedStock(v7, 0);
  await seedStock(vCredit, 30);

  let rep = await prisma.salesRep.findFirst({ where: { userId: salesRepUserId } });
  if (!rep) {
    rep = await prisma.salesRep.create({
      data: {
        userId: salesRepUserId,
        code: `RO-REP-${stamp}`,
        displayName: "RO Own Rep",
        active: true,
      },
    });
  }
  salesRepId = rep.id;

  const mgr = await ensureUser(`ro.mgr.${stamp}@example.invalid`, ["SALES_MANAGER"]);
  let other = await prisma.salesRep.findFirst({ where: { userId: mgr } });
  if (!other) {
    other = await prisma.salesRep.create({
      data: {
        userId: mgr,
        code: `RO-MGR-${stamp}`,
        displayName: "RO Manager Rep",
        active: true,
      },
    });
  }
  otherRepId = other.id;

  async function setupCo(name: string, email: string, repId: string, codeSuffix: string) {
    const co = await createCompany(name, email);
    await prisma.companyAssignment.create({ data: { companyId: co.id, salesRepId: repId } });
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: co.id,
      code: `RO${codeSuffix}${String(stamp).slice(-3)}`,
    });
    const code = (await prisma.company.findUniqueOrThrow({ where: { id: co.id } }))
      .autopartCustomerCode!;
    return { id: co.id, code };
  }

  const a = await setupCo(`RO Customer Alpha ${stamp}`, `ro.a.${stamp}@example.invalid`, salesRepId, "A");
  companyAId = a.id;
  const b = await setupCo(`RO Customer Beta ${stamp}`, `ro.b.${stamp}@example.invalid`, salesRepId, "B");
  companyBId = b.id;
  const c = await setupCo(`RO Customer Gamma ${stamp}`, `ro.c.${stamp}@example.invalid`, salesRepId, "C");
  companyCId = c.id;
  const d = await setupCo(`RO Customer Delta ${stamp}`, `ro.d.${stamp}@example.invalid`, salesRepId, "D");
  companyDId = d.id;
  const e = await setupCo(`RO Customer Echo ${stamp}`, `ro.e.${stamp}@example.invalid`, salesRepId, "E");
  companyEId = e.id;
  const oos = await setupCo(
    `RO Out Of Scope ${stamp}`,
    `ro.oos.${stamp}@example.invalid`,
    otherRepId,
    "X",
  );
  companyOutOfScopeId = oos.id;

  // A: SKU1,2,3
  await seedInvoice(companyAId, a.code, `RO-${a.code}-1`, "2026-03-10", [
    { sku: sku1, units: "5", salesNet: "50.00", line: 1 },
    { sku: sku2, units: "4", salesNet: "40.00", line: 2 },
    { sku: sku3, units: "3", salesNet: "30.00", line: 3 },
  ]);

  // B: SKU1,2,3,4 + credit-only on skuCredit (must not create adoption for skuCredit alone from B if only credit - we'll add credit on a separate sku)
  await seedInvoice(companyBId, b.code, `RO-${b.code}-1`, "2026-04-01", [
    { sku: sku1, units: "5", salesNet: "50.00", line: 1 },
    { sku: sku2, units: "5", salesNet: "50.00", line: 2 },
    { sku: sku3, units: "5", salesNet: "50.00", line: 3 },
    { sku: sku4, units: "10", salesNet: "100.00", line: 4 },
    { sku: sku7, units: "2", salesNet: "20.00", line: 5 },
  ]);
  await seedCredit(companyBId, b.code, `RO-${b.code}-C1`, "2026-04-15", skuCredit, "-2", "-20.00");

  // C: SKU1,2,4
  await seedInvoice(companyCId, c.code, `RO-${c.code}-1`, "2026-05-01", [
    { sku: sku1, units: "4", salesNet: "40.00", line: 1 },
    { sku: sku2, units: "4", salesNet: "40.00", line: 2 },
    { sku: sku4, units: "8", salesNet: "80.00", line: 3 },
  ]);

  // D: SKU1,3,4
  await seedInvoice(companyDId, d.code, `RO-${d.code}-1`, "2026-06-01", [
    { sku: sku1, units: "3", salesNet: "30.00", line: 1 },
    { sku: sku3, units: "3", salesNet: "30.00", line: 2 },
    { sku: sku4, units: "6", salesNet: "60.00", line: 3 },
  ]);

  // E unrelated: only SKU5
  await seedInvoice(companyEId, e.code, `RO-${e.code}-1`, "2026-07-01", [
    { sku: sku5, units: "20", salesNet: "200.00", line: 1 },
  ]);

  // Out-of-scope company also buys SKU4 — must not leak identity; for own-rep must not inflate cohort
  await seedInvoice(companyOutOfScopeId, oos.code, `RO-${oos.code}-1`, "2026-07-15", [
    { sku: sku1, units: "2", salesNet: "20.00", line: 1 },
    { sku: sku2, units: "2", salesNet: "20.00", line: 2 },
    { sku: sku4, units: "50", salesNet: "500.00", line: 3 },
  ]);

  // Historic-only SKU6 line on B
  const runHist = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: companyBId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      dryRun: false,
      completedAt: new Date(),
      rowsImported: 1,
      detectedAccount: b.code,
    },
  });
  const docHist = await prisma.autopartSalesDocument.create({
    data: {
      companyId: companyBId,
      autopartCustomerCode: b.code,
      documentType: "INVOICE",
      documentReference: `RO-${b.code}-H`,
      documentDate: new Date("2026-04-20T12:00:00.000Z"),
      source: "SLRB",
      importRunId: runHist.id,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: companyBId,
      documentId: docHist.id,
      autopartCustomerCode: b.code,
      documentType: "INVOICE",
      documentReference: `RO-${b.code}-H`,
      lineNumber: 1,
      sku: sku6,
      descriptionSnapshot: "Historic discontinued",
      units: "9",
      salesNet: "90.00",
      matchStatus: "NOT_IN_AB_CATALOGUE",
      source: "561L",
      importRunId: runHist.id,
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

describe("Sales Intelligence Range Opportunities", () => {
  it("surfaces SKU4 with adoption from comparable cohort; excludes historic/oos/unrelated/credit-only", async () => {
    const r = await getCustomerRangeOpportunities(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: ANALYSIS.from,
      to: ANALYSIS.to,
      pageSize: 100,
    });

    expect(r.noPurchaseHistory).toBe(false);
    expect(r.evidenceInsufficient).toBe(false);
    expect(r.summary.comparableCustomers).toBeGreaterThanOrEqual(3);

    const bySku = Object.fromEntries(r.items.items.map((i) => [i.sku.toUpperCase(), i]));
    expect(bySku[sku4.toUpperCase()]).toBeTruthy();
    const cand = bySku[sku4.toUpperCase()]!;
    // Admin scope includes out-of-scope company X as an anonymous comparable buyer
    expect(cand.buyers).toBe(4); // B,C,D,+X
    expect(cand.cohort).toBe(r.summary.comparableCustomers);
    expect(cand.adoption).toBeCloseTo(4 / cand.cohort);
    expect(cand.rangeMatch).toBe("SAME_BRAND_CATEGORY");
    expect(cand.comparableUnits).toBe(10 + 8 + 6 + 50);
    // Aggregate evidence only — never return out-of-scope company identity fields
    expect(JSON.stringify(r.items.items)).not.toContain(companyOutOfScopeId);
    expect(JSON.stringify(r.company)).not.toContain(companyOutOfScopeId);

    expect(bySku[sku5.toUpperCase()]).toBeUndefined();
    expect(bySku[sku6.toUpperCase()]).toBeUndefined();
    expect(bySku[sku7.toUpperCase()]).toBeUndefined();
    expect(bySku[skuCredit.toUpperCase()]).toBeUndefined();
    expect(bySku[sku1.toUpperCase()]).toBeUndefined(); // already purchased
  });

  it("reconciles profile totals with Sales Enquiry for same customer/period", async () => {
    const opp = await getCustomerRangeOpportunities(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: ANALYSIS.from,
      to: ANALYSIS.to,
    });
    const enquiry = await getCustomerSalesEnquiry(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: ANALYSIS.from,
      to: ANALYSIS.to,
    });
    expect(opp.profile.netSales).toBe(enquiry.summary.netSales);
    expect(opp.profile.invoiceSales).toBe(enquiry.summary.invoiceSales);
    expect(opp.profile.credits).toBe(enquiry.summary.credits);
    expect(opp.profile.units).toBe(enquiry.summary.units);
    expect(opp.profile.purchaseTransactions).toBe(enquiry.summary.purchaseTransactions);
  });

  it("enforces RBAC and sales assignment scope without leaking out-of-scope identities", async () => {
    await expect(
      getCustomerRangeOpportunities(tradeBuyerId, { companyId: companyAId, period: "LAST_365" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      getCustomerRangeOpportunities(marketingId, { companyId: companyAId, period: "LAST_365" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      getCustomerRangeOpportunities(salesRepUserId, {
        companyId: companyOutOfScopeId,
        period: "CUSTOM",
        from: ANALYSIS.from,
        to: ANALYSIS.to,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const scoped = await getCustomerRangeOpportunities(salesRepUserId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: ANALYSIS.from,
      to: ANALYSIS.to,
      pageSize: 100,
    });
    expect(scoped.summary.comparableCustomers).toBeGreaterThanOrEqual(3);
    // Out-of-scope buyer of SKU4 must not inflate own-rep cohort/buyers
    const sku4Row = scoped.items.items.find((i) => i.sku.toUpperCase() === sku4.toUpperCase());
    expect(sku4Row?.buyers).toBe(3);
    expect(JSON.stringify(scoped)).not.toContain(companyOutOfScopeId);
    expect(JSON.stringify(scoped)).not.toContain(`RO Out Of Scope`);
  });

  it("exports CSV for full filtered set without comparable identities", async () => {
    const csv = await exportCustomerRangeOpportunitiesCsv(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: ANALYSIS.from,
      to: ANALYSIS.to,
    });
    expect(csv.csv).toContain("Adoption %");
    expect(csv.csv).toContain(sku4);
    expect(csv.csv).toContain("Same brand + category");
    expect(csv.csv).not.toContain(companyBId);
    await expect(
      exportCustomerRangeOpportunitiesCsv(tradeBuyerId, {
        companyId: companyAId,
        period: "LAST_365",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("filters by range match and search", async () => {
    const search = await getCustomerRangeOpportunities(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: ANALYSIS.from,
      to: ANALYSIS.to,
      q: "Brake",
      pageSize: 50,
    });
    expect(search.items.items.every((i) => i.name.toLowerCase().includes("brake") || i.sku.toLowerCase().includes("brake"))).toBe(
      true,
    );

    const broader = await getCustomerRangeOpportunities(adminId, {
      companyId: companyAId,
      period: "CUSTOM",
      from: ANALYSIS.from,
      to: ANALYSIS.to,
      includeBroader: true,
      rangeMatch: "ALL",
      availability: "ALL",
      pageSize: 100,
    });
    expect(broader.summary.opportunities).toBeGreaterThanOrEqual(search.items.total);
  });

  it("returns empty evidence state when comparable cohort is too small", async () => {
    // Use company E which has unrelated purchases — may find few/no comparables
    const r = await getCustomerRangeOpportunities(adminId, {
      companyId: companyEId,
      period: "CUSTOM",
      from: ANALYSIS.from,
      to: ANALYSIS.to,
    });
    // E only overlaps weakly; with minSimilarity 0.25 and minComparable 3, expect insufficient
    expect(r.evidenceInsufficient || r.items.total === 0).toBe(true);
  });
});
