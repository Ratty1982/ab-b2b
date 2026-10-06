/**
 * Sales Intelligence — Rebate / Net Spend Analysis domain helpers.
 *
 * Net Spend uses the same Invoice Sales + Credits calculation as Sales Enquiry
 * Net Sales. No rebate eligibility schemes are applied in Phase 4.
 */
import {
  ALL_DATED_HISTORY_QUERY_RANGE,
  isDateOnlyIso,
  isSentinelDateOnly,
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

export type RebateCatalogueFilter = "ALL" | "CATALOGUE" | "EXTERNAL" | "HISTORIC";

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

/** Public period DTO — never includes sentinel 0001/9999 dates. */
export type RebatePeriodDto = {
  preset: RebatePeriodPreset;
  /** False for All history. */
  unbounded: boolean;
  from: string | null;
  to: string | null;
  /** Staff-facing label (“All history” or human date range). */
  label: string;
  /** Optional muted supporting copy for All history. */
  hint: string | null;
};

/**
 * Resolved period for queries.
 * `queryRange` may use internal sentinel bounds for All history (same totals as before);
 * never surface queryRange.from/to in UI/CSV/URL.
 */
export type ResolvedRebatePeriod = {
  preset: RebatePeriodPreset;
  unbounded: boolean;
  from: string | null;
  to: string | null;
  label: string;
  hint: string | null;
  queryRange: DateOnlyRange;
};

export class RebatePeriodValidationError extends Error {
  readonly code = "REBATE_PERIOD_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "RebatePeriodValidationError";
  }
}

const PERIODS = new Set<RebatePeriodPreset>([
  "ALL",
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
const CATS = new Set(["ALL", "CATALOGUE", "EXTERNAL", "HISTORIC"]);
const SORTS = new Set(["NET_DESC", "NET_ASC", "INVOICE_DESC", "CREDITS_DESC", "NAME_AZ"]);

const ALL_HISTORY_LABEL = "All history";
const ALL_HISTORY_HINT = "All dated imported invoice and credit history";

/** Normalize legacy blank Custom / missing period → ALL. */
export function normalizeRebatePeriodPreset(
  period: RebatePeriodPreset | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
): RebatePeriodPreset {
  const hasFrom = Boolean(from && isDateOnlyIso(from) && !isSentinelDateOnly(from));
  const hasTo = Boolean(to && isDateOnlyIso(to) && !isSentinelDateOnly(to));
  if (!period || period === "CUSTOM") {
    if (!hasFrom && !hasTo) return "ALL";
  }
  // Legacy URLs that stuffed sentinel bounds into Custom.
  if (
    period === "CUSTOM" &&
    from &&
    to &&
    isSentinelDateOnly(from) &&
    isSentinelDateOnly(to)
  ) {
    return "ALL";
  }
  return period ?? "ALL";
}

export function formatRebatePeriodLabel(from: string, to: string): string {
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ] as const;
  const fmt = (iso: string) => {
    const [ys, ms, ds] = iso.split("-");
    const y = Number(ys);
    const m = Number(ms);
    const d = Number(ds);
    return `${d} ${MONTHS[m! - 1]} ${y}`;
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

export function toRebatePeriodDto(resolved: ResolvedRebatePeriod): RebatePeriodDto {
  return {
    preset: resolved.preset,
    unbounded: resolved.unbounded,
    from: resolved.from,
    to: resolved.to,
    label: resolved.label,
    hint: resolved.hint,
  };
}

/** CSV / print period cells — never sentinel dates. */
export function rebatePeriodCsvCells(period: RebatePeriodDto): {
  periodFrom: string;
  periodTo: string;
  periodLabel: string;
} {
  if (period.unbounded) {
    return {
      periodFrom: ALL_HISTORY_LABEL,
      periodTo: ALL_HISTORY_LABEL,
      periodLabel: ALL_HISTORY_LABEL,
    };
  }
  return {
    periodFrom: period.from ?? "",
    periodTo: period.to ?? "",
    periodLabel: period.label,
  };
}

export function resolveRebatePrimaryPeriod(input: {
  period?: RebatePeriodPreset | null | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
  today?: string;
}): ResolvedRebatePeriod {
  const today = input.today ?? todayLondonDateOnly();
  const rawFrom = input.from && isDateOnlyIso(input.from) ? input.from : null;
  const rawTo = input.to && isDateOnlyIso(input.to) ? input.to : null;
  const preset = normalizeRebatePeriodPreset(input.period, rawFrom, rawTo);

  if (preset === "ALL") {
    return {
      preset: "ALL",
      unbounded: true,
      from: null,
      to: null,
      label: ALL_HISTORY_LABEL,
      hint: ALL_HISTORY_HINT,
      // Preserve prior “all dated docs” query semantics (excludes undated).
      queryRange: ALL_DATED_HISTORY_QUERY_RANGE,
    };
  }

  if (preset === "CUSTOM") {
    if (!rawFrom || !rawTo || isSentinelDateOnly(rawFrom) || isSentinelDateOnly(rawTo)) {
      throw new RebatePeriodValidationError(
        "Custom period requires both From and To dates (YYYY-MM-DD).",
      );
    }
    if (rawFrom > rawTo) {
      throw new RebatePeriodValidationError("Custom period From date must be on or before To date.");
    }
    return {
      preset: "CUSTOM",
      unbounded: false,
      from: rawFrom,
      to: rawTo,
      label: formatRebatePeriodLabel(rawFrom, rawTo),
      hint: null,
      queryRange: { from: rawFrom, to: rawTo },
    };
  }

  const range = resolveRebatePeriod(preset, rawFrom, rawTo, today);
  if (!range || isSentinelDateOnly(range.from) || isSentinelDateOnly(range.to)) {
    // Defensive — treat unexpected null as All history.
    return {
      preset: "ALL",
      unbounded: true,
      from: null,
      to: null,
      label: ALL_HISTORY_LABEL,
      hint: ALL_HISTORY_HINT,
      queryRange: ALL_DATED_HISTORY_QUERY_RANGE,
    };
  }
  return {
    preset,
    unbounded: false,
    from: range.from,
    to: range.to,
    label: formatRebatePeriodLabel(range.from, range.to),
    hint: null,
    queryRange: range,
  };
}

export function resolveRebateComparisonPeriod(input: {
  compare?: SalesEnquiryCompareMode | null | undefined;
  primary: ResolvedRebatePeriod | DateOnlyRange;
  period?: string | null | undefined;
  compareFrom?: string | null | undefined;
  compareTo?: string | null | undefined;
}): DateOnlyRange | null {
  const compare = input.compare ?? "OFF";
  if (compare === "OFF") return null;

  const unbounded =
    "unbounded" in input.primary ? input.primary.unbounded : false;
  const primaryRange: DateOnlyRange =
    "queryRange" in input.primary
      ? input.primary.queryRange
      : (input.primary as DateOnlyRange);

  // All history has no meaningful previous-equivalent / prior-year window.
  if (unbounded && (compare === "PREVIOUS" || compare === "PREVIOUS_YEAR")) {
    return null;
  }

  if (compare === "CUSTOM") {
    const from = input.compareFrom;
    const to = input.compareTo;
    if (!from || !to || !isDateOnlyIso(from) || !isDateOnlyIso(to)) {
      throw new RebatePeriodValidationError(
        "Custom comparison requires both Compare from and Compare to dates.",
      );
    }
    if (isSentinelDateOnly(from) || isSentinelDateOnly(to)) {
      throw new RebatePeriodValidationError("Custom comparison dates are invalid.");
    }
    if (from > to) {
      throw new RebatePeriodValidationError(
        "Custom comparison From date must be on or before To date.",
      );
    }
    return { from, to };
  }

  const period =
    input.period ??
    ("preset" in input.primary ? (input.primary as ResolvedRebatePeriod).preset : null);
  return resolveEnquiryComparisonPeriod({
    compare,
    primary: primaryRange,
    period,
    compareFrom: input.compareFrom,
    compareTo: input.compareTo,
  });
}

export function parseRebateUrlSearch(search: Record<string, unknown>): RebateUrlSearch {
  const out: RebateUrlSearch = {};
  if (search["mode"] === "multi" || search["mode"] === "customer") out.mode = search["mode"];
  if (typeof search["companyId"] === "string" && search["companyId"]) out.companyId = search["companyId"];

  let period: RebatePeriodPreset | undefined;
  if (typeof search["period"] === "string" && PERIODS.has(search["period"] as RebatePeriodPreset)) {
    period = search["period"] as RebatePeriodPreset;
  }
  let from: string | undefined;
  let to: string | undefined;
  if (typeof search["from"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["from"])) {
    from = search["from"];
  }
  if (typeof search["to"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["to"])) {
    to = search["to"];
  }
  // Strip legacy sentinel dates from URL state.
  if (from && isSentinelDateOnly(from)) from = undefined;
  if (to && isSentinelDateOnly(to)) to = undefined;

  const normalized = normalizeRebatePeriodPreset(period, from, to);
  if (normalized !== "ALL") out.period = normalized;
  else if (period === "ALL") out.period = "ALL";
  // Default ALL: omit period from parsed object when absent (compact may re-add).

  if (normalized === "CUSTOM") {
    if (from) out.from = from;
    if (to) out.to = to;
  }

  if (typeof search["compare"] === "string" && COMPARES.has(search["compare"])) {
    out.compare = search["compare"] as SalesEnquiryCompareMode;
  }
  if (typeof search["compareFrom"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["compareFrom"])) {
    if (!isSentinelDateOnly(search["compareFrom"])) out.compareFrom = search["compareFrom"];
  }
  if (typeof search["compareTo"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["compareTo"])) {
    if (!isSentinelDateOnly(search["compareTo"])) out.compareTo = search["compareTo"];
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

  const period = normalizeRebatePeriodPreset(search.period, search.from, search.to);
  if (period === "ALL") {
    out.period = "ALL";
  } else {
    out.period = period;
    if (period === "CUSTOM") {
      if (search.from && !isSentinelDateOnly(search.from)) out.from = search.from;
      if (search.to && !isSentinelDateOnly(search.to)) out.to = search.to;
    }
  }

  if (search.compare && search.compare !== "OFF") out.compare = search.compare;
  if (search.compare === "CUSTOM") {
    if (search.compareFrom && !isSentinelDateOnly(search.compareFrom)) {
      out.compareFrom = search.compareFrom;
    }
    if (search.compareTo && !isSentinelDateOnly(search.compareTo)) {
      out.compareTo = search.compareTo;
    }
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
