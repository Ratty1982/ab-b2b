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
import { getFbaForecastWorkspace } from "@/server/purchasing/fba-forecast";
import { loadRetailaOinReport, retailaOinRange } from "@/server/purchasing/fba-retaila-oin";

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
        line(`${stamp}-ol`, ongoing.id, null, "RETAILA", sale, 1, `WIN${stamp}`, 4, "ONGOING_TRM21QC"),
        line(`${stamp}-l1`, twoLines.id, retailaId, "RETAILA", lines, 1, `DUP${stamp}`, 2, "ONGOING_TRM21QC"),
        line(`${stamp}-l2`, twoLines.id, retailaId, "RETAILA", lines, 2, `DUP${stamp}`, 3, "ONGOING_TRM21QC"),
        line(`${stamp}-cl`, creditDoc.id, retailaId, "RETAILA", credit, 1, `WIN${stamp}`, 1, "ONGOING_TRM21QC", "CREDIT"),
        line(`${stamp}-nl`, negativeDoc.id, retailaId, "RETAILA", negative, 1, `NEG${stamp}`, -2, "ONGOING_TRM21QC", "CREDIT"),
        line(`${stamp}-dl`, olderDoc.id, retailaId, "RETAILA", older, 1, `WIN${stamp}`, 8, "561L"),
        line(`${stamp}-yl`, yearDoc.id, retailaId, "RETAILA", year, 1, `WIN${stamp}`, 2, "561L"),
        line(`${stamp}-fl`, foreignDoc.id, otherId, `OTHER${stamp}`, foreign, 1, `WIN${stamp}`, 9, "ONGOING_TRM21QC"),
        line(`${stamp}-al`, ambiguousDoc.id, otherId, "RETAILA", ambiguous, 1, `AMB${stamp}`, 7, "ONGOING_TRM21QC"),
        line(`${stamp}-ul`, undatedDoc.id, retailaId, "RETAILA", undated, 1, `UND${stamp}`, 6, "561L"),
      ],
    });
  }, 60_000);

  afterAll(async () => {
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
    const duplicated = report.units.find((row) => row.matchKey === skuMatchKey(`DUP${stamp}`));
    expect(duplicated?.windows.d30).toBe(5);
    const credited = report.units.find((row) => row.matchKey === skuMatchKey(`NEG${stamp}`));
    expect(credited?.windows.d30).toBe(-2);
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
  }, 30_000);
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
