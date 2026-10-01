/**
 * Sales Intelligence — Daily Sales Brief types and pure helpers.
 *
 * Brief answers “what should I know or act on today?” using the same
 * Portfolio attention / opportunity classifications (no second engine).
 */
import { addDaysIso, todayLondonDateOnly } from "@/domain/sales-history-period";
import { derivePurchaseCadence, evaluateCadenceAttention } from "@/domain/sales-cadence";
import { attentionSortKey, type AttentionReason } from "@/domain/sales-attention";
import type { PortfolioCustomerRow, PortfolioOpportunity } from "@/domain/sales-portfolio";

export const DAILY_BRIEF_ATTENTION_LIMIT = 5;
export const DAILY_BRIEF_OPPORTUNITY_LIMIT = 5;
export const DAILY_BRIEF_POSITIVE_LIMIT = 8;
export const DAILY_BRIEF_ACTIVITY_PAGE_SIZE = 25;
export const DAILY_BRIEF_FOLLOWUP_LIMIT = 10;
export const DAILY_BRIEF_FIRST_EVENT_LIMIT = 12;

export type DailyBriefActivityStatus =
  | "NEW_TODAY"
  | "RETURNED"
  | "GROWING"
  | "NORMAL_ACTIVITY";

export type DailyBriefPositiveKind =
  | "RETURNED_CUSTOMER"
  | "GROWING"
  | "FIRST_PRODUCT"
  | "FIRST_BRAND";

export type DailyBriefSummary = {
  customersPurchased: number;
  netSalesToday: string;
  needAttention: number;
  newOpportunities: number;
  followUpsDueToday: number;
  overdueFollowUps: number;
};

export type DailyBriefAttentionItem = {
  companyId: string;
  companyName: string;
  customerGroupName: string | null;
  salesRepName: string | null;
  mamAccount: string | null;
  attentionReasons: AttentionReason[];
  cadenceSummary: string;
  cadenceIntervalLabel: string;
  cadenceLastPurchaseLabel: string;
  currentNetSales: string;
  previousNetSales: string;
  movement: string;
  movementPercent: number | null;
  daysSinceLastPurchase: number | null;
  typicalIntervalDays: number | null;
};

export type DailyBriefOpportunityItem = {
  companyId: string;
  companyName: string;
  customerGroupName: string | null;
  salesRepName: string | null;
  mamAccount: string | null;
  opportunityCount: number;
  opportunities: PortfolioOpportunity[];
};

export type DailyBriefPositiveItem = {
  kind: DailyBriefPositiveKind;
  companyId: string;
  companyName: string;
  customerGroupName: string | null;
  salesRepName: string | null;
  mamAccount: string | null;
  headline: string;
  detail: string;
  netSalesToday: string | null;
  sku?: string | null;
  productName?: string | null;
  brandName?: string | null;
  daysInactive?: number | null;
  typicalIntervalDays?: number | null;
};

export type DailyBriefActivityRow = {
  companyId: string;
  companyName: string;
  customerGroupName: string | null;
  salesRepName: string | null;
  mamAccount: string | null;
  netSalesToday: string;
  units: number;
  products: number;
  lastPurchaseBeforeToday: string | null;
  status: DailyBriefActivityStatus;
};

export type DailyBriefFollowUpItem = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  sourceLabel: string | null;
  sourceReason: string | null;
  sourceSku: string | null;
  companyId: string | null;
  companyName: string | null;
  assigneeName: string | null;
  bucket: "OVERDUE" | "DUE_TODAY";
};

export type DailyBriefSinceYesterday = {
  customersPurchased: number;
  dormantReturned: number;
  firstTimeProductPurchases: number;
  followUpsCreated: number;
  followUpsCompleted: number;
};

/** Europe/London long date for brief header, e.g. “Thursday, 1 October 2026”. */
export function formatLondonBriefDate(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(noonUtc);
}

/**
 * Returned customer: invoice purchase today ends a dormant inactivity period.
 * Cadence is evaluated on invoice dates before today (asOf = yesterday).
 * Normal cadence buyers who skipped a day are not returned.
 */
export function isReturnedCustomerFromCadence(input: {
  invoicePurchaseDates: string[];
  today: string;
}): {
  returned: boolean;
  daysInactive: number | null;
  typicalIntervalDays: number | null;
  explanation: string | null;
} {
  const today = input.today;
  const purchasedToday = input.invoicePurchaseDates.some((d) => d === today);
  if (!purchasedToday) {
    return { returned: false, daysInactive: null, typicalIntervalDays: null, explanation: null };
  }

  const beforeToday = input.invoicePurchaseDates.filter((d) => d < today);
  if (beforeToday.length === 0) {
    return { returned: false, daysInactive: null, typicalIntervalDays: null, explanation: null };
  }

  const yesterday = addDaysIso(today, -1);
  const cadence = derivePurchaseCadence(beforeToday, { asOf: yesterday });
  const attention = evaluateCadenceAttention(cadence);
  if (!attention.dormant) {
    return {
      returned: false,
      daysInactive: cadence.daysSinceLastPurchase,
      typicalIntervalDays: cadence.typicalIntervalDays,
      explanation: null,
    };
  }

  // Days without invoice purchase before today's buy (from last prior purchase to yesterday, +1 to include gap to today).
  const daysInactive =
    cadence.lastPurchaseDate != null
      ? Math.max(1, (cadence.daysSinceLastPurchase ?? 0) + 1)
      : null;

  return {
    returned: true,
    daysInactive,
    typicalIntervalDays: cadence.typicalIntervalDays,
    explanation:
      daysInactive != null
        ? `Purchased today after ${daysInactive} days without an invoice purchase.`
        : "Purchased today after a dormant inactivity period.",
  };
}

/** True when the customer has no prior invoice purchase date before today. */
export function isNewCustomerToday(invoicePurchaseDates: string[], today: string): boolean {
  const purchasedToday = invoicePurchaseDates.some((d) => d === today);
  if (!purchasedToday) return false;
  return !invoicePurchaseDates.some((d) => d < today);
}

export function pickNeedsAttention(
  rows: PortfolioCustomerRow[],
  limit = DAILY_BRIEF_ATTENTION_LIMIT,
): PortfolioCustomerRow[] {
  return [...rows]
    .filter((r) => r.needsAttention)
    .sort((a, b) => {
      const ka = attentionSortKey(a.attentionReasons);
      const kb = attentionSortKey(b.attentionReasons);
      if (ka !== kb) return ka - kb;
      return (
        Number(b.currentNetSales) - Number(a.currentNetSales) ||
        a.companyName.localeCompare(b.companyName)
      );
    })
    .slice(0, limit);
}

export function toAttentionItem(row: PortfolioCustomerRow): DailyBriefAttentionItem {
  return {
    companyId: row.companyId,
    companyName: row.companyName,
    customerGroupName: row.customerGroupName,
    salesRepName: row.salesRepName,
    mamAccount: row.mamAccount,
    attentionReasons: row.attentionReasons,
    cadenceSummary: row.cadenceSummary,
    cadenceIntervalLabel: row.cadenceIntervalLabel,
    cadenceLastPurchaseLabel: row.cadenceLastPurchaseLabel,
    currentNetSales: row.currentNetSales,
    previousNetSales: row.previousNetSales,
    movement: row.movement,
    movementPercent: row.movementPercent,
    daysSinceLastPurchase: row.daysSinceLastPurchase,
    typicalIntervalDays: row.typicalIntervalDays,
  };
}

export function toOpportunityItem(row: PortfolioCustomerRow): DailyBriefOpportunityItem {
  return {
    companyId: row.companyId,
    companyName: row.companyName,
    customerGroupName: row.customerGroupName,
    salesRepName: row.salesRepName,
    mamAccount: row.mamAccount,
    opportunityCount: row.opportunityCount,
    opportunities: row.opportunities,
  };
}

export function activityStatus(input: {
  returned: boolean;
  newToday: boolean;
  growing: boolean;
}): DailyBriefActivityStatus {
  if (input.newToday) return "NEW_TODAY";
  if (input.returned) return "RETURNED";
  if (input.growing) return "GROWING";
  return "NORMAL_ACTIVITY";
}

export function positiveMovementSortRank(kind: DailyBriefPositiveKind): number {
  switch (kind) {
    case "RETURNED_CUSTOMER":
      return 0;
    case "GROWING":
      return 1;
    case "FIRST_PRODUCT":
      return 2;
    case "FIRST_BRAND":
      return 3;
  }
}

export function previousLondonCivilDay(today = todayLondonDateOnly()): string {
  return addDaysIso(today, -1);
}

export const DAILY_BRIEF_METHODOLOGY = {
  purpose:
    "Daily Sales Brief surfaces what changed or needs action today. Sales Rep Portfolio remains the overall portfolio performance workspace.",
  purchasingPresence:
    "A customer “purchased today” only when they have at least one AutopartSalesLine on an INVOICE document dated today (Europe/London). Credits never create purchasing presence.",
  netSalesToday:
    "Net sales today sum signed AutopartSalesLine.salesNet for documents dated today (invoices and credits).",
  attention:
    "Needs Attention reuses Sales Rep Portfolio classifications exactly (dormant, purchase gap, material decline, significant stopped buying). Opportunity alone never creates Needs Attention.",
  opportunities:
    "Opportunities reuse Portfolio evidence (stopped-product re-engagement, brand gap, cross-sell). No probability, opportunity £, or AI score.",
  returnedCustomer:
    "Returned Customer fires only when today’s invoice purchase ends a dormant inactivity period under Portfolio cadence rules (evaluated on invoice dates before today). Normal cadence buyers who skipped a day are not returned.",
  firstProduct:
    "First-time product: customer has a positive INVOICE line for the SKU today and no prior INVOICE purchase of that SKU. Credits do not establish prior purchase. Historic-only SKUs are supported.",
  firstBrand:
    "First-time brand only when today’s SKU maps authoritatively via ProductVariant → Product → Brand. No brand inference from SKU prefixes or unmapped historic SKUs.",
  positiveMovement:
    "Positive Movement is conservative: returned dormant customers, material Portfolio growth, first-time product, and first-time brand (when provable).",
  comparablePeriod:
    "Decline/growth use the same Portfolio comparable calendar period via previousComparableBusinessPeriod().",
  followUps:
    "Follow-ups reuse the CRM Task model (overdue / due today, Europe/London). Create Follow-up is human-confirmed only.",
  freshness:
    "Sales data freshness reuses the existing Sales Intelligence feed freshness implementation. Not real-time.",
  credits:
    "Credits reduce net sales, never create invoice purchasing presence, cadence dates, first-product events, or returned-customer events.",
} as const;
