import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { getPublicProduct } from "@/server/catalogue/products";
import { applyStockFeed } from "@/server/stock/service";
import { buildNative231Po3New } from "@/server/stock/fixtures/native-231po3new";
import { addDaysIso, todayLondonDateOnly } from "@/domain/sales-history-period";
import {
  exportPurchasePlannerCsv,
  getPurchasingDashboard,
  getPurchasingSku,
  listPurchasingForecast,
  updatePurchasingPlan,
  updatePurchasingSettings,
  updateSkuPurchasingSettings,
} from "@/server/purchasing/service";
import { netUnitsBySku } from "@/server/purchasing/demand";

const prisma = new PrismaClient();
const stamp = Date.now();
const today = todayLondonDateOnly();

let adminId = "";
let managementId = "";
let accountsId = "";
let salesId = "";
let tradeId = "";
let skuA = `PUR-A-${stamp}`;
let skuB = `PUR-B-${stamp}`;
let companyId = "";

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

async function makeSku(sku: string, name: string) {
  const product = await saveProduct(adminId, {
    sku,
    name,
    brand: "Power Maxed",
    category: "Cleaning",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
  });
  await prisma.product.update({
    where: { id: product.id },
    data: { status: "ACTIVE", isActive: true, isTradeVisible: true },
  });
  return prisma.productVariant.findUniqueOrThrow({ where: { sku } });
}

async function seedSale(sku: string, date: string, units: string, ref: string, type: "INVOICE" | "CREDIT" = "INVOICE") {
  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId,
      autopartCustomerCode: `PUR${String(stamp).slice(-6)}`,
      documentType: type,
      documentReference: ref,
      documentDate: new Date(`${date}T12:00:00.000Z`),
      source: "SLRB",
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId,
      documentId: doc.id,
      autopartCustomerCode: `PUR${String(stamp).slice(-6)}`,
      documentType: type,
      documentReference: ref,
      lineNumber: 1,
      sku,
      units,
      salesNet: type === "CREDIT" ? "-10.00" : "40.00",
      matchStatus: "MATCHED",
      source: "561L",
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`pur.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  managementId = await ensureUser(`pur.mgmt.${stamp}@example.invalid`, ["MANAGEMENT"]);
  accountsId = await ensureUser(`pur.acc.${stamp}@example.invalid`, ["ACCOUNTS"]);
  salesId = await ensureUser(`pur.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  tradeId = await ensureUser(`pur.trade.${stamp}@example.invalid`, [], "TRADE");

  const company = await prisma.company.create({
    data: {
      name: `Purchasing Co ${stamp}`,
      status: "ACTIVE",
      autopartCustomerCode: `PUR${String(stamp).slice(-6)}`,
    },
  });
  companyId = company.id;

  await makeSku(skuA, `Purchasing Cleaner ${stamp}`);
  await makeSku(skuB, `Purchasing Quiet ${stamp}`);

  await applyStockFeed({
    text: buildNative231Po3New([
      {
        sku: skuA,
        description: "CLEANER",
        stk: "40.0000",
        avail: "36.0000",
        pick: "0.0000",
        physical: "40.0000",
        incoming: "240.0000",
        cost: "2.5000",
      },
      {
        sku: skuB,
        description: "QUIET",
        stk: "200.0000",
        avail: "180.0000",
        pick: "0.0000",
        physical: "200.0000",
        incoming: "0.0000",
      },
    ]),
    dryRun: false,
    trigger: "manual",
    actorUserId: adminId,
  });
  await prisma.autopartProductCostPosition.deleteMany({ where: { sku: skuB } });

  await seedSale(skuA, addDaysIso(today, -3), "70", `PUR-${stamp}-INV1`);
  await seedSale(skuA, addDaysIso(today, -2), "-10", `PUR-${stamp}-CR1`, "CREDIT");
  await seedSale(skuA, addDaysIso(today, -40), "30", `PUR-${stamp}-INV2`);

  await prisma.purchasingSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: { verifiedSalesHistoryFrom: null },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("purchasing RBAC", () => {
  it("allows Super Admin and Management, Accounts view, denies sales and trade", async () => {
    await expect(getPurchasingDashboard(adminId)).resolves.toMatchObject({ canManage: true });
    await expect(getPurchasingDashboard(managementId)).resolves.toMatchObject({ canManage: true });
    const accounts = await getPurchasingDashboard(accountsId);
    expect(accounts.canManage).toBe(false);
    expect(accounts.metrics.critical).toBeGreaterThanOrEqual(0);
    await expect(getPurchasingDashboard(salesId)).rejects.toBeInstanceOf(AuthError);
    await expect(getPurchasingDashboard(tradeId)).rejects.toBeInstanceOf(AuthError);
    await expect(listPurchasingForecast(salesId, {})).rejects.toBeInstanceOf(AuthError);
    await expect(exportPurchasePlannerCsv(tradeId, {})).rejects.toBeInstanceOf(AuthError);
    await expect(updatePurchasingSettings(accountsId, {
      defaultTargetCoverWeeks: 8,
      defaultSafetyStockQty: 0,
      criticalCoverWeeks: 1,
      watchCoverWeeks: 3,
      overstockCoverWeeks: 26,
    })).rejects.toBeInstanceOf(AuthError);
    await expect(updatePurchasingPlan(salesId, { sku: skuA, plannedQty: 12 })).rejects.toBeInstanceOf(AuthError);
  });
});

describe("purchasing forecast from AutopartSalesLine", () => {
  it("uses grouped net units, credits reduce demand, Incoming is not sellable cover", async () => {
    const maps = await netUnitsBySku({ from: addDaysIso(today, -6), to: today });
    expect(maps.get(skuA.toUpperCase())).toBe(60);

    const list = await listPurchasingForecast(adminId, { q: skuA, pageSize: 20 });
    const row = list.rows.find((r) => r.sku === skuA);
    expect(row).toBeTruthy();
    expect(row!.availableQty).toBe(36);
    expect(row!.incomingQty).toBe(240);
    expect(row!.forecastConfidence).toBe("UNVERIFIED");
    expect(row!.salesHistoryVerified).toBe(false);
    expect(row!.salesHistoryCoverageDays).toBe(0);
    expect(row!.demandComponents.last30).toBe("unverified");
    expect(row!.demandComponents.last90).toBe("unverified");
    expect(row!.demandComponents.last365).toBe("unverified");
    expect(row!.demandComponents.seasonalAvailable).toBe(false);
    expect(row!.rates.last7.netUnits).toBe(60);
    expect(row!.weeksCover).not.toBeNull();
    expect(row!.projectedCover).toBeGreaterThan(row!.weeksCover ?? 0);
    expect(Number(row!.latestCost)).toBeCloseTo(2.5);
    expect(row!.suggestedValue == null || Number(row!.suggestedValue) > 0).toBe(true);

    const quiet = (await listPurchasingForecast(adminId, { q: skuB, pageSize: 20 })).rows.find((r) => r.sku === skuB);
    expect(quiet?.availableQty).toBe(180);
    expect(quiet?.incomingQty).toBe(0);
    expect(quiet?.latestCost).toBeNull();
    expect(quiet?.suggestedValue).toBeNull();
    expect(quiet?.availableStockValue).toBeNull();
    expect(quiet?.forecastConfidence).toBe(row!.forecastConfidence);

    const dash = await getPurchasingDashboard(adminId);
    expect(dash.forecastCoverage.coverageDays).toBe(row!.salesHistoryCoverageDays);
    expect(dash.forecastCoverage.verified).toBe(false);
    expect(dash.forecastCoverage.confidence).toBe("UNVERIFIED");
    expect(dash.forecastCoverage.counts.UNVERIFIED).toBeGreaterThan(0);
    expect(dash.forecastCoverage.counts.STRONG).toBe(0);
  });

  it("explains Incoming cover on SKU drill-down and keeps Latest Cost off trade-shaped payloads", async () => {
    const detail = await getPurchasingSku(adminId, skuA);
    expect(detail.forecast.availableQty).toBe(36);
    expect(detail.forecast.incomingQty).toBe(240);
    expect(detail.forecast.forecastConfidence).toBe("UNVERIFIED");
    expect(detail.forecast.salesHistoryVerified).toBe(false);
    expect(detail.forecast.salesHistoryCoverageDays).toBe(0);
    expect(detail.forecast.demandComponents).toBeTruthy();
    expect(detail.forecast.why).toMatch(/on order|incoming/i);
    expect(detail.chart.length).toBeGreaterThan(0);
    expect(JSON.stringify(detail)).not.toMatch(/Arriving \d/);
    const pub = await getPublicProduct(null, skuA);
    expect(JSON.stringify(pub)).not.toMatch(/forecastConfidence/);
    expect(JSON.stringify(pub)).not.toMatch(/salesHistoryCoverageDays/);
    expect(JSON.stringify(pub)).not.toContain("incomingQty");
  });

  it("stores a planned qty without changing Incoming", async () => {
    const updated = await updatePurchasingPlan(adminId, { sku: skuA, plannedQty: 24, note: "Hold for promotion" });
    expect(updated.forecast.plannedQty).toBe(24);
    expect(updated.forecast.note).toBe("Hold for promotion");
    const inv = await prisma.inventory.findFirstOrThrow({
      where: { variant: { sku: skuA } },
    });
    expect(inv.incomingQty).toBe(240);
    expect(inv.qtyOnHand).toBe(36);
  });

  it("applies SKU MOQ/multiple settings and exports CSV without claiming Autopart PO import", async () => {
    await updateSkuPurchasingSettings(adminId, {
      sku: skuA,
      leadTimeDays: 21,
      minimumOrderQty: 24,
      orderMultiple: 12,
      safetyStockQty: 0,
      targetCoverWeeks: 8,
    });
    const csv = await exportPurchasePlannerCsv(adminId, { q: skuA });
    expect(csv.disclaimer).toMatch(/not an Autopart purchase-order import/i);
    expect(csv.csv).toContain(skuA);
    expect(csv.csv).toContain("Incoming");
    expect(csv.csv).toContain("Forecast Confidence");
    expect(csv.csv).toContain("Sales History Coverage Days");
    expect(csv.csv).toContain("30d Coverage");
    expect(csv.csv).toContain("90d Coverage");
    expect(csv.csv).toContain("365d Coverage");
    expect(csv.csv).toContain("Seasonal Comparison Available");
  });
});

const SETTINGS_DEFAULTS = {
  defaultTargetCoverWeeks: 8,
  defaultSafetyStockQty: 0,
  criticalCoverWeeks: 1,
  watchCoverWeeks: 3,
  overstockCoverWeeks: 26,
};

describe("verified sales-history coverage", () => {
  afterAll(async () => {
    await updatePurchasingSettings(adminId, {
      ...SETTINGS_DEFAULTS,
      verifiedSalesHistoryFrom: null,
    });
  });

  it(
    "does not treat a 2014 invoice as Strong, and clips demand once verification is set",
    async () => {
    await seedSale(skuA, "2014-10-06", "400", `PUR-${stamp}-OLD`);
    await seedSale(skuA, addDaysIso(today, -370), "12", `PUR-${stamp}-SPY`);

    const lineCountBefore = await prisma.autopartSalesLine.count();
    const docCountBefore = await prisma.autopartSalesDocument.count();
    const netBefore = await prisma.autopartSalesLine.aggregate({ _sum: { salesNet: true, units: true } });

    const unverified = (await listPurchasingForecast(adminId, { q: skuA, pageSize: 20 })).rows.find(
      (r) => r.sku === skuA,
    );
    expect(unverified?.forecastConfidence).toBe("UNVERIFIED");
    expect(unverified?.demandComponents.last30).toBe("unverified");
    expect(unverified?.demandComponents.last90).toBe("unverified");
    expect(unverified?.demandComponents.last365).toBe("unverified");
    expect(unverified?.demandComponents.seasonalAvailable).toBe(false);
    expect(unverified?.rates.last365.netUnits).toBeGreaterThan(0);

    const veryLowFrom = addDaysIso(today, -13);
    await updatePurchasingSettings(adminId, {
      ...SETTINGS_DEFAULTS,
      verifiedSalesHistoryFrom: veryLowFrom,
    });
    const veryLow = (await listPurchasingForecast(adminId, { q: skuA, pageSize: 20 })).rows.find(
      (r) => r.sku === skuA,
    );
    expect(veryLow?.forecastConfidence).toBe("VERY_LOW");
    expect(veryLow?.salesHistoryCoverageDays).toBe(14);
    expect(veryLow?.demandComponents.last30).toBe("partial");
    expect(veryLow?.demandComponents.last90).toBe("partial");
    expect(veryLow?.demandComponents.last365).toBe("partial");
    expect(veryLow?.demandComponents.seasonalAvailable).toBe(false);
    expect(veryLow?.rates.last365.netUnits).toBe(veryLow?.rates.last30.netUnits);
    expect(veryLow?.rates.last365.netUnits).not.toBe(unverified?.rates.last365.netUnits);

    await updatePurchasingSettings(adminId, {
      ...SETTINGS_DEFAULTS,
      verifiedSalesHistoryFrom: addDaysIso(today, -29),
    });
    const low = (await listPurchasingForecast(adminId, { q: skuA, pageSize: 20 })).rows.find((r) => r.sku === skuA);
    expect(low?.forecastConfidence).toBe("LOW");
    expect(low?.salesHistoryCoverageDays).toBe(30);
    expect(low?.demandComponents.last30).toBe("full");
    expect(low?.demandComponents.last90).toBe("partial");
    expect(low?.demandComponents.last365).toBe("partial");

    await updatePurchasingSettings(adminId, {
      ...SETTINGS_DEFAULTS,
      verifiedSalesHistoryFrom: addDaysIso(today, -89),
    });
    const building = (await listPurchasingForecast(adminId, { q: skuA, pageSize: 20 })).rows.find(
      (r) => r.sku === skuA,
    );
    expect(building?.forecastConfidence).toBe("BUILDING");
    expect(building?.salesHistoryCoverageDays).toBe(90);
    expect(building?.demandComponents.last30).toBe("full");
    expect(building?.demandComponents.last90).toBe("full");
    expect(building?.demandComponents.last365).toBe("partial");
    expect(building?.demandComponents.seasonalAvailable).toBe(false);

    await updatePurchasingSettings(adminId, {
      ...SETTINGS_DEFAULTS,
      verifiedSalesHistoryFrom: addDaysIso(today, -179),
    });
    const good = (await listPurchasingForecast(adminId, { q: skuA, pageSize: 20 })).rows.find((r) => r.sku === skuA);
    expect(good?.forecastConfidence).toBe("GOOD");
    expect(good?.salesHistoryCoverageDays).toBe(180);

    await updatePurchasingSettings(adminId, {
      ...SETTINGS_DEFAULTS,
      verifiedSalesHistoryFrom: addDaysIso(today, -364),
    });
    const strong = (await listPurchasingForecast(adminId, { q: skuA, pageSize: 20 })).rows.find((r) => r.sku === skuA);
    expect(strong?.forecastConfidence).toBe("STRONG");
    expect(strong?.salesHistoryCoverageDays).toBe(365);
    expect(strong?.demandComponents.last30).toBe("full");
    expect(strong?.demandComponents.last90).toBe("full");
    expect(strong?.demandComponents.last365).toBe("full");
    expect(strong?.demandComponents.seasonalAvailable).toBe(false);
    expect(strong?.salesHistoryCoverageDays).toBeLessThan(400);
    expect(strong?.rates.last365.netUnits).toBe(unverified!.rates.last365.netUnits);

    await updatePurchasingSettings(adminId, {
      ...SETTINGS_DEFAULTS,
      verifiedSalesHistoryFrom: addDaysIso(today, -400),
    });
    const seasonal = (await listPurchasingForecast(adminId, { q: skuA, pageSize: 20 })).rows.find(
      (r) => r.sku === skuA,
    );
    expect(seasonal?.forecastConfidence).toBe("STRONG");
    expect(seasonal?.demandComponents.seasonalAvailable).toBe(true);
    expect(seasonal?.demandReason).toMatch(/seasonal/i);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "purchasing.settings.update", actorUserId: adminId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(audit?.before).toMatchObject({ verifiedSalesHistoryFrom: addDaysIso(today, -364) });
    expect(audit?.after).toMatchObject({ verifiedSalesHistoryFrom: addDaysIso(today, -400) });

    const cleared = await updatePurchasingSettings(adminId, {
      ...SETTINGS_DEFAULTS,
      verifiedSalesHistoryFrom: null,
    });
    expect(cleared.verifiedSalesHistoryFrom).toBeNull();
    const back = (await listPurchasingForecast(adminId, { q: skuA, pageSize: 20 })).rows.find((r) => r.sku === skuA);
    expect(back?.forecastConfidence).toBe("UNVERIFIED");
    expect(back?.demandComponents.last30).toBe("unverified");
    expect(back?.demandComponents.seasonalAvailable).toBe(false);

    const lineCountAfter = await prisma.autopartSalesLine.count();
    const docCountAfter = await prisma.autopartSalesDocument.count();
    const netAfter = await prisma.autopartSalesLine.aggregate({ _sum: { salesNet: true, units: true } });
    expect(lineCountAfter).toBe(lineCountBefore);
    expect(docCountAfter).toBe(docCountBefore);
    expect(String(netAfter._sum.salesNet ?? "0")).toBe(String(netBefore._sum.salesNet ?? "0"));
    expect(String(netAfter._sum.units ?? "0")).toBe(String(netBefore._sum.units ?? "0"));
    expect(await prisma.inventory.findFirstOrThrow({ where: { variant: { sku: skuA } } })).toMatchObject({
      incomingQty: 240,
      qtyOnHand: 36,
    });
  },
  60_000,
);

  it("rejects unverified date changes from Accounts and does not auto-fill from MIN(documentDate)", async () => {
    await updatePurchasingSettings(adminId, {
      ...SETTINGS_DEFAULTS,
      verifiedSalesHistoryFrom: null,
    });
    await expect(
      updatePurchasingSettings(accountsId, {
        ...SETTINGS_DEFAULTS,
        verifiedSalesHistoryFrom: "2014-10-06",
      }),
    ).rejects.toBeInstanceOf(AuthError);
    const settings = (await getPurchasingDashboard(adminId)).settings;
    expect(settings.verifiedSalesHistoryFrom).toBeNull();
    await expect(
      updatePurchasingSettings(adminId, {
        ...SETTINGS_DEFAULTS,
        verifiedSalesHistoryFrom: addDaysIso(today, 1),
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

