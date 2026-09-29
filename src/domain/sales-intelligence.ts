/**
 * Sales Intelligence — domain definitions for internal Sales Enquiry.
 *
 * Source of truth for invoiced sales: AutopartSalesDocument + AutopartSalesLine
 * (561L lines + SLRB document dates). AB Orders and 504C are excluded from
 * Invoice Sales / Credits / Net Sales.
 */

import type { DateOnlyRange, SalesEnquiryPeriodPreset } from "@/domain/sales-history-period";
import {
  isDateOnlyIso,
  previousEquivalentPeriod,
  resolveSalesEnquiryPeriod,
  samePeriodPreviousYear,
  todayLondonDateOnly,
} from "@/domain/sales-history-period";
import { moneyToString, moneyZero, parseMoney, type Money } from "@/domain/money";

export type SalesEnquiryMode = "customers" | "products";

export type SalesEnquiryCompareMode = "OFF" | "PREVIOUS" | "PREVIOUS_YEAR" | "CUSTOM";

export type CustomerProductSort =
  | "NET_SALES"
  | "QTY"
  | "PURCHASES"
  | "RECENT"
  | "NAME_AZ";

export type ProductCustomerSort =
  | "NET_SALES"
  | "QTY"
  | "PURCHASES"
  | "RECENT"
  | "NAME_AZ";

/** Auditable period totals — foundation for later rebate/net-spend reporting. */
export type SalesMoneyTotals = {
  /** Sum of INVOICE line salesNet in period (positive). */
  invoiceSalesMinor: bigint;
  /** Sum of CREDIT line salesNet in period (typically negative / signed). */
  creditsMinor: bigint;
  /** invoiceSalesMinor + creditsMinor. */
  netSalesMinor: bigint;
  /** Signed net units. */
  units: number;
  /** Distinct INVOICE document references (credits never count). */
  purchaseTransactions: number;
  /** Distinct SKUs with at least one qualifying line. */
  productsPurchased: number;
  /** Distinct companies with at least one qualifying line (product enquiry). */
  customers: number;
};

export type SalesMoneyTotalsDto = {
  invoiceSales: string;
  credits: string;
  netSales: string;
  units: number;
  purchaseTransactions: number;
  productsPurchased: number;
  customers: number;
};

export type PeriodComparisonMetric = {
  primary: string;
  comparison: string;
  difference: string;
  percentChange: number | null;
};

export type PeriodComparisonDto = {
  primary: DateOnlyRange;
  comparison: DateOnlyRange;
  invoiceSales: PeriodComparisonMetric;
  credits: PeriodComparisonMetric;
  netSales: PeriodComparisonMetric;
  units: {
    primary: number;
    comparison: number;
    difference: number;
    percentChange: number | null;
  };
  purchaseTransactions: {
    primary: number;
    comparison: number;
    difference: number;
    percentChange: number | null;
  };
  productsPurchased: {
    primary: number;
    comparison: number;
    difference: number;
    percentChange: number | null;
  };
  customers: {
    primary: number;
    comparison: number;
    difference: number;
    percentChange: number | null;
  };
};

export function emptySalesTotals(): SalesMoneyTotals {
  return {
    invoiceSalesMinor: 0n,
    creditsMinor: 0n,
    netSalesMinor: 0n,
    units: 0,
    purchaseTransactions: 0,
    productsPurchased: 0,
    customers: 0,
  };
}

export function moneyMinorToDto(minor: bigint, places = 2): string {
  return moneyToString({ minor }, places);
}

export function parseSalesNetMinor(value: unknown): bigint {
  const m = parseMoney(String(value ?? 0)) ?? moneyZero();
  return m.minor;
}

export function totalsToDto(t: SalesMoneyTotals): SalesMoneyTotalsDto {
  return {
    invoiceSales: moneyMinorToDto(t.invoiceSalesMinor),
    credits: moneyMinorToDto(t.creditsMinor),
    netSales: moneyMinorToDto(t.netSalesMinor),
    units: t.units,
    purchaseTransactions: t.purchaseTransactions,
    productsPurchased: t.productsPurchased,
    customers: t.customers,
  };
}

/** Percent change; null when base is 0 (avoid Infinity). */
export function percentChange(primary: number, comparison: number): number | null {
  if (comparison === 0) return null;
  return ((primary - comparison) / Math.abs(comparison)) * 100;
}

export function percentChangeMinor(primary: bigint, comparison: bigint): number | null {
  if (comparison === 0n) return null;
  const absBase = comparison < 0n ? -comparison : comparison;
  // (delta * 10000 / base) / 100 → 2dp number
  const delta = primary - comparison;
  const bps = (delta * 10000n) / absBase;
  return Number(bps) / 100;
}

function moneyMetric(primary: bigint, comparison: bigint): PeriodComparisonMetric {
  return {
    primary: moneyMinorToDto(primary),
    comparison: moneyMinorToDto(comparison),
    difference: moneyMinorToDto(primary - comparison),
    percentChange: percentChangeMinor(primary, comparison),
  };
}

function countMetric(primary: number, comparison: number) {
  return {
    primary,
    comparison,
    difference: primary - comparison,
    percentChange: percentChange(primary, comparison),
  };
}

export function compareSalesTotals(
  primaryRange: DateOnlyRange,
  comparisonRange: DateOnlyRange,
  primary: SalesMoneyTotals,
  comparison: SalesMoneyTotals,
): PeriodComparisonDto {
  return {
    primary: primaryRange,
    comparison: comparisonRange,
    invoiceSales: moneyMetric(primary.invoiceSalesMinor, comparison.invoiceSalesMinor),
    credits: moneyMetric(primary.creditsMinor, comparison.creditsMinor),
    netSales: moneyMetric(primary.netSalesMinor, comparison.netSalesMinor),
    units: countMetric(primary.units, comparison.units),
    purchaseTransactions: countMetric(primary.purchaseTransactions, comparison.purchaseTransactions),
    productsPurchased: countMetric(primary.productsPurchased, comparison.productsPurchased),
    customers: countMetric(primary.customers, comparison.customers),
  };
}

export type SalesEnquiryUrlSearch = {
  mode?: SalesEnquiryMode;
  companyId?: string;
  sku?: string;
  period?: SalesEnquiryPeriodPreset;
  from?: string;
  to?: string;
  compare?: SalesEnquiryCompareMode;
  compareFrom?: string;
  compareTo?: string;
  q?: string;
  brandId?: string;
  categoryId?: string;
  salesRepId?: string;
  sort?: string;
  page?: number;
  txPage?: number;
};

const PERIODS = new Set<SalesEnquiryPeriodPreset>([
  "THIS_MONTH",
  "LAST_MONTH",
  "LAST_30",
  "LAST_90",
  "LAST_180",
  "YTD",
  "LAST_YEAR",
  "CUSTOM",
]);

export function parseSalesEnquiryUrlSearch(
  search: Record<string, unknown>,
): SalesEnquiryUrlSearch {
  const out: SalesEnquiryUrlSearch = {};
  if (search["mode"] === "products" || search["mode"] === "customers") {
    out.mode = search["mode"];
  }
  if (typeof search["companyId"] === "string" && search["companyId"]) {
    out.companyId = search["companyId"];
  }
  if (typeof search["sku"] === "string" && search["sku"].trim()) {
    out.sku = search["sku"].trim();
  }
  const period = search["period"];
  if (typeof period === "string" && PERIODS.has(period as SalesEnquiryPeriodPreset)) {
    out.period = period as SalesEnquiryPeriodPreset;
  }
  if (typeof search["from"] === "string" && isDateOnlyIso(search["from"])) out.from = search["from"];
  if (typeof search["to"] === "string" && isDateOnlyIso(search["to"])) out.to = search["to"];
  if (
    search["compare"] === "PREVIOUS" ||
    search["compare"] === "PREVIOUS_YEAR" ||
    search["compare"] === "CUSTOM" ||
    search["compare"] === "OFF"
  ) {
    out.compare = search["compare"];
  }
  if (typeof search["compareFrom"] === "string" && isDateOnlyIso(search["compareFrom"])) {
    out.compareFrom = search["compareFrom"];
  }
  if (typeof search["compareTo"] === "string" && isDateOnlyIso(search["compareTo"])) {
    out.compareTo = search["compareTo"];
  }
  if (typeof search["q"] === "string" && search["q"].trim()) out.q = search["q"].trim().slice(0, 200);
  if (typeof search["brandId"] === "string" && search["brandId"]) out.brandId = search["brandId"];
  if (typeof search["categoryId"] === "string" && search["categoryId"]) {
    out.categoryId = search["categoryId"];
  }
  if (typeof search["salesRepId"] === "string" && search["salesRepId"]) {
    out.salesRepId = search["salesRepId"];
  }
  if (typeof search["sort"] === "string" && search["sort"]) out.sort = search["sort"];
  const page = search["page"];
  const pageNum = typeof page === "number" ? page : typeof page === "string" ? Number(page) : NaN;
  if (Number.isInteger(pageNum) && pageNum >= 2) out.page = pageNum;
  const txPage = search["txPage"];
  const txNum = typeof txPage === "number" ? txPage : typeof txPage === "string" ? Number(txPage) : NaN;
  if (Number.isInteger(txNum) && txNum >= 2) out.txPage = txNum;
  return out;
}

export function compactSalesEnquiryUrlSearch(search: SalesEnquiryUrlSearch): SalesEnquiryUrlSearch {
  const out: SalesEnquiryUrlSearch = {};
  if (search.mode && search.mode !== "customers") out.mode = search.mode;
  if (search.companyId) out.companyId = search.companyId;
  if (search.sku) out.sku = search.sku;
  if (search.period && search.period !== "LAST_30") out.period = search.period;
  if (search.period === "CUSTOM" || search.from) {
    if (search.from) out.from = search.from;
    if (search.to) out.to = search.to;
  }
  if (search.compare && search.compare !== "OFF") out.compare = search.compare;
  if (search.compare === "CUSTOM") {
    if (search.compareFrom) out.compareFrom = search.compareFrom;
    if (search.compareTo) out.compareTo = search.compareTo;
  }
  if (search.q) out.q = search.q;
  if (search.brandId) out.brandId = search.brandId;
  if (search.categoryId) out.categoryId = search.categoryId;
  if (search.salesRepId) out.salesRepId = search.salesRepId;
  if (search.sort && search.sort !== "NET_SALES") out.sort = search.sort;
  if (search.page && search.page > 1) out.page = search.page;
  if (search.txPage && search.txPage > 1) out.txPage = search.txPage;
  return out;
}

export function resolveEnquiryPrimaryPeriod(input: {
  period?: SalesEnquiryPeriodPreset | null | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
  today?: string | undefined;
}): DateOnlyRange {
  const today = input.today ?? todayLondonDateOnly();
  const preset = input.period ?? "LAST_30";
  return (
    resolveSalesEnquiryPeriod(preset, input.from, input.to, today) ?? lastNDaysFallback(today)
  );
}

function lastNDaysFallback(today: string): DateOnlyRange {
  return resolveSalesEnquiryPeriod("LAST_30", null, null, today)!;
}

export function resolveEnquiryComparisonPeriod(input: {
  compare?: SalesEnquiryCompareMode | null | undefined;
  primary: DateOnlyRange;
  compareFrom?: string | null | undefined;
  compareTo?: string | null | undefined;
}): DateOnlyRange | null {
  if (!input.compare || input.compare === "OFF") return null;
  if (input.compare === "PREVIOUS") return previousEquivalentPeriod(input.primary);
  if (input.compare === "PREVIOUS_YEAR") return samePeriodPreviousYear(input.primary);
  if (input.compare === "CUSTOM") {
    if (!input.compareFrom && !input.compareTo) return null;
    return {
      from: input.compareFrom && isDateOnlyIso(input.compareFrom) ? input.compareFrom : "0001-01-01",
      to: input.compareTo && isDateOnlyIso(input.compareTo) ? input.compareTo : "9999-12-31",
    };
  }
  return null;
}

/** Escape a CSV cell (RFC-style quotes). */
export function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export type LineAggInput = {
  documentType: string;
  documentReference: string;
  units: unknown;
  salesNet: unknown;
  sku: string;
  documentDate?: Date | null;
};

export type MutableLineAgg = {
  invoiceSalesMinor: bigint;
  creditsMinor: bigint;
  netSalesMinor: bigint;
  units: number;
  /** Invoice line units only — used for purchase presence / gap volume. */
  invoiceUnits: number;
  creditUnits: number;
  invoiceRefs: Set<string>;
  lastPurchasedDate: string | null;
  firstPurchasedDate: string | null;
};

export function createLineAgg(): MutableLineAgg {
  return {
    invoiceSalesMinor: 0n,
    creditsMinor: 0n,
    netSalesMinor: 0n,
    units: 0,
    invoiceUnits: 0,
    creditUnits: 0,
    invoiceRefs: new Set(),
    lastPurchasedDate: null,
    firstPurchasedDate: null,
  };
}

export function accumulateLine(agg: MutableLineAgg, line: LineAggInput, dateIso: string | null): void {
  const units = Number(line.units ?? 0);
  const spend = parseSalesNetMinor(line.salesNet);
  agg.units += units;
  agg.netSalesMinor += spend;
  if (line.documentType === "INVOICE") {
    agg.invoiceSalesMinor += spend;
    agg.invoiceUnits += units;
    agg.invoiceRefs.add(line.documentReference);
    if (dateIso) {
      if (!agg.firstPurchasedDate || dateIso < agg.firstPurchasedDate) agg.firstPurchasedDate = dateIso;
      if (!agg.lastPurchasedDate || dateIso > agg.lastPurchasedDate) agg.lastPurchasedDate = dateIso;
    }
  } else if (line.documentType === "CREDIT") {
    agg.creditsMinor += spend;
    agg.creditUnits += units;
  }
}

/** Invoice purchase presence — credits alone never create presence. */
export function hasInvoicePurchase(agg: Pick<MutableLineAgg, "invoiceRefs" | "invoiceUnits">): boolean {
  return agg.invoiceRefs.size > 0 || agg.invoiceUnits !== 0;
}

export function lineAggPurchaseCount(agg: MutableLineAgg): number {
  return agg.invoiceRefs.size;
}

/** Format money for staff UI (£x,xxx.xx). */
export function formatGbp(minorOrDecimal: string | Money): string {
  const s = typeof minorOrDecimal === "string" ? minorOrDecimal : moneyToString(minorOrDecimal, 2);
  const n = Number(s);
  if (!Number.isFinite(n)) return `£${s}`;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}
