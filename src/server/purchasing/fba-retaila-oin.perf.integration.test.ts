/**
 * Bounded RETAILA OIN reads against a disposable database.
 * The guard refuses any database whose name does not end with _test.
 * The budget matches the local statement_timeout: a forecast read must finish
 * within 8 seconds and must not pin the pooled connection afterwards.
 */
import "@/server/testing/use-protect-integration-database";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { todayLondonDateOnly } from "@/domain/sales-history-period";
import { skuMatchKey } from "@/domain/stock";
import {
  explainRetailaOinReport,
  loadRetailaOinReport,
  retailaOinRange,
  retailaWindowDays,
  RETAILA_OIN_QUERY_BUDGET_MS,
  withForecastQuery,
  listRetailaOinHistory,
} from "@/server/purchasing/fba-retaila-oin";
import { prisma as appPrisma } from "@/infra/database/client";

const prisma = new PrismaClient();
const stamp = `P${Date.now().toString(36).toUpperCase()}`;
const noise = 6000;

describe("bounded RETAILA OIN report", () => {
  let retailaId = "";
  let otherId = "";

  beforeAll(async () => {
    retailaId = (
      await prisma.company.create({
        data: {
          name: `Perf retaila ${stamp}`,
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
        verifiedById: (
          await prisma.user.create({
            data: {
              email: `perf-${stamp.toLowerCase()}@example.test`,
              name: "Perf",
              status: "ACTIVE",
              actorType: "INTERNAL",
              emailVerified: true,
            },
          })
        ).id,
      },
    });
    otherId = (
      await prisma.company.create({
        data: {
          name: `Perf other ${stamp}`,
          status: "ACTIVE",
          autopartCustomerCode: `OTHER${stamp}`,
          autopartCustomerCodeVerifiedAt: new Date(),
        },
      })
    ).id;

    await prisma.$executeRaw`
      INSERT INTO "AutopartSalesDocument" (
        id, "companyId", "autopartCustomerCode", "documentType", "documentReference",
        "documentDate", "has504", "hasTrm21qc", source, "createdAt", "updatedAt"
      )
      SELECT
        ${stamp} || '-odoc-' || gs,
        ${otherId},
        ${`OTHER${stamp}`},
        'INVOICE'::"AutopartHistoricDocumentType",
        'SS' || ${stamp} || gs,
        CURRENT_DATE - 400,
        false,
        false,
        '561L',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM generate_series(1, ${noise}) gs
    `;
    await prisma.$executeRaw`
      INSERT INTO "AutopartSalesLine" (
        id, "companyId", "documentId", "autopartCustomerCode", "documentType", "documentReference",
        "lineNumber", sku, units, "salesNet", source, "createdAt", "updatedAt"
      )
      SELECT
        ${stamp} || '-oline-' || gs,
        ${otherId},
        ${stamp} || '-odoc-' || gs,
        ${`OTHER${stamp}`},
        'INVOICE'::"AutopartHistoricDocumentType",
        'SS' || ${stamp} || gs,
        1,
        'NOISE' || ${stamp},
        9,
        90,
        '561L',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM generate_series(1, ${noise}) gs
    `;
    await prisma.$executeRaw`
      INSERT INTO "AutopartSalesDocument" (
        id, "companyId", "autopartCustomerCode", "documentType", "documentReference",
        "documentDate", "has504", "hasTrm21qc", source, "createdAt", "updatedAt"
      )
      SELECT
        ${stamp} || '-old-' || gs,
        ${retailaId},
        'RETAILA',
        'INVOICE'::"AutopartHistoricDocumentType",
        'OINOLD' || ${stamp} || gs,
        CURRENT_DATE - 400,
        false,
        false,
        '561L',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM generate_series(1, ${noise}) gs
    `;
    await prisma.$executeRaw`
      INSERT INTO "AutopartSalesLine" (
        id, "companyId", "documentId", "autopartCustomerCode", "documentType", "documentReference",
        "lineNumber", sku, units, "salesNet", source, "createdAt", "updatedAt"
      )
      SELECT
        ${stamp} || '-oldline-' || gs,
        ${retailaId},
        ${stamp} || '-old-' || gs,
        'RETAILA',
        'INVOICE'::"AutopartHistoricDocumentType",
        'OINOLD' || ${stamp} || gs,
        1,
        ${`OLD${stamp}`},
        50,
        500,
        '561L',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM generate_series(1, ${noise}) gs
    `;

    const posted = new Date(`${todayLondonDateOnly()}T12:00:00.000Z`);
    const once = `OIN${stamp}A`;
    const historic = await prisma.autopartSalesDocument.create({
      data: {
        id: `${stamp}-once-h`,
        companyId: retailaId,
        autopartCustomerCode: "RETAILA",
        documentType: "INVOICE",
        documentReference: once,
        documentDate: posted,
        has504: false,
        hasTrm21qc: false,
        source: "561L",
      },
    });
    const ongoing = await prisma.autopartSalesDocument.create({
      data: {
        id: `${stamp}-once-o`,
        companyId: null,
        autopartCustomerCode: "RETAILA",
        documentType: "INVOICE",
        documentReference: once,
        documentDate: posted,
        goodsNet: "40.00",
        has504: true,
        hasTrm21qc: true,
        source: "ONGOING_504",
      },
    });
    await prisma.autopartSalesLine.createMany({
      data: [
        {
          id: `${stamp}-once-hl`,
          documentId: historic.id,
          companyId: retailaId,
          autopartCustomerCode: "RETAILA",
          documentType: "INVOICE",
          documentReference: once,
          lineNumber: 1,
          sku: `NOW${stamp}`,
          units: 4,
          salesNet: "40.00",
          source: "561L",
        },
        {
          id: `${stamp}-once-ol`,
          documentId: ongoing.id,
          companyId: null,
          autopartCustomerCode: "RETAILA",
          documentType: "INVOICE",
          documentReference: once,
          lineNumber: 1,
          sku: `NOW${stamp}`,
          units: 4,
          salesNet: "40.00",
          source: "ONGOING_TRM21QC",
        },
      ],
    });
    const credit = await prisma.autopartSalesDocument.create({
      data: {
        id: `${stamp}-credit`,
        companyId: retailaId,
        autopartCustomerCode: "RETAILA",
        documentType: "CREDIT",
        documentReference: `OIN${stamp}C`,
        documentDate: posted,
        hasTrm21qc: true,
        source: "ONGOING_504",
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        id: `${stamp}-credit-line`,
        documentId: credit.id,
        companyId: retailaId,
        autopartCustomerCode: "RETAILA",
        documentType: "CREDIT",
        documentReference: `OIN${stamp}C`,
        lineNumber: 1,
        sku: `NOW${stamp}`,
        units: 1,
        salesNet: "10.00",
        source: "ONGOING_TRM21QC",
      },
    });
    const foreign = await prisma.autopartSalesDocument.create({
      data: {
        id: `${stamp}-foreign`,
        companyId: otherId,
        autopartCustomerCode: `OTHER${stamp}`,
        documentType: "INVOICE",
        documentReference: `OIN${stamp}F`,
        documentDate: posted,
        hasTrm21qc: true,
        source: "ONGOING_504",
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        id: `${stamp}-foreign-line`,
        documentId: foreign.id,
        companyId: otherId,
        autopartCustomerCode: `OTHER${stamp}`,
        documentType: "INVOICE",
        documentReference: `OIN${stamp}F`,
        lineNumber: 1,
        sku: `NOW${stamp}`,
        units: 9,
        salesNet: "90.00",
        source: "ONGOING_TRM21QC",
      },
    });
    await prisma.$executeRaw`ANALYZE "AutopartSalesDocument", "AutopartSalesLine", "Company", "AutopartCustomerAccountAlias"`;
  }, 60_000);

  afterAll(async () => {
    await prisma.autopartSalesLine.deleteMany({ where: { id: { startsWith: stamp } } });
    await prisma.autopartSalesDocument.deleteMany({ where: { id: { startsWith: stamp } } });
    await prisma.autopartCustomerAccountAlias.deleteMany({ where: { companyId: retailaId } });
    await prisma.company.deleteMany({ where: { id: { in: [retailaId, otherId] } } });
    await prisma.user.deleteMany({ where: { email: `perf-${stamp.toLowerCase()}@example.test` } });
    await prisma.$disconnect();
  });

  it("keeps the 90-day RETAILA result correct inside the statement budget", async () => {
    expect(retailaWindowDays(90)).toBe(90);
    expect(retailaWindowDays(10)).toBe(90);
    expect(retailaWindowDays(365)).toBe(365);
    const range = retailaOinRange(todayLondonDateOnly(), 90);
    const started = Date.now();
    const report = await loadRetailaOinReport(range);
    const elapsed = Date.now() - started;
    const current = report.units.find((row) => row.matchKey === skuMatchKey(`NOW${stamp}`));
    expect(current?.units).toBe(3);
    expect(current?.windows.d7).toBe(3);
    expect(current?.windows.d30).toBe(3);
    expect(current?.windows.d90).toBe(3);
    expect(current?.windows.d365).toBeNull();
    expect(report.units.some((row) => row.matchKey === skuMatchKey(`OLD${stamp}`))).toBe(false);
    expect(report.units.some((row) => row.sku.includes("NOISE"))).toBe(false);
    expect(elapsed).toBeLessThan(RETAILA_OIN_QUERY_BUDGET_MS);

    const plan = await explainRetailaOinReport(range);
    const execution = /Execution Time: ([0-9.]+) ms/.exec(plan);
    expect(Number(execution?.[1] ?? 99999)).toBeLessThan(RETAILA_OIN_QUERY_BUDGET_MS);
    expect(plan).toMatch(/Index|Bitmap/);
    expect(plan).not.toMatch(/Seq Scan on "AutopartSalesLine"/);
    const explainPath = process.env["FBA_OIN_EXPLAIN_PATH"]?.trim();
    if (explainPath) {
      mkdirSync(dirname(explainPath), { recursive: true });
      writeFileSync(explainPath, plan);
    }

    const history = await listRetailaOinHistory({ range, page: 1, pageSize: 20, q: stamp, sort: "units" });
    const once = history.documents.find((item) => item.documentReference === `OIN${stamp}A`);
    expect(once?.status).toBe("COUNTED");
    expect(once?.units).toBe(4);
    expect(once?.lines).toHaveLength(1);
    expect(history.documents.some((item) => item.documentReference.startsWith(`OINOLD${stamp}`))).toBe(false);
    expect(history.documents.some((item) => item.documentReference === `OIN${stamp}F`)).toBe(false);
  }, 60_000);

  it("cancels a stalled forecast read without blocking the next query", async () => {
    const started = Date.now();
    const stalled = withForecastQuery((db) => db.$queryRaw`SELECT pg_sleep(20)`);
    const quickStarted = Date.now();
    const quick = await appPrisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    expect(Date.now() - quickStarted).toBeLessThan(3_000);
    expect(Number(quick[0]?.ok)).toBe(1);
    await expect(stalled).rejects.toThrow(/stopped/);
    expect(Date.now() - started).toBeLessThan(15_000);
    const after = await appPrisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    expect(Number(after[0]?.ok)).toBe(1);
  }, 20_000);
});
