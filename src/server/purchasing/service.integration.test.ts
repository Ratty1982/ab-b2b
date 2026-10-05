import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
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
  });

  it("explains Incoming cover on SKU drill-down and keeps Latest Cost off trade-shaped payloads", async () => {
    const detail = await getPurchasingSku(adminId, skuA);
    expect(detail.forecast.availableQty).toBe(36);
    expect(detail.forecast.incomingQty).toBe(240);
    expect(detail.forecast.why).toMatch(/on order|incoming/i);
    expect(detail.chart.length).toBeGreaterThan(0);
    expect(JSON.stringify(detail)).not.toMatch(/Arriving \d/);
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
  });
});
