/**
 * Monthly sales trends from AutopartSalesLine.
 * FBA stock and FBA report usage are not read.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requirePurchasingAccess } from "@/server/rbac/guards";
import { lastNDaysRange, todayLondonDateOnly } from "@/domain/sales-history-period";
import { buildSalesTrend, SALES_TREND_DIRECTION_LABEL, type SalesTrendRange } from "@/domain/sales-trend";
import { netUnitsForKeys } from "@/server/purchasing/demand";
import { skuMatchKey } from "@/domain/stock";

type MonthRow = { month: string; units: Prisma.Decimal | number | string; net: Prisma.Decimal | number | string };

function num(value: Prisma.Decimal | number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function skuMonths(sku: string): Promise<MonthRow[]> {
  return prisma.$queryRaw<MonthRow[]>`
    SELECT to_char(d."documentDate", 'YYYY-MM') AS month,
           COALESCE(SUM(l.units), 0) AS units,
           COALESCE(SUM(l."salesNet"), 0) AS net
    FROM "AutopartSalesLine" l
    INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
    WHERE d."documentDate" IS NOT NULL
      AND UPPER(l.sku) = ${skuMatchKey(sku)}
    GROUP BY 1
    ORDER BY 1
  `;
}

async function brandMonths(brandId: string): Promise<MonthRow[]> {
  return prisma.$queryRaw<MonthRow[]>`
    SELECT to_char(d."documentDate", 'YYYY-MM') AS month,
           COALESCE(SUM(l.units), 0) AS units,
           COALESCE(SUM(l."salesNet"), 0) AS net
    FROM "AutopartSalesLine" l
    INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
    INNER JOIN "ProductVariant" v ON UPPER(v.sku) = UPPER(l.sku)
    INNER JOIN "Product" p ON p.id = v."productId"
    WHERE d."documentDate" IS NOT NULL
      AND p."brandId" = ${brandId}
    GROUP BY 1
    ORDER BY 1
  `;
}

async function brandSkuCount(brandId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ skus: number }>>`
    SELECT COUNT(DISTINCT UPPER(l.sku))::int AS skus
    FROM "AutopartSalesLine" l
    INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
    INNER JOIN "ProductVariant" v ON UPPER(v.sku) = UPPER(l.sku)
    INNER JOIN "Product" p ON p.id = v."productId"
    WHERE d."documentDate" IS NOT NULL
      AND p."brandId" = ${brandId}
  `;
  return Number(rows[0]?.skus ?? 0);
}

function observed(rows: MonthRow[]) {
  return rows.map((row) => ({ month: row.month, units: num(row.units), netSales: num(row.net) }));
}

const rangeInput = z.enum(["12", "24", "all"]);

export async function getSkuSalesTrend(actorUserId: string, raw: unknown) {
  await requirePurchasingAccess(actorUserId);
  const input = z.object({ sku: z.string().trim().min(1), range: rangeInput.optional() }).parse(raw);
  const range = (input.range ?? "12") as SalesTrendRange;
  const today = todayLondonDateOnly();
  const [months, d30, d90, d365] = await Promise.all([
    skuMonths(input.sku),
    netUnitsForKeys([input.sku], lastNDaysRange(today, 30)),
    netUnitsForKeys([input.sku], lastNDaysRange(today, 90)),
    netUnitsForKeys([input.sku], lastNDaysRange(today, 365)),
  ]);
  const key = skuMatchKey(input.sku);
  const trend = buildSalesTrend({ observed: observed(months), range, today });
  return {
    sku: input.sku,
    ...trend,
    directionLabel: SALES_TREND_DIRECTION_LABEL[trend.direction],
    last30: d30.get(key) ?? 0,
    last90: d90.get(key) ?? 0,
    last365: d365.get(key) ?? 0,
  };
}

export async function getBrandSalesTrend(actorUserId: string, raw: unknown) {
  await requirePurchasingAccess(actorUserId);
  const input = z.object({ brandSlug: z.string().trim().min(1), range: rangeInput.optional() }).parse(raw);
  const brand = await prisma.brand.findUnique({
    where: { slug: input.brandSlug },
    select: { id: true, name: true, slug: true },
  });
  if (!brand) throw new AuthError("Brand not found", "NOT_FOUND", 404);
  const range = (input.range ?? "12") as SalesTrendRange;
  const today = todayLondonDateOnly();
  const [months, skuCount] = await Promise.all([brandMonths(brand.id), brandSkuCount(brand.id)]);
  const trend = buildSalesTrend({ observed: observed(months), range, today });
  return {
    brandName: brand.name,
    brandSlug: brand.slug,
    skuCount,
    ...trend,
    directionLabel: SALES_TREND_DIRECTION_LABEL[trend.direction],
  };
}

/** One grouped query for CSV trend direction. Not used by the demand engine. */
export async function trendDirectionBySku(skus: string[], today = todayLondonDateOnly()): Promise<Map<string, string>> {
  const unique = [...new Set(skus.map((sku) => skuMatchKey(sku)).filter(Boolean))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const rows: MonthRow[] = [];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const part = await prisma.$queryRaw<Array<MonthRow & { sku: string }>>`
      SELECT UPPER(l.sku) AS sku,
             to_char(d."documentDate", 'YYYY-MM') AS month,
             COALESCE(SUM(l.units), 0) AS units,
             0 AS net
      FROM "AutopartSalesLine" l
      INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE d."documentDate" IS NOT NULL
        AND UPPER(l.sku) IN (${Prisma.join(chunk)})
      GROUP BY 1, 2
    `;
    rows.push(...part);
  }
  const bySku = new Map<string, Array<{ month: string; units: number }>>();
  for (const row of rows as Array<MonthRow & { sku: string }>) {
    const list = bySku.get(row.sku) ?? [];
    list.push({ month: row.month, units: num(row.units) });
    bySku.set(row.sku, list);
  }
  for (const sku of unique) {
    const trend = buildSalesTrend({ observed: bySku.get(sku) ?? [], range: "all", today });
    out.set(sku, SALES_TREND_DIRECTION_LABEL[trend.direction]);
  }
  return out;
}
