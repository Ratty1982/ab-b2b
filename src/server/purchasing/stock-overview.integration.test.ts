/**
 * Stock overview reads imported warehouse Avail and keeps FBA out of sellable stock.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { FBA_LOCATION_CODE, FBA_SOURCE_BRANCH } from "@/domain/fba-stock";
import { skuMatchKey } from "@/domain/stock";
import { AuthError } from "@/server/rbac/guards";
import {
  exportStockOverviewCsv,
  getStockOverview,
  getStockPartDetail,
} from "@/server/purchasing/stock-overview";

const prisma = new PrismaClient();
const stamp = `SOV${Date.now().toString(36).slice(-6).toUpperCase()}`;
const warehouseSku = `${stamp}W`;
const fbaSku = `${stamp}F`;
const historicSku = `${stamp}H`;
const lowSku = `${stamp}L`;
const smallSku = `${stamp}S`;
const outSku = `${stamp}O`;
const ean = `EAN${stamp}`;

let adminId = "";
let salesId = "";
let tradeId = "";
let brandId = "";
let productId = "";
let runId = "";
let warehouseName = "Autopart";

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
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
    const brand = await prisma.brand.create({
      data: { name: `Brand ${stamp}`, slug: `brand-${stamp.toLowerCase()}` },
    });
    brandId = brand.id;
    const product = await prisma.product.create({
      data: {
        name: `Overview linked ${stamp}`,
        slug: `overview-linked-${stamp.toLowerCase()}`,
        brandId: brand.id,
        status: "ACTIVE",
        isActive: true,
      },
    });
    productId = product.id;
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, sku: `VAR-${stamp}`, barcode: ean, isActive: true },
    });
    const warehouse = await prisma.warehouse.upsert({
      where: { code: "AUTOPART" },
      create: { code: "AUTOPART", name: "Autopart" },
      update: {},
    });
    warehouseName = warehouse.name;
    await prisma.inventory.create({
      data: {
        variantId: variant.id,
        warehouseId: warehouse.id,
        qtyOnHand: 0,
        qtyReserved: 4,
        status: "IN_STOCK",
      },
    });
    await prisma.variantPurchasingSettings.create({
      data: { variantId: variant.id, safetyStockQty: 12 },
    });
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
        {
          sku: lowSku,
          matchKey: skuMatchKey(lowSku),
          description: "Overview low line",
          groupCode: stamp,
          availQty: 10,
          physicalQty: 18,
          incomingQty: 0,
          presentInLatestFeed: true,
          catalogueVariantId: variant.id,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        {
          sku: smallSku,
          matchKey: skuMatchKey(smallSku),
          description: "Overview small line",
          groupCode: stamp,
          availQty: 3,
          presentInLatestFeed: true,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        {
          sku: outSku,
          matchKey: skuMatchKey(outSku),
          description: "Overview out line",
          groupCode: stamp,
          availQty: 0,
          presentInLatestFeed: true,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      ],
    });
    const fbaProduct = await prisma.autopartProduct.findUniqueOrThrow({
      where: { matchKey: skuMatchKey(fbaSku) },
    });
    await prisma.autopartLocationStock.create({
      data: {
        autopartProductId: fbaProduct.id,
        locationCode: FBA_LOCATION_CODE,
        availableQty: 15,
        sourceBranch: FBA_SOURCE_BRANCH,
        sourceImportedAt: now,
      },
    });
    const run = await prisma.stockSyncRun.create({
      data: {
        source: "test-overview",
        mode: "live",
        status: "SUCCESS",
        trigger: "manual",
        completedAt: now,
      },
    });
    runId = run.id;
    await prisma.stockSyncChange.create({
      data: {
        runId: run.id,
        variantId: variant.id,
        skuSnapshot: lowSku,
        productNameSnapshot: `Overview linked ${stamp}`,
        previousQty: 8,
        newQty: 10,
        previousAvailability: "in",
        newAvailability: "in",
      },
    });
  });

  afterAll(async () => {
    if (runId) await prisma.stockSyncRun.deleteMany({ where: { id: runId } });
    const products = await prisma.autopartProduct.findMany({
      where: { matchKey: { startsWith: stamp } },
      select: { id: true },
    });
    await prisma.autopartLocationStock.deleteMany({
      where: { autopartProductId: { in: products.map((row) => row.id) } },
    });
    await prisma.autopartProduct.deleteMany({
      where: { id: { in: products.map((row) => row.id) } },
    });
    if (productId) await prisma.product.deleteMany({ where: { id: productId } });
    if (brandId) await prisma.brand.deleteMany({ where: { id: brandId } });
    await prisma.$disconnect();
  });

  it("keeps warehouse Avail separate from FBA and omits cost", async () => {
    const result = await getStockOverview(adminId, { q: stamp, feed: "current" });
    const warehouse = result.items.find((row) => row.sku === warehouseSku);
    const fba = result.items.find((row) => row.sku === fbaSku);
    const low = result.items.find((row) => row.sku === lowSku);
    expect(warehouse).toMatchObject({
      availQty: 40,
      incomingQty: 5,
      physicalQty: 44,
      fbaQty: 0,
      ownedQty: 40,
      sellableQty: null,
      unavailableQty: null,
      inCatalogue: false,
      catalogueLabel: "Not linked to catalogue",
      stockStatus: "IN_STOCK",
      reorderPoint: null,
    });
    expect(fba).toMatchObject({
      availQty: 2,
      fbaQty: 15,
      ownedQty: 17,
      sellableQty: null,
      stockStatus: "IN_STOCK",
    });
    expect(low).toMatchObject({
      availQty: 10,
      physicalQty: 18,
      unavailableQty: 4,
      sellableQty: 6,
      stockStatus: "LOW",
      reorderPoint: 12,
      brandName: `Brand ${stamp}`,
      ean,
      catalogueLabel: "Linked",
      warehouseName,
    });
    expect(result.items.find((row) => row.sku === smallSku)?.stockStatus).toBe("IN_STOCK");
    expect(result.items.some((row) => row.sku === historicSku)).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/latestCost|12\.5|supplier cost/i);

    const counted = await prisma.autopartProduct.count({ where: { presentInLatestFeed: true } });
    const out = await prisma.autopartProduct.count({
      where: { presentInLatestFeed: true, availQty: { lte: 0 } },
    });
    expect(result.summary.partNumbers).toBe(counted);
    expect(result.summary.outPartNumbers).toBe(out);
    expect(result.summary.lowPartNumbers).toBeGreaterThanOrEqual(1);
    expect(result.summary.sellableUnits).toBeGreaterThanOrEqual(6);
    expect(result.summary.unavailableUnits).toBeGreaterThanOrEqual(4);
    expect(result.summary.physicalUnits).toBeGreaterThanOrEqual(44 + 18);
    expect(result.summary.fbaUnits).toBeGreaterThanOrEqual(15);
    const filteredSellable = result.items.reduce((sum, row) => sum + (row.sellableQty ?? 0), 0);
    const filteredPhysical = result.items.reduce((sum, row) => sum + (row.physicalQty ?? 0), 0);
    expect(filteredSellable).toBe(6);
    expect(filteredPhysical).toBe(62);
    expect(result.items.filter((row) => row.stockStatus === "OUT_OF_STOCK")).toHaveLength(1);
    expect(result.items.filter((row) => row.stockStatus === "LOW")).toHaveLength(1);
    expect(result.items.some((row) => row.catalogueLabel === "Not linked to catalogue")).toBe(true);
    expect(["running", "failed", "delayed", "healthy", "unknown"]).toContain(
      result.importStatus.health,
    );

    const historic = await getStockOverview(adminId, { q: historicSku, feed: "historic" });
    expect(historic.items.map((row) => row.sku)).toEqual([historicSku]);
    expect(historic.items[0]?.stockStatus).toBe("UNKNOWN");

    const fbaOnly = await getStockOverview(adminId, { q: stamp, position: "fba" });
    expect(fbaOnly.items.map((row) => row.sku)).toEqual([fbaSku]);

    const csv = await exportStockOverviewCsv(adminId, { q: warehouseSku });
    expect(csv.csv).toContain(warehouseSku);
    expect(csv.csv).toContain("Part number");
    expect(csv.csv).toContain("Product name");
    expect(csv.csv).toContain("Physical");
    expect(csv.csv).toContain("Unavailable");
    expect(csv.csv).toContain("Sellable");
    expect(csv.csv).toContain("Status");
    expect(csv.csv).toContain("Last update");
    expect(csv.csv).toContain("Warehouse Avail");
    expect(csv.csv).toContain("Not linked to catalogue");
    expect(csv.csv).not.toContain("12.5");
    expect(csv.truncated).toBe(false);
    expect(csv.exported).toBe(csv.total);
  });

  it("filters low stock from configured thresholds and searches brand, EAN, and empty results", async () => {
    const low = await getStockOverview(adminId, { q: stamp, position: "low", feed: "all" });
    expect(low.items.map((row) => row.sku)).toEqual([lowSku]);

    const inStock = await getStockOverview(adminId, { q: stamp, position: "in" });
    expect(inStock.items.map((row) => row.sku).sort()).toEqual(
      [fbaSku, smallSku, warehouseSku].sort(),
    );

    const branded = await getStockOverview(adminId, { brand: brandId, q: stamp });
    expect(branded.items.map((row) => row.sku)).toEqual([lowSku]);

    const byEan = await getStockOverview(adminId, { q: ean });
    expect(byEan.items.map((row) => row.sku)).toEqual([lowSku]);

    const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { code: "AUTOPART" } });
    const inWarehouse = await getStockOverview(adminId, { q: stamp, warehouse: warehouse.id });
    expect(inWarehouse.items.map((row) => row.sku)).toEqual([lowSku]);

    const empty = await getStockOverview(adminId, { q: `missing-${stamp}` });
    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(0);

    const filteredExport = await exportStockOverviewCsv(adminId, {
      q: stamp,
      position: "low",
      feed: "all",
    });
    expect(filteredExport.csv).toContain(lowSku);
    expect(filteredExport.csv).not.toContain(warehouseSku);
    expect(filteredExport.exported).toBe(1);
  });

  it("opens a part detail without inventing history, warehouses, or arrival dates", async () => {
    const low = await getStockPartDetail(adminId, { sku: lowSku });
    expect(low).toMatchObject({
      sku: lowSku,
      sellableQty: 6,
      unavailableQty: 4,
      physicalQty: 18,
      reorderPoint: 12,
      supplierName: null,
      expectedArrivalAt: null,
      catalogueLabel: "Linked",
    });
    expect(low?.locations).toEqual([
      { name: warehouseName, code: "AUTOPART", qty: 0, kind: "warehouse" },
    ]);
    expect(low?.history.available).toBe(true);
    expect(low?.history.points.map((point) => point.qty)).toEqual([10]);
    expect(low?.lastSuccessfulUpdateAt).toBe(low?.history.points[0]?.at);
    expect(JSON.stringify(low)).not.toMatch(/latestCost|12\.5/);

    const external = await getStockPartDetail(adminId, { sku: warehouseSku });
    expect(external?.catalogueLabel).toBe("Not linked to catalogue");
    expect(external?.locations).toEqual([]);
    expect(external?.history).toMatchObject({ available: false, points: [] });
    expect(external?.sellableQty).toBeNull();
    expect(external?.currentQty).toBe(40);
    expect(external?.lastSuccessfulUpdateAt).toBeNull();

    expect(await getStockPartDetail(adminId, { sku: `missing-${stamp}` })).toBeNull();
    await expect(getStockPartDetail(adminId, { sku: " " })).rejects.toThrow();
  });

  it("pages through matching part numbers without repeating a row", async () => {
    const now = new Date();
    await prisma.autopartProduct.createMany({
      data: Array.from({ length: 51 }, (_, index) => {
        const sku = `${stamp}N${String(index).padStart(2, "0")}`;
        return {
          sku,
          matchKey: skuMatchKey(sku),
          description: "Overview page line",
          availQty: 1,
          presentInLatestFeed: true,
          firstSeenAt: now,
          lastSeenAt: now,
        };
      }),
    });
    const first = await getStockOverview(adminId, { q: `${stamp}N`, sort: "sku", page: 1 });
    const second = await getStockOverview(adminId, { q: `${stamp}N`, sort: "sku", page: 2 });
    expect(first.total).toBe(51);
    expect(first.pageSize).toBe(50);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(1);
    expect(second.page).toBe(2);
    expect(first.items.some((row) => row.sku === second.items[0]?.sku)).toBe(false);
  });

  it("refuses sales and trade users", async () => {
    await expect(getStockOverview(salesId, {})).rejects.toBeInstanceOf(AuthError);
    await expect(getStockOverview(tradeId, {})).rejects.toBeInstanceOf(AuthError);
    await expect(exportStockOverviewCsv(tradeId, {})).rejects.toBeInstanceOf(AuthError);
    await expect(getStockPartDetail(tradeId, { sku: lowSku })).rejects.toBeInstanceOf(AuthError);
    await expect(getStockPartDetail(salesId, { sku: lowSku })).rejects.toBeInstanceOf(AuthError);
  });
});
