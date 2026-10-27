/**
 * FBA replenishment ledger against Postgres.
 * Skipped when DATABASE_URL is unset. Does not bootstrap RBAC or rewrite role grants.
 */
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDaysIso, todayLondonDateOnly } from "@/domain/sales-history-period";
import { skuMatchKey } from "@/domain/stock";
import {
  getFbaForecastWorkspace,
  importFbaAmazonSales,
  importOinReplenishment,
  saveFbaInboundShipment,
  updateFbaForecastSettings,
} from "@/server/purchasing/fba-forecast";

const hasDb = Boolean(process.env["DATABASE_URL"]);
const prisma = hasDb ? new PrismaClient() : null;
const stamp = Date.now().toString(36).toUpperCase();
const doc = `OIN${stamp.slice(0, 8)}`;
const sku = `ZF${stamp.slice(0, 6)}`;
const orphan = `ZU${stamp.slice(0, 6)}`;
const email = `fba-forecast-${stamp.toLowerCase()}@example.test`;

const report504 = `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${doc},01/10/2026,10:00,Retail Amazon,40.00,8.00,48.00,WR,AMZ
`;
const reportTrm = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
AMZ,RET,${doc},01/10/2026,${sku},Disc,2,40.00,10.00,30.00,50
AMZ,RET,${doc},01/10/2026,${orphan},Missing,1,0.00,0.00,0.00,0
`;

describe.skipIf(!hasDb)("FBA replenishment ledger", () => {
  let actorUserId = "";
  let previousSettings: {
    leadTimeDays: number;
    targetCoverWeeks: { toString(): string };
    safetyStockQty: number;
    caseMultiple: number | null;
    overstockCoverWeeks: { toString(): string };
    updatedByUserId: string | null;
  } | null = null;
  let createdImportId: string | null = null;

  afterAll(async () => {
    if (!prisma) return;
    if (createdImportId) {
      await prisma.autopartFbaStockImport.deleteMany({ where: { id: createdImportId } });
    }
    await prisma.fbaInboundShipment.deleteMany({ where: { reference: `IN-${stamp}` } });
    await prisma.fbaReplenishmentDocument.deleteMany({ where: { documentReference: doc } });
    await prisma.fbaReplenishmentImport.deleteMany({ where: { filename504: `504-${stamp}.csv` } });
    await prisma.fbaAmazonSalesImport.deleteMany({ where: { filename: `amazon-${stamp}.csv` } });
    await prisma.autopartProduct.deleteMany({ where: { matchKey: skuMatchKey(sku) } });
    await prisma.autopartSalesDocument.deleteMany({
      where: { documentReference: doc, autopartCustomerCode: `FBA${stamp}` },
    });
    if (actorUserId) await prisma.user.deleteMany({ where: { id: actorUserId } });
    if (previousSettings) {
      await prisma.fbaForecastSettings.update({
        where: { id: "default" },
        data: {
          leadTimeDays: previousSettings.leadTimeDays,
          targetCoverWeeks: previousSettings.targetCoverWeeks.toString(),
          safetyStockQty: previousSettings.safetyStockQty,
          caseMultiple: previousSettings.caseMultiple,
          overstockCoverWeeks: previousSettings.overstockCoverWeeks.toString(),
          updatedByUserId: previousSettings.updatedByUserId,
        },
      });
    } else {
      await prisma.fbaForecastSettings.deleteMany({
        where: { id: "default", updatedByUserId: actorUserId },
      });
    }
    await prisma.$disconnect();
  });

  it("stores OIN without a financial sales document and forecasts only from Amazon sales", async () => {
    const db = prisma!;
    const role = await db.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    const user = await db.user.create({
      data: {
        email,
        name: "FBA forecast",
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
      },
    });
    actorUserId = user.id;
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
    previousSettings = await db.fbaForecastSettings.findUnique({ where: { id: "default" } });

    const first = await importOinReplenishment(actorUserId, {
      report504,
      reportTrm,
      filename504: `504-${stamp}.csv`,
      filenameTrm: `trm-${stamp}.csv`,
    });
    expect(first.duplicate).toBe(false);
    const again = await importOinReplenishment(actorUserId, {
      report504,
      reportTrm,
      filename504: `504-${stamp}.csv`,
      filenameTrm: `trm-${stamp}.csv`,
    });
    expect(again.duplicate).toBe(true);
    expect(
      await db.autopartSalesDocument.count({
        where: { documentReference: doc },
      }),
    ).toBe(0);

    const beforeSales = await getFbaForecastWorkspace(actorUserId, { q: sku });
    const hidden = beforeSales.rows.find((row) => row.matchKey === skuMatchKey(sku));
    expect(hidden?.forecast.recommendation).toBe("INSUFFICIENT_DATA");
    expect(hidden?.forecast.weeklyRate).toBeNull();
    expect(hidden?.forecast.suggestedSendQty).toBeNull();
    expect(beforeSales.unmatchedSkus).toContain(skuMatchKey(orphan));

    const today = todayLondonDateOnly();
    const sales = ["sku,date,units_sold,units_credited"];
    for (let day = 0; day < 35; day += 1) sales.push(`${sku},${addDaysIso(today, -day)},1,0`);
    await importFbaAmazonSales(actorUserId, {
      text: sales.join("\n"),
      filename: `amazon-${stamp}.csv`,
      completeDaily: true,
    });

    const now = new Date(Date.now() + 60_000);
    const product = await db.autopartProduct.create({
      data: {
        sku,
        matchKey: skuMatchKey(sku),
        description: "FBA test",
        availQty: 5,
        presentInLatestFeed: true,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
    const stockImport = await db.autopartFbaStockImport.create({
      data: {
        fileName: `optimus-${stamp}.csv`,
        fileHash: `fba-${stamp}`,
        status: "IMPORTED",
        importedAt: now,
        sourceBranch: "OPTIMUS",
        warnings: [],
      },
    });
    createdImportId = stockImport.id;
    await db.autopartLocationStock.create({
      data: {
        autopartProductId: product.id,
        locationCode: "FBA",
        availableQty: 10,
        sourceBranch: "OPTIMUS",
        sourceImportedAt: now,
        importId: stockImport.id,
      },
    });

    await updateFbaForecastSettings(actorUserId, {
      leadTimeDays: 14,
      targetCoverWeeks: 6,
      safetyStockQty: 0,
      caseMultiple: 4,
      overstockCoverWeeks: 16,
    });
    const planned = await getFbaForecastWorkspace(actorUserId, { q: sku });
    const open = planned.rows.find((row) => row.matchKey === skuMatchKey(sku));
    expect(open?.amazonUnits.d30).toBe(30);
    expect(open?.amazonUnits.d7).toBe(7);
    expect(open?.amazonUnits.d90).toBeNull();
    expect(open?.forecast.suggestedSendQty).toBe(48);
    expect(open?.forecast.dispatchableQty).toBe(5);
    expect(open?.forecast.studleyShortfallQty).toBe(43);
    expect(open?.forecast.recommendation).toBe("SEND_NOW");

    await saveFbaInboundShipment(actorUserId, {
      reference: `IN-${stamp}`,
      sku,
      qty: 100,
      status: "PLANNED",
    });
    const stillOpen = await getFbaForecastWorkspace(actorUserId, { q: sku });
    expect(
      stillOpen.rows.find((row) => row.matchKey === skuMatchKey(sku))?.forecast.suggestedSendQty,
    ).toBe(48);

    await saveFbaInboundShipment(actorUserId, {
      reference: `IN-${stamp}`,
      sku,
      qty: 8,
      status: "CONFIRMED_IN_TRANSIT",
    });
    const inbound = await getFbaForecastWorkspace(actorUserId, { q: sku });
    expect(
      inbound.rows.find((row) => row.matchKey === skuMatchKey(sku))?.forecast.suggestedSendQty,
    ).toBe(40);

    await db.autopartSalesDocument.create({
      data: {
        autopartCustomerCode: `FBA${stamp}`,
        documentType: "INVOICE",
        documentReference: doc,
        source: "ONGOING_504",
        has504: false,
      },
    });
    const overlap = await getFbaForecastWorkspace(actorUserId, { q: sku });
    expect(overlap.overlapDocuments).toBeGreaterThan(0);

    await db.autopartFbaStockImport.update({
      where: { id: stockImport.id },
      data: { importedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
    });
    const latest = await db.autopartFbaStockImport.findFirst({ orderBy: { importedAt: "desc" } });
    if (latest?.id === stockImport.id) {
      const stale = await getFbaForecastWorkspace(actorUserId, { q: sku });
      const row = stale.rows.find((item) => item.matchKey === skuMatchKey(sku));
      expect(stale.stale).toBe(true);
      expect(row?.forecast.recommendation).toBe("INSUFFICIENT_DATA");
      expect(row?.forecast.suggestedSendQty).toBeNull();
      expect(row?.forecast.fbaStockVerified).toBe(false);
    }
  });
});
