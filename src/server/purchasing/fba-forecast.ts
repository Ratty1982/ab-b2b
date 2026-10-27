/**
 * FBA UK replenishment workspace.
 * Writes only the FBA ledger, Amazon sales extract, inbound notes and settings.
 * It does not create orders, change Autopart sales documents, or poll 504/TRM.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { parseAutopart504Report } from "@/domain/autopart-504";
import { parseAutopartTrm21qcReport } from "@/domain/autopart-trm21qc";
import { parseFbaAmazonSalesCsv } from "@/domain/fba-amazon-sales-csv";
import {
  amazonWindowSupported,
  buildOinReplenishmentBatch,
  projectFbaShipment,
  provisionalReplenishmentWeekly,
  type FbaForecastResult,
  type OinException,
} from "@/domain/fba-replenishment";
import { FBA_LOCATION_CODE, FBA_STOCK_STALE_AFTER_DAYS, fbaStockIsStale } from "@/domain/fba-stock";
import { lastNDaysRange, todayLondonDateOnly } from "@/domain/sales-history-period";
import { skuMatchKey } from "@/domain/stock";
import { hasPermission } from "@/server/rbac/access";
import { AuthError, requirePurchasingSection } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";

const PAGE_SIZE = 50;

function num(value: { toString(): string } | number | string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function asDate(iso: string | null): Date | null {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00.000Z`);
}

async function requireView(actorUserId: string) {
  const profile = await requirePurchasingSection(actorUserId, "purchasing.fba_forecast.view");
  return profile;
}

async function requireManage(actorUserId: string) {
  const profile = await requirePurchasingSection(actorUserId, "purchasing.fba_forecast.manage");
  if (!hasPermission(profile, "purchasing.fba_forecast.manage")) {
    throw new AuthError("Purchasing access required", "PURCHASING_FORBIDDEN", 403);
  }
  return profile;
}

export function fbaReportPairHash(report504: string, reportTrm: string): string {
  return createHash("sha256")
    .update(report504.replace(/\r\n/g, "\n"))
    .update("\n")
    .update(reportTrm.replace(/\r\n/g, "\n"))
    .digest("hex");
}

const oinInput = z.object({
  report504: z.string().min(1).max(8_000_000),
  reportTrm: z.string().min(1).max(12_000_000),
  filename504: z.string().min(1).max(240),
  filenameTrm: z.string().min(1).max(240),
});

export async function importOinReplenishment(actorUserId: string, raw: unknown) {
  await requireManage(actorUserId);
  const input = oinInput.parse(raw);
  const headers = parseAutopart504Report(input.report504);
  const lines = parseAutopartTrm21qcReport(input.reportTrm);
  if (!headers.headerFound || !lines.headerFound) {
    throw new AuthError(
      "Both files must be a recognised 504 report and a TRM21QC report. Nothing was stored.",
      "FBA_IMPORT_REJECTED",
      400,
    );
  }
  const batch = buildOinReplenishmentBatch({ headers: headers.rows, lines: lines.rows });
  const fileHash = fbaReportPairHash(input.report504, input.reportTrm);
  const existing = await prisma.fbaReplenishmentImport.findUnique({ where: { fileHash } });
  if (existing) {
    return {
      duplicate: true,
      importId: existing.id,
      documentCount: existing.documentCount,
      lineCount: existing.lineCount,
      exceptionCount: existing.exceptionCount,
    };
  }
  const created = await prisma.$transaction(async (tx) => {
    const run = await tx.fbaReplenishmentImport.create({
      data: {
        filename504: input.filename504,
        filenameTrm: input.filenameTrm,
        fileHash,
        actorUserId,
        documentCount: batch.documents.length,
        lineCount: batch.documents.reduce((sum, doc) => sum + doc.lines.length, 0),
        exceptionCount: batch.exceptions.length,
        exceptions: batch.exceptions as unknown as Prisma.InputJsonValue,
      },
    });
    for (const doc of batch.documents) {
      const saved = await tx.fbaReplenishmentDocument.upsert({
        where: {
          documentReference_documentType: {
            documentReference: doc.documentReference,
            documentType: doc.documentType,
          },
        },
        create: {
          importId: run.id,
          documentReference: doc.documentReference,
          documentType: doc.documentType,
          documentDate: asDate(doc.documentDate),
          customerAccount: doc.customerAccount,
          customerName: doc.customerName,
          goodsNet: doc.goodsNet,
          sourceFileHash: fileHash,
        },
        update: {
          importId: run.id,
          documentDate: asDate(doc.documentDate),
          customerAccount: doc.customerAccount,
          customerName: doc.customerName,
          goodsNet: doc.goodsNet,
          sourceFileHash: fileHash,
        },
      });
      for (const line of doc.lines) {
        await tx.fbaReplenishmentLine.upsert({
          where: { documentId_lineKey: { documentId: saved.id, lineKey: line.lineKey } },
          create: {
            documentId: saved.id,
            lineKey: line.lineKey,
            sku: line.sku,
            matchKey: skuMatchKey(line.sku),
            description: line.description,
            qty: line.qty,
            salesNet: line.salesNet,
          },
          update: {
            sku: line.sku,
            matchKey: skuMatchKey(line.sku),
            description: line.description,
            qty: line.qty,
            salesNet: line.salesNet,
          },
        });
      }
    }
    return run;
  });
  await recordAuditEvent({
    action: "fba.replenishment.import",
    entityType: "FbaReplenishmentImport",
    entityId: created.id,
    actorUserId,
    metadata: {
      documents: created.documentCount,
      lines: created.lineCount,
      exceptions: created.exceptionCount,
      filename504: input.filename504,
      filenameTrm: input.filenameTrm,
    },
  });
  return {
    duplicate: false,
    importId: created.id,
    documentCount: created.documentCount,
    lineCount: created.lineCount,
    exceptionCount: created.exceptionCount,
    exceptions: batch.exceptions.slice(0, 50),
  };
}

const salesInput = z.object({
  text: z.string().min(1).max(12_000_000),
  filename: z.string().min(1).max(240),
  completeDaily: z.boolean(),
});

export async function importFbaAmazonSales(actorUserId: string, raw: unknown) {
  await requireManage(actorUserId);
  const input = salesInput.parse(raw);
  const parsed = parseFbaAmazonSalesCsv(input.text);
  if (!parsed.ok) throw new AuthError(parsed.error, "FBA_SALES_REJECTED", 400);
  const fileHash = createHash("sha256").update(input.text.replace(/\r\n/g, "\n")).digest("hex");
  const existing = await prisma.fbaAmazonSalesImport.findUnique({ where: { fileHash } });
  if (existing) return { duplicate: true, importId: existing.id, rowCount: existing.rowCount };
  const created = await prisma.fbaAmazonSalesImport.create({
    data: {
      filename: input.filename,
      fileHash,
      actorUserId,
      completeDaily: input.completeDaily,
      coverageFrom: asDate(parsed.coverageFrom),
      coverageTo: asDate(parsed.coverageTo),
      rowCount: parsed.rows.length,
      lines: {
        create: parsed.rows.map((row) => ({
          matchKey: row.matchKey,
          sku: row.sku,
          saleDate: asDate(row.saleDate)!,
          unitsSold: row.unitsSold,
          unitsCredited: row.unitsCredited,
          marketplace: row.marketplace,
        })),
      },
    },
  });
  await recordAuditEvent({
    action: "fba.amazon_sales.import",
    entityType: "FbaAmazonSalesImport",
    entityId: created.id,
    actorUserId,
    metadata: {
      rows: created.rowCount,
      completeDaily: input.completeDaily,
      coverageFrom: parsed.coverageFrom,
      coverageTo: parsed.coverageTo,
      mergedDuplicateDays: parsed.mergedDuplicateDays,
    },
  });
  return {
    duplicate: false,
    importId: created.id,
    rowCount: created.rowCount,
    coverageFrom: parsed.coverageFrom,
    coverageTo: parsed.coverageTo,
  };
}

const settingsInput = z.object({
  leadTimeDays: z.number().int().min(1).max(120),
  targetCoverWeeks: z.number().min(0).max(52),
  safetyStockQty: z.number().int().min(0).max(100000),
  caseMultiple: z.number().int().min(1).max(10000).nullable(),
  overstockCoverWeeks: z.number().min(1).max(104),
});

export async function updateFbaForecastSettings(actorUserId: string, raw: unknown) {
  await requireManage(actorUserId);
  const input = settingsInput.parse(raw);
  const saved = await prisma.fbaForecastSettings.upsert({
    where: { id: "default" },
    create: { id: "default", ...input, updatedByUserId: actorUserId },
    update: { ...input, updatedByUserId: actorUserId },
  });
  await recordAuditEvent({
    action: "fba.forecast.settings",
    entityType: "FbaForecastSettings",
    entityId: saved.id,
    actorUserId,
    after: input,
  });
  return {
    leadTimeDays: saved.leadTimeDays,
    targetCoverWeeks: num(saved.targetCoverWeeks),
    safetyStockQty: saved.safetyStockQty,
    caseMultiple: saved.caseMultiple,
    overstockCoverWeeks: num(saved.overstockCoverWeeks),
  };
}

const inboundInput = z.object({
  reference: z.string().trim().min(1).max(80),
  sku: z.string().trim().min(1).max(80),
  qty: z.number().int().positive().max(1_000_000),
  status: z.enum(["PLANNED", "CONFIRMED_IN_TRANSIT", "RECEIVED", "CANCELLED"]),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function saveFbaInboundShipment(actorUserId: string, raw: unknown) {
  await requireManage(actorUserId);
  const input = inboundInput.parse(raw);
  const matchKey = skuMatchKey(input.sku);
  const saved = await prisma.fbaInboundShipment.upsert({
    where: { reference_matchKey: { reference: input.reference, matchKey } },
    create: {
      reference: input.reference,
      matchKey,
      sku: input.sku.trim(),
      qty: input.qty,
      status: input.status,
      note: input.note ?? null,
      createdByUserId: actorUserId,
    },
    update: {
      sku: input.sku.trim(),
      qty: input.qty,
      status: input.status,
      note: input.note ?? null,
    },
  });
  await recordAuditEvent({
    action: "fba.inbound.save",
    entityType: "FbaInboundShipment",
    entityId: saved.id,
    actorUserId,
    metadata: { reference: input.reference, matchKey, qty: input.qty, status: input.status },
  });
  return { id: saved.id, matchKey, status: saved.status };
}

const overrideInput = z.object({
  sku: z.string().trim().min(1).max(80),
  leadTimeDays: z.number().int().min(1).max(120).nullable(),
  targetCoverWeeks: z.number().min(0).max(52).nullable(),
  safetyStockQty: z.number().int().min(0).max(100000).nullable(),
  caseMultiple: z.number().int().min(1).max(10000).nullable(),
});

export async function saveFbaSkuOverride(actorUserId: string, raw: unknown) {
  await requireManage(actorUserId);
  const input = overrideInput.parse(raw);
  const matchKey = skuMatchKey(input.sku);
  const saved = await prisma.fbaSkuForecastOverride.upsert({
    where: { matchKey },
    create: {
      matchKey,
      leadTimeDays: input.leadTimeDays,
      targetCoverWeeks: input.targetCoverWeeks,
      safetyStockQty: input.safetyStockQty,
      caseMultiple: input.caseMultiple,
      updatedByUserId: actorUserId,
    },
    update: {
      leadTimeDays: input.leadTimeDays,
      targetCoverWeeks: input.targetCoverWeeks,
      safetyStockQty: input.safetyStockQty,
      caseMultiple: input.caseMultiple,
      updatedByUserId: actorUserId,
    },
  });
  return { matchKey: saved.matchKey };
}

const listInput = z.object({
  q: z.string().trim().max(80).optional().nullable(),
  recommendation: z
    .enum(["SEND_NOW", "SEND_SOON", "HEALTHY", "OVERSTOCKED", "INSUFFICIENT_DATA"])
    .optional()
    .nullable(),
  page: z.number().int().positive().optional().nullable(),
});

type SkuBucket = {
  matchKey: string;
  sku: string;
  description: string | null;
  fbaAvailable: number | null;
  fbaStockKnown: boolean;
  studleyAvailable: number | null;
  inbound: number;
  oinUnits90: number;
  amazon: { d7: number; d30: number; d90: number; d365: number } | null;
};

export async function getFbaForecastWorkspace(actorUserId: string, raw: unknown = {}) {
  const profile = await requireView(actorUserId);
  const input = listInput.parse(raw ?? {});
  const today = todayLondonDateOnly();
  const settingsRow = await prisma.fbaForecastSettings.findUnique({ where: { id: "default" } });
  const settings = {
    leadTimeDays: settingsRow?.leadTimeDays ?? 14,
    targetCoverWeeks: num(settingsRow?.targetCoverWeeks ?? 6),
    safetyStockQty: settingsRow?.safetyStockQty ?? 0,
    caseMultiple: settingsRow?.caseMultiple ?? null,
    overstockCoverWeeks: num(settingsRow?.overstockCoverWeeks ?? 16),
  };
  const [salesImport, fbaImport, overrides, overlap] = await Promise.all([
    prisma.fbaAmazonSalesImport.findFirst({ orderBy: { importedAt: "desc" } }),
    prisma.autopartFbaStockImport.findFirst({
      orderBy: { importedAt: "desc" },
      select: { importedAt: true, fileName: true },
    }),
    prisma.fbaSkuForecastOverride.findMany(),
    prisma.$queryRaw<Array<{ documents: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS documents
      FROM "FbaReplenishmentDocument" f
      WHERE EXISTS (
        SELECT 1 FROM "AutopartSalesDocument" s
        WHERE UPPER(s."documentReference") = f."documentReference"
      )
    `),
  ]);
  const stale = fbaStockIsStale(fbaImport?.importedAt ?? null);
  const ranges = {
    d7: lastNDaysRange(today, 7),
    d30: lastNDaysRange(today, 30),
    d90: lastNDaysRange(today, 90),
    d365: lastNDaysRange(today, 365),
  };
  const coverageFrom = dateOnly(salesImport?.coverageFrom);
  const coverageTo = dateOnly(salesImport?.coverageTo);
  const windows = {
    d7: amazonWindowSupported({
      completeDaily: Boolean(salesImport?.completeDaily),
      coverageFrom,
      coverageTo,
      windowFrom: ranges.d7.from,
      windowTo: ranges.d7.to,
      today,
    }),
    d30: amazonWindowSupported({
      completeDaily: Boolean(salesImport?.completeDaily),
      coverageFrom,
      coverageTo,
      windowFrom: ranges.d30.from,
      windowTo: ranges.d30.to,
      today,
    }),
    d90: amazonWindowSupported({
      completeDaily: Boolean(salesImport?.completeDaily),
      coverageFrom,
      coverageTo,
      windowFrom: ranges.d90.from,
      windowTo: ranges.d90.to,
      today,
    }),
    d365: amazonWindowSupported({
      completeDaily: Boolean(salesImport?.completeDaily),
      coverageFrom,
      coverageTo,
      windowFrom: ranges.d365.from,
      windowTo: ranges.d365.to,
      today,
    }),
  };
  const [fbaRows, oinRows, amazonRows, inboundRows, unmatched] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        matchKey: string;
        sku: string;
        description: string | null;
        fba: number;
        studley: number | null;
        present: boolean;
      }>
    >(Prisma.sql`
      SELECT p."matchKey" AS "matchKey", p.sku AS sku, p.description AS description,
             loc."availableQty" AS fba,
             CASE WHEN p."presentInLatestFeed" THEN p."availQty" ELSE NULL END AS studley,
             p."presentInLatestFeed" AS present
      FROM "AutopartLocationStock" loc
      INNER JOIN "AutopartProduct" p ON p.id = loc."autopartProductId"
      WHERE loc."locationCode" = ${FBA_LOCATION_CODE}
    `),
    prisma.$queryRaw<Array<{ matchKey: string; sku: string; units: Prisma.Decimal }>>(Prisma.sql`
      SELECT l."matchKey" AS "matchKey", MAX(l.sku) AS sku, COALESCE(SUM(l.qty), 0) AS units
      FROM "FbaReplenishmentLine" l
      INNER JOIN "FbaReplenishmentDocument" d ON d.id = l."documentId"
      WHERE d."documentDate" IS NOT NULL
        AND d."documentDate" >= ${asDate(ranges.d90.from)}
        AND d."documentDate" < ${addDaysIsoSafe(ranges.d90.to)}
      GROUP BY l."matchKey"
    `),
    salesImport
      ? prisma.$queryRaw<
          Array<{
            matchKey: string;
            sku: string;
            d7: Prisma.Decimal;
            d30: Prisma.Decimal;
            d90: Prisma.Decimal;
            d365: Prisma.Decimal;
          }>
        >(Prisma.sql`
          SELECT "matchKey", MAX(sku) AS sku,
            COALESCE(SUM("unitsSold" - "unitsCredited") FILTER (WHERE "saleDate" >= ${asDate(ranges.d7.from)}), 0) AS d7,
            COALESCE(SUM("unitsSold" - "unitsCredited") FILTER (WHERE "saleDate" >= ${asDate(ranges.d30.from)}), 0) AS d30,
            COALESCE(SUM("unitsSold" - "unitsCredited") FILTER (WHERE "saleDate" >= ${asDate(ranges.d90.from)}), 0) AS d90,
            COALESCE(SUM("unitsSold" - "unitsCredited") FILTER (WHERE "saleDate" >= ${asDate(ranges.d365.from)}), 0) AS d365
          FROM "FbaAmazonSalesLine"
          WHERE "importId" = ${salesImport.id}
            AND "saleDate" <= ${asDate(today)}
          GROUP BY "matchKey"
        `)
      : Promise.resolve([]),
    prisma.$queryRaw<Array<{ matchKey: string; sku: string; qty: number }>>(Prisma.sql`
      SELECT "matchKey", MAX(sku) AS sku, COALESCE(SUM(qty), 0)::int AS qty
      FROM "FbaInboundShipment"
      WHERE status = 'CONFIRMED_IN_TRANSIT'
      GROUP BY "matchKey"
    `),
    prisma.$queryRaw<Array<{ matchKey: string }>>(Prisma.sql`
      SELECT DISTINCT l."matchKey" AS "matchKey"
      FROM "FbaReplenishmentLine" l
      LEFT JOIN "AutopartProduct" p ON p."matchKey" = l."matchKey"
      WHERE p.id IS NULL
    `),
  ]);

  const buckets = new Map<string, SkuBucket>();
  function bucket(matchKey: string, sku: string, description: string | null = null): SkuBucket {
    const existing = buckets.get(matchKey);
    if (existing) {
      if (!existing.description && description) existing.description = description;
      return existing;
    }
    const created: SkuBucket = {
      matchKey,
      sku,
      description,
      fbaAvailable: null,
      fbaStockKnown: false,
      studleyAvailable: null,
      inbound: 0,
      oinUnits90: 0,
      amazon: null,
    };
    buckets.set(matchKey, created);
    return created;
  }
  for (const row of fbaRows) {
    const item = bucket(row.matchKey, row.sku, row.description);
    item.fbaAvailable = row.fba;
    item.fbaStockKnown = true;
    item.studleyAvailable = row.present ? row.studley : null;
  }
  for (const row of oinRows) bucket(row.matchKey, row.sku).oinUnits90 = num(row.units);
  for (const row of amazonRows) {
    bucket(row.matchKey, row.sku).amazon = {
      d7: num(row.d7),
      d30: num(row.d30),
      d90: num(row.d90),
      d365: num(row.d365),
    };
  }
  for (const row of inboundRows) bucket(row.matchKey, row.sku).inbound = row.qty;

  const overrideByKey = new Map(overrides.map((row) => [row.matchKey, row]));
  const q = input.q?.trim().toLowerCase() ?? "";
  const rows = [...buckets.values()]
    .map((item) => {
      const override = overrideByKey.get(item.matchKey);
      const forecast: FbaForecastResult = projectFbaShipment({
        fbaAvailable: item.fbaAvailable,
        fbaStockKnown: item.fbaStockKnown,
        fbaStockStale: stale,
        studleyAvailable: item.studleyAvailable,
        confirmedInboundQty: item.inbound,
        salesSupported: windows.d30,
        amazonNetUnits30: windows.d30 ? (item.amazon?.d30 ?? 0) : null,
        leadTimeDays: override?.leadTimeDays ?? settings.leadTimeDays,
        targetCoverWeeks: num(override?.targetCoverWeeks ?? settings.targetCoverWeeks),
        safetyStockQty: override?.safetyStockQty ?? settings.safetyStockQty,
        caseMultiple: override?.caseMultiple ?? settings.caseMultiple,
        overstockCoverWeeks: settings.overstockCoverWeeks,
        today,
      });
      return {
        ...item,
        forecast,
        oinWeekly: provisionalReplenishmentWeekly(item.oinUnits90, 90),
        amazonUnits: {
          d7: windows.d7 ? (item.amazon?.d7 ?? 0) : null,
          d30: windows.d30 ? (item.amazon?.d30 ?? 0) : null,
          d90: windows.d90 ? (item.amazon?.d90 ?? 0) : null,
          d365: windows.d365 ? (item.amazon?.d365 ?? 0) : null,
        },
      };
    })
    .filter((row) => {
      if (input.recommendation && row.forecast.recommendation !== input.recommendation)
        return false;
      if (!q) return true;
      return (
        row.sku.toLowerCase().includes(q) ||
        row.matchKey.toLowerCase().includes(q) ||
        (row.description ?? "").toLowerCase().includes(q)
      );
    })
    .sort(
      (a, b) =>
        recommendationRank(a.forecast.recommendation) -
          recommendationRank(b.forecast.recommendation) || a.sku.localeCompare(b.sku),
    );

  const page = input.page ?? 1;
  const start = (page - 1) * PAGE_SIZE;
  const latestRun = await prisma.fbaReplenishmentImport.findFirst({
    orderBy: { importedAt: "desc" },
  });
  return {
    today,
    stale,
    staleAfterDays: FBA_STOCK_STALE_AFTER_DAYS,
    fbaImportedAt: fbaImport?.importedAt.toISOString() ?? null,
    fbaFileName: fbaImport?.fileName ?? null,
    sales: salesImport
      ? {
          filename: salesImport.filename,
          importedAt: salesImport.importedAt.toISOString(),
          completeDaily: salesImport.completeDaily,
          coverageFrom,
          coverageTo,
          windows,
        }
      : null,
    canManage: hasPermission(profile, "purchasing.fba_forecast.manage"),
    settings,
    overlapDocuments: overlap[0]?.documents ?? 0,
    unmatchedCount: unmatched.length,
    unmatchedSkus: unmatched.slice(0, 50).map((row) => row.matchKey),
    latestExceptions: (latestRun?.exceptions as OinException[] | null)?.slice(0, 20) ?? [],
    total: rows.length,
    page,
    pageSize: PAGE_SIZE,
    rows: rows.slice(start, start + PAGE_SIZE).map((row) => ({
      matchKey: row.matchKey,
      sku: row.sku,
      description: row.description,
      fbaAvailable: row.fbaAvailable,
      studleyAvailable: row.studleyAvailable,
      confirmedInbound: row.inbound,
      oinUnits90: row.oinUnits90,
      oinWeekly: row.oinWeekly,
      amazonUnits: row.amazonUnits,
      forecast: row.forecast,
    })),
  };
}

function recommendationRank(value: string): number {
  if (value === "SEND_NOW") return 0;
  if (value === "SEND_SOON") return 1;
  if (value === "INSUFFICIENT_DATA") return 2;
  if (value === "HEALTHY") return 3;
  return 4;
}

function addDaysIsoSafe(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1));
}
