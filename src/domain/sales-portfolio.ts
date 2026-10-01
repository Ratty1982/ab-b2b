/**
 * Sales Intelligence — Sales Rep Portfolio types, filters, and cross-sell rules.
 */
import type { BusinessPeriodPreset } from "@/domain/sales-history-period";
import type { AttentionReason, AttentionReasonCode } from "@/domain/sales-attention";
import type { PurchaseCadence } from "@/domain/sales-cadence";
import { RANGE_OPPORTUNITY_CONFIG } from "@/domain/sales-opportunity";

/** Cross-sell / brand-gap evidence thresholds (deterministic). */
export const PORTFOLIO_CROSS_SELL_CONFIG = {
  /** Minimum companies in the cohort that bought the seed SKU. */
  minCohortBuyers: 8,
  /** Minimum co-buyers of the suggested SKU within that cohort. */
  minCoBuyers: 4,
  /** Minimum adoption (coBuyers / cohort) to surface. */
  minAdoption: 0.4,
  /** Max cross-sell suggestions per customer in portfolio list. */
  maxSuggestionsPerCustomer: 3,
  /** Brand-gap: min other group members buying a brand the target never bought. */
  minBrandGapPeers: 3,
} as const;

export type PortfolioFilter =
  | "ALL"
  | "NEEDS_ATTENTION"
  | "DORMANT"
  | "DECLINING"
  | "GROWING"
  | "STOPPED_PRODUCTS"
  | "HAS_OPPORTUNITIES"
  | "HAS_FOLLOWUP"
  | "NO_SALES";

export type PortfolioOpportunityType =
  | "STOPPED_PRODUCT"
  | "BRAND_GAP"
  | "CROSS_SELL";

export type PortfolioOpportunity = {
  type: PortfolioOpportunityType;
  title: string;
  explanation: string;
  sku?: string | null;
  brandName?: string | null;
  categoryName?: string | null;
  /** For CROSS_SELL: numerator of comparable buyers. */
  evidenceNumerator?: number | null;
  /** For CROSS_SELL: denominator (cohort size). */
  evidenceDenominator?: number | null;
};

export type PortfolioCustomerRow = {
  companyId: string;
  companyName: string;
  customerGroupId: string | null;
  customerGroupName: string | null;
  mamAccount: string | null;
  salesRepId: string | null;
  salesRepName: string | null;
  currentNetSales: string;
  previousNetSales: string;
  movement: string;
  movementPercent: number | null;
  declining: boolean;
  growing: boolean;
  lastPurchaseDate: string | null;
  typicalIntervalDays: number | null;
  daysSinceLastPurchase: number | null;
  cadenceSummary: string;
  productsPurchased: number;
  stoppedProductCount: number;
  opportunityCount: number;
  openFollowUpCount: number;
  attentionReasons: AttentionReason[];
  needsAttention: boolean;
  dormant: boolean;
  opportunities: PortfolioOpportunity[];
};

export type PortfolioKpis = {
  netSales: string;
  previousNetSales: string;
  movement: string;
  movementPercent: number | null;
  activeCustomers: number;
  needingAttention: number;
  dormantCustomers: number;
  growingCustomers: number;
  decliningCustomers: number;
  openFollowUps: number;
};

export type PortfolioUrlSearch = {
  period?: BusinessPeriodPreset;
  from?: string;
  to?: string;
  salesRepId?: string;
  /** Sentinel: unassigned companies only (management). */
  unassigned?: boolean;
  customerGroupId?: string;
  brandId?: string;
  filter?: PortfolioFilter;
  q?: string;
  page?: number;
  companyId?: string;
};

export const PORTFOLIO_DEFAULT_PERIOD: BusinessPeriodPreset = "THIS_MONTH";
export const PORTFOLIO_PAGE_SIZE = 50;

const FILTERS = new Set<string>([
  "ALL",
  "NEEDS_ATTENTION",
  "DORMANT",
  "DECLINING",
  "GROWING",
  "STOPPED_PRODUCTS",
  "HAS_OPPORTUNITIES",
  "HAS_FOLLOWUP",
  "NO_SALES",
]);

export function parsePortfolioUrlSearch(
  search: Record<string, unknown>,
): PortfolioUrlSearch {
  const out: PortfolioUrlSearch = {};
  if (typeof search["period"] === "string" && search["period"]) {
    out.period = search["period"].toUpperCase() as BusinessPeriodPreset;
  }
  if (typeof search["from"] === "string" && search["from"]) out.from = search["from"];
  if (typeof search["to"] === "string" && search["to"]) out.to = search["to"];
  if (typeof search["salesRepId"] === "string" && search["salesRepId"]) {
    out.salesRepId = search["salesRepId"];
  }
  if (search["unassigned"] === true || search["unassigned"] === "1") out.unassigned = true;
  if (typeof search["customerGroupId"] === "string" && search["customerGroupId"]) {
    out.customerGroupId = search["customerGroupId"];
  }
  if (typeof search["brandId"] === "string" && search["brandId"]) out.brandId = search["brandId"];
  if (typeof search["filter"] === "string" && FILTERS.has(search["filter"])) {
    out.filter = search["filter"] as PortfolioFilter;
  }
  if (typeof search["q"] === "string" && search["q"].trim()) out.q = search["q"].trim().slice(0, 200);
  const page =
    typeof search["page"] === "number"
      ? search["page"]
      : typeof search["page"] === "string"
        ? Number(search["page"])
        : NaN;
  if (Number.isInteger(page) && page >= 2) out.page = page;
  if (typeof search["companyId"] === "string" && search["companyId"]) {
    out.companyId = search["companyId"];
  }
  return out;
}

export function compactPortfolioUrlSearch(search: PortfolioUrlSearch): PortfolioUrlSearch {
  const out: PortfolioUrlSearch = {};
  if (search.period && search.period !== PORTFOLIO_DEFAULT_PERIOD) out.period = search.period;
  if (search.period === "CUSTOM" || search.from || search.to) {
    if (search.from) out.from = search.from;
    if (search.to) out.to = search.to;
  }
  if (search.salesRepId) out.salesRepId = search.salesRepId;
  if (search.unassigned) out.unassigned = true;
  if (search.customerGroupId) out.customerGroupId = search.customerGroupId;
  if (search.brandId) out.brandId = search.brandId;
  if (search.filter && search.filter !== "ALL") out.filter = search.filter;
  if (search.q) out.q = search.q;
  if (search.page && search.page > 1) out.page = search.page;
  if (search.companyId) out.companyId = search.companyId;
  return out;
}

export function rowMatchesPortfolioFilter(
  row: Pick<
    PortfolioCustomerRow,
    | "needsAttention"
    | "dormant"
    | "declining"
    | "growing"
    | "stoppedProductCount"
    | "opportunityCount"
    | "openFollowUpCount"
    | "currentNetSales"
  >,
  filter: PortfolioFilter | undefined,
): boolean {
  switch (filter ?? "ALL") {
    case "ALL":
      return true;
    case "NEEDS_ATTENTION":
      return row.needsAttention;
    case "DORMANT":
      return row.dormant;
    case "DECLINING":
      return row.declining;
    case "GROWING":
      return row.growing;
    case "STOPPED_PRODUCTS":
      return row.stoppedProductCount > 0;
    case "HAS_OPPORTUNITIES":
      return row.opportunityCount > 0;
    case "HAS_FOLLOWUP":
      return row.openFollowUpCount > 0;
    case "NO_SALES":
      return Number(row.currentNetSales) === 0 || row.currentNetSales === "0.00";
    default:
      return true;
  }
}

export function buildCrossSellOpportunity(input: {
  seedSku: string;
  suggestedSku: string;
  suggestedName?: string | null;
  coBuyers: number;
  cohortSize: number;
}): PortfolioOpportunity | null {
  const { minCohortBuyers, minCoBuyers, minAdoption } = PORTFOLIO_CROSS_SELL_CONFIG;
  if (input.cohortSize < minCohortBuyers) return null;
  if (input.coBuyers < minCoBuyers) return null;
  const adoption = input.cohortSize > 0 ? input.coBuyers / input.cohortSize : 0;
  if (adoption < minAdoption) return null;
  const pct = Math.round(adoption * 100);
  const label = input.suggestedName?.trim() || input.suggestedSku;
  return {
    type: "CROSS_SELL",
    title: `Cross-sell — ${label}`,
    explanation: `${input.coBuyers} of ${input.cohortSize} comparable customers who bought ${input.seedSku} also bought ${input.suggestedSku} (${pct}%).`,
    sku: input.suggestedSku,
    evidenceNumerator: input.coBuyers,
    evidenceDenominator: input.cohortSize,
  };
}

export function buildStoppedProductOpportunity(input: {
  count: number;
  sampleSkus?: string[];
}): PortfolioOpportunity | null {
  if (input.count <= 0) return null;
  const sample =
    input.sampleSkus && input.sampleSkus.length
      ? ` (e.g. ${input.sampleSkus.slice(0, 3).join(", ")})`
      : "";
  return {
    type: "STOPPED_PRODUCT",
    title: `${input.count} stopped product${input.count === 1 ? "" : "s"}`,
    explanation: `Previously purchased SKU(s) with no invoice purchase in the current period${sample}.`,
  };
}

export function buildBrandGapOpportunity(input: {
  brandName: string;
  peerCount: number;
  groupName?: string | null;
}): PortfolioOpportunity | null {
  if (input.peerCount < PORTFOLIO_CROSS_SELL_CONFIG.minBrandGapPeers) return null;
  const groupBit = input.groupName ? ` in ${input.groupName}` : "";
  return {
    type: "BRAND_GAP",
    title: `Brand gap — ${input.brandName}`,
    explanation: `${input.peerCount} other customers${groupBit} purchase ${input.brandName}; this company has no invoice purchase history for that brand.`,
    brandName: input.brandName,
  };
}

/** Re-export range opportunity min comparable for docs/help consistency. */
export const PORTFOLIO_RANGE_MIN_COMPARABLES = RANGE_OPPORTUNITY_CONFIG.minComparableCustomers;

export type { AttentionReason, AttentionReasonCode, PurchaseCadence };
