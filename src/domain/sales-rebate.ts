/**
 * Sales Intelligence — Rebate / Net Spend Analysis domain helpers.
 *
 * Net Spend uses the same Invoice Sales + Credits calculation as Sales Enquiry
 * Net Sales. No rebate eligibility schemes are applied in Phase 4.
 */
import {
  resolveRebatePeriod,
  todayLondonDateOnly,
  type DateOnlyRange,
  type RebatePeriodPreset,
} from "@/domain/sales-history-period";
import {
  resolveEnquiryComparisonPeriod,
  type SalesEnquiryCompareMode,
} from "@/domain/sales-intelligence";

export type RebateMode = "customer" | "multi";

export type RebateTab = "documents" | "products" | "brands" | "categories";

export type RebateDocTypeFilter = "ALL" | "INVOICE" | "CREDIT";

export type RebateCatalogueFilter = "ALL" | "CATALOGUE" | "HISTORIC";

export type RebateCustomerSort =
  | "NET_DESC"
  | "NET_ASC"
  | "INVOICE_DESC"
  | "CREDITS_DESC"
  | "NAME_AZ";

export type RebateUrlSearch = {
  mode?: RebateMode;
  companyId?: string;
  period?: RebatePeriodPreset;
  from?: string;
  to?: string;
  compare?: SalesEnquiryCompareMode;
  compareFrom?: string;
  compareTo?: string;
  tab?: RebateTab;
  docType?: RebateDocTypeFilter;
  brandId?: string;
  categoryId?: string;
  catalogue?: RebateCatalogueFilter;
  q?: string;
  salesRepId?: string;
  minNet?: string;
  maxNet?: string;
  sort?: RebateCustomerSort;
  page?: number;
  docPage?: number;
  /** Expanded document reference for drilldown. */
  docRef?: string;
};

const PERIODS = new Set<RebatePeriodPreset>([
  "THIS_MONTH",
  "LAST_MONTH",
  "THIS_QUARTER",
  "PREVIOUS_QUARTER",
  "YTD",
  "LAST_YEAR",
  "LAST_90",
  "LAST_180",
  "LAST_365",
  "CUSTOM",
]);
const COMPARES = new Set(["OFF", "PREVIOUS", "PREVIOUS_YEAR", "CUSTOM"]);
const TABS = new Set(["documents", "products", "brands", "categories"]);
const DOC_TYPES = new Set(["ALL", "INVOICE", "CREDIT"]);
const CATS = new Set(["ALL", "CATALOGUE", "HISTORIC"]);
const SORTS = new Set(["NET_DESC", "NET_ASC", "INVOICE_DESC", "CREDITS_DESC", "NAME_AZ"]);

export function resolveRebatePrimaryPeriod(input: {
  period?: RebatePeriodPreset | null | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
  today?: string;
}): DateOnlyRange {
  const today = input.today ?? todayLondonDateOnly();
  const preset = input.period ?? "CUSTOM";
  return (
    resolveRebatePeriod(preset, input.from, input.to, today) ?? {
      from: input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? input.from : "0001-01-01",
      to: input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? input.to : "9999-12-31",
    }
  );
}

export function resolveRebateComparisonPeriod(input: {
  compare?: SalesEnquiryCompareMode | null | undefined;
  primary: DateOnlyRange;
  compareFrom?: string | null | undefined;
  compareTo?: string | null | undefined;
}): DateOnlyRange | null {
  return resolveEnquiryComparisonPeriod({
    compare: input.compare ?? "OFF",
    primary: input.primary,
    compareFrom: input.compareFrom,
    compareTo: input.compareTo,
  });
}

export function parseRebateUrlSearch(search: Record<string, unknown>): RebateUrlSearch {
  const out: RebateUrlSearch = {};
  if (search["mode"] === "multi" || search["mode"] === "customer") out.mode = search["mode"];
  if (typeof search["companyId"] === "string" && search["companyId"]) out.companyId = search["companyId"];
  if (typeof search["period"] === "string" && PERIODS.has(search["period"] as RebatePeriodPreset)) {
    out.period = search["period"] as RebatePeriodPreset;
  }
  if (typeof search["from"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["from"])) {
    out.from = search["from"];
  }
  if (typeof search["to"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["to"])) {
    out.to = search["to"];
  }
  if (typeof search["compare"] === "string" && COMPARES.has(search["compare"])) {
    out.compare = search["compare"] as SalesEnquiryCompareMode;
  }
  if (typeof search["compareFrom"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["compareFrom"])) {
    out.compareFrom = search["compareFrom"];
  }
  if (typeof search["compareTo"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["compareTo"])) {
    out.compareTo = search["compareTo"];
  }
  if (typeof search["tab"] === "string" && TABS.has(search["tab"])) out.tab = search["tab"] as RebateTab;
  if (typeof search["docType"] === "string" && DOC_TYPES.has(search["docType"])) {
    out.docType = search["docType"] as RebateDocTypeFilter;
  }
  if (typeof search["brandId"] === "string" && search["brandId"]) out.brandId = search["brandId"];
  if (typeof search["categoryId"] === "string" && search["categoryId"]) {
    out.categoryId = search["categoryId"];
  }
  if (typeof search["catalogue"] === "string" && CATS.has(search["catalogue"])) {
    out.catalogue = search["catalogue"] as RebateCatalogueFilter;
  }
  if (typeof search["q"] === "string" && search["q"].trim()) out.q = search["q"].trim().slice(0, 200);
  if (typeof search["salesRepId"] === "string" && search["salesRepId"]) {
    out.salesRepId = search["salesRepId"];
  }
  if (typeof search["minNet"] === "string" && /^-?\d+(\.\d+)?$/.test(search["minNet"])) {
    out.minNet = search["minNet"];
  }
  if (typeof search["maxNet"] === "string" && /^-?\d+(\.\d+)?$/.test(search["maxNet"])) {
    out.maxNet = search["maxNet"];
  }
  if (typeof search["sort"] === "string" && SORTS.has(search["sort"])) {
    out.sort = search["sort"] as RebateCustomerSort;
  }
  const page = search["page"];
  const pageNum = typeof page === "number" ? page : typeof page === "string" ? Number(page) : NaN;
  if (Number.isInteger(pageNum) && pageNum >= 2) out.page = pageNum;
  const docPage = search["docPage"];
  const docPageNum =
    typeof docPage === "number" ? docPage : typeof docPage === "string" ? Number(docPage) : NaN;
  if (Number.isInteger(docPageNum) && docPageNum >= 2) out.docPage = docPageNum;
  if (typeof search["docRef"] === "string" && search["docRef"].trim()) {
    out.docRef = search["docRef"].trim().slice(0, 120);
  }
  return out;
}

export function compactRebateUrlSearch(search: RebateUrlSearch): RebateUrlSearch {
  const out: RebateUrlSearch = {};
  if (search.mode && search.mode !== "customer") out.mode = search.mode;
  if (search.companyId) out.companyId = search.companyId;
  if (search.period && search.period !== "CUSTOM") out.period = search.period;
  if (search.period === "CUSTOM" || search.from || search.to) {
    if (search.from) out.from = search.from;
    if (search.to) out.to = search.to;
  }
  if (search.compare && search.compare !== "OFF") out.compare = search.compare;
  if (search.compare === "CUSTOM") {
    if (search.compareFrom) out.compareFrom = search.compareFrom;
    if (search.compareTo) out.compareTo = search.compareTo;
  }
  if (search.tab && search.tab !== "documents") out.tab = search.tab;
  if (search.docType && search.docType !== "ALL") out.docType = search.docType;
  if (search.brandId) out.brandId = search.brandId;
  if (search.categoryId) out.categoryId = search.categoryId;
  if (search.catalogue && search.catalogue !== "ALL") out.catalogue = search.catalogue;
  if (search.q) out.q = search.q;
  if (search.salesRepId) out.salesRepId = search.salesRepId;
  if (search.minNet) out.minNet = search.minNet;
  if (search.maxNet) out.maxNet = search.maxNet;
  if (search.sort && search.sort !== "NET_DESC") out.sort = search.sort;
  if (search.page && search.page > 1) out.page = search.page;
  if (search.docPage && search.docPage > 1) out.docPage = search.docPage;
  if (search.docRef) out.docRef = search.docRef;
  return out;
}

/**
 * Future extension point — Phase 4 applies no eligibility rules.
 * Later schemes may filter lines by brand/category/SKU/date before summing.
 */
export type RebateEligibilityRules = {
  /** Reserved for future brand include/exclude lists. */
  includeBrandIds?: string[];
  excludeBrandIds?: string[];
  includeCategoryIds?: string[];
  excludeCategoryIds?: string[];
  includeSkus?: string[];
  excludeSkus?: string[];
};

/** Phase 4: identity — qualifying lines === all lines (no scheme rules). */
export function applyRebateEligibilityRules<T>(lines: T[], _rules?: RebateEligibilityRules | null): T[] {
  void _rules;
  return lines;
}

export type RebateSpendSummary = {
  invoiceSales: string;
  credits: string;
  /** Alias of Sales Enquiry netSales — Invoice Sales + Credits. */
  netSpend: string;
  units: number;
  invoiceDocuments: number;
  creditDocuments: number;
  products: number;
};

export function countDocumentTypes(
  refs: Iterable<{ documentType: string; documentReference: string; companyId?: string }>,
): { invoiceDocuments: number; creditDocuments: number } {
  const inv = new Set<string>();
  const cr = new Set<string>();
  for (const r of refs) {
    const key = `${r.companyId ?? ""}:${r.documentReference}`;
    if (r.documentType === "INVOICE") inv.add(key);
    else if (r.documentType === "CREDIT") cr.add(key);
  }
  return { invoiceDocuments: inv.size, creditDocuments: cr.size };
}
