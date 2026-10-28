/**
 * RETAILA OIN invoices are customer sales. Window totals stay inside one
 * bounded reconciliation. They do not become an FBA shipment on their own.
 * The guard refuses any database whose name does not end with _test.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDaysIso, todayLondonDateOnly } from "@/domain/sales-history-period";
import { skuMatchKey } from "@/domain/stock";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { exportFbaForecastCsv, getFbaForecastWorkspace } from "@/server/purchasing/fba-forecast";
import {
  listRetailaOinHistory,
  listRetailaOinLinesForSku,
  loadRetailaOinReport,
  retailaOinRange,
} from "@/server/purchasing/fba-retaila-oin";

const prisma = new PrismaClient();
const stamp = `S${Date.now().toString(36).toUpperCase()}`;
const today = todayLondonDateOnly();

function at(daysAgo: number): Date {
  return new Date(`${addDaysIso(today, -daysAgo)}T12:00:00.000Z`);
}

describe("RETAILA OIN customer sales windows", () => {
  let retailaId = "";
  let otherId = "";
  let adminId = "";

  beforeAll(async () => {
    await bootstrapRbac(prisma);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    const admin = await prisma.user.create({
      data: {
        email: `fba-sales-${stamp.toLowerCase()}@example.test`,
        name: "FBA sales",
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
        userRoles: { create: { roleId: adminRole.id } },
      },
    });
    adminId = admin.id;
    retailaId = (
      await prisma.company.create({
        data: {
          name: `Retail sales ${stamp}`,
          status: "ACTIVE",
          autopartCustomerCode: `RETAILA${stamp}`,
          autopartCustomerCodeVerifiedAt: new Date(),
        },
      })
    ).id;
    await prisma.autopartCustomerAccountAlias.create({
      data: { companyId: retailaId, alias: "RETAILA", verifiedById: adminId },
    });
    otherId = (
      await prisma.company.create({
        data: {
          name: `Other sales ${stamp}`,
          status: "ACTIVE",
          autopartCustomerCode: `OTHER${stamp}`,
          autopartCustomerCodeVerifiedAt: new Date(),
        },
      })
    ).id;

    async function invoice(input: {
      id: string;
      reference: string;
      companyId: string | null;
      account: string;
      type?: "INVOICE" | "CREDIT";
      date: Date | null;
      source: "561L" | "ONGOING_504";
      trm?: boolean;
      goods?: string;
    }) {
      return prisma.autopartSalesDocument.create({
        data: {
          id: input.id,
          companyId: input.companyId,
          autopartCustomerCode: input.account,
          documentType: input.type ?? "INVOICE",
          documentReference: input.reference,
          documentDate: input.date,
          ...(input.goods != null ? { goodsNet: input.goods } : {}),
          has504: input.goods != null,
          hasTrm21qc: input.trm ?? false,
          source: input.source,
        },
      });
    }

    const sale = `OIN${stamp}S`;
    const historic = await invoice({
      id: `${stamp}-h`,
      reference: sale,
      companyId: retailaId,
      account: "RETAILA",
      date: at(0),
      source: "561L",
    });
    const ongoing = await invoice({
      id: `${stamp}-o`,
      reference: sale,
      companyId: null,
      account: "RETAILA",
      date: at(0),
      source: "ONGOING_504",
      trm: true,
      goods: "10.00",
    });
    const lines = `OIN${stamp}L`;
    const twoLines = await invoice({
      id: `${stamp}-lines`,
      reference: lines,
      companyId: retailaId,
      account: "RETAILA",
      date: at(0),
      source: "ONGOING_504",
      trm: true,
      goods: "20.00",
    });
    const credit = `OIN${stamp}C`;
    const creditDoc = await invoice({
      id: `${stamp}-c`,
      reference: credit,
      companyId: retailaId,
      account: "RETAILA",
      type: "CREDIT",
      date: at(0),
      source: "ONGOING_504",
      trm: true,
    });
    const negative = `OIN${stamp}N`;
    const negativeDoc = await invoice({
      id: `${stamp}-n`,
      reference: negative,
      companyId: retailaId,
      account: "RETAILA",
      type: "CREDIT",
      date: at(0),
      source: "ONGOING_504",
      trm: true,
    });
    const older = `OIN${stamp}D`;
    const olderDoc = await invoice({
      id: `${stamp}-d`,
      reference: older,
      companyId: retailaId,
      account: "RETAILA",
      date: at(40),
      source: "561L",
    });
    const year = `OIN${stamp}Y`;
    const yearDoc = await invoice({
      id: `${stamp}-y`,
      reference: year,
      companyId: retailaId,
      account: "RETAILA",
      date: at(100),
      source: "561L",
    });
    const foreign = `OIN${stamp}F`;
    const foreignDoc = await invoice({
      id: `${stamp}-f`,
      reference: foreign,
      companyId: otherId,
      account: `OTHER${stamp}`,
      date: at(0),
      source: "ONGOING_504",
      trm: true,
    });
    const ambiguous = `OIN${stamp}A`;
    const ambiguousDoc = await invoice({
      id: `${stamp}-a`,
      reference: ambiguous,
      companyId: otherId,
      account: "RETAILA",
      date: at(0),
      source: "ONGOING_504",
      trm: true,
    });
    const undated = `OIN${stamp}U`;
    const undatedDoc = await invoice({
      id: `${stamp}-u`,
      reference: undated,
      companyId: retailaId,
      account: "RETAILA",
      date: null,
      source: "561L",
    });

    await prisma.autopartSalesLine.createMany({
      data: [
        line(`${stamp}-hl`, historic.id, retailaId, "RETAILA", sale, 1, `WIN${stamp}`, 4, "561L"),
        line(
          `${stamp}-ol`,
          ongoing.id,
          null,
          "RETAILA",
          sale,
          1,
          `WIN${stamp}`,
          4,
          "ONGOING_TRM21QC",
        ),
        line(
          `${stamp}-l1`,
          twoLines.id,
          retailaId,
          "RETAILA",
          lines,
          1,
          `DUP${stamp}`,
          2,
          "ONGOING_TRM21QC",
        ),
        line(
          `${stamp}-l2`,
          twoLines.id,
          retailaId,
          "RETAILA",
          lines,
          2,
          `DUP${stamp}`,
          3,
          "ONGOING_TRM21QC",
        ),
        line(
          `${stamp}-cl`,
          creditDoc.id,
          retailaId,
          "RETAILA",
          credit,
          1,
          `WIN${stamp}`,
          1,
          "ONGOING_TRM21QC",
          "CREDIT",
        ),
        line(
          `${stamp}-nl`,
          negativeDoc.id,
          retailaId,
          "RETAILA",
          negative,
          1,
          `NEG${stamp}`,
          -2,
          "ONGOING_TRM21QC",
          "CREDIT",
        ),
        line(`${stamp}-dl`, olderDoc.id, retailaId, "RETAILA", older, 1, `WIN${stamp}`, 8, "561L"),
        line(`${stamp}-yl`, yearDoc.id, retailaId, "RETAILA", year, 1, `WIN${stamp}`, 2, "561L"),
        line(
          `${stamp}-fl`,
          foreignDoc.id,
          otherId,
          `OTHER${stamp}`,
          foreign,
          1,
          `WIN${stamp}`,
          9,
          "ONGOING_TRM21QC",
        ),
        line(
          `${stamp}-al`,
          ambiguousDoc.id,
          otherId,
          "RETAILA",
          ambiguous,
          1,
          `AMB${stamp}`,
          7,
          "ONGOING_TRM21QC",
        ),
        line(
          `${stamp}-ul`,
          undatedDoc.id,
          retailaId,
          "RETAILA",
          undated,
          1,
          `UND${stamp}`,
          6,
          "561L",
        ),
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.fbaReplenishmentDocument.deleteMany({
      where: {
        documentReference: {
          in: [`OIN${stamp}LI`, `OIN${stamp}LP`, `OIN${stamp}LN`, `OIN${stamp}LC`],
        },
      },
    });
    await prisma.autopartLocationStock.deleteMany({
      where: { autopartProduct: { sku: { startsWith: `Z${stamp}` } } },
    });
    await prisma.autopartProduct.deleteMany({ where: { sku: { startsWith: `Z${stamp}` } } });
    await prisma.autopartFbaStockImport.deleteMany({ where: { fileHash: `act-${stamp}` } });
    await prisma.autopartSalesLine.deleteMany({ where: { id: { startsWith: stamp } } });
    await prisma.autopartSalesDocument.deleteMany({ where: { id: { startsWith: stamp } } });
    await prisma.autopartCustomerAccountAlias.deleteMany({ where: { companyId: retailaId } });
    await prisma.company.deleteMany({ where: { id: { in: [retailaId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it("counts each proven sale once inside the right date window", async () => {
    const report = await loadRetailaOinReport(retailaOinRange(today, 365));
    const win = report.units.find((row) => row.matchKey === skuMatchKey(`WIN${stamp}`));
    expect(win?.windows).toEqual({ d7: 3, d30: 3, d60: 11, d90: 11, d365: 13 });
    expect(win?.sold).toEqual({ d30: true, d90: true, d365: true });
    const duplicated = report.units.find((row) => row.matchKey === skuMatchKey(`DUP${stamp}`));
    expect(duplicated?.windows.d30).toBe(5);
    expect(duplicated?.sold.d30).toBe(true);
    const credited = report.units.find((row) => row.matchKey === skuMatchKey(`NEG${stamp}`));
    expect(credited?.windows.d30).toBe(-2);
    expect(credited?.sold).toEqual({ d30: false, d90: false, d365: false });
    expect(report.units.some((row) => row.matchKey === skuMatchKey(`AMB${stamp}`))).toBe(false);
    expect(report.units.some((row) => row.matchKey === skuMatchKey(`UND${stamp}`))).toBe(false);
    expect(report.units.some((row) => row.sku.includes("NOISE"))).toBe(false);
  }, 30_000);

  it("shows the RETAILA sales and does not recommend a shipment from them", async () => {
    const workspace = await getFbaForecastWorkspace(adminId, { q: `WIN${stamp}` });
    const row = workspace.rows.find((item) => item.matchKey === skuMatchKey(`WIN${stamp}`));
    expect(row?.customerSales.d30).toBe(3);
    expect(row?.customerSales.d365).toBe(13);
    expect(row?.customerWeekly).toBe(0.7);
    expect(row?.demand.source).toBe("NONE");
    expect(row?.forecast.recommendation).toBe("INSUFFICIENT_DATA");
    expect(row?.forecast.suggestedSendQty).toBeNull();
    expect(row?.amazonUnits.d30).toBeNull();
    expect(row?.forecast.coverWeeks).toBeNull();
  }, 30_000);

  it("signs a manual-ledger credit once when the stored quantity is positive or already negative", async () => {
    const day = new Date(`${today}T00:00:00.000Z`);
    async function ledger(reference: string, type: "INVOICE" | "CREDIT", sku: string, qty: number) {
      const saved = await prisma.fbaReplenishmentDocument.create({
        data: {
          documentReference: reference,
          documentType: type,
          documentDate: day,
          customerAccount: "RETAILA",
        },
      });
      await prisma.fbaReplenishmentLine.create({
        data: {
          documentId: saved.id,
          lineKey: reference,
          sku,
          matchKey: skuMatchKey(sku),
          qty,
        },
      });
    }
    await ledger(`OIN${stamp}LI`, "INVOICE", `LINV${stamp}`, 6);
    await ledger(`OIN${stamp}LP`, "CREDIT", `LPOS${stamp}`, 4);
    await ledger(`OIN${stamp}LN`, "CREDIT", `LNEG${stamp}`, -3);
    const bothRef = `OIN${stamp}B`;
    const bothDoc = await prisma.autopartSalesDocument.create({
      data: {
        id: `${stamp}-both`,
        companyId: retailaId,
        autopartCustomerCode: "RETAILA",
        documentType: "INVOICE",
        documentReference: bothRef,
        documentDate: at(0),
        has504: false,
        hasTrm21qc: false,
        source: "561L",
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        id: `${stamp}-both-line`,
        documentId: bothDoc.id,
        companyId: retailaId,
        autopartCustomerCode: "RETAILA",
        documentType: "INVOICE",
        documentReference: bothRef,
        lineNumber: 1,
        sku: `BOTH${stamp}`,
        units: 10,
        salesNet: "10.00",
        source: "561L",
      },
    });
    await ledger(`OIN${stamp}LC`, "CREDIT", `BOTH${stamp}`, 2);

    const range = retailaOinRange(today, 90);
    const report = await loadRetailaOinReport(range);
    const ledgerInvoice = report.units.find((row) => row.matchKey === skuMatchKey(`LINV${stamp}`));
    const ledgerCredit = report.units.find((row) => row.matchKey === skuMatchKey(`LPOS${stamp}`));
    const ledgerNegative = report.units.find((row) => row.matchKey === skuMatchKey(`LNEG${stamp}`));
    expect(ledgerInvoice?.windows.d30).toBe(6);
    expect(ledgerInvoice?.sold.d30).toBe(true);
    expect(ledgerCredit?.windows.d30).toBe(-4);
    expect(ledgerCredit?.sold.d30).toBe(false);
    expect(ledgerNegative?.windows.d30).toBe(-3);
    expect(ledgerNegative?.sold.d30).toBe(false);
    expect(
      report.units.find((row) => row.matchKey === skuMatchKey(`BOTH${stamp}`))?.windows.d30,
    ).toBe(8);
    expect(report.units.find((row) => row.matchKey === skuMatchKey(`BOTH${stamp}`))?.sold.d30).toBe(
      true,
    );
    const soldInvoice = await getFbaForecastWorkspace(adminId, { q: `LINV${stamp}` });
    expect(soldInvoice.rows.map((row) => row.sku)).toEqual([`LINV${stamp}`]);
    const hiddenCredit = await getFbaForecastWorkspace(adminId, { q: `LPOS${stamp}` });
    expect(hiddenCredit.rows).toEqual([]);
    const shownCredit = await getFbaForecastWorkspace(adminId, { q: `LPOS${stamp}`, sold: "all" });
    expect(shownCredit.rows.map((row) => row.sku)).toEqual([`LPOS${stamp}`]);

    const history = await listRetailaOinHistory({
      range,
      page: 1,
      pageSize: 50,
      q: stamp,
      sort: "reference",
    });
    const positive = history.documents.find((item) => item.documentReference === `OIN${stamp}LP`);
    expect(positive?.status).toBe("LEDGER_ONLY");
    expect(positive?.units).toBe(-4);
    expect(positive?.lines[0]?.units).toBe(-4);
    const negative = history.documents.find((item) => item.documentReference === `OIN${stamp}LN`);
    expect(negative?.units).toBe(-3);
    expect(negative?.lines[0]?.units).toBe(-3);
    const invoice = history.documents.find((item) => item.documentReference === `OIN${stamp}LI`);
    expect(invoice?.units).toBe(6);
    expect(invoice?.lines[0]?.units).toBe(6);

    const positiveSku = await listRetailaOinLinesForSku(skuMatchKey(`LPOS${stamp}`), range);
    expect(positiveSku[0]?.status).toBe("LEDGER_ONLY");
    expect(positiveSku[0]?.units).toBe(-4);
    expect(positiveSku[0]?.lines[0]?.units).toBe(-4);
    const negativeSku = await listRetailaOinLinesForSku(skuMatchKey(`LNEG${stamp}`), range);
    expect(negativeSku[0]?.units).toBe(-3);
    expect(negativeSku[0]?.lines[0]?.units).toBe(-3);
  }, 30_000);

  it("lists products with a real invoice and hides the rest of the catalogue", async () => {
    const recent = `Z${stamp}NEW`;
    const old = `Z${stamp}OLD`;
    const full = `Z${stamp}FULL`;
    const creditOnly = `Z${stamp}CRED`;
    const duplicated = `Z${stamp}DUP`;
    const tieA = `Z${stamp}A`;
    const tieB = `Z${stamp}B`;
    const conflicted = `Z${stamp}BAD`;
    const stockOnly = `Z${stamp}STOCK`;
    const now = new Date();

    async function sale(
      id: string,
      reference: string,
      sku: string,
      units: number,
      daysAgo: number,
      source: "561L" | "ONGOING_TRM21QC",
      type: "INVOICE" | "CREDIT" = "INVOICE",
      companyId: string | null = retailaId,
    ) {
      const doc = await prisma.autopartSalesDocument.create({
        data: {
          id,
          companyId,
          autopartCustomerCode: "RETAILA",
          documentType: type,
          documentReference: reference,
          documentDate: at(daysAgo),
          has504: false,
          hasTrm21qc: source === "ONGOING_TRM21QC",
          source: source === "ONGOING_TRM21QC" ? "ONGOING_504" : "561L",
        },
      });
      await prisma.autopartSalesLine.create({
        data: line(`${id}-l`, doc.id, companyId, "RETAILA", reference, 1, sku, units, source, type),
      });
    }

    await sale(`${stamp}-act-new`, `OIN${stamp}ACTN`, recent, 8, 20, "561L");
    await sale(`${stamp}-act-old`, `OIN${stamp}ACTO`, old, 3, 200, "561L");
    await sale(`${stamp}-act-full`, `OIN${stamp}ACTF`, full, 5, 0, "561L");
    await sale(`${stamp}-act-full-c`, `OIN${stamp}ACTC`, full, 5, 0, "ONGOING_TRM21QC", "CREDIT");
    await sale(
      `${stamp}-act-cred`,
      `OIN${stamp}ACTR`,
      creditOnly,
      4,
      0,
      "ONGOING_TRM21QC",
      "CREDIT",
    );
    await sale(`${stamp}-act-dup-h`, `OIN${stamp}ACTD`, duplicated, 2, 0, "561L");
    await sale(
      `${stamp}-act-dup-o`,
      `OIN${stamp}ACTD`,
      duplicated,
      2,
      0,
      "ONGOING_TRM21QC",
      "INVOICE",
      null,
    );
    await sale(`${stamp}-act-tie-a`, `OIN${stamp}ACTA`, tieA, 1, 0, "561L");
    await sale(`${stamp}-act-tie-b`, `OIN${stamp}ACTB`, tieB, 1, 0, "561L");
    await sale(`${stamp}-act-bad-h`, `OIN${stamp}ACTX`, conflicted, 2, 0, "561L");
    await sale(
      `${stamp}-act-bad-o`,
      `OIN${stamp}ACTX`,
      conflicted,
      9,
      0,
      "ONGOING_TRM21QC",
      "INVOICE",
      null,
    );

    const product = await prisma.autopartProduct.create({
      data: {
        sku: stockOnly,
        matchKey: skuMatchKey(stockOnly),
        description: "Unsold FBA stock",
        availQty: 4,
        presentInLatestFeed: true,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
    const stockImport = await prisma.autopartFbaStockImport.create({
      data: {
        fileName: `optimus-act-${stamp}.csv`,
        fileHash: `act-${stamp}`,
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
        availableQty: 4,
        sourceBranch: "OPTIMUS",
        sourceImportedAt: now,
        importId: stockImport.id,
      },
    });

    const prefix = `Z${stamp}`;
    const skus = async (sold?: "365" | "90" | "30" | "all", extra: Record<string, unknown> = {}) =>
      getFbaForecastWorkspace(adminId, { q: prefix, ...(sold ? { sold } : {}), ...extra });

    const year = await skus("365");
    expect(year.salesActivity).toBe("365");
    expect(year.salesActivityUnavailable).toBe(false);
    expect(year.rows.map((row) => row.sku)).toEqual([recent, duplicated, tieA, tieB, old, full]);
    expect(year.total).toBe(6);
    expect(year.rows.find((row) => row.sku === duplicated)?.customerSales.d30).toBe(2);
    expect(year.rows.find((row) => row.sku === full)?.customerSales.d30).toBe(0);
    expect(
      year.rows.every(
        (row) => row.demand.source === "NONE" && row.forecast.suggestedSendQty == null,
      ),
    ).toBe(true);
    expect(year.rows.every((row) => row.forecast.coverWeeks == null)).toBe(true);
    const counted =
      year.summary.sendNow +
      year.summary.sendSoon +
      year.summary.healthy +
      year.summary.forecastUnavailable +
      year.summary.overstocked;
    expect(counted).toBe(year.summary.productCount);
    expect(year.summary.productCount).toBeGreaterThanOrEqual(year.total);

    const searched = await skus("365", { q: recent });
    expect(searched.total).toBe(1);
    expect(searched.rows[0]?.sku).toBe(recent);
    expect(searched.summary.productCount).toBeGreaterThan(searched.total);

    const pageTwo = await skus("365", { page: 2 });
    expect(pageTwo.total).toBe(6);
    expect(pageTwo.rows).toHaveLength(0);

    const unbranded = await skus("365", { q: recent, brand: "__unbranded" });
    expect(unbranded.total).toBe(1);
    const missingBrand = await skus("365", { q: recent, brand: `NO-BRAND-${stamp}` });
    expect(missingBrand.total).toBe(0);
    const sendNow = await skus("365", { recommendation: "SEND_NOW" });
    expect(sendNow.total).toBe(0);

    const byPriority = await skus("365", { sort: "priority" });
    expect(byPriority.rows.map((row) => row.sku)).toEqual(
      [recent, duplicated, tieA, tieB, old, full].sort((a, b) => a.localeCompare(b)),
    );

    expect((await skus("90")).rows.some((row) => row.sku === old)).toBe(false);
    expect((await skus("30")).rows.some((row) => row.sku === old)).toBe(false);
    expect((await skus("90")).rows.some((row) => row.sku === recent)).toBe(true);
    expect((await skus("30")).rows.some((row) => row.sku === recent)).toBe(true);
    expect((await skus("30")).rows.some((row) => row.sku === full)).toBe(true);
    expect(
      (await skus("365")).rows.some(
        (row) => row.sku === creditOnly || row.sku === conflicted || row.sku === stockOnly,
      ),
    ).toBe(false);

    const catalogue = await skus("all");
    expect(catalogue.salesActivity).toBe("all");
    expect(catalogue.rows.some((row) => row.sku === stockOnly)).toBe(true);
    expect(catalogue.rows.some((row) => row.sku === creditOnly)).toBe(true);
    expect(catalogue.rows.some((row) => row.sku === conflicted)).toBe(false);
    expect(catalogue.total).toBe(year.total + 2);
    expect(catalogue.summary.productCount).toBeGreaterThan(year.summary.productCount);

    const csv = await exportFbaForecastCsv(adminId, { q: prefix });
    expect(csv.rows).toBe(6);
    expect(csv.csv).toContain(recent);
    expect(csv.csv).not.toContain(stockOnly);
    const allCsv = await exportFbaForecastCsv(adminId, { q: prefix, sold: "all" });
    expect(allCsv.rows).toBe(catalogue.total);
    expect(allCsv.csv).toContain(stockOnly);
  }, 60_000);
});

function line(
  id: string,
  documentId: string,
  companyId: string | null,
  account: string,
  reference: string,
  lineNumber: number,
  sku: string,
  units: number,
  source: "561L" | "ONGOING_TRM21QC",
  documentType: "INVOICE" | "CREDIT" = "INVOICE",
) {
  return {
    id,
    documentId,
    companyId,
    autopartCustomerCode: account,
    documentType,
    documentReference: reference,
    lineNumber,
    sku,
    units,
    salesNet: "10.00",
    source,
  };
}
