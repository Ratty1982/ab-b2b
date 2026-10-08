/**
 * Manual Amazon FBA stock import.
 * OPTIMUS Avail is location stock only. SS Avail stays the B2B sellable quantity.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { getPublicProduct } from "@/server/catalogue/products";
import { applyStockFeed } from "@/server/stock/service";
import { buildNative231Po3New, type Native231Po3NewRow } from "@/server/stock/fixtures/native-231po3new";
import { buildAutopart216vFixture } from "@/domain/autopart-216v-fixture";
import { AUTOPART_504C_HEADER } from "@/domain/autopart-504c-fixture";
import { skuMatchKey } from "@/domain/stock";
import { FBA_WAREHOUSE_FILE_MESSAGE } from "@/domain/fba-stock";
import { plannerPurchaseQty } from "@/domain/purchasing-planner";
import { addProductSupplier } from "@/server/purchasing/suppliers";
import { exportPurchasePlannerCsv, listPurchasePlanner } from "@/server/purchasing/service";
import { fbaFileHash, importFbaStock, listFbaStockImports, previewFbaStockImport } from "@/server/purchasing/fba-stock";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36).slice(-6).toUpperCase();
const warehouseGroup = `W${stamp.slice(0, 5)}`;
const fbaGroup = `Q${stamp.slice(0, 5)}`;

let adminId = "";
let accountsId = "";
let salesId = "";
let tradeId = "";

const catSku = `FC${stamp}`;
const extSku = `FE${stamp}`;
const onlySku = `FF${stamp}`;
const zeroSku = `FZ${stamp}`;
const swapSku = `FR${stamp}`;
const keepSku = `FK${stamp}`;
const goneSku = `FG${stamp}`;
const planSku = `FP${stamp}`;

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

function warehouseRow(sku: string, avail: string): Native231Po3NewRow {
  return {
    sku,
    description: `Warehouse ${sku}`,
    group: warehouseGroup,
    branch: "SS",
    stk: "20.0000",
    avail,
    pick: "1.0000",
    physical: "20.0000",
    cost: "2.50",
    incoming: "3.0000",
    condition: "W",
    subGrp: "NOTGRP",
    trailerGroup: "LATER",
  };
}

function optimusNative(rows: Native231Po3NewRow[], selectGroup = "PART"): string {
  return [`[Branch OPTIMUS] [Select Group ${selectGroup}] [Sub Grp ALL] [GROUP ALL]`, buildNative231Po3New(rows)].join(
    "\n",
  );
}

const CSV_HEADER =
  "Branch,Group,Part Number,C,Description,Latest Cost,Stk,Avail,Pick Qty,Physical Stk,Ryr,Curr,Mth1,P/Ord Qty,Sub Grp,GROUP";

function csvRow(sku: string, avail: string, extra: { branch?: string; blankSku?: boolean } = {}): string {
  return [
    extra.branch ?? "OPTIMUS",
    fbaGroup,
    extra.blankSku ? "" : sku,
    "O",
    `FBA ${sku || "blank"}`,
    "88.00",
    "99.0000",
    avail,
    "7.0000",
    "80.0000",
    "111",
    "9",
    "14",
    "40.0000",
    "SUBGRP",
    "TRAIL",
  ].join(",");
}

function fbaCsv(lines: string[]): string {
  return [CSV_HEADER, ...lines].join("\n");
}

function csvDescribed(sku: string, description: string, avail: string): string {
  return [
    "OPTIMUS",
    fbaGroup,
    sku,
    "O",
    description,
    "88.00",
    "99.0000",
    avail,
    "7.0000",
    "80.0000",
    "111",
    "9",
    "14",
    "40.0000",
    "SUBGRP",
    "TRAIL",
  ].join(",");
}

async function applyWarehouse(rows: Native231Po3NewRow[]) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      return await applyStockFeed({
        text: buildNative231Po3New(rows),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
      });
    } catch (error) {
      if (!(error instanceof AuthError) || error.code !== "CONFLICT" || attempt === 14) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("stock sync lock was not released");
}

async function product(sku: string) {
  return prisma.autopartProduct.findUniqueOrThrow({ where: { matchKey: skuMatchKey(sku) } });
}

async function fbaQty(sku: string): Promise<number> {
  const row = await prisma.autopartLocationStock.findFirst({
    where: { locationCode: "FBA", autopartProduct: { matchKey: skuMatchKey(sku) } },
  });
  return row?.availableQty ?? 0;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`fba.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  accountsId = await ensureUser(`fba.acc.${stamp}@example.invalid`, ["ACCOUNTS"]);
  salesId = await ensureUser(`fba.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  tradeId = await ensureUser(`fba.trade.${stamp}@example.invalid`, [], "TRADE");
  const catalogue = await saveProduct(adminId, {
    sku: catSku,
    name: "FBA catalogue item",
    brand: "Power Maxed",
    category: "Cleaning",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
  });
  await prisma.product.update({
    where: { id: catalogue.id },
    data: { status: "ACTIVE", isActive: true, isTradeVisible: true, slug: `fba-cat-${stamp.toLowerCase()}` },
  });
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("FBA stock import permissions", () => {
  it("lets purchasing.manage import, purchasing.view read, and denies sales, trade, and accounts import", async () => {
    const text = fbaCsv([csvRow(`FPV${stamp}`, "1")]);
    await expect(importFbaStock(accountsId, { fileName: "denied.csv", text })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(previewFbaStockImport(salesId, { fileName: "denied.csv", text })).rejects.toBeInstanceOf(AuthError);
    await expect(importFbaStock(tradeId, { fileName: "denied.csv", text })).rejects.toBeInstanceOf(AuthError);
    await expect(listFbaStockImports(salesId)).rejects.toBeInstanceOf(AuthError);
    await expect(listFbaStockImports(tradeId)).rejects.toBeInstanceOf(AuthError);
    const history = await listFbaStockImports(accountsId);
    expect(Array.isArray(history)).toBe(true);
    const imported = await importFbaStock(adminId, { fileName: "view-ok.csv", text });
    expect(imported.status).toBe("IMPORTED");
  });
});

describe("FBA stock stays separate from warehouse stock", () => {
  it("rejects warehouse, 216V, 504, 504C, TRM21QC, and unstructured files", async () => {
    const before = await prisma.autopartFbaStockImport.count();
    await expect(
      importFbaStock(adminId, {
        fileName: "231PO3NEW-SS.CSV",
        text: buildNative231Po3New([warehouseRow(catSku, "10.0000")]),
      }),
    ).rejects.toMatchObject({ message: FBA_WAREHOUSE_FILE_MESSAGE });
    await expect(importFbaStock(adminId, { fileName: "216v.csv", text: buildAutopart216vFixture() })).rejects.toMatchObject({
      message: expect.stringMatching(/216V/),
    });
    const report504 = `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,SS100001,29/09/2026,13:05,EXAMPLE MOTOR FACTORS,303.00,60.60,363.60,WR,AB-001234
`;
    await expect(importFbaStock(adminId, { fileName: "504.csv", text: report504 })).rejects.toMatchObject({
      message: expect.stringMatching(/504/),
    });
    await expect(
      importFbaStock(adminId, {
        fileName: "504c.csv",
        text: `LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)\n${AUTOPART_504C_HEADER}\n`,
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/504C/) });
    await expect(
      importFbaStock(adminId, {
        fileName: "trm.csv",
        text: "Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%\nAB,T,SS1,01/01/2026,SKU,Name,1,10,5,5,50\n",
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/TRM21QC/) });
    await expect(importFbaStock(adminId, { fileName: "notes.txt", text: "not a stock file" })).rejects.toMatchObject({
      message: expect.stringMatching(/231PO3NEW/),
    });
    expect(await prisma.autopartFbaStockImport.count()).toBe(before);
  });

  it("stores FBA Avail without changing warehouse master, demand, or B2B sellable stock", async () => {
    await applyWarehouse([
      warehouseRow(catSku, "10.0000"),
      warehouseRow(extSku, "10.0000"),
      warehouseRow(swapSku, "6.0000"),
      warehouseRow(planSku, "0.0000"),
    ]);
    const supplier = await prisma.supplier.create({
      data: { name: `FBA supplier ${stamp}`, code: `FBA-${stamp}`, active: true },
    });
    await addProductSupplier(adminId, { supplierId: supplier.id, sku: catSku, isPreferred: true, unitCost: "1.10" });
    const beforeLinks = await prisma.productSupplier.count({ where: { matchKey: skuMatchKey(catSku) } });
    const beforeSnapshots = await prisma.autopartBackorderSnapshot.count();
    const beforeSales = await prisma.autopartSalesLine.count({ where: { sku: { in: [catSku, extSku, onlySku] } } });
    const beforeProducts = await prisma.product.count();
    const beforeSuppliers = await prisma.supplier.count();

    const preview = await previewFbaStockImport(adminId, {
      fileName: "231PO3NEW-OPTIMUS.CSV",
      text: fbaCsv([
        csvRow(catSku, "25"),
        csvRow(extSku, "25"),
        csvRow(onlySku, "4"),
        csvRow(zeroSku, "0"),
        csvRow(swapSku, "20"),
        csvRow("", "5", { blankSku: true }),
        csvRow(`BAD${stamp}`, "n/a"),
      ]),
    });
    expect(preview.sourceLabel).toBe("Amazon FBA");
    expect(preview.duplicate).toBe(false);
    expect(preview.completeSnapshot).toBe(false);
    expect(preview.invalidRows).toBe(2);
    expect(preview.rowsRead).toBe(preview.productsProcessed + preview.invalidRows + preview.duplicateSkus);
    expect(preview.productsProcessed).toBe(preview.matchedExisting + preview.newProducts);
    expect(preview.newProducts).toBe(2);
    expect(preview.productsWithStock).toBe(4);
    expect(preview.invalidRowDetails.map((row) => row.reason).sort()).toEqual(["invalid_avail", "missing_sku"]);
    expect(preview.newProductRows.map((row) => row.sku).sort()).toEqual([onlySku, zeroSku].sort());
    expect(preview.newProductRows.every((row) => row.result === "Create internal product")).toBe(true);
    expect(preview.stockedProducts.some((row) => row.sku.toUpperCase() === zeroSku)).toBe(false);
    const catPreview = preview.stockedProducts.find((row) => row.sku.toUpperCase() === catSku);
    expect(catPreview).toMatchObject({
      warehouseQty: 10,
      currentFbaQty: 0,
      importedFbaQty: 25,
      change: 25,
      totalAfterImport: 35,
      result: "Update FBA quantity",
    });
    expect(JSON.stringify(preview)).not.toMatch(/Unknown\/unmatched/);
    expect(await prisma.autopartLocationStock.count({ where: { autopartProduct: { matchKey: skuMatchKey(catSku) } } })).toBe(
      0,
    );

    const firstName = "231PO3NEW-OPTIMUS.CSV";
    const firstText = fbaCsv([
      csvRow(catSku, "25"),
      csvRow(extSku, "25"),
      csvRow(onlySku, "4"),
      csvRow(zeroSku, "0"),
      csvRow(swapSku, "20"),
      csvRow("", "5", { blankSku: true }),
      csvRow(`BAD${stamp}`, "n/a"),
    ]);
    const imported = await importFbaStock(adminId, { fileName: firstName, text: firstText });
    expect(imported.status).toBe("IMPORTED");
    if (imported.status !== "IMPORTED") return;
    expect(imported.message).toBe("FBA Stock updated");
    expect(imported.productsWithStock).toBe(4);
    expect(imported.zeroStock).toBe(1);
    expect(imported.totalUnits).toBe(74);
    expect(imported.newProducts).toBe(2);

    const catalogue = await product(catSku);
    const external = await product(extSku);
    expect(catalogue.catalogueVariantId).toBeTruthy();
    expect(external.catalogueVariantId).toBeNull();
    expect(catalogue.availQty).toBe(10);
    expect(external.availQty).toBe(10);
    expect(catalogue.incomingQty).toBe(3);
    expect(external.incomingQty).toBe(3);
    expect(Number(catalogue.latestCost)).toBeCloseTo(2.5);
    expect(Number(external.latestCost)).toBeCloseTo(2.5);
    expect(catalogue.conditionCode).toBe("W");
    expect(catalogue.groupCode).toBe(warehouseGroup);
    expect(external.groupCode).toBe(warehouseGroup);
    expect(await fbaQty(catSku)).toBe(25);
    expect(await fbaQty(extSku)).toBe(25);
    expect(await fbaQty(zeroSku)).toBe(0);
    expect(await fbaQty(swapSku)).toBe(20);

    const createdOnly = await product(onlySku);
    expect(createdOnly.availQty).toBe(0);
    expect(createdOnly.incomingQty).toBeNull();
    expect(createdOnly.latestCost).toBeNull();
    expect(createdOnly.conditionCode).toBeNull();
    expect(createdOnly.groupCode).toBeNull();
    expect(createdOnly.presentInLatestFeed).toBe(false);
    expect(createdOnly.catalogueVariantId).toBeNull();
    expect(await prisma.productVariant.count({ where: { sku: { equals: onlySku, mode: "insensitive" } } })).toBe(0);

    const inventory = await prisma.inventory.findFirst({
      where: { variant: { sku: { equals: catSku, mode: "insensitive" } } },
    });
    expect(inventory?.qtyOnHand).toBe(10);
    expect(inventory?.incomingQty).toBe(3);

    const planner = await listPurchasePlanner(adminId, { q: catSku, pageSize: 50 });
    const catRow = planner.rows.find((row) => row.sku.toUpperCase() === catSku);
    expect(catRow?.availableQty).toBe(10);
    expect(catRow?.fbaQty).toBe(25);
    expect(catRow?.totalStock).toBe(35);
    const extPlanner = await listPurchasePlanner(adminId, { q: extSku, pageSize: 50 });
    const extRow = extPlanner.rows.find((row) => row.sku.toUpperCase() === extSku);
    expect(extRow?.productKind).toBe("EXTERNAL");
    expect(extRow?.availableQty).toBe(10);
    expect(extRow?.fbaQty).toBe(25);
    expect(extRow?.totalStock).toBe(35);
    const onlyPlanner = await listPurchasePlanner(adminId, { q: onlySku, pageSize: 50 });
    const onlyRow = onlyPlanner.rows.find((row) => row.sku.toUpperCase() === onlySku);
    expect(onlyRow?.productKind).toBe("EXTERNAL");
    expect(onlyRow?.availableQty).toBe(0);
    expect(onlyRow?.fbaQty).toBe(4);
    expect(onlyRow?.totalStock).toBe(4);

    const csv = await exportPurchasePlannerCsv(adminId, { q: catSku });
    expect(csv.csv).toContain("Warehouse Stock");
    expect(csv.csv).toContain("FBA Stock");
    expect(csv.csv).toContain("Total Stock");

    const anonymous = await getPublicProduct(null, catSku);
    const trade = await getPublicProduct(tradeId, catSku);
    for (const payload of [anonymous, trade]) {
      const json = JSON.stringify(payload);
      expect(json).not.toMatch(/fbaQty/);
      expect(json).not.toMatch(/totalStock/);
      expect(json).not.toContain("OPTIMUS");
      expect(json).not.toContain("8473");
    }
    expect(anonymous?.internalStock).toBeNull();
    expect(trade?.internalStock).toBeNull();
    expect(anonymous?.card).not.toHaveProperty("fbaQty");
    expect(anonymous?.card).not.toHaveProperty("stockQty");

    expect(await prisma.productSupplier.count({ where: { matchKey: skuMatchKey(catSku) } })).toBe(beforeLinks);
    expect(await prisma.supplier.count()).toBe(beforeSuppliers);
    expect(await prisma.autopartBackorderSnapshot.count()).toBe(beforeSnapshots);
    expect(await prisma.autopartSalesLine.count({ where: { sku: { in: [catSku, extSku, onlySku] } } })).toBe(beforeSales);
    expect(await prisma.product.count()).toBe(beforeProducts);
    expect(await prisma.autopartProduct.findUnique({ where: { matchKey: skuMatchKey(`BAD${stamp}`) } })).toBeNull();

    const replaced = await importFbaStock(adminId, {
      fileName: firstName,
      text: fbaCsv([csvRow(swapSku, "12")]),
    });
    expect(replaced.status).toBe("IMPORTED");
    expect(await fbaQty(swapSku)).toBe(12);
    expect((await product(swapSku)).availQty).toBe(6);
    expect(await fbaQty(catSku)).toBe(25);

    const duplicate = await importFbaStock(adminId, { fileName: "renamed-but-same.csv", text: firstText });
    expect(duplicate.status).toBe("DUPLICATE");
    if (duplicate.status === "DUPLICATE") {
      expect(duplicate.message).toMatch(/Already imported/);
    }
    expect(await fbaQty(catSku)).toBe(25);
    expect(await prisma.autopartFbaStockImport.count({ where: { fileHash: fbaFileHash(firstText) } })).toBe(1);

    const nativePartial = optimusNative([
      {
        sku: keepSku,
        description: "Keep",
        group: fbaGroup,
        branch: "OPTIMUS",
        stk: "99.0000",
        avail: "8.0000",
        pick: "1.0000",
        physical: "9.0000",
        cost: "77.00",
        incoming: "40.0000",
        condition: "O",
        ryr: "111",
        curr: "9",
        mth1: "14",
      },
      {
        sku: goneSku,
        description: "Gone later",
        group: fbaGroup,
        branch: "OPTIMUS",
        stk: "99.0000",
        avail: "5.0000",
        pick: "1.0000",
        physical: "9.0000",
        cost: "77.00",
        incoming: "40.0000",
        condition: "O",
      },
    ]);
    await importFbaStock(adminId, { fileName: "partial-optimus.txt", text: nativePartial });
    expect(await fbaQty(keepSku)).toBe(8);
    expect(await fbaQty(goneSku)).toBe(5);
    expect(await prisma.autopartSalesLine.count({ where: { sku: keepSku } })).toBe(0);
    const partialAgain = await importFbaStock(adminId, {
      fileName: "partial-optimus.txt",
      text: optimusNative([
        {
          sku: keepSku,
          description: "Keep",
          group: fbaGroup,
          branch: "OPTIMUS",
          stk: "99.0000",
          avail: "8.0000",
          pick: "1.0000",
          physical: "9.0000",
          cost: "77.00",
          incoming: "40.0000",
          condition: "O",
        },
      ]),
    });
    expect(partialAgain.status).toBe("IMPORTED");
    expect(await fbaQty(goneSku)).toBe(5);

    const forecast = await listPurchasePlanner(adminId, { q: catSku, pageSize: 20 });
    const still = forecast.rows.find((row) => row.sku.toUpperCase() === catSku);
    expect(still?.rates.last30.netUnits).toBe(0);
    const warehouseCalc = plannerPurchaseQty({
      availableQty: still!.availableQty,
      incomingQty: still!.incomingQty,
      backorderUnits: still!.backorderUnits,
      recommendedWeekly: still!.recommendedWeekly,
      targetCoverWeeks: still!.targetCoverWeeks,
      safetyStockQty: still!.safetyStockQty,
      leadTimeDays: still!.purchasing.leadTimeDays,
      minimumOrderQty: still!.purchasing.minimumOrderQty,
      orderMultiple: still!.purchasing.orderMultiple,
    });
    expect(still?.suggestedQty).toBe(warehouseCalc.suggestedQty);
    expect(still?.purchase.suggestedQty).toBe(warehouseCalc.suggestedQty);
  });

  it("previews warehouse and FBA totals without changing B2B sellable stock", async () => {
    const sku = `FT${stamp}`;
    const catalogue = await saveProduct(adminId, {
      sku,
      name: "FBA total check",
      brand: "Power Maxed",
      category: "Cleaning",
      trade: 4,
      rrp: 8,
      packQty: 1,
      caseQty: 1,
    });
    await prisma.product.update({
      where: { id: catalogue.id },
      data: { status: "ACTIVE", isActive: true, isTradeVisible: true, slug: `fba-total-${stamp.toLowerCase()}` },
    });
    await applyWarehouse([warehouseRow(sku, "120.0000")]);
    const before = await prisma.inventory.findFirst({
      where: { variant: { sku: { equals: sku, mode: "insensitive" } } },
    });
    const preview = await previewFbaStockImport(adminId, {
      fileName: `stocked-${stamp}.csv`,
      text: fbaCsv([csvRow(sku, "17"), csvRow(`FZ2${stamp}`, "0")]),
    });
    const stocked = preview.stockedProducts.find((row) => row.sku.toUpperCase() === sku);
    expect(stocked).toMatchObject({
      warehouseQty: 120,
      currentFbaQty: 0,
      importedFbaQty: 17,
      change: 17,
      totalAfterImport: 137,
    });
    expect(preview.productsWithStock).toBe(1);
    expect(preview.zeroStock).toBe(1);
    expect(preview.newProductRows.map((row) => row.sku)).toEqual([`FZ2${stamp}`]);
    expect(preview.stockedProducts.some((row) => row.importedFbaQty === 0)).toBe(false);
    const after = await prisma.inventory.findFirst({
      where: { variant: { sku: { equals: sku, mode: "insensitive" } } },
    });
    expect(after?.qtyOnHand).toBe(120);
    expect(before?.qtyOnHand).toBe(120);
    expect((await product(sku)).availQty).toBe(120);
    expect(await fbaQty(sku)).toBe(0);
    const anonymous = await getPublicProduct(null, sku);
    expect(anonymous?.internalStock).toBeNull();
    expect(JSON.stringify(anonymous)).not.toMatch(/fbaQty|totalAfterImport|OPTIMUS|importedFba/);
  });

  it("does not treat FBA stock as warehouse cover in the purchase planner", async () => {
    await importFbaStock(adminId, {
      fileName: `planner-${stamp}.csv`,
      text: fbaCsv([csvRow(planSku, "100")]),
    });
    const planner = await listPurchasePlanner(adminId, { q: planSku, pageSize: 20 });
    const row = planner.rows.find((item) => item.sku.toUpperCase() === planSku);
    expect(row?.availableQty).toBe(0);
    expect(row?.fbaQty).toBe(100);
    expect(row?.totalStock).toBe(100);
    expect(row?.incomingQty).toBe(3);
    expect(row?.recommendation).not.toBe("ADEQUATE_STOCK");
    const warehouseCalc = plannerPurchaseQty({
      availableQty: 0,
      incomingQty: row!.incomingQty,
      backorderUnits: row!.backorderUnits,
      recommendedWeekly: row!.recommendedWeekly,
      targetCoverWeeks: row!.targetCoverWeeks,
      safetyStockQty: row!.safetyStockQty,
      leadTimeDays: row!.purchasing.leadTimeDays,
      minimumOrderQty: row!.purchasing.minimumOrderQty,
      orderMultiple: row!.purchasing.orderMultiple,
    });
    const demandInput = {
      incomingQty: 0,
      backorderUnits: 0,
      recommendedWeekly: 2,
      targetCoverWeeks: 4,
      safetyStockQty: 0,
      leadTimeDays: null,
      minimumOrderQty: null,
      orderMultiple: null,
    };
    const ifFbaWereAvailable = plannerPurchaseQty({ ...demandInput, availableQty: 100 });
    const warehouseDemand = plannerPurchaseQty({ ...demandInput, availableQty: 0 });
    expect(ifFbaWereAvailable.suggestedQty).toBe(0);
    expect(warehouseDemand.suggestedQty).toBeGreaterThan(0);
    expect(row?.suggestedQty).toBe(warehouseCalc.suggestedQty);
    expect(row?.plan.steps.find((step) => step.label === "Available")?.value).toBe("0");
    expect((await product(planSku)).availQty).toBe(0);
    expect((await product(planSku)).incomingQty).toBe(3);
  });

  it("zeros SKUs missing from a complete OPTIMUS snapshot and leaves a partial file unchanged", async () => {
    const heldSku = `FH${stamp}`;
    const absentSku = `FX${stamp}`;
    await importFbaStock(adminId, {
      fileName: `partial-before-complete-${stamp}.txt`,
      text: optimusNative([
        {
          sku: heldSku,
          description: "Held",
          group: fbaGroup,
          branch: "OPTIMUS",
          stk: "4.0000",
          avail: "6.0000",
          pick: "0.0000",
          physical: "4.0000",
          cost: "4.00",
          incoming: "2.0000",
          condition: "N",
        },
        {
          sku: absentSku,
          description: "Absent later",
          group: fbaGroup,
          branch: "OPTIMUS",
          stk: "4.0000",
          avail: "2.0000",
          pick: "0.0000",
          physical: "4.0000",
          cost: "4.00",
          incoming: "2.0000",
          condition: "N",
        },
      ]),
    });
    expect(await fbaQty(absentSku)).toBe(2);
    const stillThere = await importFbaStock(adminId, {
      fileName: `partial-only-held-${stamp}.txt`,
      text: optimusNative([
        {
          sku: heldSku,
          description: "Held",
          group: fbaGroup,
          branch: "OPTIMUS",
          stk: "4.0000",
          avail: "6.0000",
          pick: "0.0000",
          physical: "4.0000",
          cost: "4.00",
          incoming: "2.0000",
          condition: "N",
        },
      ]),
    });
    expect(stillThere.status).toBe("IMPORTED");
    expect(await fbaQty(absentSku)).toBe(2);
    const complete = optimusNative(
      [
        {
          sku: heldSku,
          description: "Held",
          group: fbaGroup,
          branch: "OPTIMUS",
          stk: "1.0000",
          avail: "3.0000",
          pick: "0.0000",
          physical: "1.0000",
          cost: "1.00",
          incoming: "9.0000",
          condition: "N",
        },
      ],
      "ALL",
    );
    const saved = await importFbaStock(adminId, { fileName: `complete-optimus-${stamp}.txt`, text: complete });
    expect(saved.status).toBe("IMPORTED");
    if (saved.status === "IMPORTED") expect(saved.absentZeroed).toBeGreaterThanOrEqual(1);
    expect(await fbaQty(heldSku)).toBe(3);
    expect(await fbaQty(absentSku)).toBe(0);
    expect((await product(heldSku)).groupCode).toBeNull();
    expect((await product(heldSku)).latestCost).toBeNull();
    expect((await product(heldSku)).incomingQty).toBeNull();
    expect((await product(catSku)).availQty).toBe(10);
    expect(await fbaQty(catSku)).toBe(0);
  });

  it("imports inch-mark wheel trims as separate FBA rows and blocks an unsafe quotation", async () => {
    const v14 = `V14${stamp}`;
    const v15 = `V15${stamp}`;
    const v16 = `V16${stamp}`;
    const after = `VA${stamp}`;
    const text = fbaCsv([
      csvDescribed(v14, 'Venus 14" Wheel Trim', "4"),
      csvDescribed(v15, 'Venus 15" Wheel Trim', "5"),
      csvDescribed(v16, 'Venus 16" Wheel Trim', "6"),
      csvDescribed(after, "After pad", "2"),
    ]);
    const preview = await previewFbaStockImport(adminId, { fileName: `venus-${stamp}.csv`, text });
    expect(preview.invalidRows).toBe(0);
    expect(preview.duplicateSkus).toBe(0);
    expect(preview.rowsRead).toBe(4);
    expect(preview.productsProcessed).toBe(4);
    expect(preview.totalUnits).toBe(17);
    expect(preview.productsWithStock).toBe(4);
    expect(preview.rowsRead).toBe(preview.productsProcessed + preview.invalidRows + preview.duplicateSkus);
    expect(preview.quoteDiagnostics.filter((row) => row.recovered).map((row) => row.sku).sort()).toEqual(
      [v14, v15, v16].sort(),
    );
    expect(preview.quoteDiagnostics.every((row) => row.recovered && !row.description?.includes(v15))).toBe(true);

    const imported = await importFbaStock(adminId, { fileName: `venus-${stamp}.csv`, text });
    expect(imported.status).toBe("IMPORTED");
    expect(await fbaQty(v14)).toBe(4);
    expect(await fbaQty(v15)).toBe(5);
    expect(await fbaQty(v16)).toBe(6);
    expect(await fbaQty(after)).toBe(2);
    const created = await product(v14);
    expect(created.description).toBe('Venus 14" Wheel Trim');
    expect(created.availQty).toBe(0);
    expect(created.latestCost).toBeNull();
    expect(created.incomingQty).toBeNull();
    expect(created.conditionCode).toBeNull();

    const beforeImports = await prisma.autopartFbaStockImport.count();
    const unsafe = fbaCsv([
      csvDescribed(`VB${stamp}`, "Plain", "1"),
      `OPTIMUS,${fbaGroup},BAD${stamp},O,"description keeps going`,
      "and has, commas, but no close",
      "still not a product row",
    ]);
    await expect(previewFbaStockImport(adminId, { fileName: `unsafe-${stamp}.csv`, text: unsafe })).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringMatching(/cannot be split safely/),
    });
    await expect(importFbaStock(adminId, { fileName: `unsafe-${stamp}.csv`, text: unsafe })).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringMatching(/No FBA stock was changed/),
    });
    expect(await prisma.autopartFbaStockImport.count()).toBe(beforeImports);
    expect(await prisma.autopartProduct.findUnique({ where: { matchKey: skuMatchKey(`VB${stamp}`) } })).toBeNull();
    expect(await fbaQty(v14)).toBe(4);
    expect((await product(v14)).availQty).toBe(0);
  });
});
