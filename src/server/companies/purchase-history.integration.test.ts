/**
 * Portal Purchase History — filters, purchase counts, credits, trends, IDOR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  getPortalPurchaseProductInsight,
  listPortalPurchaseHistory,
  purchaseHistoryWindowRange,
} from "@/server/companies/purchase-history";
import { listPortalHistoricPurchases } from "@/server/companies/autopart-history";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { saveProduct } from "@/server/catalogue/service";

const prisma = new PrismaClient();

let adminId = "";
let buyerAId = "";
let buyerBId = "";
let companyAId = "";
let companyBId = "";
let brandPowerId = "";
let brandSteelId = "";
let catCleanId = "";
let catSealId = "";

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

async function seedHistoric(companyId: string, code: string) {
  // Dated invoices + credit for SKU MATCH-A / MATCH-B / GONE-SKU
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

  async function doc(
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
        importRunId: run.id,
      },
    });
  }

  const inv1 = await doc("INVOICE", "SS900001", "2025-01-15");
  const inv2 = await doc("INVOICE", "SS900002", "2025-06-20");
  const inv3 = await doc("INVOICE", "SS900003", "2026-03-10");
  const crn1 = await doc("CREDIT", "SC900010", "2026-03-20");
  const invUndated = await doc("INVOICE", "SS900099", null);

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

  // MATCH-A: 3 invoice purchases + 1 credit
  await line(inv1.id, "INVOICE", "SS900001", 1, "MATCH-A", "10", "100.00", "Cleaner A");
  await line(inv2.id, "INVOICE", "SS900002", 1, "MATCH-A", "5", "50.00", "Cleaner A");
  await line(inv3.id, "INVOICE", "SS900003", 1, "MATCH-A", "8", "80.00", "Cleaner A");
  await line(crn1.id, "CREDIT", "SC900010", 1, "MATCH-A", "-2", "-20.00", "Cleaner A credit");
  // second line same invoice — must not inflate purchase count
  await line(inv3.id, "INVOICE", "SS900003", 2, "MATCH-A", "1", "10.00", "Cleaner A bottle");

  // MATCH-B: single purchase
  await line(inv2.id, "INVOICE", "SS900002", 2, "MATCH-B", "3", "30.00", "Sealant B");

  // GONE-SKU: historic only + undated invoice
  await line(inv1.id, "INVOICE", "SS900001", 2, "GONE-SKU", "4", "40.00", "Legacy Degreaser");
  await line(invUndated.id, "INVOICE", "SS900099", 1, "GONE-SKU", "2", "15.00", "Legacy Degreaser");
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("ph.admin@example.invalid", ["SUPER_ADMIN"]);
  const stamp = Date.now();
  const brandPower = await prisma.brand.upsert({
    where: { slug: `ph-power-${stamp}` },
    create: { name: "Power Maxed PH", slug: `ph-power-${stamp}` },
    update: {},
  });
  const brandSteel = await prisma.brand.upsert({
    where: { slug: `ph-steel-${stamp}` },
    create: { name: "Steel Seal PH", slug: `ph-steel-${stamp}` },
    update: {},
  });
  brandPowerId = brandPower.id;
  brandSteelId = brandSteel.id;
  const catClean = await prisma.category.upsert({
    where: { slug: `ph-clean-${stamp}` },
    create: { name: "Cleaners PH", slug: `ph-clean-${stamp}` },
    update: {},
  });
  const catSeal = await prisma.category.upsert({
    where: { slug: `ph-seal-${stamp}` },
    create: { name: "Sealants PH", slug: `ph-seal-${stamp}` },
    update: {},
  });
  catCleanId = catClean.id;
  catSealId = catSeal.id;

  for (const [sku, name, brandId, categoryId, brandName, catName] of [
    ["MATCH-A", "All Purpose Cleaner 5L", brandPowerId, catCleanId, "Power Maxed PH", "Cleaners PH"],
    ["MATCH-B", "Steel Seal Tube", brandSteelId, catSealId, "Steel Seal PH", "Sealants PH"],
  ] as const) {
    const existing = await prisma.productVariant.findUnique({ where: { sku } });
    if (!existing) {
      await saveProduct(adminId, {
        sku,
        name,
        brand: brandName,
        category: catName,
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
        name,
        isActive: true,
        isTradeVisible: true,
        status: "ACTIVE",
      },
    });
  }

  const companyA = await prisma.company.create({
    data: { name: `PH Co A ${stamp}`, status: "ACTIVE" },
  });
  const companyB = await prisma.company.create({
    data: { name: `PH Co B ${stamp}`, status: "ACTIVE" },
  });
  companyAId = companyA.id;
  companyBId = companyB.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: companyAId,
    code: `PHA${String(stamp).slice(-6)}`,
  });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: companyBId,
    code: `PHB${String(stamp).slice(-6)}`,
  });

  buyerAId = await ensureUser(`ph.buyer.a.${stamp}@example.invalid`, [], "TRADE");
  buyerBId = await ensureUser(`ph.buyer.b.${stamp}@example.invalid`, [], "TRADE");
  await prisma.companyUser.create({
    data: {
      companyId: companyAId,
      userId: buyerAId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });
  await prisma.companyUser.create({
    data: {
      companyId: companyBId,
      userId: buyerBId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });

  const codeA = (await prisma.company.findUniqueOrThrow({ where: { id: companyAId } }))
    .autopartCustomerCode!;
  await seedHistoric(companyAId, codeA);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("portal purchase history", () => {
  it("scopes by company (IDOR) and rejects spoofed companyId", async () => {
    const a = await listPortalPurchaseHistory(buyerAId, {});
    expect(a.summary.productsPurchased).toBeGreaterThanOrEqual(3);
    const b = await listPortalPurchaseHistory(buyerBId, {});
    expect(b.summary.productsPurchased).toBe(0);
    expect(b.items).toEqual([]);

    await expect(
      listPortalPurchaseHistory(buyerAId, { companyId: companyBId }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("summary metrics use distinct invoices and net credits", async () => {
    const r = await listPortalPurchaseHistory(buyerAId, { pageSize: 50 });
    expect(r.summary.productsPurchased).toBe(3);
    // Invoice docs with lines: SS900001, SS900002, SS900003, SS900099 = 4
    expect(r.summary.purchaseTransactions).toBe(4);
    // units: MATCH-A 10+5+8-2+1=22; MATCH-B 3; GONE 4+2=6 → 31
    expect(r.summary.unitsPurchased).toBe(31);
    expect(Number(r.summary.historicNetSpend)).toBeCloseTo(100 + 50 + 80 - 20 + 10 + 30 + 40 + 15, 2);
  });

  it("purchase count is distinct invoices; credits excluded; multi-line invoice once", async () => {
    const r = await listPortalPurchaseHistory(buyerAId, { pageSize: 50, sort: "NAME_AZ" });
    const matchA = r.items.find((i) => i.sku.toUpperCase() === "MATCH-A")!;
    expect(matchA.purchaseCount).toBe(3);
    expect(matchA.netUnits).toBe(22);
    expect(Number(matchA.netSpend)).toBeCloseTo(220, 2);
    expect(matchA.lastPurchasedDate).toBe("2026-03-10");
    expect(matchA.canBuyAgain).toBe(true);
    expect(matchA.action).toBe("BUY_AGAIN");
  });

  it("historic-only SKU keeps description and has no Buy Again", async () => {
    const r = await listPortalPurchaseHistory(buyerAId, {
      availability: "HISTORIC_ONLY",
      pageSize: 50,
    });
    const gone = r.items.find((i) => i.sku.toUpperCase() === "GONE-SKU");
    expect(gone).toBeTruthy();
    expect(gone!.name).toContain("Legacy Degreaser");
    expect(gone!.canBuyAgain).toBe(false);
    expect(gone!.action).toBe("HISTORIC_PRODUCT");
    expect(gone!.purchaseCount).toBe(2);
  });

  it("search, brand, category filters work", async () => {
    const bySku = await listPortalPurchaseHistory(buyerAId, { q: "MATCH-B", pageSize: 50 });
    expect(bySku.items.every((i) => i.sku.toUpperCase() === "MATCH-B")).toBe(true);

    const all = await listPortalPurchaseHistory(buyerAId, { pageSize: 50 });
    const matchA = all.items.find((i) => i.sku.toUpperCase() === "MATCH-A")!;
    const matchB = all.items.find((i) => i.sku.toUpperCase() === "MATCH-B")!;
    expect(matchA.brandId).toBeTruthy();
    expect(matchB.brandId).toBeTruthy();
    expect(matchA.brandId).not.toBe(matchB.brandId);

    const byBrand = await listPortalPurchaseHistory(buyerAId, {
      brandId: matchA.brandId!,
      pageSize: 50,
    });
    expect(byBrand.items.some((i) => i.sku.toUpperCase() === "MATCH-A")).toBe(true);
    expect(byBrand.items.some((i) => i.sku.toUpperCase() === "MATCH-B")).toBe(false);

    const byCat = await listPortalPurchaseHistory(buyerAId, {
      categoryId: matchB.categoryId!,
      pageSize: 50,
    });
    expect(byCat.items.map((i) => i.sku.toUpperCase())).toEqual(["MATCH-B"]);
  });

  it("date filter excludes undated-only products from the period", async () => {
    // Window covering only 2026-03 invoices — GONE-SKU's only dated purchase is 2025-01
    const r = await listPortalPurchaseHistory(buyerAId, {
      purchased: "CUSTOM",
      purchasedFrom: "2026-03-01",
      purchasedTo: "2026-03-31",
      pageSize: 50,
    });
    const skus = r.items.map((i) => i.sku.toUpperCase());
    expect(skus).toContain("MATCH-A");
    expect(skus).not.toContain("GONE-SKU");
    expect(skus).not.toContain("MATCH-B");
  });

  it("sorting and quick filters", async () => {
    const spend = await listPortalPurchaseHistory(buyerAId, {
      sort: "HIGHEST_SPEND",
      pageSize: 50,
    });
    expect(spend.items[0]!.sku.toUpperCase()).toBe("MATCH-A");

    const frequent = await listPortalPurchaseHistory(buyerAId, {
      quick: "FREQUENT",
      pageSize: 50,
    });
    expect(frequent.items.every((i) => i.purchaseCount >= 3)).toBe(true);
    expect(frequent.items.some((i) => i.sku.toUpperCase() === "MATCH-A")).toBe(true);
    expect(frequent.items.some((i) => i.sku.toUpperCase() === "MATCH-B")).toBe(false);

    const historic = await listPortalPurchaseHistory(buyerAId, {
      quick: "HISTORIC_ONLY",
      pageSize: 50,
    });
    expect(historic.items.every((i) => i.action === "HISTORIC_PRODUCT")).toBe(true);
  });

  it("pagination", async () => {
    const p1 = await listPortalPurchaseHistory(buyerAId, { page: 1, pageSize: 2, sort: "NAME_AZ" });
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(3);
    const p2 = await listPortalPurchaseHistory(buyerAId, { page: 2, pageSize: 2, sort: "NAME_AZ" });
    expect(p2.items).toHaveLength(1);
    expect(p1.items[0]!.sku).not.toBe(p2.items[0]!.sku);
  });

  it("product insight: monthly trend, averages, credits, undated handling", async () => {
    const insight = await getPortalPurchaseProductInsight(buyerAId, { sku: "MATCH-A" });
    expect(insight.metrics.purchaseCount).toBe(3);
    expect(insight.metrics.totalNetUnits).toBe(22);
    expect(Number(insight.metrics.historicNetSpend)).toBeCloseTo(220, 2);
    expect(insight.metrics.averageQuantityPerPurchase).toBeCloseTo(22 / 3, 2);
    expect(insight.metrics.firstKnownPurchase).toBe("2025-01-15");
    expect(insight.metrics.lastPurchased).toBe("2026-03-10");
    expect(insight.metrics.averageDaysBetweenPurchases).toBeGreaterThan(0);
    expect(insight.hasDatedHistory).toBe(true);
    expect(insight.monthly.length).toBeGreaterThanOrEqual(3);
    const mar = insight.monthly.find((m) => m.monthKey === "2026-03");
    expect(mar).toBeTruthy();
    // March: +8+1 invoice units and -2 credit = +7 units; spend 80+10-20=70
    expect(mar!.units).toBe(7);
    expect(Number(mar!.spend)).toBeCloseTo(70, 2);
    expect(insight.canBuyAgain).toBe(true);

    const gone = await getPortalPurchaseProductInsight(buyerAId, { sku: "GONE-SKU" });
    expect(gone.action).toBe("HISTORIC_PRODUCT");
    expect(gone.canBuyAgain).toBe(false);
    expect(gone.historicDescription).toContain("Legacy Degreaser");

    await expect(
      getPortalPurchaseProductInsight(buyerBId, { sku: "MATCH-A" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("period comparison returns New activity when previous period empty", async () => {
    const insight = await getPortalPurchaseProductInsight(buyerAId, { sku: "MATCH-B" });
    // MATCH-B only purchased 2025-06 — relative to "today" (2026) last12 may be empty;
    // comparison helpers must not produce Infinity.
    const c12 = insight.metrics.comparison12Months;
    if (c12) {
      expect(c12.unitsChangePct === null || Number.isFinite(c12.unitsChangePct)).toBe(true);
    }
  });

  it("purchaseHistoryWindowRange LAST_N windows are inclusive of today", () => {
    const today = "2026-09-29";
    expect(purchaseHistoryWindowRange("ANY", null, null, today)).toBeNull();
    expect(purchaseHistoryWindowRange("LAST_30", null, null, today)).toEqual({
      from: "2026-08-31",
      to: "2026-09-29",
    });
    expect(purchaseHistoryWindowRange("LAST_90", null, null, today)).toEqual({
      from: "2026-07-02",
      to: "2026-09-29",
    });
    expect(purchaseHistoryWindowRange("LAST_180", null, null, today)).toEqual({
      from: "2026-04-03",
      to: "2026-09-29",
    });
    expect(purchaseHistoryWindowRange("LAST_365", null, null, today)).toEqual({
      from: "2025-09-30",
      to: "2026-09-29",
    });
    expect(
      purchaseHistoryWindowRange("CUSTOM", "2026-03-01", "2026-03-31", today),
    ).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("LAST_30 / LAST_90 / LAST_180 / LAST_365 match CUSTOM of the same inclusive window", async () => {
    const any = await listPortalPurchaseHistory(buyerAId, { pageSize: 50 });
    const windows = ["LAST_30", "LAST_90", "LAST_180", "LAST_365"] as const;
    for (const purchased of windows) {
      const ranged = await listPortalPurchaseHistory(buyerAId, { purchased, pageSize: 50 });
      const wr = purchaseHistoryWindowRange(
        purchased,
        null,
        null,
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/London",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
      );
      const custom = await listPortalPurchaseHistory(buyerAId, {
        purchased: "CUSTOM",
        purchasedFrom: wr!.from,
        purchasedTo: wr!.to,
        pageSize: 50,
      });
      expect(ranged.total).toBe(custom.total);
      expect(ranged.summary).toEqual(custom.summary);
      expect(ranged.items.map((i) => i.sku.toUpperCase()).sort()).toEqual(
        custom.items.map((i) => i.sku.toUpperCase()).sort(),
      );
      // Bounded windows must not silently fall back to lifetime ANY.
      if (ranged.total === 0) {
        expect(ranged.summary.productsPurchased).toBe(0);
        expect(ranged.summary.purchaseTransactions).toBe(0);
        expect(Number(ranged.summary.historicNetSpend)).toBe(0);
        expect(ranged.summary.unitsPurchased).toBe(0);
        expect(ranged.items).toEqual([]);
      } else {
        expect(ranged.summary.productsPurchased).toBeLessThanOrEqual(any.summary.productsPurchased);
      }
    }
  });

  it("period filter recalculates row metrics and summary (not lifetime)", async () => {
    const r = await listPortalPurchaseHistory(buyerAId, {
      purchased: "CUSTOM",
      purchasedFrom: "2026-03-01",
      purchasedTo: "2026-03-31",
      pageSize: 50,
    });
    expect(r.total).toBe(1);
    expect(r.items.map((i) => i.sku.toUpperCase())).toEqual(["MATCH-A"]);
    const matchA = r.items[0]!;
    // March invoices SS900003 (8+1 units, 80+10 spend) + credit -2 / -20 — not lifetime 22 / 220
    expect(matchA.purchaseCount).toBe(1);
    expect(matchA.netUnits).toBe(7);
    expect(Number(matchA.netSpend)).toBeCloseTo(70, 2);
    expect(matchA.firstPurchasedDate).toBe("2026-03-10");
    expect(matchA.lastPurchasedDate).toBe("2026-03-10");
    expect(r.summary.productsPurchased).toBe(1);
    expect(r.summary.purchaseTransactions).toBe(1);
    expect(r.summary.unitsPurchased).toBe(7);
    expect(Number(r.summary.historicNetSpend)).toBeCloseTo(70, 2);
  });

  it("product with no dated transaction in range disappears", async () => {
    const r = await listPortalPurchaseHistory(buyerAId, {
      purchased: "CUSTOM",
      purchasedFrom: "2025-06-01",
      purchasedTo: "2025-06-30",
      pageSize: 50,
    });
    const skus = r.items.map((i) => i.sku.toUpperCase());
    expect(skus).toContain("MATCH-A");
    expect(skus).toContain("MATCH-B");
    expect(skus).not.toContain("GONE-SKU");
    const matchA = r.items.find((i) => i.sku.toUpperCase() === "MATCH-A")!;
    expect(matchA.purchaseCount).toBe(1);
    expect(matchA.netUnits).toBe(5);
    expect(Number(matchA.netSpend)).toBeCloseTo(50, 2);
    expect(matchA.lastPurchasedDate).toBe("2025-06-20");
    expect(matchA.firstPurchasedDate).toBe("2025-06-20");
    const matchB = r.items.find((i) => i.sku.toUpperCase() === "MATCH-B")!;
    expect(matchB.purchaseCount).toBe(1);
    expect(matchB.netUnits).toBe(3);
    expect(r.summary.productsPurchased).toBe(2);
    expect(r.summary.purchaseTransactions).toBe(1); // shared SS900002
    expect(r.summary.unitsPurchased).toBe(8);
    expect(Number(r.summary.historicNetSpend)).toBeCloseTo(80, 2);
  });

  it("credits in period reduce net spend and credits-only SKUs still appear", async () => {
    const r = await listPortalPurchaseHistory(buyerAId, {
      purchased: "CUSTOM",
      purchasedFrom: "2026-03-15",
      purchasedTo: "2026-03-31",
      pageSize: 50,
    });
    expect(r.items.map((i) => i.sku.toUpperCase())).toEqual(["MATCH-A"]);
    const matchA = r.items[0]!;
    expect(matchA.purchaseCount).toBe(0);
    expect(matchA.netUnits).toBe(-2);
    expect(Number(matchA.netSpend)).toBeCloseTo(-20, 2);
    expect(r.summary.productsPurchased).toBe(1);
    expect(r.summary.purchaseTransactions).toBe(0);
    expect(r.summary.unitsPurchased).toBe(-2);
    expect(Number(r.summary.historicNetSpend)).toBeCloseTo(-20, 2);
  });

  it("empty period returns empty items and zero summary (no ANY fallback)", async () => {
    const r = await listPortalPurchaseHistory(buyerAId, {
      purchased: "CUSTOM",
      purchasedFrom: "2024-01-01",
      purchasedTo: "2024-01-31",
      pageSize: 50,
    });
    expect(r.total).toBe(0);
    expect(r.items).toEqual([]);
    expect(r.summary.productsPurchased).toBe(0);
    expect(r.summary.purchaseTransactions).toBe(0);
    expect(r.summary.unitsPurchased).toBe(0);
    expect(Number(r.summary.historicNetSpend)).toBe(0);
  });

  it("undated invoices are excluded from bounded periods", async () => {
    const r = await listPortalPurchaseHistory(buyerAId, {
      purchased: "CUSTOM",
      purchasedFrom: "2025-01-01",
      purchasedTo: "2025-01-31",
      pageSize: 50,
    });
    const gone = r.items.find((i) => i.sku.toUpperCase() === "GONE-SKU")!;
    expect(gone.purchaseCount).toBe(1);
    expect(gone.netUnits).toBe(4);
    expect(Number(gone.netSpend)).toBeCloseTo(40, 2);
  });

  it("brand filter combines with purchased period; summary follows the filtered set", async () => {
    const matchA = (
      await listPortalPurchaseHistory(buyerAId, { pageSize: 50 })
    ).items.find((i) => i.sku.toUpperCase() === "MATCH-A")!;
    const matchB = (
      await listPortalPurchaseHistory(buyerAId, { pageSize: 50 })
    ).items.find((i) => i.sku.toUpperCase() === "MATCH-B")!;

    const power = await listPortalPurchaseHistory(buyerAId, {
      purchased: "CUSTOM",
      purchasedFrom: "2025-06-01",
      purchasedTo: "2025-06-30",
      brandId: matchA.brandId!,
      pageSize: 50,
    });
    expect(power.items.map((i) => i.sku.toUpperCase())).toEqual(["MATCH-A"]);
    expect(power.summary.productsPurchased).toBe(1);
    expect(power.summary.unitsPurchased).toBe(5);
    expect(Number(power.summary.historicNetSpend)).toBeCloseTo(50, 2);

    const steel = await listPortalPurchaseHistory(buyerAId, {
      purchased: "CUSTOM",
      purchasedFrom: "2026-03-01",
      purchasedTo: "2026-03-31",
      brandId: matchB.brandId!,
      pageSize: 50,
    });
    expect(steel.total).toBe(0);
    expect(steel.items).toEqual([]);
    expect(steel.summary.productsPurchased).toBe(0);
    expect(steel.summary.unitsPurchased).toBe(0);
  });

  it("ANY time still shows lifetime aggregation including undated lines", async () => {
    const r = await listPortalPurchaseHistory(buyerAId, { purchased: "ANY", pageSize: 50 });
    expect(r.summary.productsPurchased).toBe(3);
    expect(r.summary.purchaseTransactions).toBe(4);
    expect(r.summary.unitsPurchased).toBe(31);
    const gone = r.items.find((i) => i.sku.toUpperCase() === "GONE-SKU")!;
    expect(gone.purchaseCount).toBe(2);
    expect(gone.netUnits).toBe(6);
    const matchA = r.items.find((i) => i.sku.toUpperCase() === "MATCH-A")!;
    expect(matchA.purchaseCount).toBe(3);
    expect(matchA.netUnits).toBe(22);
  });

  it("search, category, availability and quick combine with purchased period", async () => {
    const search = await listPortalPurchaseHistory(buyerAId, {
      q: "MATCH",
      purchased: "CUSTOM",
      purchasedFrom: "2026-03-01",
      purchasedTo: "2026-03-31",
      pageSize: 50,
    });
    expect(search.items.map((i) => i.sku.toUpperCase())).toEqual(["MATCH-A"]);
    expect(search.summary.productsPurchased).toBe(1);

    const cat = await listPortalPurchaseHistory(buyerAId, {
      categoryId: catSealId,
      purchased: "CUSTOM",
      purchasedFrom: "2025-06-01",
      purchasedTo: "2025-06-30",
      pageSize: 50,
    });
    expect(cat.items.map((i) => i.sku.toUpperCase())).toEqual(["MATCH-B"]);

    const historicPeriod = await listPortalPurchaseHistory(buyerAId, {
      availability: "HISTORIC_ONLY",
      purchased: "CUSTOM",
      purchasedFrom: "2025-01-01",
      purchasedTo: "2025-01-31",
      pageSize: 50,
    });
    expect(historicPeriod.items.every((i) => i.sku.toUpperCase() === "GONE-SKU")).toBe(true);

    const frequentInJune = await listPortalPurchaseHistory(buyerAId, {
      quick: "FREQUENT",
      purchased: "CUSTOM",
      purchasedFrom: "2025-06-01",
      purchasedTo: "2025-06-30",
      pageSize: 50,
    });
    expect(frequentInJune.items).toHaveLength(0);
    expect(frequentInJune.summary.productsPurchased).toBe(0);
  });

  it("compat shim listPortalHistoricPurchases still works", async () => {
    const legacy = await listPortalHistoricPurchases(buyerAId, { filter: "AVAILABLE" });
    expect(legacy.items.every((i) => i.canBuyAgain)).toBe(true);
    expect(legacy.items.some((i) => i.sku.toUpperCase() === "MATCH-A")).toBe(true);
  });
});
