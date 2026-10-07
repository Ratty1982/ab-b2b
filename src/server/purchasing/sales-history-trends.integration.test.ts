/**
 * Sales-history verification, monthly trends, and Stock Forecast CSV.
 * Forecast recommendation maths is not an input to these checks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { applyStockFeed } from "@/server/stock/service";
import { buildNative231Po3New, type Native231Po3NewRow } from "@/server/stock/fixtures/native-231po3new";
import { addDaysIso, todayLondonDateOnly } from "@/domain/sales-history-period";
import { addMonths, classifySalesHistoryVerification, requiredForecastCoverageWindow } from "@/domain/sales-history-coverage";
import { importFbaStock } from "@/server/purchasing/fba-stock";
import { exportStockForecastCsv, listPurchasingForecast } from "@/server/purchasing/service";
import { previewSalesHistoryCoverage, verifySalesHistoryCoverage } from "@/server/purchasing/sales-history-coverage";
import { getBrandSalesTrend, getSkuSalesTrend } from "@/server/purchasing/sales-trend";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36).slice(-6).toUpperCase();
const today = todayLondonDateOnly();
const todayMonth = today.slice(0, 7);
const sumMonth = addMonths(todayMonth, -8);
const zeroMonth = addMonths(todayMonth, -3);
const group = `H${stamp.slice(0, 5)}`;

const skuA = `HA${stamp}`;
const skuB = `HB${stamp}`;
const skuGap = `HG${stamp}`;
const fbaOnly = `HF${stamp}`;
const awkwardName = `Widget, "Pro"\nKit ${stamp}`;
const opening = addDaysIso(today, -370);

let adminId = "";
let accountsId = "";
let salesId = "";
let tradeId = "";
let companyId = "";
let brandSlug = "";
let gapBrandSlug = "";

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

async function makeSku(sku: string, name: string, brand: string) {
  const product = await saveProduct(adminId, {
    sku,
    name,
    brand,
    category: "Cleaning",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
  });
  await prisma.product.update({
    where: { id: product.id },
    data: { status: "ACTIVE", isActive: true, isTradeVisible: true, slug: `hist-${sku.toLowerCase()}` },
  });
  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { sku },
    include: { product: { include: { brand: true } } },
  });
  return variant.product.brand.slug;
}

async function seedSale(sku: string, date: string, units: string, ref: string, net = "10.00") {
  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId,
      autopartCustomerCode: `H${stamp}`,
      documentType: "INVOICE",
      documentReference: ref,
      documentDate: new Date(`${date}T12:00:00.000Z`),
      source: "SLRB",
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId,
      documentId: doc.id,
      autopartCustomerCode: `H${stamp}`,
      documentType: "INVOICE",
      documentReference: ref,
      lineNumber: 1,
      sku,
      units,
      salesNet: net,
      matchStatus: "MATCHED",
      source: "561L",
    },
  });
}

function stockRow(sku: string, avail: string, incoming: string): Native231Po3NewRow {
  return {
    sku,
    description: sku,
    group,
    branch: "SS",
    stk: "20.0000",
    avail,
    pick: "0.0000",
    physical: "20.0000",
    cost: "13.90",
    incoming,
    condition: "W",
    subGrp: "NOTGRP",
    trailerGroup: "LATER",
  };
}

async function applyWarehouse() {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      return await applyStockFeed({
        text: buildNative231Po3New([stockRow(skuA, "36.0000", "8.0000"), stockRow(skuB, "12.0000", "0.0000")]),
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

function purchaseSnapshot(row: {
  recommendedWeekly: number | null;
  weeksCover: number | null;
  estimatedStockoutDate: string | null;
  suggestedValue: string | null;
  status: string;
  purchase: { suggestedQty: number };
}) {
  return {
    recommendedWeekly: row.recommendedWeekly,
    weeksCover: row.weeksCover,
    estimatedStockoutDate: row.estimatedStockoutDate,
    suggestedQty: row.purchase.suggestedQty,
    suggestedValue: row.suggestedValue,
    status: row.status,
  };
}

async function forecastRow(sku: string) {
  const list = await listPurchasingForecast(adminId, { q: sku, pageSize: 20 });
  const row = list.rows.find((item) => item.sku === sku);
  if (!row) throw new Error(`missing forecast row ${sku}`);
  return row;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const FBA_HEADER =
  "Branch,Group,Part Number,C,Description,Latest Cost,Stk,Avail,Pick Qty,Physical Stk,Ryr,Curr,Mth1,P/Ord Qty,Sub Grp,GROUP";

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`hist.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  accountsId = await ensureUser(`hist.acc.${stamp}@example.invalid`, ["ACCOUNTS"]);
  salesId = await ensureUser(`hist.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  tradeId = await ensureUser(`hist.trade.${stamp}@example.invalid`, [], "TRADE");
  const company = await prisma.company.create({
    data: { name: `Hist Co ${stamp}`, status: "ACTIVE", autopartCustomerCode: `H${stamp}` },
  });
  companyId = company.id;
  brandSlug = await makeSku(skuA, awkwardName, `Hist ${stamp}`);
  await makeSku(skuB, `Quiet ${stamp}`, `Hist ${stamp}`);
  gapBrandSlug = await makeSku(skuGap, `Gap ${stamp}`, `Gap ${stamp}`);
  await applyWarehouse();

  await seedSale(skuA, opening, "1", `H-${stamp}-OPEN`);
  await seedSale(skuA, `${sumMonth}-15`, "10", `H-${stamp}-A`, "40.00");
  await seedSale(skuB, `${sumMonth}-15`, "15", `H-${stamp}-B`, "25.00");
  await seedSale(skuA, `${addMonths(todayMonth, -7)}-15`, "1", `H-${stamp}-C`);
  for (const month of [-6, -5, -4]) {
    await seedSale(skuA, `${addMonths(todayMonth, month)}-15`, "10", `H-${stamp}-P${month}`);
  }
  await seedSale(skuA, `${addMonths(todayMonth, -2)}-15`, "30", `H-${stamp}-R2`);
  await seedSale(skuA, `${addMonths(todayMonth, -1)}-15`, "30", `H-${stamp}-R1`);
  await seedSale(skuA, today, "4", `H-${stamp}-TODAY`);
  await seedSale(skuGap, addDaysIso(today, -200), "2", `H-${stamp}-G1`);
  await seedSale(skuGap, today, "2", `H-${stamp}-G2`);
}, 120_000);

afterAll(async () => {
  await prisma.salesHistoryCoverageVerification.deleteMany({ where: { notes: { startsWith: `hist-test ${stamp}` } } });
  await prisma.$disconnect();
});

describe("sales history verification permissions and coverage", () => {
  it("requires purchasing.manage to verify and purchasing.view to read, and denies sales and trade", async () => {
    await expect(
      verifySalesHistoryCoverage(accountsId, {
        scope: "BRAND",
        brandSlug,
        coverageFrom: `${sumMonth}-15`,
        coverageTo: today,
        confirmed: true,
        notes: `hist-test ${stamp} denied`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(previewSalesHistoryCoverage(salesId, { scope: "BRAND", brandSlug })).rejects.toBeInstanceOf(AuthError);
    await expect(verifySalesHistoryCoverage(tradeId, { scope: "BRAND", brandSlug, coverageFrom: today, coverageTo: today, confirmed: true })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(getSkuSalesTrend(tradeId, { sku: skuA })).rejects.toBeInstanceOf(AuthError);
    await expect(exportStockForecastCsv(salesId, { brand: brandSlug })).rejects.toBeInstanceOf(AuthError);
    const preview = await previewSalesHistoryCoverage(accountsId, { scope: "BRAND", brandSlug });
    expect(preview.canManage).toBe(false);
    expect(preview.earliestSale).toBe(opening);
    expect(preview.latestSale).toBe(today);
    expect(preview.skuCount).toBeGreaterThanOrEqual(2);
  });

  it("rejects an unconfirmed, reversed, or future coverage range", async () => {
    await expect(
      verifySalesHistoryCoverage(adminId, {
        scope: "BRAND",
        brandSlug,
        coverageFrom: `${sumMonth}-15`,
        coverageTo: today,
        confirmed: false,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      verifySalesHistoryCoverage(adminId, {
        scope: "BRAND",
        brandSlug,
        coverageFrom: today,
        coverageTo: `${sumMonth}-15`,
        confirmed: true,
        notes: `hist-test ${stamp} reversed`,
      }),
    ).rejects.toMatchObject({ message: "Coverage end must be on or after the start date." });
    await expect(
      verifySalesHistoryCoverage(adminId, {
        scope: "BRAND",
        brandSlug,
        coverageFrom: `${sumMonth}-15`,
        coverageTo: addDaysIso(today, 1),
        confirmed: true,
        notes: `hist-test ${stamp} future`,
      }),
    ).rejects.toMatchObject({ message: "Coverage cannot extend beyond the imported sales dates for this scope." });
  });

  it("keeps suggested order unchanged and classifies partial then merged coverage", async () => {
    const before = await forecastRow(skuA);
    expect(before.historyVerification).toBe("UNVERIFIED");
    const shortFrom = addDaysIso(today, -20);
    await verifySalesHistoryCoverage(adminId, {
      scope: "BRAND",
      brandSlug,
      coverageFrom: shortFrom,
      coverageTo: today,
      confirmed: true,
      notes: `hist-test ${stamp} partial`,
    });
    const partial = await forecastRow(skuA);
    expect(purchaseSnapshot(partial)).toEqual(purchaseSnapshot(before));
    expect(partial.historyVerification).toBe("PARTIAL");
    const olderTo = addDaysIso(shortFrom, -1);
    await verifySalesHistoryCoverage(adminId, {
      scope: "BRAND",
      brandSlug,
      coverageFrom: opening,
      coverageTo: olderTo,
      confirmed: true,
      notes: `hist-test ${stamp} contiguous`,
    });
    const merged = await previewSalesHistoryCoverage(adminId, { scope: "BRAND", brandSlug });
    expect(merged.effectiveCoverage).toEqual([{ from: opening, to: today }]);
    const verified = await forecastRow(skuA);
    expect(verified.historyVerification).toBe("VERIFIED");
    expect(purchaseSnapshot(verified)).toEqual(purchaseSnapshot(before));
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "purchasing.sales_history.verify", actorUserId: adminId, entityType: "SalesHistoryCoverageVerification" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorUserId).toBe(adminId);
    expect(audit?.metadata).toMatchObject({ brandSlug, coverageTo: olderTo });
  });

  it("does not merge a genuine gap", async () => {
    const earlyTo = addDaysIso(today, -160);
    const lateFrom = addDaysIso(today, -40);
    await verifySalesHistoryCoverage(adminId, {
      scope: "BRAND",
      brandSlug: gapBrandSlug,
      coverageFrom: addDaysIso(today, -200),
      coverageTo: earlyTo,
      confirmed: true,
      notes: `hist-test ${stamp} gap-early`,
    });
    await verifySalesHistoryCoverage(adminId, {
      scope: "BRAND",
      brandSlug: gapBrandSlug,
      coverageFrom: lateFrom,
      coverageTo: today,
      confirmed: true,
      notes: `hist-test ${stamp} gap-late`,
    });
    const preview = await previewSalesHistoryCoverage(adminId, { scope: "BRAND", brandSlug: gapBrandSlug });
    expect(preview.effectiveCoverage.length).toBeGreaterThan(1);
    const classified = classifySalesHistoryVerification(preview.effectiveCoverage, requiredForecastCoverageWindow(today));
    const row = await forecastRow(skuGap);
    expect(row.historyVerification).toBe(classified.status);
    expect(classified.status).toBe("PARTIAL");
  });
});

describe("monthly sales trends", () => {
  it("aggregates a brand without dropping a zero month or double-counting SKUs", async () => {
    const trend = await getBrandSalesTrend(adminId, { brandSlug, range: "all" });
    expect(trend.points.find((point) => point.month === sumMonth)?.units).toBe(25);
    expect(trend.points.find((point) => point.month === zeroMonth)?.units).toBe(0);
    expect(trend.points[0]?.month).toBe(opening.slice(0, 7));
    expect(trend.direction).toBe("GROWING");
    const year = await getBrandSalesTrend(adminId, { brandSlug, range: "12" });
    const two = await getBrandSalesTrend(adminId, { brandSlug, range: "24" });
    expect(year.points.some((point) => point.month < opening.slice(0, 7))).toBe(false);
    expect(two.points[0]?.month).toBe(opening.slice(0, 7));
    expect(year.points.find((point) => point.month === zeroMonth)?.units).toBe(0);
  });

  it("does not treat an FBA stock upload or its usage fields as sales", async () => {
    const before = await getSkuSalesTrend(adminId, { sku: skuA, range: "all" });
    const linesBefore = await prisma.autopartSalesLine.count({ where: { sku: skuA } });
    const text = [
      FBA_HEADER,
      ["OPTIMUS", group, skuA, "O", "FBA row", "88.00", "99.0000", "17.0000", "7.0000", "80.0000", "111", "9", "14", "40.0000", "SUBGRP", "TRAIL"].join(","),
      ["OPTIMUS", group, fbaOnly, "O", "FBA only", "88.00", "99.0000", "5.0000", "1.0000", "5.0000", "50", "8", "14", "0", "SUBGRP", "TRAIL"].join(","),
    ].join("\n");
    const imported = await importFbaStock(adminId, { fileName: `fba-${stamp}.csv`, text });
    expect(imported.status).toBe("IMPORTED");
    const after = await getSkuSalesTrend(adminId, { sku: skuA, range: "all" });
    expect(after.points.map((point) => [point.month, point.units])).toEqual(
      before.points.map((point) => [point.month, point.units]),
    );
    expect(await prisma.autopartSalesLine.count({ where: { sku: skuA } })).toBe(linesBefore);
    const unused = await getSkuSalesTrend(adminId, { sku: fbaOnly, range: "all" });
    expect(unused.points.every((point) => point.units === 0)).toBe(true);
    expect(unused.last365).toBe(0);
  });
});

describe("stock forecast csv", () => {
  it("exports the full filtered set, escapes text, and keeps money numeric", async () => {
    const page = await listPurchasingForecast(adminId, { brand: brandSlug, page: 1, pageSize: 1 });
    const exported = await exportStockForecastCsv(adminId, { brand: brandSlug, page: 1, pageSize: 1 });
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBeGreaterThan(1);
    expect(exported.rowCount).toBe(page.total);
    expect(exported.filename).toBe(`stock-forecast-${brandSlug}-${today}.csv`);

    const table = parseCsv(exported.csv);
    const header = table[0]!;
    expect(header).toContain("Warehouse Stock");
    expect(header).toContain("FBA Stock");
    expect(header).toContain("Total Stock");
    expect(header).toContain("Latest Cost GBP");
    expect(header).toContain("Suggested Value GBP");
    expect(header).toContain("Sales History Confidence");
    const index = (name: string) => header.indexOf(name);
    const data = table.slice(1);
    const a = data.find((cells) => cells[index("SKU")] === skuA);
    const b = data.find((cells) => cells[index("SKU")] === skuB);
    expect(a?.[index("Product")]).toBe(awkwardName);
    expect(a?.[index("Latest Cost GBP")]).toMatch(/^\d+(\.\d+)?$/);
    expect(a?.[index("Latest Cost GBP")]).not.toContain("£");
    expect(Number(a?.[index("Warehouse Stock")])).toBe(36);
    expect(Number(a?.[index("FBA Stock")])).toBe(17);
    expect(Number(a?.[index("Total Stock")])).toBe(53);
    expect(Number(b?.[index("Warehouse Stock")])).toBe(12);
    expect(Number(b?.[index("FBA Stock")])).toBe(0);
    expect(Number(b?.[index("Total Stock")])).toBe(12);
    expect(Number(a?.[index("Incoming")])).toBe(8);
    expect(Number(b?.[index("Incoming")])).toBe(0);

    const incoming = await exportStockForecastCsv(adminId, { brand: brandSlug, incoming: "yes" });
    const incomingRows = parseCsv(incoming.csv).slice(1);
    expect(incomingRows.map((cells) => cells[1])).toContain(skuA);
    expect(incomingRows.map((cells) => cells[1])).not.toContain(skuB);

    const status = page.rows[0]!.status;
    const byStatus = await listPurchasingForecast(adminId, { brand: brandSlug, status, pageSize: 50 });
    const statusExport = await exportStockForecastCsv(adminId, { brand: brandSlug, status });
    expect(statusExport.rowCount).toBe(byStatus.total);

    const trend = (await forecastRow(skuA)).trend;
    const byTrend = await listPurchasingForecast(adminId, { brand: brandSlug, trend, pageSize: 50 });
    const trendExport = await exportStockForecastCsv(adminId, { brand: brandSlug, trend });
    expect(trendExport.rowCount).toBe(byTrend.total);
    const none = await exportStockForecastCsv(adminId, { brand: brandSlug, trend: "NOT_A_TREND" });
    expect(none.rowCount).toBe(0);

    const combined = await exportStockForecastCsv(adminId, {
      brand: brandSlug,
      incoming: "yes",
      status: (await forecastRow(skuA)).status,
      trend,
    });
    const combinedList = await listPurchasingForecast(adminId, {
      brand: brandSlug,
      incoming: "yes",
      status: (await forecastRow(skuA)).status,
      trend,
      pageSize: 50,
    });
    expect(combined.rowCount).toBe(combinedList.total);
    expect(parseCsv(combined.csv).slice(1).map((cells) => cells[1])).toContain(skuA);

    const everything = await listPurchasingForecast(accountsId, { page: 1, pageSize: 1 });
    const allExport = await exportStockForecastCsv(accountsId, { page: 1, pageSize: 1 });
    expect(allExport.rowCount).toBe(everything.total);
    expect(allExport.rowCount).toBeGreaterThan(page.total);
  });
});
