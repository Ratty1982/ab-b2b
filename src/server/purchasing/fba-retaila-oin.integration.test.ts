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
import { projectFbaShipment, RETAILA_PLANNING_SCOPE_POLICY } from "@/domain/fba-replenishment";
import { retailaReportingRequiredWeekdays } from "@/domain/fba-retaila-reporting-coverage";
import {
  approveRetailaPlanning,
  disableRetailaPlanning,
  exportFbaForecastCsv,
  getFbaForecastSku,
  getFbaForecastWorkspace,
  getFbaOinHistory,
  importFbaAmazonSales,
  setRetailaPlanningAuditWriterForTests,
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
const splitOnce = `OIN${stamp}S1`;
const splitConflict = `OIN${stamp}S2`;
const splitGoods = `OIN${stamp}S3`;
const notMerged = `OIN${stamp}S4`;
const foreignCoded = `OIN${stamp}S5`;
const twoOwners = `OIN${stamp}S6`;
const ledgerOverlapSplit = `OIN${stamp}S7`;
const ledgerRetaila = `OIN${stamp}L1`;
const ledgerOther = `OIN${stamp}L2`;
const ledgerBlank = `OIN${stamp}L3`;
const ledgerShadow = `OIN${stamp}L4`;
const identityRefs = [
  splitOnce,
  splitConflict,
  splitGoods,
  notMerged,
  foreignCoded,
  twoOwners,
  ledgerOverlapSplit,
  ledgerRetaila,
  ledgerOther,
  ledgerBlank,
  ledgerShadow,
];
const skuOnce = `RA${stamp}A`;
const skuFix = `RA${stamp}B`;
const skuNet = `RA${stamp}C`;
const skuOther = `RA${stamp}D`;
const skuForeign = `RA${stamp}E`;
const skuOverlap = `RA${stamp}F`;
const skuLedger = `RA${stamp}G`;
const skuCase = `RA${stamp}H`;
const skuSplitOnce = `RA${stamp}I`;
const skuSplitConflict = `RA${stamp}J`;
const skuSplitGoods = `RA${stamp}K`;
const skuNotMerged = `RA${stamp}L`;
const skuForeignCoded = `RA${stamp}M`;
const skuTwoOwners = `RA${stamp}N`;
const skuLedgerOverlap = `RA${stamp}S`;
const skuLedgerRetaila = `RA${stamp}O`;
const skuLedgerOther = `RA${stamp}P`;
const skuLedgerBlank = `RA${stamp}Q`;
const skuLedgerShadow = `RA${stamp}R`;
const adminEmail = `fba-retaila-${stamp.toLowerCase()}@example.test`;
const deniedEmail = `fba-denied-${stamp.toLowerCase()}@example.test`;
const viewerEmail = `fba-view-${stamp.toLowerCase()}@example.test`;

describe("RETAILA OIN forecast history", () => {
  let adminId = "";
  let deniedId = "";
  let viewerId = "";
  let retailaId = "";
  let otherId = "";
  let retailaTwoId = "";
  let previousSettings: {
    leadTimeDays: number;
    targetCoverWeeks: { toString(): string };
    safetyStockQty: number;
    caseMultiple: number | null;
    overstockCoverWeeks: { toString(): string };
    updatedByUserId: string | null;
    retailaPlanningEnabled: boolean;
    retailaPlanningJustification: string | null;
    retailaPlanningScope: string | null;
    retailaPlanningApprovedByUserId: string | null;
    retailaPlanningApprovedAt: Date | null;
    retailaPlanningDisabledByUserId: string | null;
    retailaPlanningDisabledAt: Date | null;
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
      where: {
        documentReference: {
          in: [overlap, ledgerOnly, ledgerOverlapSplit, ledgerRetaila, ledgerOther, ledgerBlank, ledgerShadow],
        },
      },
    });
    await prisma.autopartSalesLine.deleteMany({
      where: {
        documentReference: { in: [once, conflict, invoice, credit, otherDoc, foreignDoc, ...identityRefs] },
      },
    });
    await prisma.autopartSalesDocument.deleteMany({
      where: {
        documentReference: { in: [once, conflict, invoice, credit, otherDoc, foreignDoc, ...identityRefs] },
      },
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
    await prisma.company.deleteMany({
      where: { id: { in: [retailaId, otherId, retailaTwoId].filter((id) => id.length > 0) } },
    });
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
          retailaPlanningEnabled: previousSettings.retailaPlanningEnabled,
          retailaPlanningJustification: previousSettings.retailaPlanningJustification,
          retailaPlanningScope: previousSettings.retailaPlanningScope,
          retailaPlanningApprovedByUserId: previousSettings.retailaPlanningApprovedByUserId,
          retailaPlanningApprovedAt: previousSettings.retailaPlanningApprovedAt,
          retailaPlanningDisabledByUserId: previousSettings.retailaPlanningDisabledByUserId,
          retailaPlanningDisabledAt: previousSettings.retailaPlanningDisabledAt,
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

  it("counts one invoice across company links and keeps other ledger accounts out", async () => {
    const posted = new Date(`${today}T12:00:00.000Z`);
    const ledgerDate = new Date(`${today}T00:00:00.000Z`);
    retailaTwoId = (
      await prisma.company.create({
        data: {
          name: `Retail Amazon two ${stamp}`,
          status: "ACTIVE",
          autopartCustomerCode: `RETAILA2${stamp}`,
          autopartCustomerCodeVerifiedAt: new Date(),
        },
      })
    ).id;
    await prisma.autopartCustomerAccountAlias.create({
      data: { companyId: retailaTwoId, alias: "RETAILA", verifiedById: adminId },
    });

    async function document(input: {
      companyId: string | null;
      account: string;
      reference: string;
      goods?: string;
      has504?: boolean;
      ongoing?: boolean;
    }) {
      const ongoing = input.ongoing ?? false;
      return prisma.autopartSalesDocument.create({
        data: {
          companyId: input.companyId,
          autopartCustomerCode: input.account,
          documentType: "INVOICE",
          documentReference: input.reference,
          documentDate: posted,
          ...(input.goods != null ? { goodsNet: input.goods } : {}),
          has504: input.has504 ?? false,
          hasTrm21qc: ongoing,
          source: ongoing || input.has504 ? "ONGOING_504" : "561L",
        },
      });
    }
    async function line(input: {
      documentId: string;
      companyId: string | null;
      account: string;
      reference: string;
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
          documentType: "INVOICE",
          documentReference: input.reference,
          lineNumber: 1,
          sku: input.sku,
          units: input.units,
          salesNet: input.salesNet,
          source: input.source,
        },
      });
    }
    async function ledger(input: { reference: string; account: string; sku: string; qty: number }) {
      const saved = await prisma.fbaReplenishmentDocument.create({
        data: {
          documentReference: input.reference,
          documentType: "INVOICE",
          documentDate: ledgerDate,
          customerAccount: input.account,
        },
      });
      await prisma.fbaReplenishmentLine.create({
        data: {
          documentId: saved.id,
          lineKey: `ledger-${stamp}-${input.reference}`,
          sku: input.sku,
          matchKey: skuMatchKey(input.sku),
          qty: input.qty,
        },
      });
    }

    const onceMapped = await document({
      companyId: retailaId,
      account: "RETAILA",
      reference: splitOnce,
    });
    const onceOpen = await document({
      companyId: null,
      account: "RETAILA",
      reference: splitOnce,
      goods: "40.00",
      has504: true,
      ongoing: true,
    });
    await line({
      documentId: onceMapped.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: splitOnce,
      sku: skuSplitOnce,
      units: 4,
      salesNet: "40.00",
      source: "561L",
    });
    await line({
      documentId: onceOpen.id,
      companyId: null,
      account: "RETAILA",
      reference: splitOnce,
      sku: skuSplitOnce,
      units: 4,
      salesNet: "40.00",
      source: "ONGOING_TRM21QC",
    });

    const conflictMapped = await document({
      companyId: retailaId,
      account: "RETAILA",
      reference: splitConflict,
    });
    const conflictOpen = await document({
      companyId: null,
      account: "RETAILA",
      reference: splitConflict,
      ongoing: true,
    });
    await line({
      documentId: conflictMapped.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: splitConflict,
      sku: skuSplitConflict,
      units: 2,
      salesNet: "20.00",
      source: "561L",
    });
    await line({
      documentId: conflictOpen.id,
      companyId: null,
      account: "RETAILA",
      reference: splitConflict,
      sku: skuSplitConflict,
      units: 3,
      salesNet: "30.00",
      source: "ONGOING_TRM21QC",
    });

    const goodsMapped = await document({
      companyId: retailaId,
      account: "RETAILA",
      reference: splitGoods,
    });
    const goodsOpen = await document({
      companyId: null,
      account: "RETAILA",
      reference: splitGoods,
      goods: "99.00",
      has504: true,
      ongoing: true,
    });
    await line({
      documentId: goodsMapped.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: splitGoods,
      sku: skuSplitGoods,
      units: 4,
      salesNet: "40.00",
      source: "561L",
    });
    await line({
      documentId: goodsOpen.id,
      companyId: null,
      account: "RETAILA",
      reference: splitGoods,
      sku: skuSplitGoods,
      units: 4,
      salesNet: "40.00",
      source: "ONGOING_TRM21QC",
    });

    const kept = await document({ companyId: retailaId, account: "RETAILA", reference: notMerged });
    const stranger = await document({
      companyId: otherId,
      account: "RETAILA",
      reference: notMerged,
      ongoing: true,
    });
    await line({
      documentId: kept.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: notMerged,
      sku: skuNotMerged,
      units: 4,
      salesNet: "40.00",
      source: "561L",
    });
    await line({
      documentId: stranger.id,
      companyId: otherId,
      account: "RETAILA",
      reference: notMerged,
      sku: skuNotMerged,
      units: 9,
      salesNet: "90.00",
      source: "ONGOING_TRM21QC",
    });

    const codedOnly = await document({
      companyId: otherId,
      account: "RETAILA",
      reference: foreignCoded,
      ongoing: true,
    });
    await line({
      documentId: codedOnly.id,
      companyId: otherId,
      account: "RETAILA",
      reference: foreignCoded,
      sku: skuForeignCoded,
      units: 11,
      salesNet: "110.00",
      source: "561L",
    });

    const firstOwner = await document({
      companyId: retailaId,
      account: "RETAILA",
      reference: twoOwners,
    });
    const secondOwner = await document({
      companyId: retailaTwoId,
      account: "RETAILA",
      reference: twoOwners,
      ongoing: true,
    });
    await line({
      documentId: firstOwner.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: twoOwners,
      sku: skuTwoOwners,
      units: 4,
      salesNet: "40.00",
      source: "561L",
    });
    await line({
      documentId: secondOwner.id,
      companyId: retailaTwoId,
      account: "RETAILA",
      reference: twoOwners,
      sku: skuTwoOwners,
      units: 4,
      salesNet: "40.00",
      source: "ONGOING_TRM21QC",
    });

    const overlapDoc = await document({
      companyId: retailaId,
      account: "RETAILA",
      reference: ledgerOverlapSplit,
      ongoing: true,
    });
    await line({
      documentId: overlapDoc.id,
      companyId: retailaId,
      account: "RETAILA",
      reference: ledgerOverlapSplit,
      sku: skuLedgerOverlap,
      units: 4,
      salesNet: "40.00",
      source: "561L",
    });
    await ledger({ reference: ledgerOverlapSplit, account: "RETAILA", sku: skuLedgerOverlap, qty: 9 });
    await ledger({ reference: ledgerRetaila, account: "RETAILA", sku: skuLedgerRetaila, qty: 6 });
    await ledger({ reference: ledgerOther, account: `OTHER${stamp}`, sku: skuLedgerOther, qty: 8 });
    await ledger({ reference: ledgerBlank, account: "", sku: skuLedgerBlank, qty: 7 });
    const shadowDoc = await document({
      companyId: otherId,
      account: `OTHER${stamp}`,
      reference: ledgerShadow,
      ongoing: true,
    });
    await line({
      documentId: shadowDoc.id,
      companyId: otherId,
      account: `OTHER${stamp}`,
      reference: ledgerShadow,
      sku: skuLedgerShadow,
      units: 5,
      salesNet: "50.00",
      source: "ONGOING_TRM21QC",
    });
    await ledger({ reference: ledgerShadow, account: "RETAILA", sku: skuLedgerShadow, qty: 5 });

    const workspace = await getFbaForecastWorkspace(adminId, { q: stamp });
    const units = (sku: string) =>
      workspace.rows.find((row) => row.matchKey === skuMatchKey(sku))?.oinUnits90 ?? null;
    const skuDocuments = async (sku: string) =>
      (await getFbaForecastSku(adminId, { matchKey: skuMatchKey(sku) })).documents;

    const onceDocuments = await skuDocuments(skuSplitOnce);
    expect(onceDocuments).toHaveLength(1);
    expect(onceDocuments[0]?.status).toBe("COUNTED");
    expect(onceDocuments[0]?.source).toBe("ONGOING_TRM21QC");
    expect(onceDocuments[0]?.units).toBe(4);
    expect(onceDocuments[0]?.lines).toHaveLength(1);
    expect(units(skuSplitOnce)).toBe(4);

    const conflictDocuments = await skuDocuments(skuSplitConflict);
    expect(conflictDocuments.map((item) => item.status)).toContain("SOURCE_CONFLICT");
    expect(conflictDocuments.every((item) => item.units === 0)).toBe(true);
    expect(units(skuSplitConflict)).toBeNull();

    const goodsDocuments = await skuDocuments(skuSplitGoods);
    expect(goodsDocuments.map((item) => item.status)).toContain("GOODS_MISMATCH");
    expect(goodsDocuments.every((item) => item.units === 0)).toBe(true);
    expect(units(skuSplitGoods)).toBeNull();

    const keptDocuments = await skuDocuments(skuNotMerged);
    const keptRow = keptDocuments.find((item) => item.status === "COUNTED");
    expect(keptRow?.units).toBe(4);
    expect(keptRow?.lines.reduce((sum, item) => sum + item.units, 0)).toBe(4);
    expect(units(skuNotMerged)).toBe(4);

    const foreignDocuments = await skuDocuments(skuForeignCoded);
    expect(foreignDocuments).toHaveLength(1);
    expect(foreignDocuments[0]?.status).toBe("AMBIGUOUS_OWNER");
    expect(foreignDocuments[0]?.units).toBe(0);
    expect(units(skuForeignCoded)).toBeNull();

    const ownerDocuments = await skuDocuments(skuTwoOwners);
    expect(ownerDocuments.map((item) => item.status)).toContain("AMBIGUOUS_OWNER");
    expect(ownerDocuments.every((item) => item.units === 0)).toBe(true);
    expect(units(skuTwoOwners)).toBeNull();

    const overlapDocuments = await skuDocuments(skuLedgerOverlap);
    expect(overlapDocuments.find((item) => item.status === "COUNTED")?.units).toBe(4);
    expect(overlapDocuments.some((item) => item.status === "LEDGER_ONLY" || item.status === "LEDGER_REVIEW")).toBe(
      false,
    );
    expect(units(skuLedgerOverlap)).toBe(4);

    const retailaLedger = await skuDocuments(skuLedgerRetaila);
    expect(retailaLedger).toHaveLength(1);
    expect(retailaLedger[0]?.status).toBe("LEDGER_ONLY");
    expect(retailaLedger[0]?.units).toBe(6);
    expect(units(skuLedgerRetaila)).toBe(6);

    expect(await skuDocuments(skuLedgerOther)).toEqual([]);
    expect(units(skuLedgerOther)).toBeNull();

    const blankLedger = await skuDocuments(skuLedgerBlank);
    expect(blankLedger).toHaveLength(1);
    expect(blankLedger[0]?.status).toBe("LEDGER_REVIEW");
    expect(blankLedger[0]?.units).toBe(0);
    expect(units(skuLedgerBlank)).toBeNull();

    const shadowLedger = await skuDocuments(skuLedgerShadow);
    expect(shadowLedger).toHaveLength(1);
    expect(shadowLedger[0]?.status).toBe("LEDGER_REVIEW");
    expect(shadowLedger[0]?.units).toBe(0);
    expect(units(skuLedgerShadow)).toBeNull();

    const firstPage = await getFbaOinHistory(adminId, { page: 1 });
    const history = [...firstPage.documents];
    const pageCount = Math.min(20, Math.ceil(firstPage.total / firstPage.pageSize));
    for (let page = 2; page <= pageCount; page += 1) {
      history.push(...(await getFbaOinHistory(adminId, { page })).documents);
    }
    const references = history.map((item) => item.documentReference);
    expect(references).not.toContain(ledgerOther);
    const blankHistory = history.find((item) => item.documentReference === ledgerBlank);
    expect(blankHistory?.status).toBe("LEDGER_REVIEW");
    expect(blankHistory?.units).toBe(0);
  }, 60_000);

  it("keeps shipment quantities on Amazon sales and whole cases", async () => {
    const expected = projectFbaShipment({
      fbaAvailable: 44,
      fbaStockKnown: true,
      fbaStockStale: false,
      studleyAvailable: 7,
      confirmedInboundQty: 0,
      salesSupported: true,
      demandNetUnits30: 30,
      demandSource: "AMAZON_UK_FBA_CSV",
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
    const workspace = await getFbaForecastWorkspace(adminId, { q: skuCase, sold: "all" });
    const row = workspace.rows.find((item) => item.matchKey === skuMatchKey(skuCase));
    expect(row?.amazonUnits.d30).toBe(30);
    expect(row?.forecast.suggestedSendQty).toBe(12);
    expect(row?.forecast.dispatchableQty).toBe(0);
    expect(row?.forecast.looseStudleyQty).toBe(7);
    expect(row?.forecast.studleyShortfallQty).toBe(5);
    expect(row?.oinUnits90 ?? 0).toBe(0);
    const csv = await exportFbaForecastCsv(adminId, { q: skuCase, sold: "all" });
    expect(csv.csv).toContain(skuCase);
    expect(csv.csv).toContain("Suggested replenishment");
    expect(csv.csv).toContain("Unavailable reason");
    expect(csv.csv).toContain("Planning estimate");
    await expect(exportFbaForecastCsv(deniedId, { q: skuCase })).rejects.toThrow(/Purchasing access required/);
  });

  it("locks RETAILA planning until a Super Admin approves and audits the relationship", async () => {
    await prisma.autopartCustomerImportRun.deleteMany({
      where: { type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] } },
    });
    await prisma.fbaForecastSettings.update({
      where: { id: "default" },
      data: { retailaPlanningEnabled: false },
    }).catch(() => undefined);
    const locked = await getFbaForecastWorkspace(adminId, { plan: "retaila", sold: "all", q: skuCase });
    expect(locked.retailaPlanning.enabled).toBe(false);
    expect(locked.canApproveRetailaPlanning).toBe(true);
    expect(locked.retailaPlanning.scopePolicy).toBe(RETAILA_PLANNING_SCOPE_POLICY);
    const lockedRow = locked.rows.find((item) => item.matchKey === skuMatchKey(skuCase));
    expect(lockedRow?.forecast.blocker).toBe("PLANNING_NOT_APPROVED");
    expect(lockedRow?.forecast.suggestedSendQty).toBeNull();
    expect(locked.summary.blockers.PLANNING_NOT_APPROVED).toBeGreaterThan(0);

    await expect(
      approveRetailaPlanning(viewerId, {
        justification: "RETAILA invoices replenish the Amazon FBA UK branch for this account.",
      }),
    ).rejects.toThrow(/Purchasing access required|Super Admin/);

    const approved = await approveRetailaPlanning(adminId, {
      justification: "RETAILA invoices replenish the Amazon FBA UK branch for this account.",
    });
    expect(approved.enabled).toBe(true);
    expect(approved.approvedByUserId).toBe(adminId);
    expect(approved.scopePolicy).toBe(RETAILA_PLANNING_SCOPE_POLICY);

    const planned = await getFbaForecastWorkspace(adminId, {
      plan: "retaila",
      sold: "all",
      q: skuCase,
    });
    expect(planned.retailaPlanning.enabled).toBe(true);
    expect(planned.retailaReporting.planningAllowed).toBe(false);
    // Without verified 504/TRM coverage, recommendations stay blocked while sales stay visible.
    const plannedRow = planned.rows.find((item) => item.matchKey === skuMatchKey(skuCase));
    expect(plannedRow?.forecast.blocker).toBe("RETAILA_REPORTING_INCOMPLETE");
    expect(plannedRow?.forecast.planningEstimate).toBe(false);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "fba.retaila_planning.approve", actorUserId: adminId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();

    const disabled = await disableRetailaPlanning(adminId);
    expect(disabled.enabled).toBe(false);
    const after = await getFbaForecastWorkspace(adminId, { plan: "retaila", sold: "all", q: skuCase });
    expect(after.retailaPlanning.enabled).toBe(false);
    expect(after.rows.find((item) => item.matchKey === skuMatchKey(skuCase))?.forecast.blocker).toBe(
      "PLANNING_NOT_APPROVED",
    );
  });

  it("rolls approval and disable back when the audit write fails", async () => {
    setRetailaPlanningAuditWriterForTests(null);
    await prisma.fbaForecastSettings.upsert({
      where: { id: "default" },
      create: { id: "default", retailaPlanningEnabled: false },
      update: { retailaPlanningEnabled: false },
    });
    setRetailaPlanningAuditWriterForTests(async () => {
      throw new Error("Simulated retaila planning audit failure");
    });
    try {
      await expect(
        approveRetailaPlanning(adminId, {
          justification: "This approval must not persist without an audit row.",
        }),
      ).rejects.toThrow("Simulated retaila planning audit failure");
      const settings = await prisma.fbaForecastSettings.findUnique({ where: { id: "default" } });
      expect(settings?.retailaPlanningEnabled).toBe(false);

      setRetailaPlanningAuditWriterForTests(null);
      await approveRetailaPlanning(adminId, {
        justification: "Enable first so disable rollback can be proven.",
      });
      setRetailaPlanningAuditWriterForTests(async () => {
        throw new Error("Simulated retaila planning disable audit failure");
      });
      await expect(disableRetailaPlanning(adminId)).rejects.toThrow(
        "Simulated retaila planning disable audit failure",
      );
      const stillEnabled = await prisma.fbaForecastSettings.findUnique({ where: { id: "default" } });
      expect(stillEnabled?.retailaPlanningEnabled).toBe(true);
    } finally {
      setRetailaPlanningAuditWriterForTests(null);
      await prisma.fbaForecastSettings.update({
        where: { id: "default" },
        data: { retailaPlanningEnabled: false },
      });
    }
  });

  it("blocks RETAILA planning on incomplete reporting and allows zero sales when coverage is verified", async () => {
    // Disposable DB only: isolate coverage marks for this assertion.
    await prisma.autopartCustomerImportRun.deleteMany({
      where: { type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] } },
    });
    const londonToday = todayLondonDateOnly();
    const windowFrom = addDaysIso(londonToday, -29);
    const required = retailaReportingRequiredWeekdays(windowFrom, addDaysIso(londonToday, -1));
    expect(required.length).toBeGreaterThan(2);
    // Leave one weekday without TRM so coverage is incomplete.
    for (const day of required) {
      const at = new Date(`${day}T17:00:00.000Z`);
      await prisma.autopartCustomerImportRun.create({
        data: {
          type: "ONGOING_504",
          status: "COMMITTED",
          dryRun: false,
          filename: `504-${day}-${stamp}.txt`,
          createdAt: at,
          completedAt: at,
        },
      });
      if (day !== required[0]) {
        await prisma.autopartCustomerImportRun.create({
          data: {
            type: "ONGOING_TRM21QC",
            status: "COMMITTED",
            dryRun: false,
            filename: `trm-${day}-${stamp}.csv`,
            createdAt: at,
            completedAt: at,
          },
        });
      }
    }

    await approveRetailaPlanning(adminId, {
      justification: "Coverage tests require an approved global RETAILA planning relationship.",
    });
    const incomplete = await getFbaForecastWorkspace(adminId, {
      plan: "retaila",
      sold: "all",
      q: skuCase,
    });
    expect(incomplete.retailaReporting.planningAllowed).toBe(false);
    expect(incomplete.rows.find((item) => item.matchKey === skuMatchKey(skuCase))?.forecast.blocker).toBe(
      "RETAILA_REPORTING_INCOMPLETE",
    );

    const missingDay = required[0]!;
    await prisma.autopartCustomerImportRun.create({
      data: {
        type: "ONGOING_TRM21QC",
        status: "COMMITTED",
        dryRun: false,
        filename: `trm-fill-${missingDay}-${stamp}.csv`,
        createdAt: new Date(`${missingDay}T17:30:00.000Z`),
        completedAt: new Date(`${missingDay}T17:30:00.000Z`),
      },
    });

    const complete = await getFbaForecastWorkspace(adminId, {
      plan: "retaila",
      sold: "all",
      q: skuCase,
    });
    expect(complete.retailaReporting.planningAllowed).toBe(true);
    const zeroRow = complete.rows.find((item) => item.matchKey === skuMatchKey(skuCase));
    // skuCase has no RETAILA invoices; with verified coverage that is zero planning demand.
    expect(zeroRow?.demand.source).toBe("RETAILA_PLANNING");
    expect(zeroRow?.forecast.blocker).toBeNull();
    expect(zeroRow?.forecast.planningEstimate).toBe(true);
    expect(zeroRow?.forecast.weeklyRate).toBe(0);
    expect(zeroRow?.forecast.suggestedSendQty).toBe(0);

    // Needs-review focus must match the summary card exactly (send, shortfall, unavailable).
    const needsReview = await getFbaForecastWorkspace(adminId, {
      plan: "fba",
      sold: "all",
      focus: "needs_review",
    });
    expect(needsReview.total).toBe(needsReview.summary.needsReview);
    expect(needsReview.rows).toHaveLength(needsReview.total);
    for (const row of needsReview.rows) {
      const send =
        row.forecast.recommendation === "SEND_NOW" || row.forecast.recommendation === "SEND_SOON";
      const unavailable = row.forecast.recommendation === "INSUFFICIENT_DATA";
      const shortfall =
        row.forecast.studleyShortfallQty != null && row.forecast.studleyShortfallQty > 0;
      expect(send || unavailable || shortfall).toBe(true);
    }

    await disableRetailaPlanning(adminId);
    await prisma.autopartCustomerImportRun.deleteMany({
      where: { type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] } },
    });
  });
});
