/**
 * Sales Intelligence — factual Gap Analysis classification.
 *
 * Presence = invoice purchase activity (invoice refs / invoice units).
 * Credits affect financial/unit totals but never create purchase presence alone.
 */
import {
  hasInvoicePurchase,
  moneyMinorToDto,
  percentChange,
  percentChangeMinor,
  resolveEnquiryComparisonPeriod,
  resolveEnquiryPrimaryPeriod,
  type MutableLineAgg,
} from "@/domain/sales-intelligence";
import type { DateOnlyRange } from "@/domain/sales-history-period";

export type GapStatus = "STOPPED" | "NEW" | "DECREASED" | "INCREASED" | "UNCHANGED";

export type GapCompareBy = "UNITS" | "NET_SALES";

export type GapPeriodActivity = {
  invoiceUnits: number;
  creditUnits: number;
  netUnits: number;
  invoiceSalesMinor: bigint;
  creditsMinor: bigint;
  netSalesMinor: bigint;
  purchaseTransactions: number;
  lastInvoiceDate: string | null;
  hasInvoicePurchase: boolean;
};

export function activityFromAgg(agg: MutableLineAgg): GapPeriodActivity {
  return {
    invoiceUnits: agg.invoiceUnits,
    creditUnits: agg.creditUnits,
    netUnits: agg.units,
    invoiceSalesMinor: agg.invoiceSalesMinor,
    creditsMinor: agg.creditsMinor,
    netSalesMinor: agg.netSalesMinor,
    purchaseTransactions: agg.invoiceRefs.size,
    lastInvoiceDate: agg.lastPurchasedDate,
    hasInvoicePurchase: hasInvoicePurchase(agg),
  };
}

export function emptyGapActivity(): GapPeriodActivity {
  return {
    invoiceUnits: 0,
    creditUnits: 0,
    netUnits: 0,
    invoiceSalesMinor: 0n,
    creditsMinor: 0n,
    netSalesMinor: 0n,
    purchaseTransactions: 0,
    lastInvoiceDate: null,
    hasInvoicePurchase: false,
  };
}

/**
 * Classify a SKU/customer pair across two periods.
 * STOPPED/NEW use invoice presence only.
 * INCREASED/DECREASED/UNCHANGED require presence in both; metric defaults to units.
 * Returns null when neither period has invoice purchase activity (credits-only ignored).
 */
export function classifyGapActivity(
  selected: GapPeriodActivity,
  comparison: GapPeriodActivity,
  compareBy: GapCompareBy = "UNITS",
): GapStatus | null {
  const sel = selected.hasInvoicePurchase;
  const cmp = comparison.hasInvoicePurchase;
  if (!sel && !cmp) return null;
  if (cmp && !sel) return "STOPPED";
  if (!cmp && sel) return "NEW";
  const delta = compareMetric(selected, comparison, compareBy);
  if (delta < 0) return "DECREASED";
  if (delta > 0) return "INCREASED";
  return "UNCHANGED";
}

function compareMetric(
  selected: GapPeriodActivity,
  comparison: GapPeriodActivity,
  compareBy: GapCompareBy,
): number {
  if (compareBy === "NET_SALES") {
    const d = selected.netSalesMinor - comparison.netSalesMinor;
    if (d < 0n) return -1;
    if (d > 0n) return 1;
    return 0;
  }
  // Default: invoice units for volume comparison when both have presence;
  // fall back to net units if invoice units tied but signed units differ? Spec says UNITS PURCHASED.
  // Use invoice units as the classification metric for INCREASED/DECREASED.
  return selected.invoiceUnits - comparison.invoiceUnits;
}

export type GapMovementDto = {
  selected: string | number;
  comparison: string | number;
  change: string | number;
  percentChange: number | null;
};

export function moneyMovement(
  selectedMinor: bigint,
  comparisonMinor: bigint,
): GapMovementDto {
  return {
    selected: moneyMinorToDto(selectedMinor),
    comparison: moneyMinorToDto(comparisonMinor),
    change: moneyMinorToDto(selectedMinor - comparisonMinor),
    percentChange: percentChangeMinor(selectedMinor, comparisonMinor),
  };
}

export function unitsMovement(selected: number, comparison: number): GapMovementDto {
  return {
    selected,
    comparison,
    change: selected - comparison,
    percentChange: percentChange(selected, comparison),
  };
}

export type GapStatusCounts = {
  stopped: number;
  decreased: number;
  increased: number;
  new: number;
  unchanged: number;
};

export function emptyStatusCounts(): GapStatusCounts {
  return { stopped: 0, decreased: 0, increased: 0, new: 0, unchanged: 0 };
}

export function bumpStatus(counts: GapStatusCounts, status: GapStatus): void {
  if (status === "STOPPED") counts.stopped += 1;
  else if (status === "DECREASED") counts.decreased += 1;
  else if (status === "INCREASED") counts.increased += 1;
  else if (status === "NEW") counts.new += 1;
  else counts.unchanged += 1;
}

export type GapCompareMode = "PREVIOUS" | "PREVIOUS_YEAR" | "CUSTOM";

export type GapUrlSearch = {
  mode?: "customers" | "products";
  companyId?: string;
  sku?: string;
  period?: string;
  from?: string;
  to?: string;
  compare?: GapCompareMode;
  compareFrom?: string;
  compareTo?: string;
  compareBy?: GapCompareBy;
  status?: string;
  brandId?: string;
  categoryId?: string;
  salesRepId?: string;
  q?: string;
  sort?: string;
  page?: number;
};

const PERIODS = new Set([
  "THIS_MONTH",
  "LAST_MONTH",
  "LAST_30",
  "LAST_90",
  "LAST_180",
  "YTD",
  "LAST_YEAR",
  "CUSTOM",
]);
const COMPARES = new Set<GapCompareMode>(["PREVIOUS", "PREVIOUS_YEAR", "CUSTOM"]);
const STATUSES = new Set([
  "ALL_CHANGES",
  "STOPPED",
  "DECREASED",
  "INCREASED",
  "NEW",
  "UNCHANGED",
]);

export function parseGapUrlSearch(search: Record<string, unknown>): GapUrlSearch {
  const out: GapUrlSearch = {};
  if (search["mode"] === "products" || search["mode"] === "customers") out.mode = search["mode"];
  if (typeof search["companyId"] === "string" && search["companyId"]) out.companyId = search["companyId"];
  if (typeof search["sku"] === "string" && search["sku"].trim()) out.sku = search["sku"].trim();
  if (typeof search["period"] === "string" && PERIODS.has(search["period"])) out.period = search["period"];
  if (typeof search["from"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["from"])) out.from = search["from"];
  if (typeof search["to"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["to"])) out.to = search["to"];
  if (typeof search["compare"] === "string" && COMPARES.has(search["compare"] as GapCompareMode)) {
    out.compare = search["compare"] as GapCompareMode;
  }
  if (typeof search["compareFrom"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["compareFrom"])) {
    out.compareFrom = search["compareFrom"];
  }
  if (typeof search["compareTo"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["compareTo"])) {
    out.compareTo = search["compareTo"];
  }
  if (search["compareBy"] === "UNITS" || search["compareBy"] === "NET_SALES") {
    out.compareBy = search["compareBy"];
  }
  if (typeof search["status"] === "string" && STATUSES.has(search["status"])) out.status = search["status"];
  if (typeof search["brandId"] === "string" && search["brandId"]) out.brandId = search["brandId"];
  if (typeof search["categoryId"] === "string" && search["categoryId"]) out.categoryId = search["categoryId"];
  if (typeof search["salesRepId"] === "string" && search["salesRepId"]) out.salesRepId = search["salesRepId"];
  if (typeof search["q"] === "string" && search["q"].trim()) out.q = search["q"].trim().slice(0, 200);
  if (typeof search["sort"] === "string" && search["sort"]) out.sort = search["sort"];
  const page = search["page"];
  const pageNum = typeof page === "number" ? page : typeof page === "string" ? Number(page) : NaN;
  if (Number.isInteger(pageNum) && pageNum >= 2) out.page = pageNum;
  return out;
}

export function compactGapUrlSearch(search: GapUrlSearch): GapUrlSearch {
  const out: GapUrlSearch = {};
  if (search.mode && search.mode !== "customers") out.mode = search.mode;
  if (search.companyId) out.companyId = search.companyId;
  if (search.sku) out.sku = search.sku;
  if (search.period && search.period !== "LAST_30") out.period = search.period;
  if (search.period === "CUSTOM" || search.from || search.to) {
    if (search.from) out.from = search.from;
    if (search.to) out.to = search.to;
  }
  if (search.compare && search.compare !== "PREVIOUS") out.compare = search.compare;
  if (search.compare === "CUSTOM") {
    if (search.compareFrom) out.compareFrom = search.compareFrom;
    if (search.compareTo) out.compareTo = search.compareTo;
  }
  if (search.compareBy && search.compareBy !== "UNITS") out.compareBy = search.compareBy;
  if (search.status && search.status !== "ALL_CHANGES") out.status = search.status;
  if (search.brandId) out.brandId = search.brandId;
  if (search.categoryId) out.categoryId = search.categoryId;
  if (search.salesRepId) out.salesRepId = search.salesRepId;
  if (search.q) out.q = search.q;
  if (search.sort && search.sort !== "NET_DECREASE") out.sort = search.sort;
  if (search.page && search.page > 1) out.page = search.page;
  return out;
}

export type GapRowSort =
  | "NET_DECREASE"
  | "UNIT_DECREASE"
  | "NET_INCREASE"
  | "UNIT_INCREASE"
  | "RECENT"
  | "NAME_AZ";

export function resolveGapPeriods(input: {
  period?: string | null | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
  compare?: GapCompareMode | null | undefined;
  compareFrom?: string | null | undefined;
  compareTo?: string | null | undefined;
  today?: string;
}): { selected: DateOnlyRange; comparison: DateOnlyRange } {
  const period = (input.period as never) ?? "LAST_30";
  const selected = resolveEnquiryPrimaryPeriod({
    period,
    from: input.from,
    to: input.to,
    today: input.today,
  });
  const comparison =
    resolveEnquiryComparisonPeriod({
      compare: input.compare ?? "PREVIOUS",
      primary: selected,
      period,
      compareFrom: input.compareFrom,
      compareTo: input.compareTo,
    }) ??
    resolveEnquiryComparisonPeriod({ compare: "PREVIOUS", primary: selected, period })!;
  return { selected, comparison };
}
