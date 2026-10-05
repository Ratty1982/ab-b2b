/**
 * Purchasing demand from AutopartSalesLine — grouped SQL, never per-SKU N+1.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import {
  addDaysIso,
  documentDatePrismaHalfOpenBounds,
  lastNDaysRange,
  previousEquivalentPeriod,
  todayLondonDateOnly,
  type DateOnlyRange,
} from "@/domain/sales-history-period";

type UnitsRow = { sku: string; units: Prisma.Decimal | number | string };

function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function netUnitsBySku(range: DateOnlyRange): Promise<Map<string, number>> {
  const bounds = documentDatePrismaHalfOpenBounds(range);
  const rows = await prisma.$queryRaw<UnitsRow[]>(Prisma.sql`
    SELECT l.sku AS sku, COALESCE(SUM(l.units), 0) AS units
    FROM "AutopartSalesLine" l
    INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
    WHERE d."documentDate" IS NOT NULL
      AND d."documentDate" >= ${bounds.gte}
      AND d."documentDate" < ${bounds.lt}
    GROUP BY l.sku
  `);
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.sku.toUpperCase(), toNumber(row.units));
  return map;
}

export async function lastInvoiceSaleBySku(): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<Array<{ sku: string; last_sale: Date }>>(Prisma.sql`
    SELECT l.sku AS sku, MAX(d."documentDate") AS last_sale
    FROM "AutopartSalesLine" l
    INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
    WHERE d."documentDate" IS NOT NULL
      AND d."documentType" = 'INVOICE'
    GROUP BY l.sku
  `);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.sku.toUpperCase(), row.last_sale.toISOString().slice(0, 10));
  }
  return map;
}

export async function latestSalesUpdatedAt(): Promise<Date | null> {
  const doc = await prisma.autopartSalesDocument.findFirst({
    where: { documentDate: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return doc?.updatedAt ?? null;
}

export async function demandSourcesForSku(sku: string, range: DateOnlyRange) {
  const bounds = documentDatePrismaHalfOpenBounds(range);
  const rows = await prisma.$queryRaw<
    Array<{ source: string; units: Prisma.Decimal | number | string }>
  >(Prisma.sql`
    SELECT COALESCE(NULLIF(c.name, ''), l."autopartCustomerCode") AS source,
           COALESCE(SUM(l.units), 0) AS units
    FROM "AutopartSalesLine" l
    INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
    LEFT JOIN "Company" c ON c.id = l."companyId"
    WHERE d."documentDate" IS NOT NULL
      AND d."documentDate" >= ${bounds.gte}
      AND d."documentDate" < ${bounds.lt}
      AND UPPER(l.sku) = UPPER(${sku})
    GROUP BY 1
    ORDER BY SUM(l.units) DESC
    LIMIT 12
  `);
  return rows.map((row) => ({ name: row.source, units: toNumber(row.units) }));
}

export async function weeklyNetUnitsForSku(sku: string, from: string, to: string) {
  const bounds = documentDatePrismaHalfOpenBounds({ from, to });
  const rows = await prisma.$queryRaw<
    Array<{ day: Date; units: Prisma.Decimal | number | string }>
  >(Prisma.sql`
    SELECT (d."documentDate" AT TIME ZONE 'UTC')::date AS day,
           COALESCE(SUM(l.units), 0) AS units
    FROM "AutopartSalesLine" l
    INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
    WHERE d."documentDate" IS NOT NULL
      AND d."documentDate" >= ${bounds.gte}
      AND d."documentDate" < ${bounds.lt}
      AND UPPER(l.sku) = UPPER(${sku})
    GROUP BY 1
    ORDER BY 1
  `);
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const key = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);
    byDay.set(key, toNumber(row.units));
  }
  const weeks: Array<{ weekStart: string; units: number }> = [];
  let cursor = from;
  while (cursor <= to) {
    const weekEnd = addDaysIso(cursor, 6);
    let units = 0;
    let day = cursor;
    while (day <= weekEnd && day <= to) {
      units += byDay.get(day) ?? 0;
      day = addDaysIso(day, 1);
    }
    weeks.push({ weekStart: cursor, units });
    cursor = addDaysIso(cursor, 7);
  }
  return weeks;
}

export function coverageDaysForPeriod(
  periodFrom: string,
  periodTo: string,
  historyFrom: string | null,
  today: string,
): number {
  const from = historyFrom && historyFrom > periodFrom ? historyFrom : periodFrom;
  const to = periodTo < today ? periodTo : today;
  if (from > to) return 0;
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const a = Date.UTC(y1!, m1! - 1, d1!);
  const b = Date.UTC(y2!, m2! - 1, d2!);
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** Clip a demand window to the verified coverage start. Null = window is entirely before verification. */
export function clipRangeToVerified(
  range: DateOnlyRange,
  verifiedFrom: string | null,
): DateOnlyRange | null {
  if (!verifiedFrom) return range;
  const from = verifiedFrom > range.from ? verifiedFrom : range.from;
  if (from > range.to) return null;
  return { from, to: range.to };
}

export function purchasingDemandWindows(today = todayLondonDateOnly()) {
  const last7 = lastNDaysRange(today, 7);
  const last30 = lastNDaysRange(today, 30);
  const last90 = lastNDaysRange(today, 90);
  const last365 = lastNDaysRange(today, 365);
  const previous30 = previousEquivalentPeriod(last30);
  const previous90 = previousEquivalentPeriod(last90);
  const samePeriodLastYear = {
    from: addDaysIso(last30.from, -365),
    to: addDaysIso(last30.to, -365),
  };
  return { today, last7, last30, last90, last365, previous30, previous90, samePeriodLastYear };
}

export async function loadPurchasingDemandMaps(verifiedFrom: string | null = null) {
  const windows = purchasingDemandWindows();
  const clip = (range: DateOnlyRange) => clipRangeToVerified(range, verifiedFrom);
  const units = async (range: DateOnlyRange) => {
    const clipped = clip(range);
    if (!clipped) return new Map<string, number>();
    return netUnitsBySku(clipped);
  };
  const [u7, u30, u90, u365, prev30, prev90, spy, lastSale] = await Promise.all([
    units(windows.last7),
    units(windows.last30),
    units(windows.last90),
    units(windows.last365),
    units(windows.previous30),
    units(windows.previous90),
    units(windows.samePeriodLastYear),
    lastInvoiceSaleBySku(),
  ]);
  return { windows, u7, u30, u90, u365, prev30, prev90, spy, lastSale, historyFrom: verifiedFrom };
}

export function unitsFor(map: Map<string, number>, sku: string): number {
  return map.get(sku.toUpperCase()) ?? 0;
}
