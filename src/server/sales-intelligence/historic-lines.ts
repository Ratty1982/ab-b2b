/**
 * Shared Autopart historic sales line loaders for Sales Enquiry + Gap Analysis.
 * Single source of period filtering so figures reconcile across modules.
 */
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

export async function loadHistoricSalesLines(args: {
  companyId?: string | { in: string[] } | undefined;
  sku?: { equals: string; mode: "insensitive" } | undefined;
  range: DateOnlyRange;
}): Promise<HistoricLineRow[]> {
  const bounds = documentDatePrismaBounds(args.range);
  // Realised Autopart sales only (historic 561L/SLRB + ongoing 504/TRM21QC).
  // Excludes unmapped documents (null company) and never merges AB Order lines —
  // AB Orders remain operational; Autopart invoice/credit lines are authoritative realised sales.
  return prisma.autopartSalesLine.findMany({
    where: {
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
    },
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
