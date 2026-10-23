/**
 * Shared Autopart historic sales line loaders for Sales Enquiry + Gap Analysis.
 * Single source of period filtering so figures reconcile across modules.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { dateOnlyIsoFromDate, type DateOnlyRange } from "@/domain/sales-history-period";
import { countedSalesLinesCte } from "@/server/sales-intelligence/counted-sales-lines";
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

function countedArgs(args: {
  companyId?: string | { in: string[] } | undefined;
  sku?: { equals: string; mode: "insensitive" } | undefined;
  range: DateOnlyRange;
}) {
  return {
    ...(args.companyId != null ? { companyId: args.companyId } : {}),
    ...(args.sku ? { skuEquals: args.sku.equals } : {}),
    range: args.range,
  };
}

export async function countHistoricSalesLines(args: {
  companyId?: string | { in: string[] } | undefined;
  sku?: { equals: string; mode: "insensitive" } | undefined;
  range: DateOnlyRange;
}): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    ${countedSalesLinesCte(countedArgs(args))}
    SELECT COUNT(*)::bigint AS count FROM counted_sales_lines
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function loadHistoricSalesLines(args: {
  companyId?: string | { in: string[] } | undefined;
  sku?: { equals: string; mode: "insensitive" } | undefined;
  range: DateOnlyRange;
}): Promise<HistoricLineRow[]> {
  // Per-customer 561L product lines and ongoing TRM21QC lines. Payments are not
  // lines. A repeated invoice is counted once. Undated rows keep a null date.
  const rows = await prisma.$queryRaw<
    Array<{
      companyId: string;
      autopartCustomerCode: string;
      sku: string;
      units: Prisma.Decimal;
      salesNet: Prisma.Decimal;
      descriptionSnapshot: string | null;
      documentType: string;
      documentReference: string;
      documentDate: Date | null;
    }>
  >`
    ${countedSalesLinesCte(countedArgs(args))}
    SELECT
      company_id AS "companyId",
      account_code AS "autopartCustomerCode",
      sku,
      units,
      sales_net AS "salesNet",
      description AS "descriptionSnapshot",
      doc_type AS "documentType",
      document_reference AS "documentReference",
      doc_date AS "documentDate"
    FROM counted_sales_lines
  `;
  return rows.map((row) => ({
    companyId: row.companyId,
    autopartCustomerCode: row.autopartCustomerCode,
    sku: row.sku,
    units: row.units,
    salesNet: row.salesNet,
    descriptionSnapshot: row.descriptionSnapshot,
    documentType: row.documentType,
    documentReference: row.documentReference,
    document: { documentDate: row.documentDate },
  }));
}

/**
 * Summary cards without loading every line — safe after large historic imports.
 */
export async function summarizeHistoricSalesFromDb(args: {
  companyId?: string | { in: string[] } | undefined;
  sku?: { equals: string; mode: "insensitive" } | undefined;
  range: DateOnlyRange;
}): Promise<SalesMoneyTotals> {
  const rows = await prisma.$queryRaw<
    Array<{
      net: Prisma.Decimal;
      units: Prisma.Decimal;
      invoiceSales: Prisma.Decimal;
      credits: Prisma.Decimal;
      purchaseTransactions: bigint;
      products: bigint;
      customers: bigint;
    }>
  >`
    ${countedSalesLinesCte(countedArgs(args))}
    SELECT
      COALESCE(SUM(sales_net), 0) AS net,
      COALESCE(SUM(units), 0) AS units,
      COALESCE(SUM(sales_net) FILTER (WHERE doc_type = 'INVOICE'), 0) AS "invoiceSales",
      COALESCE(SUM(sales_net) FILTER (WHERE doc_type = 'CREDIT'), 0) AS credits,
      COUNT(DISTINCT CASE WHEN doc_type = 'INVOICE' THEN company_id || ':' || document_reference END)::bigint AS "purchaseTransactions",
      COUNT(DISTINCT sku_key)::bigint AS products,
      COUNT(DISTINCT company_id)::bigint AS customers
    FROM counted_sales_lines
  `;
  const row = rows[0];
  const totals = emptySalesTotals();
  totals.units = Number(row?.units ?? 0);
  totals.netSalesMinor = parseSalesNetMinor(row?.net);
  totals.invoiceSalesMinor = parseSalesNetMinor(row?.invoiceSales);
  totals.creditsMinor = parseSalesNetMinor(row?.credits);
  totals.purchaseTransactions = Number(row?.purchaseTransactions ?? 0);
  totals.productsPurchased = Number(row?.products ?? 0);
  totals.customers = Number(row?.customers ?? 0);
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
