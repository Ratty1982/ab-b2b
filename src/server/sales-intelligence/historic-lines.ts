/**
 * Shared Autopart historic sales line loaders for Sales Enquiry + Gap Analysis.
 * Single source of period filtering so figures reconcile across modules.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import {
  dateOnlyIsoFromDate,
  documentDatePrismaBounds,
  type DateOnlyRange,
} from "@/domain/sales-history-period";
import {
  accumulateLine,
  createLineAgg,
  emptySalesTotals,
  parseSalesNetMinor,
  totalsToDto,
  type MutableLineAgg,
  type SalesMoneyTotals,
  type SalesMoneyTotalsDto,
} from "@/domain/sales-intelligence";

/** Above this, prefer DB aggregation over loading every AutopartSalesLine into Node. */
export const HISTORIC_LINES_IN_MEMORY_MAX = 25_000;

export type HistoricLineRow = {
  companyId: string;
  autopartCustomerCode: string;
  sku: string;
  units: { toString(): string } | number;
  salesNet: { toString(): string } | number;
  descriptionSnapshot: string | null;
  documentType: string;
  documentReference: string;
  document: { documentDate: Date | null } | null;
};

function historicLineWhere(args: {
  companyId?: string | { in: string[] } | undefined;
  sku?: { equals: string; mode: "insensitive" } | undefined;
  range: DateOnlyRange;
}): Prisma.AutopartSalesLineWhereInput {
  const bounds = documentDatePrismaBounds(args.range);
  return {
    ...(typeof args.companyId === "string"
      ? { companyId: args.companyId }
      : args.companyId
        ? { companyId: args.companyId }
        : {}),
    ...(args.sku ? { sku: args.sku } : {}),
    document: {
      is: {
        companyId: { not: null },
        documentDate: { gte: bounds.gte, lte: bounds.lte },
      },
    },
  };
}

export async function countHistoricSalesLines(args: {
  companyId?: string | { in: string[] } | undefined;
  sku?: { equals: string; mode: "insensitive" } | undefined;
  range: DateOnlyRange;
}): Promise<number> {
  return prisma.autopartSalesLine.count({ where: historicLineWhere(args) });
}

export async function loadHistoricSalesLines(args: {
  companyId?: string | { in: string[] } | undefined;
  sku?: { equals: string; mode: "insensitive" } | undefined;
  range: DateOnlyRange;
}): Promise<HistoricLineRow[]> {
  // Realised Autopart sales only (historic 561L/SLRB + ongoing 504/TRM21QC).
  // Excludes unmapped documents (null company) and never merges AB Order lines —
  // AB Orders remain operational; Autopart invoice/credit lines are authoritative realised sales.
  return prisma.autopartSalesLine.findMany({
    where: historicLineWhere(args),
    select: {
      companyId: true,
      autopartCustomerCode: true,
      sku: true,
      units: true,
      salesNet: true,
      descriptionSnapshot: true,
      documentType: true,
      documentReference: true,
      document: { select: { documentDate: true } },
    },
  });
}

/**
 * Summary cards without loading every line — safe after large historic imports.
 */
export async function summarizeHistoricSalesFromDb(args: {
  companyId?: string | { in: string[] } | undefined;
  sku?: { equals: string; mode: "insensitive" } | undefined;
  range: DateOnlyRange;
}): Promise<SalesMoneyTotals> {
  const where = historicLineWhere(args);
  const bounds = documentDatePrismaBounds(args.range);
  const byType = await prisma.autopartSalesLine.groupBy({
    by: ["documentType"],
    where,
    _sum: { salesNet: true, units: true },
  });

  const totals = emptySalesTotals();
  for (const row of byType) {
    const minor = parseSalesNetMinor(row._sum.salesNet);
    totals.units += Number(row._sum.units ?? 0);
    totals.netSalesMinor += minor;
    if (row.documentType === "INVOICE") {
      totals.invoiceSalesMinor += minor;
    } else if (row.documentType === "CREDIT") {
      totals.creditsMinor += minor;
    }
  }

  const companyIds =
    typeof args.companyId === "string"
      ? [args.companyId]
      : args.companyId && "in" in args.companyId
        ? args.companyId.in
        : null;

  const companySql =
    companyIds == null
      ? Prisma.sql`TRUE`
      : companyIds.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`l."companyId" IN (${Prisma.join(companyIds)})`;
  const skuSql = args.sku
    ? Prisma.sql`AND UPPER(l.sku) = UPPER(${args.sku.equals})`
    : Prisma.empty;

  const [docCount, skuCount, companyCount] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT 1
        FROM "AutopartSalesLine" l
        INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
        WHERE ${companySql}
          AND d."companyId" IS NOT NULL
          AND d."documentDate" >= ${bounds.gte}
          AND d."documentDate" <= ${bounds.lte}
          AND l."documentType" = 'INVOICE'
          ${skuSql}
        GROUP BY l."companyId", l."documentReference"
      ) t
    `,
    prisma.autopartSalesLine.groupBy({ by: ["sku"], where }),
    prisma.autopartSalesLine.groupBy({ by: ["companyId"], where }),
  ]);

  totals.purchaseTransactions = Number(docCount[0]?.count ?? 0);
  totals.productsPurchased = skuCount.length;
  totals.customers = companyCount.length;
  return totals;
}

export function summarizeHistoricLines(lines: HistoricLineRow[]): SalesMoneyTotals {
  const totals = emptySalesTotals();
  const invoiceRefs = new Set<string>();
  const skus = new Set<string>();
  const companies = new Set<string>();
  for (const line of lines) {
    const minor = parseSalesNetMinor(line.salesNet);
    totals.units += Number(line.units ?? 0);
    totals.netSalesMinor += minor;
    if (line.documentType === "INVOICE") {
      totals.invoiceSalesMinor += minor;
      invoiceRefs.add(`${line.companyId}:${line.documentReference}`);
    } else if (line.documentType === "CREDIT") {
      totals.creditsMinor += minor;
    }
    skus.add(line.sku.trim().toUpperCase());
    companies.add(line.companyId);
  }
  totals.purchaseTransactions = invoiceRefs.size;
  totals.productsPurchased = skus.size;
  totals.customers = companies.size;
  return totals;
}

export function summarizeHistoricLinesDto(lines: HistoricLineRow[]): SalesMoneyTotalsDto {
  return totalsToDto(summarizeHistoricLines(lines));
}

export function groupHistoricBySku(
  lines: HistoricLineRow[],
): Map<string, { agg: MutableLineAgg; sku: string; desc: string | null }> {
  const map = new Map<string, { agg: MutableLineAgg; sku: string; desc: string | null }>();
  for (const line of lines) {
    const key = line.sku.trim().toUpperCase();
    let entry = map.get(key);
    if (!entry) {
      entry = {
        agg: createLineAgg(),
        sku: line.sku.trim(),
        desc: line.descriptionSnapshot?.trim() || null,
      };
      map.set(key, entry);
    }
    const dateIso = line.document?.documentDate
      ? dateOnlyIsoFromDate(line.document.documentDate)
      : null;
    accumulateLine(entry.agg, line, dateIso);
    if (!entry.desc && line.descriptionSnapshot?.trim()) {
      entry.desc = line.descriptionSnapshot.trim();
    }
  }
  return map;
}

export function groupHistoricByCompany(lines: HistoricLineRow[]): Map<string, MutableLineAgg> {
  const map = new Map<string, MutableLineAgg>();
  for (const line of lines) {
    let agg = map.get(line.companyId);
    if (!agg) {
      agg = createLineAgg();
      map.set(line.companyId, agg);
    }
    const dateIso = line.document?.documentDate
      ? dateOnlyIsoFromDate(line.document.documentDate)
      : null;
    accumulateLine(agg, line, dateIso);
  }
  return map;
}
