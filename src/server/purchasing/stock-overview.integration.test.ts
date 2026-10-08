/**
 * Stock overview reads imported warehouse Avail and keeps FBA in its own column.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { FBA_LOCATION_CODE, FBA_SOURCE_BRANCH } from "@/domain/fba-stock";
import { skuMatchKey } from "@/domain/stock";
import { AuthError } from "@/server/rbac/guards";
import { exportStockOverviewCsv, getStockOverview } from "@/server/purchasing/stock-overview";

const prisma = new PrismaClient();
const stamp = `SOV${Date.now().toString(36).slice(-6).toUpperCase()}`;
const warehouseSku = `${stamp}W`;
const fbaSku = `${stamp}F`;
const historicSku = `${stamp}H`;

let adminId = "";
let salesId = "";
let tradeId = "";

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType, emailVerified: true },
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

describe("stock overview", () => {
  beforeAll(async () => {
    await bootstrapRbac(prisma);
    adminId = await ensureUser("stock-overview.admin@example.invalid", ["SUPER_ADMIN"]);
    salesId = await ensureUser("stock-overview.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
    tradeId = await ensureUser("stock-overview.trade@example.invalid", [], "TRADE");
    const now = new Date();
    await prisma.autopartProduct.createMany({
      data: [
        {
          sku: warehouseSku,
          matchKey: skuMatchKey(warehouseSku),
          description: "Overview warehouse line",
          groupCode: stamp,
          conditionCode: "W",
          availQty: 40,
          incomingQty: 5,
          physicalQty: 44,
          latestCost: "12.5000",
          presentInLatestFeed: true,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        {
          sku: fbaSku,
          matchKey: skuMatchKey(fbaSku),
          description: "Overview FBA line",
          groupCode: stamp,
          conditionCode: "O",
          availQty: 2,
          incomingQty: 0,
          latestCost: "9.0000",
          presentInLatestFeed: true,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        {
          sku: historicSku,
          matchKey: skuMatchKey(historicSku),
          description: "Overview historic line",
          availQty: 8,
          presentInLatestFeed: false,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      ],
    });
    const fbaProduct = await prisma.autopartProduct.findUniqueOrThrow({ where: { matchKey: skuMatchKey(fbaSku) } });
    await prisma.autopartLocationStock.create({
      data: {
        autopartProductId: fbaProduct.id,
        locationCode: FBA_LOCATION_CODE,
        availableQty: 15,
        sourceBranch: FBA_SOURCE_BRANCH,
        sourceImportedAt: now,
      },
    });
  });

  afterAll(async () => {
    const products = await prisma.autopartProduct.findMany({
      where: { matchKey: { startsWith: stamp } },
      select: { id: true },
    });
    await prisma.autopartLocationStock.deleteMany({ where: { autopartProductId: { in: products.map((row) => row.id) } } });
    await prisma.autopartProduct.deleteMany({ where: { id: { in: products.map((row) => row.id) } } });
    await prisma.$disconnect();
  });

  it("keeps warehouse Avail separate from FBA and omits cost", async () => {
    const before = await getStockOverview(adminId, {});
    const result = await getStockOverview(adminId, { q: stamp, feed: "current" });
    const warehouse = result.items.find((row) => row.sku === warehouseSku);
    const fba = result.items.find((row) => row.sku === fbaSku);
    expect(warehouse).toMatchObject({
      availQty: 40,
      incomingQty: 5,
      fbaQty: 0,
      ownedQty: 40,
      sellableQty: null,
      reservedQty: null,
      inCatalogue: false,
    });
    expect(fba).toMatchObject({ availQty: 2, fbaQty: 15, ownedQty: 17 });
    expect(result.items.some((row) => row.sku === historicSku)).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/latestCost|12\.5|supplier cost/i);
    expect(result.summary.availUnits).toBeGreaterThanOrEqual(before.summary.availUnits);
    expect(result.summary.fbaUnits).toBeGreaterThanOrEqual(15);

    const historic = await getStockOverview(adminId, { q: historicSku, feed: "historic" });
    expect(historic.items.map((row) => row.sku)).toEqual([historicSku]);

    const fbaOnly = await getStockOverview(adminId, { q: stamp, position: "fba" });
    expect(fbaOnly.items.map((row) => row.sku)).toEqual([fbaSku]);

    const csv = await exportStockOverviewCsv(adminId, { q: warehouseSku });
    expect(csv.csv).toContain(warehouseSku);
    expect(csv.csv).toContain("Warehouse Avail");
    expect(csv.csv).not.toContain("12.5");
    expect(csv.truncated).toBe(false);
  });

  it("refuses sales and trade users", async () => {
    await expect(getStockOverview(salesId, {})).rejects.toBeInstanceOf(AuthError);
    await expect(getStockOverview(tradeId, {})).rejects.toBeInstanceOf(AuthError);
  });
});
