/**
 * FBA replenishment ledger against a disposable Postgres database.
 * The guard refuses production and any database whose name does not end with _test.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDaysIso, todayLondonDateOnly } from "@/domain/sales-history-period";
import { skuMatchKey } from "@/domain/stock";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  getFbaForecastWorkspace,
  importFbaAmazonSales,
  importOinReplenishment,
  saveFbaInboundShipment,
  updateFbaForecastSettings,
} from "@/server/purchasing/fba-forecast";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36).toUpperCase();
const doc = `OIN${stamp}A`;
const otherDoc = `OIN${stamp}B`;
const amended = `FA${stamp}`;
const kept = `FB${stamp}`;
const other = `FC${stamp}`;
const freshSku = `FD${stamp}`;
const staleSku = `FE${stamp}`;
const email = `fba-forecast-${stamp.toLowerCase()}@example.test`;

function uk(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function pair(
  reference: string,
  date: string,
  goods: string,
  lines: string[],
): { report504: string; reportTrm: string } {
  return {
    report504: `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${reference},${uk(date)},10:00,Retail Amazon,${goods},0.00,${goods},WR,AMZ
`,
    reportTrm: `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${lines.map((line) => `AMZ,RET,${reference},${uk(date)},${line}`).join("\n")}
`,
  };
}

function salesCsv(input: {
  from: string;
  to: string;
  extracted: string;
  complete: "yes" | "no";
  zeros: "yes" | "no";
  rows: string[];
  channel?: boolean;
}): string {
  const header =
    input.channel === false
      ? "sku,date,units_sold,units_credited,marketplace"
      : "sku,date,units_sold,units_credited,marketplace,fulfilment_channel";
  return [
    "coverage_from,coverage_to,extracted_on,fulfilment_scope,complete,zeros_omitted",
    `${input.from},${input.to},${input.extracted},FBA,${input.complete},${input.zeros}`,
    header,
    ...input.rows,
  ].join("\n");
}

describe("FBA replenishment ledger", () => {
  let actorUserId = "";
  let previousSettings: {
    leadTimeDays: number;
    targetCoverWeeks: { toString(): string };
    safetyStockQty: number;
    caseMultiple: number | null;
    overstockCoverWeeks: { toString(): string };
    updatedByUserId: string | null;
  } | null = null;

  beforeAll(async () => {
    await bootstrapRbac(prisma);
    previousSettings = await prisma.fbaForecastSettings.findUnique({ where: { id: "default" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    const user = await prisma.user.create({
      data: {
        email,
        name: "FBA forecast",
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
      },
    });
    actorUserId = user.id;
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  });

  afterAll(async () => {
    await prisma.fbaInboundShipment.deleteMany({ where: { reference: `IN-${stamp}` } });
    await prisma.fbaReplenishmentDocument.deleteMany({
      where: { documentReference: { in: [doc, otherDoc] } },
    });
    await prisma.fbaReplenishmentImport.deleteMany({
      where: { filename504: { startsWith: `504-${stamp}` } },
    });
    await prisma.fbaAmazonSalesImport.deleteMany({
      where: { filename: { startsWith: `amazon-${stamp}` } },
    });
    await prisma.autopartFbaStockImport.deleteMany({
      where: { fileHash: { startsWith: `fba-${stamp}` } },
    });
    await prisma.autopartProduct.deleteMany({
      where: { matchKey: { in: [freshSku, staleSku].map((sku) => skuMatchKey(sku)) } },
    });
    await prisma.autopartSalesDocument.deleteMany({
      where: { documentReference: doc, autopartCustomerCode: `FBA${stamp}` },
    });
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
    } else if (actorUserId) {
      await prisma.fbaForecastSettings.deleteMany({
        where: { id: "default", updatedByUserId: actorUserId },
      });
    }
    if (actorUserId) await prisma.user.deleteMany({ where: { id: actorUserId } });
    await prisma.$disconnect();
  });

  it("keeps amended OIN cadence, per-SKU stock age, and FBA-only sales honest", async () => {
    const today = todayLondonDateOnly();
    const docDate = addDaysIso(today, -3);
    const first = pair(doc, docDate, "60.00", [
      `${amended},Disc,2,20.00,5.00,15.00,50`,
      `${kept},Pad,4,40.00,10.00,30.00,50`,
    ]);
    const otherPair = pair(otherDoc, docDate, "70.00", [`${other},Other,7,70.00,10.00,60.00,50`]);
    await importOinReplenishment(actorUserId, {
      report504: `${first.report504}${otherPair.report504.split("\n").slice(1).join("\n")}`,
      reportTrm: `${first.reportTrm}${otherPair.reportTrm.split("\n").slice(1).join("\n")}`,
      filename504: `504-${stamp}-v1.csv`,
      filenameTrm: `trm-${stamp}-v1.csv`,
    });
    const revised = pair(doc, docDate, "30.00", [`${amended},Disc,3,30.00,5.00,25.00,50`]);
    const second = await importOinReplenishment(actorUserId, {
      report504: revised.report504,
      reportTrm: revised.reportTrm,
      filename504: `504-${stamp}-v2.csv`,
      filenameTrm: `trm-${stamp}-v2.csv`,
    });
    expect(second.duplicate).toBe(false);
    expect(second.supersededLines).toBe(1);
    const again = await importOinReplenishment(actorUserId, {
      report504: revised.report504,
      reportTrm: revised.reportTrm,
      filename504: `504-${stamp}-v2.csv`,
      filenameTrm: `trm-${stamp}-v2.csv`,
    });
    expect(again.duplicate).toBe(true);

    const activeAmended = await prisma.fbaReplenishmentLine.findMany({
      where: { matchKey: skuMatchKey(amended), supersededAt: null },
    });
    expect(activeAmended).toHaveLength(1);
    expect(Number(activeAmended[0]?.qty)).toBe(3);
    const retired = await prisma.fbaReplenishmentLine.findMany({
      where: { matchKey: skuMatchKey(amended), supersededAt: { not: null } },
    });
    expect(retired).toHaveLength(1);
    expect(Number(retired[0]?.qty)).toBe(2);
    const cadence = await getFbaForecastWorkspace(actorUserId, { q: amended });
    // The manual ledger account on this file is AMZ, so the rows stay for audit and are not RETAILA cadence.
    expect(cadence.rows.find((row) => row.matchKey === skuMatchKey(amended))?.oinUnits90 ?? 0).toBe(0);
    const keptRow = await getFbaForecastWorkspace(actorUserId, { q: kept });
    expect(keptRow.rows.find((row) => row.matchKey === skuMatchKey(kept))?.oinUnits90 ?? 0).toBe(0);
    const otherRow = await getFbaForecastWorkspace(actorUserId, { q: other });
    expect(otherRow.rows.find((row) => row.matchKey === skuMatchKey(other))?.oinUnits90 ?? 0).toBe(0);
    expect(await prisma.autopartSalesDocument.count({ where: { documentReference: doc } })).toBe(0);

    const ambiguous = pair(doc, docDate, "100.00", [
      `${amended},Disc,9,90.00,5.00,85.00,50`,
      `${amended},Disc,1,10.00,5.00,5.00,50`,
    ]);
    const ambiguousImport = await importOinReplenishment(actorUserId, {
      report504: ambiguous.report504,
      reportTrm: ambiguous.reportTrm,
      filename504: `504-${stamp}-ambiguous.csv`,
      filenameTrm: `trm-${stamp}-ambiguous.csv`,
    });
    expect(ambiguousImport.exceptions.some((item) => item.code === "AMBIGUOUS_LINE")).toBe(true);
    const still = await prisma.fbaReplenishmentLine.findMany({
      where: { matchKey: skuMatchKey(amended), supersededAt: null },
    });
    expect(still).toHaveLength(1);
    expect(Number(still[0]?.qty)).toBe(3);

    const mfn = salesCsv({
      from: today,
      to: today,
      extracted: today,
      complete: "yes",
      zeros: "no",
      rows: [`${freshSku},${today},4,0,AMAZON_UK,MFN`, `${freshSku},${today},9,0,AMAZON_UK,AFN`],
    });
    await expect(
      importFbaAmazonSales(actorUserId, {
        text: mfn,
        filename: `amazon-${stamp}-mfn.csv`,
        completeDaily: true,
        fbaOnlyAttested: true,
      }),
    ).rejects.toThrow(/MFN|FBM/);
    const normalized = salesCsv({
      from: today,
      to: today,
      extracted: today,
      complete: "yes",
      zeros: "no",
      channel: false,
      rows: [`${freshSku},${today},4,0,AMAZON_UK`],
    });
    await expect(
      importFbaAmazonSales(actorUserId, {
        text: normalized,
        filename: `amazon-${stamp}-normalized.csv`,
        completeDaily: true,
        fbaOnlyAttested: false,
      }),
    ).rejects.toThrow(/fulfilment_channel/);
    const unscoped = [
      "coverage_from,coverage_to,extracted_on,fulfilment_scope,complete,zeros_omitted",
      `${today},${today},${today},FBA,yes,no`,
      "sku,date,units_sold,units_credited,fulfilment_channel",
      `${freshSku},${today},4,0,AFN`,
    ].join("\n");
    await expect(
      importFbaAmazonSales(actorUserId, {
        text: unscoped,
        filename: `amazon-${stamp}-unscoped.csv`,
        completeDaily: true,
        fbaOnlyAttested: true,
        ukMarketplaceAttested: true,
      }),
    ).rejects.toThrow(/not treated as Amazon UK/);
    const german = salesCsv({
      from: today,
      to: today,
      extracted: today,
      complete: "yes",
      zeros: "no",
      rows: [`${freshSku},${today},4,0,AMAZON_DE,AFN`],
    });
    await expect(
      importFbaAmazonSales(actorUserId, {
        text: german,
        filename: `amazon-${stamp}-de.csv`,
        completeDaily: true,
        fbaOnlyAttested: true,
        ukMarketplaceAttested: true,
      }),
    ).rejects.toThrow(/AMAZON_DE/);
    const normalizedUk = [
      "coverage_from,coverage_to,extracted_on,fulfilment_scope,complete,zeros_omitted," +
        "marketplace_scope",
      `${today},${today},${today},FBA,yes,no,AMAZON_UK`,
      "sku,date,units_sold,units_credited,fulfilment_channel",
      `${freshSku},${today},4,0,AFN`,
    ].join("\n");
    await expect(
      importFbaAmazonSales(actorUserId, {
        text: normalizedUk,
        filename: `amazon-${stamp}-uk-scope.csv`,
        completeDaily: true,
        fbaOnlyAttested: true,
        ukMarketplaceAttested: false,
      }),
    ).rejects.toThrow(/Amazon UK/);
    expect(
      await prisma.fbaAmazonSalesLine.count({ where: { sku: { in: [freshSku, staleSku] } } }),
    ).toBe(0);

    const now = new Date();
    const staleAt = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const freshProduct = await prisma.autopartProduct.create({
      data: {
        sku: freshSku,
        matchKey: skuMatchKey(freshSku),
        description: "Fresh FBA",
        availQty: 5,
        presentInLatestFeed: true,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
    const staleProduct = await prisma.autopartProduct.create({
      data: {
        sku: staleSku,
        matchKey: skuMatchKey(staleSku),
        description: "Stale FBA",
        availQty: 5,
        presentInLatestFeed: true,
        firstSeenAt: staleAt,
        lastSeenAt: staleAt,
      },
    });
    const oldImport = await prisma.autopartFbaStockImport.create({
      data: {
        fileName: `optimus-${stamp}-old.csv`,
        fileHash: `fba-${stamp}-old`,
        status: "SUCCESS",
        importedAt: staleAt,
        sourceBranch: "OPTIMUS",
        completeSnapshot: false,
        warnings: [],
      },
    });
    const newImport = await prisma.autopartFbaStockImport.create({
      data: {
        fileName: `optimus-${stamp}-partial.csv`,
        fileHash: `fba-${stamp}-partial`,
        status: "SUCCESS",
        importedAt: now,
        sourceBranch: "OPTIMUS",
        completeSnapshot: false,
        warnings: [],
      },
    });
    await prisma.autopartLocationStock.create({
      data: {
        autopartProductId: freshProduct.id,
        locationCode: "FBA",
        availableQty: 10,
        sourceBranch: "OPTIMUS",
        sourceImportedAt: now,
        importId: newImport.id,
      },
    });
    await prisma.autopartLocationStock.create({
      data: {
        autopartProductId: staleProduct.id,
        locationCode: "FBA",
        availableQty: 10,
        sourceBranch: "OPTIMUS",
        sourceImportedAt: staleAt,
        importId: oldImport.id,
      },
    });

    const start = addDaysIso(today, -29);
    const sparse = salesCsv({
      from: start,
      to: today,
      extracted: today,
      complete: "yes",
      zeros: "no",
      rows: [`${freshSku},${start},1,0,AMAZON_UK,AFN`, `${freshSku},${today},1,0,AMAZON_UK,AFN`],
    });
    const sparseImport = await importFbaAmazonSales(actorUserId, {
      text: sparse,
      filename: `amazon-${stamp}-sparse.csv`,
      completeDaily: true,
      fbaOnlyAttested: true,
    });
    expect(sparseImport.completeDaily).toBe(false);
    expect(sparseImport.coverageHasGaps).toBe(true);
    const incomplete = await getFbaForecastWorkspace(actorUserId, { q: freshSku });
    const incompleteRow = incomplete.rows.find((row) => row.matchKey === skuMatchKey(freshSku));
    expect(incomplete.sales?.completeDaily).toBe(false);
    expect(incompleteRow?.forecast.recommendation).toBe("INSUFFICIENT_DATA");
    expect(incompleteRow?.forecast.weeklyRate).toBeNull();
    expect(incompleteRow?.forecast.suggestedSendQty).toBeNull();

    const coverageFrom = addDaysIso(today, -34);
    const daily: string[] = [];
    for (let day = 0; day < 35; day += 1) {
      const date = addDaysIso(today, -day);
      daily.push(`${freshSku},${date},1,0,AMAZON_UK,AFN`, `${staleSku},${date},1,0,AMAZON_UK,AFN`);
    }
    const complete = salesCsv({
      from: coverageFrom,
      to: today,
      extracted: today,
      complete: "yes",
      zeros: "no",
      rows: daily,
    });
    const completeImport = await importFbaAmazonSales(actorUserId, {
      text: complete,
      filename: `amazon-${stamp}-complete.csv`,
      completeDaily: true,
      fbaOnlyAttested: true,
    });
    expect(completeImport.completeDaily).toBe(true);
    await updateFbaForecastSettings(actorUserId, {
      leadTimeDays: 14,
      targetCoverWeeks: 6,
      safetyStockQty: 0,
      caseMultiple: 4,
      overstockCoverWeeks: 16,
    });
    const forecast = await getFbaForecastWorkspace(actorUserId, { q: stamp });
    expect(forecast.stale).toBe(false);
    const fresh = forecast.rows.find((row) => row.matchKey === skuMatchKey(freshSku));
    const stale = forecast.rows.find((row) => row.matchKey === skuMatchKey(staleSku));
    expect(fresh?.amazonUnits.d30).toBe(30);
    expect(fresh?.forecast.suggestedSendQty).toBe(48);
    expect(fresh?.forecast.recommendation).toBe("SEND_NOW");
    expect(fresh?.forecast.dispatchableQty).toBe(4);
    expect(fresh?.forecast.looseStudleyQty).toBe(1);
    expect(fresh?.forecast.studleyShortfallQty).toBe(43);
    expect(stale?.forecast.recommendation).toBe("INSUFFICIENT_DATA");
    expect(stale?.forecast.suggestedSendQty).toBeNull();
    expect(stale?.forecast.fbaStockVerified).toBe(false);
    expect(forecast.unverifiedFbaSkus).toBeGreaterThan(0);

    await saveFbaInboundShipment(actorUserId, {
      reference: `IN-${stamp}`,
      sku: freshSku,
      qty: 100,
      status: "PLANNED",
    });
    const planned = await getFbaForecastWorkspace(actorUserId, { q: freshSku });
    expect(
      planned.rows.find((row) => row.matchKey === skuMatchKey(freshSku))?.forecast.suggestedSendQty,
    ).toBe(48);
    await saveFbaInboundShipment(actorUserId, {
      reference: `IN-${stamp}`,
      sku: freshSku,
      qty: 8,
      status: "CONFIRMED_IN_TRANSIT",
    });
    const inbound = await getFbaForecastWorkspace(actorUserId, { q: freshSku });
    expect(
      inbound.rows.find((row) => row.matchKey === skuMatchKey(freshSku))?.forecast.suggestedSendQty,
    ).toBe(40);
  }, 60_000);
});
