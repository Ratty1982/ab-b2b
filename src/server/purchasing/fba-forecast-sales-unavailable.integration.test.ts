/**
 * A failed RETAILA read must not look like a catalogue with no sales.
 * The guard refuses any database whose name does not end with _test.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { skuMatchKey } from "@/domain/stock";
import {
  retailaCompletedDaysWindow,
  retailaReportingRequiredWeekdays,
} from "@/domain/fba-retaila-reporting-coverage";
import { todayLondonDateOnly } from "@/domain/sales-history-period";
import {
  approveRetailaPlanning,
  disableRetailaPlanning,
  exportFbaForecastCsv,
  getFbaForecastWorkspace,
} from "@/server/purchasing/fba-forecast";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";

const control = vi.hoisted(() => ({ failOin: false }));

vi.mock("@/server/purchasing/fba-retaila-oin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/purchasing/fba-retaila-oin")>();
  return {
    ...actual,
    loadRetailaOinReport: (range: Parameters<typeof actual.loadRetailaOinReport>[0]) => {
      if (control.failOin) {
        throw new actual.ForecastQueryError(
          "RETAILA customer sales took too long and were stopped. Amazon FBA and Studley stock are unchanged. Retry in a moment.",
        );
      }
      return actual.loadRetailaOinReport(range);
    },
  };
});

const prisma = new PrismaClient();
const stamp = `U${Date.now().toString(36).toUpperCase()}`;
const stockSku = `UNSOLD${stamp}`;

describe("failed RETAILA sales do not become zero sales", () => {
  let adminId = "";

  beforeAll(async () => {
    await bootstrapRbac(prisma);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    const admin = await prisma.user.create({
      data: {
        email: `fba-unavailable-${stamp.toLowerCase()}@example.test`,
        name: "FBA unavailable",
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
        userRoles: { create: { roleId: adminRole.id } },
      },
    });
    adminId = admin.id;
    const now = new Date();
    const product = await prisma.autopartProduct.create({
      data: {
        sku: stockSku,
        matchKey: skuMatchKey(stockSku),
        description: "Stock without a sales read",
        availQty: 2,
        presentInLatestFeed: true,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
    const stockImport = await prisma.autopartFbaStockImport.create({
      data: {
        fileName: `optimus-unavail-${stamp}.csv`,
        fileHash: `unavail-${stamp}`,
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
        availableQty: 2,
        sourceBranch: "OPTIMUS",
        sourceImportedAt: now,
        importId: stockImport.id,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.autopartLocationStock.deleteMany({
      where: { autopartProduct: { sku: stockSku } },
    });
    await prisma.autopartProduct.deleteMany({ where: { sku: stockSku } });
    await prisma.autopartFbaStockImport.deleteMany({ where: { fileHash: `unavail-${stamp}` } });
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it("hides the sold list and still opens the full catalogue", async () => {
    control.failOin = true;
    const blocked = await getFbaForecastWorkspace(adminId, { q: stockSku });
    expect(blocked.salesActivity).toBe("365");
    expect(blocked.salesActivityUnavailable).toBe(true);
    expect(blocked.oinUnavailable ?? "").toMatch(/too long/);
    expect(blocked.rows).toEqual([]);
    expect(blocked.total).toBe(0);
    await expect(exportFbaForecastCsv(adminId, { q: stockSku })).rejects.toThrow(
      /not created|unavailable|too long/,
    );

    const catalogue = await getFbaForecastWorkspace(adminId, { q: stockSku, sold: "all" });
    expect(catalogue.salesActivityUnavailable).toBe(false);
    expect(catalogue.oinUnavailable ?? "").toMatch(/too long/);
    expect(catalogue.retailaInvoicesAvailable).toBe(false);
    const row = catalogue.rows.find((item) => item.matchKey === skuMatchKey(stockSku));
    expect(row?.customerSales.d365).toBeNull();
    expect(row?.customerSales.d30).toBeNull();
    expect(row?.forecast.recommendation).toBe("INSUFFICIENT_DATA");
    expect(row?.forecast.suggestedSendQty).toBeNull();
  }, 30_000);

  it("does not treat a failed invoice read as zero RETAILA planning demand", async () => {
    const today = todayLondonDateOnly();
    const { from, to } = retailaCompletedDaysWindow(today, 30);
    await prisma.autopartCustomerImportRun.deleteMany({
      where: { type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] } },
    });
    for (const day of retailaReportingRequiredWeekdays(from, to)) {
      const at = new Date(`${day}T17:00:00.000Z`);
      for (const type of ["ONGOING_504", "ONGOING_TRM21QC"] as const) {
        await prisma.autopartCustomerImportRun.create({
          data: {
            type,
            status: "COMMITTED",
            dryRun: false,
            filename: `${type}-${day}-${stamp}.dat`,
            createdAt: at,
            completedAt: at,
          },
        });
      }
    }

    await approveRetailaPlanning(adminId, {
      justification: "Approved so a failed invoice read cannot fabricate zero planning demand.",
    });
    control.failOin = true;
    try {
      const failed = await getFbaForecastWorkspace(adminId, {
        plan: "retaila",
        sold: "all",
        q: stockSku,
      });
      expect(failed.retailaReporting.planningAllowed).toBe(true);
      expect(failed.retailaInvoicesAvailable).toBe(false);
      expect(failed.oinUnavailable ?? "").toMatch(/too long/);
      const row = failed.rows.find((item) => item.matchKey === skuMatchKey(stockSku));
      expect(row?.fbaAvailable).toBe(2);
      expect(row?.studleyAvailable).toBe(2);
      expect(row?.customerSales.d30).toBeNull();
      expect(row?.forecast.blocker).toBe("RETAILA_SALES_UNKNOWN");
      expect(row?.forecast.recommendation).toBe("INSUFFICIENT_DATA");
      expect(row?.forecast.suggestedSendQty).toBeNull();
      expect(row?.forecast.planningEstimate).toBe(false);
      expect(row?.demand.source).toBe("NONE");
      await expect(
        exportFbaForecastCsv(adminId, { plan: "retaila", sold: "all", q: stockSku }),
      ).rejects.toThrow(/not created|unavailable|too long|zero demand/i);

      // Verified Amazon FBA mode must keep working when RETAILA invoices fail.
      const amazonMode = await getFbaForecastWorkspace(adminId, {
        plan: "fba",
        sold: "all",
        q: stockSku,
      });
      expect(amazonMode.retailaInvoicesAvailable).toBe(false);
      expect(amazonMode.rows.find((item) => item.matchKey === skuMatchKey(stockSku))?.demand.source).toBe(
        "NONE",
      );
    } finally {
      control.failOin = false;
      await disableRetailaPlanning(adminId).catch(() => undefined);
      await prisma.autopartCustomerImportRun.deleteMany({
        where: { type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] } },
      });
    }
  }, 60_000);
});
