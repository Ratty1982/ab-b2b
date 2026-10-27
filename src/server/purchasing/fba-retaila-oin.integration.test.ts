/**
 * RETAILA OIN history is read from Autopart sales, not a second 504/TRM upload.
 * The guard refuses any database whose name does not end with _test.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDaysIso, todayLondonDateOnly } from "@/domain/sales-history-period";
import { skuMatchKey } from "@/domain/stock";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { projectFbaShipment } from "@/domain/fba-replenishment";
import {
  exportFbaForecastCsv,
  getFbaForecastSku,
  getFbaForecastWorkspace,
  getFbaOinHistory,
  importFbaAmazonSales,
  updateFbaForecastSettings,
} from "@/server/purchasing/fba-forecast";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36).toUpperCase();
const once = `OIN${stamp}1`;
const conflict = `OIN${stamp}2`;
const invoice = `OIN${stamp}3`;
const credit = `OIN${stamp}4`;
const otherDoc = `SS${stamp}9`;
const foreignDoc = `OIN${stamp}8`;
const overlap = `OIN${stamp}5`;
const ledgerOnly = `OIN${stamp}6`;
const skuOnce = `RA${stamp}A`;
const skuFix = `RA${stamp}B`;
const skuNet = `RA${stamp}C`;
const skuOther = `RA${stamp}D`;
const skuForeign = `RA${stamp}E`;
const skuOverlap = `RA${stamp}F`;
const skuLedger = `RA${stamp}G`;
const skuCase = `RA${stamp}H`;
const adminEmail = `fba-retaila-${stamp.toLowerCase()}@example.test`;
const deniedEmail = `fba-denied-${stamp.toLowerCase()}@example.test`;
const viewerEmail = `fba-view-${stamp.toLowerCase()}@example.test`;

describe("RETAILA OIN forecast history", () => {
  let adminId = "";
  let deniedId = "";
  let viewerId = "";
  let retailaId = "";
  let otherId = "";
  let previousSettings: {
    leadTimeDays: number;
    targetCoverWeeks: { toString(): string };
    safetyStockQty: number;
    caseMultiple: number | null;
    overstockCoverWeeks: { toString(): string };
    updatedByUserId: string | null;
  } | null = null;
  const today = todayLondonDateOnly();

  beforeAll(async () => {
    await bootstrapRbac(prisma);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    const viewPermission = await prisma.permission.findUniqueOrThrow({
      where: { key: "purchasing.view" },
    });
    const backorderPermission = await prisma.permission.findUniqueOrThrow({
      where: { key: "purchasing.backorders.view" },
    });
    const viewerRole = await prisma.role.create({
      data: {
        key: `fba-view-${stamp}`,
        name: `FBA view ${stamp}`,
        permissions: { create: [{ permissionId: viewPermission.id }] },
      },
    });
    const deniedRole = await prisma.role.create({
      data: {
        key: `fba-denied-${stamp}`,
        name: `FBA denied ${stamp}`,
        permissions: { create: [{ permissionId: backorderPermission.id }] },
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        name: "FBA admin",
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
        userRoles: { create: { roleId: adminRole.id } },
      },
    });
    const denied = await prisma.user.create({
      data: {
        email: deniedEmail,
        name: "FBA denied",
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
        userRoles: { create: { roleId: deniedRole.id } },
      },
    });
    const viewer = await prisma.user.create({
      data: {
        email: viewerEmail,
        name: "FBA viewer",
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
        userRoles: { create: { roleId: viewerRole.id } },
      },
    });
    previousSettings = await prisma.fbaForecastSettings.findUnique({ where: { id: "default" } });
    adminId = admin.id;
    deniedId = denied.id;
    viewerId = viewer.id;
    retailaId = (
      await prisma.company.create({
        data: {
          name: `Retail Amazon ${stamp}`,
          status: "ACTIVE",
          autopartCustomerCode: `RETAILA${stamp}`,
          autopartCustomerCodeVerifiedAt: new Date(),
        },
      })
    ).id;
    await prisma.autopartCustomerAccountAlias.create({
      data: {
        companyId: retailaId,
        alias: "RETAILA",
        verifiedById: adminId,
      },
    });
    otherId = (
      await prisma.company.create({
        data: {
          name: `Other factor ${stamp}`,
          status: "ACTIVE",
          autopartCustomerCode: `OTHER${stamp}`,
          autopartCustomerCodeVerifiedAt: new Date(),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.fbaReplenishmentDocument.deleteMany({
      where: { documentReference: { in: [overlap, ledgerOnly] } },
    });
    await prisma.autopartSalesLine.deleteMany({
      where: { documentReference: { in: [once, conflict, invoice, credit, otherDoc, foreignDoc] } },
    });
    await prisma.autopartSalesDocument.deleteMany({
      where: { documentReference: { in: [once, conflict, invoice, credit, otherDoc, foreignDoc] } },
    });
    await prisma.fbaAmazonSalesImport.deleteMany({
      where: { filename: { startsWith: `amazon-retaila-${stamp}` } },
    });
    await prisma.autopartFbaStockImport.deleteMany({
      where: { fileHash: `fba-retaila-${stamp}` },
    });
    await prisma.autopartProduct.deleteMany({
      where: { sku: skuCase },
    });
    await prisma.company.deleteMany({ where: { id: { in: [retailaId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, deniedId, viewerId] } } });
    await prisma.role.deleteMany({ where: { key: { in: [`fba-view-${stamp}`, `fba-denied-${stamp}`] } } });
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
      await prisma.fbaForecastSettings.deleteMany({ where: { id: "default" } });
    }
    await prisma.$disconnect();
  });

  it("refuses a user without the FBA forecast permission and allows purchasing view", async () => {
    await expect(getFbaForecastWorkspace(deniedId)).rejects.toThrow(/Purchasing access required/);
    const allowed = await getFbaForecastWorkspace(viewerId);
    expect(allowed.canManage).toBe(false);
    expect(allowed.oin.account).toBe("RETAILA");
  });

  it("reads RETAILA OIN history once, and keeps every other invoice out", async () => {
    const before = await getFbaForecastWorkspace(adminId, { q: stamp });
    expect(before.oin.warning ?? "").toMatch(/No RETAILA OIN invoices/);
    expect(before.rows.every((row) => row.forecast.recommendation !== "SEND_NOW" || row.amazonUnits.d30 != null)).toBe(
      true,
    );

    const posted = new Date(`${today}T12:00:00.000Z`);
    async function document(input: {
      companyId: string | null;
      account: string;
      reference: string;
      type?: "INVOICE" | "CREDIT";
      goods?: string;
      has504?: boolean;
    }) {
      return prisma.autopartSalesDocument.create({
        data: {
          companyId: input.companyId,
          autopartCustomerCode: input.account,
          documentType: input.type ?? "INVOICE",
          documentReference: input.reference,
          documentDate: posted,
          ...(input.goods != null ? { goodsNet: input.goods } : {}),
          has504: input.has504 ?? false,
          hasTrm21qc: true,
          source: "ONGOING_504",
        },
      });
    }
    async function line(input: {
      documentId: string;
      companyId: string | null;
      account: string;
      reference: string;
      type?: "INVOICE" | "CREDIT";
      lineNumber: number;
      sku: string;
      units: number;
      salesNet: string;
      source: "561L" | "ONGOING_TRM21QC";
    }) {
      await prisma.autopartSalesLine.create({
        data: {
          documentId: input.documentId,
          companyId: input.companyId,
          autopartCustomerCode: input.account,
          documentType: input.type ?? "INVOICE",
          documentReference: input.reference,
          lineNumber: input.lineNumber,
          sku: input.sku,
          units: input.units,
          salesNet: input.salesNet,
          source: input.source,
        },
      });
    }

    const onceDoc = await document({ companyId: retailaId, account: "RETAILA", reference: once });
    await line({
      documentId: onceDoc.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: once,
      lineNumber: 1,
      sku: skuOnce,
      units: 4,
      salesNet: "40.00",
      source: "561L",
    });
    await line({
      documentId: onceDoc.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: once,
      lineNumber: 2,
      sku: skuOnce,
      units: 4,
      salesNet: "40.00",
      source: "ONGOING_TRM21QC",
    });

    const conflictDoc = await document({
      companyId: retailaId,
      account: "RETAILA",
      reference: conflict,
    });
    await line({
      documentId: conflictDoc.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: conflict,
      lineNumber: 1,
      sku: skuFix,
      units: 2,
      salesNet: "20.00",
      source: "561L",
    });
    await line({
      documentId: conflictDoc.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: conflict,
      lineNumber: 2,
      sku: skuFix,
      units: 3,
      salesNet: "30.00",
      source: "ONGOING_TRM21QC",
    });

    const invoiceDoc = await document({
      companyId: retailaId,
      account: "RETAILA",
      reference: invoice,
    });
    await line({
      documentId: invoiceDoc.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: invoice,
      lineNumber: 1,
      sku: skuNet,
      units: 5,
      salesNet: "50.00",
      source: "ONGOING_TRM21QC",
    });
    const creditDoc = await document({
      companyId: retailaId,
      account: "RETAILA",
      reference: credit,
      type: "CREDIT",
    });
    await line({
      documentId: creditDoc.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: credit,
      type: "CREDIT",
      lineNumber: 1,
      sku: skuNet,
      units: 2,
      salesNet: "20.00",
      source: "ONGOING_TRM21QC",
    });

    const plain = await document({
      companyId: retailaId,
      account: "RETAILA",
      reference: otherDoc,
    });
    await line({
      documentId: plain.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: otherDoc,
      lineNumber: 1,
      sku: skuOther,
      units: 9,
      salesNet: "90.00",
      source: "561L",
    });
    const foreign = await document({
      companyId: otherId,
      account: `OTHER${stamp}`,
      reference: foreignDoc,
    });
    await line({
      documentId: foreign.id,
      companyId: otherId,
      account: `OTHER${stamp}`,
      reference: foreignDoc,
      lineNumber: 1,
      sku: skuForeign,
      units: 8,
      salesNet: "80.00",
      source: "ONGOING_TRM21QC",
    });

    const overlapDoc = await document({
      companyId: retailaId,
      account: "RETAILA",
      reference: overlap,
    });
    await line({
      documentId: overlapDoc.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: overlap,
      lineNumber: 1,
      sku: skuOverlap,
      units: 4,
      salesNet: "40.00",
      source: "561L",
    });
    const ledgerDate = new Date(`${today}T00:00:00.000Z`);
    const ledgerOverlap = await prisma.fbaReplenishmentDocument.create({
      data: {
        documentReference: overlap,
        documentType: "INVOICE",
        documentDate: ledgerDate,
        customerAccount: "RETAILA",
      },
    });
    await prisma.fbaReplenishmentLine.create({
      data: {
        documentId: ledgerOverlap.id,
        lineKey: `ledger-${stamp}-overlap`,
        sku: skuOverlap,
        matchKey: skuMatchKey(skuOverlap),
        qty: 9,
      },
    });
    const ledger = await prisma.fbaReplenishmentDocument.create({
      data: {
        documentReference: ledgerOnly,
        documentType: "INVOICE",
        documentDate: ledgerDate,
        customerAccount: "RETAILA",
      },
    });
    await prisma.fbaReplenishmentLine.create({
      data: {
        documentId: ledger.id,
        lineKey: `ledger-${stamp}-only`,
        sku: skuLedger,
        matchKey: skuMatchKey(skuLedger),
        qty: 6,
      },
    });

    const history = await getFbaOinHistory(adminId, { page: 1 });
    const refs = history.documents.map((item) => item.documentReference);
    expect(refs).toContain(once);
    expect(refs).not.toContain(otherDoc);
    expect(refs).not.toContain(foreignDoc);
    const onceRow = history.documents.find((item) => item.documentReference === once);
    expect(onceRow?.status).toBe("COUNTED");
    expect(onceRow?.source).toBe("ONGOING_TRM21QC");
    expect(onceRow?.units).toBe(4);
    const conflictRow = history.documents.find((item) => item.documentReference === conflict);
    expect(conflictRow?.status).toBe("SOURCE_CONFLICT");
    expect(conflictRow?.units).toBe(0);
    const workspace = await getFbaForecastWorkspace(adminId, { q: stamp });
    const units = (sku: string) =>
      workspace.rows.find((row) => row.matchKey === skuMatchKey(sku))?.oinUnits90 ?? null;
    expect(units(skuOnce)).toBe(4);
    expect(units(skuFix)).toBeNull();
    expect(units(skuNet)).toBe(3);
    expect(units(skuOther)).toBeNull();
    expect(units(skuForeign)).toBeNull();
    expect(units(skuOverlap)).toBe(4);
    expect(units(skuLedger)).toBe(6);
    expect(workspace.oin.warning ?? "").toMatch(/need review/);
    const skuDetail = await getFbaForecastSku(adminId, { matchKey: skuMatchKey(skuOnce) });
    expect(skuDetail.documents.some((item) => item.documentReference === once && item.source === "ONGOING_TRM21QC")).toBe(
      true,
    );
    const untouched = workspace.rows.find((row) => row.matchKey === skuMatchKey(skuOnce));
    expect(untouched?.forecast.recommendation).toBe("INSUFFICIENT_DATA");
    expect(untouched?.forecast.suggestedSendQty).toBeNull();
    expect(untouched?.forecast.weeklyRate).toBeNull();
  });

  it("keeps shipment quantities on Amazon sales and whole cases", async () => {
    const expected = projectFbaShipment({
      fbaAvailable: 44,
      fbaStockKnown: true,
      fbaStockStale: false,
      studleyAvailable: 7,
      confirmedInboundQty: 0,
      salesSupported: true,
      amazonNetUnits30: 30,
      leadTimeDays: 14,
      targetCoverWeeks: 6,
      safetyStockQty: 0,
      caseMultiple: 12,
      overstockCoverWeeks: 16,
      today,
    });
    expect(expected.suggestedSendQty).toBe(12);
    expect(expected.dispatchableQty).toBe(0);

    const now = new Date();
    const product = await prisma.autopartProduct.create({
      data: {
        sku: skuCase,
        matchKey: skuMatchKey(skuCase),
        description: "Case pack",
        availQty: 7,
        presentInLatestFeed: true,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
    const stockImport = await prisma.autopartFbaStockImport.create({
      data: {
        fileName: `optimus-${stamp}.csv`,
        fileHash: `fba-retaila-${stamp}`,
        status: "SUCCESS",
        importedAt: now,
        sourceBranch: "OPTIMUS",
        completeSnapshot: false,
        warnings: [],
      },
    });
    await prisma.autopartLocationStock.create({
      data: {
        autopartProductId: product.id,
        locationCode: "FBA",
        availableQty: 44,
        sourceBranch: "OPTIMUS",
        sourceImportedAt: now,
        importId: stockImport.id,
      },
    });
    const from = addDaysIso(today, -29);
    const sales = [
      "coverage_from,coverage_to,extracted_on,fulfilment_scope,complete,zeros_omitted",
      `${from},${today},${today},FBA,yes,yes`,
      "sku,date,units_sold,units_credited,marketplace,fulfilment_channel",
      `${skuCase},${today},30,0,AMAZON_UK,AFN`,
    ].join("\n");
    await importFbaAmazonSales(adminId, {
      text: sales,
      filename: `amazon-retaila-${stamp}.csv`,
      completeDaily: true,
      fbaOnlyAttested: true,
      ukMarketplaceAttested: true,
    });
    await updateFbaForecastSettings(adminId, {
      leadTimeDays: 14,
      targetCoverWeeks: 6,
      safetyStockQty: 0,
      caseMultiple: 12,
      overstockCoverWeeks: 16,
    });
    const workspace = await getFbaForecastWorkspace(adminId, { q: skuCase });
    const row = workspace.rows.find((item) => item.matchKey === skuMatchKey(skuCase));
    expect(row?.amazonUnits.d30).toBe(30);
    expect(row?.forecast.suggestedSendQty).toBe(12);
    expect(row?.forecast.dispatchableQty).toBe(0);
    expect(row?.forecast.looseStudleyQty).toBe(7);
    expect(row?.forecast.studleyShortfallQty).toBe(5);
    expect(row?.oinUnits90 ?? 0).toBe(0);
    const csv = await exportFbaForecastCsv(adminId, { q: skuCase });
    expect(csv.csv).toContain(skuCase);
    expect(csv.csv).toContain("Suggested send");
    await expect(exportFbaForecastCsv(deniedId, { q: skuCase })).rejects.toThrow(/Purchasing access required/);
  });
});
