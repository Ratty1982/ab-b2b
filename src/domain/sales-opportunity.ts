/**
 * Sales Intelligence — Range Opportunities (deterministic, explainable).
 *
 * Similarity uses Jaccard overlap of category / brand / SKU purchase sets.
 * Candidates are current catalogue SKUs never invoice-purchased by the target
 * customer in the analysis lookback, supported by comparable-customer adoption.
 */
import {
  lastNDaysRange,
  resolveSalesEnquiryPeriod,
  todayLondonDateOnly,
  type DateOnlyRange,
} from "@/domain/sales-history-period";
import type { PublicAvailability } from "@/domain/availability";

/** Explicit methodology constants — do not scatter magic numbers in UI. */
export const RANGE_OPPORTUNITY_CONFIG = {
  /** Category Jaccard weight (renormalized when a dimension is unused). */
  weightCategory: 0.5,
  /** Brand Jaccard weight. */
  weightBrand: 0.3,
  /** SKU Jaccard weight. */
  weightSku: 0.2,
  /**
   * Minimum weighted similarity to enter the comparable cohort.
   * 0.25 ≈ meaningful category/brand overlap without requiring near-identical baskets.
   */
  minSimilarity: 0.25,
  /**
   * Minimum comparable customers after thresholding.
   * Below this we refuse to surface opportunities (empty evidence state).
   */
  minComparableCustomers: 3,
  /** Minimum invoice-buying comparables required for a candidate SKU. */
  minCandidateBuyers: 2,
  /** Default: require same brand and/or same category (exclude Broader Range). */
  defaultRequireRangeMatch: true,
  /** Default analysis window. */
  defaultAnalysisPeriod: "LAST_365" as OpportunityAnalysisPeriod,
} as const;

export type OpportunityAnalysisPeriod =
  | "LAST_90"
  | "LAST_180"
  | "LAST_365"
  | "LAST_730"
  | "CUSTOM";

export type RangeMatch =
  | "SAME_BRAND_CATEGORY"
  | "SAME_CATEGORY"
  | "SAME_BRAND"
  | "BROADER_RANGE";

export type OpportunitySort =
  | "ADOPTION"
  | "BUYERS"
  | "UNITS"
  | "RANGE_MATCH"
  | "NAME_AZ";

export type PurchaseProfileSets = {
  /** Catalogue category IDs with invoice purchase (unknown excluded). */
  categoryIds: Set<string>;
  /** Catalogue brand IDs with invoice purchase (unknown excluded). */
  brandIds: Set<string>;
  /** Uppercase SKUs with invoice purchase presence. */
  skus: Set<string>;
};

export function emptyPurchaseProfileSets(): PurchaseProfileSets {
  return {
    categoryIds: new Set(),
    brandIds: new Set(),
    skus: new Set(),
  };
}

/** Jaccard similarity; empty∪empty → null (dimension unused). */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number | null {
  if (a.size === 0 && b.size === 0) return null;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter += 1;
  }
  const union = a.size + b.size - inter;
  if (union === 0) return null;
  return inter / union;
}

export type SimilarityBreakdown = {
  category: number | null;
  brand: number | null;
  sku: number | null;
  /** Weighted score in [0,1]; 0 when no usable dimensions. */
  score: number;
  weightsUsed: { category: number; brand: number; sku: number };
};

/**
 * Weighted Jaccard across category/brand/SKU.
 * Unknown/empty dimensions are excluded and remaining weights renormalized.
 * "Both unknown" never counts as a match.
 */
export function calculateCustomerSimilarity(
  a: PurchaseProfileSets,
  b: PurchaseProfileSets,
  cfg = RANGE_OPPORTUNITY_CONFIG,
): SimilarityBreakdown {
  const category = jaccardSimilarity(a.categoryIds, b.categoryIds);
  const brand = jaccardSimilarity(a.brandIds, b.brandIds);
  const sku = jaccardSimilarity(a.skus, b.skus);

  let wCat = category == null ? 0 : cfg.weightCategory;
  let wBrand = brand == null ? 0 : cfg.weightBrand;
  let wSku = sku == null ? 0 : cfg.weightSku;
  const sum = wCat + wBrand + wSku;
  if (sum <= 0) {
    return {
      category,
      brand,
      sku,
      score: 0,
      weightsUsed: { category: 0, brand: 0, sku: 0 },
    };
  }
  wCat /= sum;
  wBrand /= sum;
  wSku /= sum;
  const score =
    (category ?? 0) * wCat + (brand ?? 0) * wBrand + (sku ?? 0) * wSku;
  return {
    category,
    brand,
    sku,
    score,
    weightsUsed: { category: wCat, brand: wBrand, sku: wSku },
  };
}

export function resolveRangeMatch(
  target: PurchaseProfileSets,
  candidateBrandId: string | null,
  candidateCategoryId: string | null,
): RangeMatch {
  const sameBrand = Boolean(candidateBrandId && target.brandIds.has(candidateBrandId));
  const sameCategory = Boolean(
    candidateCategoryId && target.categoryIds.has(candidateCategoryId),
  );
  if (sameBrand && sameCategory) return "SAME_BRAND_CATEGORY";
  if (sameCategory) return "SAME_CATEGORY";
  if (sameBrand) return "SAME_BRAND";
  return "BROADER_RANGE";
}

export function rangeMatchLabel(match: RangeMatch): string {
  if (match === "SAME_BRAND_CATEGORY") return "Same brand + category";
  if (match === "SAME_CATEGORY") return "Same category";
  if (match === "SAME_BRAND") return "Same brand";
  return "Broader range";
}

export function rangeMatchRank(match: RangeMatch): number {
  if (match === "SAME_BRAND_CATEGORY") return 0;
  if (match === "SAME_CATEGORY") return 1;
  if (match === "SAME_BRAND") return 2;
  return 3;
}

/** Observed adoption = buyers / cohort; null when cohort is 0. */
export function calculateObservedAdoption(buyers: number, cohort: number): number | null {
  if (cohort <= 0) return null;
  return buyers / cohort;
}

export function formatAdoptionPercent(rate: number | null): string {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(0)}%`;
}

/** Stock bands eligible for default recommendation. */
export function isOpportunityAvailabilityEligible(
  band: PublicAvailability | null | undefined,
): boolean {
  if (!band) return false;
  return band === "in" || band === "low" || band === "backorder" || band === "partial";
}

export function resolveOpportunityAnalysisPeriod(input: {
  period?: OpportunityAnalysisPeriod | null | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
  today?: string;
}): DateOnlyRange {
  const today = input.today ?? todayLondonDateOnly();
  const period = input.period ?? RANGE_OPPORTUNITY_CONFIG.defaultAnalysisPeriod;
  if (period === "LAST_90") return lastNDaysRange(today, 90);
  if (period === "LAST_180") return lastNDaysRange(today, 180);
  if (period === "LAST_365") return lastNDaysRange(today, 365);
  if (period === "LAST_730") return lastNDaysRange(today, 730);
  return (
    resolveSalesEnquiryPeriod("CUSTOM", input.from, input.to, today) ??
    lastNDaysRange(today, 365)
  );
}

export type OpportunityUrlSearch = {
  companyId?: string;
  period?: OpportunityAnalysisPeriod;
  from?: string;
  to?: string;
  q?: string;
  brandId?: string;
  categoryId?: string;
  rangeMatch?: RangeMatch | "ALL";
  availability?: "ALL" | "IN" | "LOW" | "BACKORDER" | "ORDERABLE";
  minAdoption?: number;
  sort?: OpportunitySort;
  page?: number;
  includeBroader?: boolean;
};

const PERIODS = new Set<OpportunityAnalysisPeriod>([
  "LAST_90",
  "LAST_180",
  "LAST_365",
  "LAST_730",
  "CUSTOM",
]);
const MATCHES = new Set(["ALL", "SAME_BRAND_CATEGORY", "SAME_CATEGORY", "SAME_BRAND", "BROADER_RANGE"]);
const AVAIL = new Set(["ALL", "IN", "LOW", "BACKORDER", "ORDERABLE"]);
const SORTS = new Set(["ADOPTION", "BUYERS", "UNITS", "RANGE_MATCH", "NAME_AZ"]);

export function parseOpportunityUrlSearch(search: Record<string, unknown>): OpportunityUrlSearch {
  const out: OpportunityUrlSearch = {};
  if (typeof search["companyId"] === "string" && search["companyId"]) {
    out.companyId = search["companyId"];
  }
  if (typeof search["period"] === "string" && PERIODS.has(search["period"] as OpportunityAnalysisPeriod)) {
    out.period = search["period"] as OpportunityAnalysisPeriod;
  }
  if (typeof search["from"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["from"])) {
    out.from = search["from"];
  }
  if (typeof search["to"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["to"])) {
    out.to = search["to"];
  }
  if (typeof search["q"] === "string" && search["q"].trim()) {
    out.q = search["q"].trim().slice(0, 200);
  }
  if (typeof search["brandId"] === "string" && search["brandId"]) out.brandId = search["brandId"];
  if (typeof search["categoryId"] === "string" && search["categoryId"]) {
    out.categoryId = search["categoryId"];
  }
  if (typeof search["rangeMatch"] === "string" && MATCHES.has(search["rangeMatch"])) {
    out.rangeMatch = search["rangeMatch"] as NonNullable<OpportunityUrlSearch["rangeMatch"]>;
  }
  if (typeof search["availability"] === "string" && AVAIL.has(search["availability"])) {
    out.availability = search["availability"] as NonNullable<OpportunityUrlSearch["availability"]>;
  }
  const minAd =
    typeof search["minAdoption"] === "number"
      ? search["minAdoption"]
      : typeof search["minAdoption"] === "string"
        ? Number(search["minAdoption"])
        : NaN;
  if (Number.isFinite(minAd) && minAd >= 0 && minAd <= 1) out.minAdoption = minAd;
  if (typeof search["sort"] === "string" && SORTS.has(search["sort"])) {
    out.sort = search["sort"] as OpportunitySort;
  }
  const page = search["page"];
  const pageNum = typeof page === "number" ? page : typeof page === "string" ? Number(page) : NaN;
  if (Number.isInteger(pageNum) && pageNum >= 2) out.page = pageNum;
  if (search["includeBroader"] === true || search["includeBroader"] === "1") {
    out.includeBroader = true;
  }
  return out;
}

export function compactOpportunityUrlSearch(search: OpportunityUrlSearch): OpportunityUrlSearch {
  const out: OpportunityUrlSearch = {};
  if (search.companyId) out.companyId = search.companyId;
  if (search.period && search.period !== RANGE_OPPORTUNITY_CONFIG.defaultAnalysisPeriod) {
    out.period = search.period;
  }
  if (search.period === "CUSTOM" || search.from || search.to) {
    if (search.from) out.from = search.from;
    if (search.to) out.to = search.to;
  }
  if (search.q) out.q = search.q;
  if (search.brandId) out.brandId = search.brandId;
  if (search.categoryId) out.categoryId = search.categoryId;
  if (search.rangeMatch && search.rangeMatch !== "ALL") out.rangeMatch = search.rangeMatch;
  if (search.availability && search.availability !== "ORDERABLE") {
    out.availability = search.availability;
  }
  if (search.minAdoption != null && search.minAdoption > 0) out.minAdoption = search.minAdoption;
  if (search.sort && search.sort !== "RANGE_MATCH") out.sort = search.sort;
  if (search.page && search.page > 1) out.page = search.page;
  if (search.includeBroader) out.includeBroader = true;
  return out;
}

export type OpportunityRowSortable = {
  rangeMatch: RangeMatch;
  adoption: number;
  buyers: number;
  comparableUnits: number;
  name: string;
};

export function sortOpportunityRows<T extends OpportunityRowSortable>(
  rows: T[],
  sort: OpportunitySort,
): void {
  rows.sort((a, b) => {
    switch (sort) {
      case "ADOPTION":
        return b.adoption - a.adoption || b.buyers - a.buyers || a.name.localeCompare(b.name);
      case "BUYERS":
        return b.buyers - a.buyers || b.adoption - a.adoption || a.name.localeCompare(b.name);
      case "UNITS":
        return (
          b.comparableUnits - a.comparableUnits ||
          b.adoption - a.adoption ||
          a.name.localeCompare(b.name)
        );
      case "NAME_AZ":
        return a.name.localeCompare(b.name, "en-GB");
      case "RANGE_MATCH":
      default: {
        const mr = rangeMatchRank(a.rangeMatch) - rangeMatchRank(b.rangeMatch);
        if (mr !== 0) return mr;
        return b.adoption - a.adoption || b.buyers - a.buyers || a.name.localeCompare(b.name);
      }
    }
  });
}

/**
 * Cross-sell foundation: of companies that bought `sku`, how many also bought each other SKU.
 * Returns Map<otherSku, coBuyerCount>. Not exposed in UI yet.
 */
export function computeSkuCoPurchase(
  companyInvoiceSkus: Iterable<Set<string>>,
  sku: string,
): Map<string, number> {
  const key = sku.trim().toUpperCase();
  const counts = new Map<string, number>();
  for (const set of companyInvoiceSkus) {
    if (!set.has(key)) continue;
    for (const other of set) {
      if (other === key) continue;
      counts.set(other, (counts.get(other) ?? 0) + 1);
    }
  }
  return counts;
}

export function availabilityFilterMatches(
  filter: OpportunityUrlSearch["availability"] | undefined,
  band: PublicAvailability | null,
): boolean {
  const f = filter ?? "ORDERABLE";
  if (f === "ALL") return true;
  if (!band) return false;
  if (f === "ORDERABLE") return isOpportunityAvailabilityEligible(band);
  if (f === "IN") return band === "in";
  if (f === "LOW") return band === "low";
  if (f === "BACKORDER") return band === "backorder" || band === "partial";
  return true;
}
