/**
 * Sales Intelligence — Daily Sales Brief types and pure helpers.
 *
 * Brief answers “what should I do today?” using the same Portfolio
 * attention / opportunity classifications (no second engine).
 * Presentation/prioritisation helpers live here; Portfolio rules stay authoritative.
 */
import { addDaysIso, daysInclusive, todayLondonDateOnly } from "@/domain/sales-history-period";
import { derivePurchaseCadence, evaluateCadenceAttention } from "@/domain/sales-cadence";
import {
  attentionSortKey,
  type AttentionReason,
  type AttentionReasonCode,
} from "@/domain/sales-attention";
import type {
  PortfolioCustomerRow,
  PortfolioOpportunity,
  PortfolioOpportunityType,
} from "@/domain/sales-portfolio";
import { formatGbp } from "@/domain/sales-intelligence";
import { formatDate } from "@/lib/datetime";

export const DAILY_BRIEF_ATTENTION_LIMIT = 5;
export const DAILY_BRIEF_OPPORTUNITY_LIMIT = 5;
export const DAILY_BRIEF_POSITIVE_LIMIT = 8;
export const DAILY_BRIEF_ACTIVITY_PAGE_SIZE = 25;
export const DAILY_BRIEF_FOLLOWUP_LIMIT = 10;
export const DAILY_BRIEF_FIRST_EVENT_LIMIT = 12;

/** Suppress decline-only Daily Brief priorities in the first N days of THIS_* periods. */
export const DAILY_BRIEF_EARLY_PERIOD_DAYS = 3;

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
  /** Daily Brief priority count after presentation suppression. */
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
  /** Salesperson-facing badge label for the lead reason. */
  priorityLabel: string;
  cadenceSummary: string;
  cadenceIntervalLabel: string;
  cadenceLastPurchaseLabel: string;
  cadenceHuman: string;
  currentNetSales: string;
  previousNetSales: string;
  movement: string;
  movementPercent: number | null;
  daysSinceLastPurchase: number | null;
  typicalIntervalDays: number | null;
  purchasedToday: boolean;
  todayNetSales: string | null;
  todayUnits: number | null;
  todayProducts: number | null;
  /** Compact salesperson lines (no threshold jargon). */
  summaryLines: string[];
};

export type DailyBriefOpportunityLine = {
  type: PortfolioOpportunityType;
  productLabel: string;
  sku: string | null;
  brandName: string | null;
  primaryText: string;
  secondaryText: string | null;
};

export type DailyBriefOpportunityItem = {
  companyId: string;
  companyName: string;
  customerGroupName: string | null;
  salesRepName: string | null;
  mamAccount: string | null;
  opportunityCount: number;
  opportunities: PortfolioOpportunity[];
  lines: DailyBriefOpportunityLine[];
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
  lastPurchaseBeforeTodayLabel: string;
  cadenceHuman: string;
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

/** Good morning / afternoon / evening from Europe/London clock hour. */
export function londonDayGreeting(now = new Date()): "Good morning" | "Good afternoon" | "Good evening" {
  const hourStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  const hour = Number(hourStr);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function firstNameFromDisplayName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  return first || null;
}

export function personalisedGreetingLine(
  name: string | null | undefined,
  now = new Date(),
): string {
  const first = firstNameFromDisplayName(name);
  const greet = londonDayGreeting(now);
  return first ? `${greet}, ${first}` : greet;
}

/**
 * Human comparison phrase for Portfolio/THIS_* comparable windows.
 * Prefer concrete commercial language over “comparable period”.
 */
export function humanComparisonPhrase(periodKey: string | null | undefined): string {
  const p = (periodKey ?? "").toUpperCase();
  switch (p) {
    case "THIS_MONTH":
      return "same point last month";
    case "THIS_QUARTER":
      return "same point last quarter";
    case "THIS_YEAR":
      return "same point last year";
    case "LAST_30":
      return "previous 30 days";
    case "LAST_7":
      return "previous 7 days";
    case "LAST_90":
      return "previous 90 days";
    case "LAST_365":
      return "previous 12 months";
    case "LAST_MONTH":
      return "the month before";
    case "LAST_QUARTER":
      return "the quarter before";
    case "LAST_YEAR":
      return "the year before";
    default:
      return "the comparison period";
  }
}

export function isEarlyCalendarPeriod(input: {
  periodKey: string | null | undefined;
  elapsedDays: number;
  thresholdDays?: number;
}): boolean {
  const p = (input.periodKey ?? "").toUpperCase();
  if (p !== "THIS_MONTH" && p !== "THIS_QUARTER" && p !== "THIS_YEAR") return false;
  return input.elapsedDays <= (input.thresholdDays ?? DAILY_BRIEF_EARLY_PERIOD_DAYS);
}

/** True when the only attention reason is material decline (Daily Brief suppressible). */
export function isDeclineOnlyAttention(reasons: AttentionReason[]): boolean {
  return reasons.length > 0 && reasons.every((r) => r.code === "DECLINING");
}

/** True when the only attention reason is significant stopped buying / not reordered. */
export function isStoppedBuyingOnlyAttention(reasons: AttentionReason[]): boolean {
  return reasons.length > 0 && reasons.every((r) => r.code === "STOPPED_BUYING");
}

/** Dormant or purchase gap — always meaningful Daily Brief priorities. */
export function hasIndependentCadencePriority(reasons: AttentionReason[]): boolean {
  return reasons.some((r) => r.code === "DORMANT" || r.code === "PURCHASE_GAP");
}

/**
 * Early-period noise: decline and/or stopped-product without dormant/gap.
 * A calendar rollover alone must not create a salesperson chase.
 */
export function isEarlyPeriodReorderNoise(reasons: AttentionReason[]): boolean {
  if (reasons.length === 0) return false;
  if (hasIndependentCadencePriority(reasons)) return false;
  return reasons.every((r) => r.code === "DECLINING" || r.code === "STOPPED_BUYING");
}

/**
 * Stopped-product-only is not yet commercially meaningful when the customer
 * is still within their normal purchasing cadence (or cadence is unknown and
 * we are in an early calendar period — handled separately).
 */
export function isStoppedProductBeforeReorderPoint(input: {
  reasons: AttentionReason[];
  typicalIntervalDays: number | null | undefined;
  daysSinceLastPurchase: number | null | undefined;
}): boolean {
  if (!isStoppedBuyingOnlyAttention(input.reasons)) return false;
  const typical = input.typicalIntervalDays;
  const since = input.daysSinceLastPurchase;
  if (typical == null || typical < 1 || since == null) return false;
  return since <= typical;
}

/**
 * Daily Brief presentation filter — does not change Portfolio classifications.
 *
 * Suppress when:
 * - early THIS_* period and reasons are only decline and/or stopped-product
 * - stopped-product-only while still within typical purchase cadence
 *
 * Always keep dormant / purchase gap.
 */
export function shouldSuppressDailyBriefPriority(input: {
  reasons: AttentionReason[];
  typicalIntervalDays: number | null | undefined;
  daysSinceLastPurchase: number | null | undefined;
  earlyPeriod: boolean;
}): boolean {
  if (input.reasons.length === 0) return true;
  if (hasIndependentCadencePriority(input.reasons)) return false;

  if (input.earlyPeriod && isEarlyPeriodReorderNoise(input.reasons)) {
    return true;
  }

  if (
    isStoppedProductBeforeReorderPoint({
      reasons: input.reasons,
      typicalIntervalDays: input.typicalIntervalDays,
      daysSinceLastPurchase: input.daysSinceLastPurchase,
    })
  ) {
    return true;
  }

  // No-cadence stopped-only outside early period: allow existing Portfolio evidence.
  // Decline-only outside early period: allow.
  return false;
}

/** Responsive card grid: one card uses a balanced max width; 2+ use two columns. */
export function dailyBriefCardGridClassName(count: number): string {
  if (count <= 1) return "grid max-w-3xl grid-cols-1 gap-2";
  return "grid gap-2 md:grid-cols-2";
}

export function humanPriorityLabel(code: AttentionReasonCode): string {
  switch (code) {
    case "DORMANT":
      return "Customer gone quiet";
    case "PURCHASE_GAP":
      return "Purchase gap";
    case "DECLINING":
      return "Sales lower than usual";
    case "STOPPED_BUYING":
      return "Products worth checking";
    default:
      return "Worth a check-in";
  }
}

export function leadPriorityLabel(reasons: AttentionReason[]): string {
  if (reasons.length === 0) return "Worth a check-in";
  return humanPriorityLabel(reasons[0]!.code);
}

export function cadenceHumanLabel(typicalIntervalDays: number | null | undefined): string {
  if (typicalIntervalDays == null || typicalIntervalDays < 1) return "Cadence not yet established";
  if (typicalIntervalDays === 1) return "Usually orders daily";
  if (typicalIntervalDays <= 3) return `Usually orders every ${typicalIntervalDays} days`;
  return `Usually orders about every ${typicalIntervalDays} days`;
}

/** UK-friendly relative label for a prior purchase date. */
export function formatPurchaseDateLabel(
  dateOnly: string | null | undefined,
  today: string,
): string {
  if (!dateOnly) return "No earlier order";
  if (dateOnly === today) return "Today";
  if (dateOnly === addDaysIso(today, -1)) return "Yesterday";
  return formatDate(dateOnly) ?? dateOnly;
}

export function absMoneyDisplay(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return formatGbp(value);
  return formatGbp(String(Math.abs(n)));
}

export function buildPrioritySummaryLines(input: {
  reasons: AttentionReason[];
  currentNetSales: string;
  movement: string;
  movementPercent: number | null;
  daysSinceLastPurchase: number | null;
  typicalIntervalDays: number | null;
  purchasedToday: boolean;
  todayNetSales: string | null;
  todayUnits: number | null;
  todayProducts: number | null;
  comparisonPhrase: string;
  periodShortLabel: string;
}): string[] {
  const lines: string[] = [];
  if (input.purchasedToday && input.todayNetSales != null) {
    const units =
      input.todayUnits != null
        ? ` · ${input.todayUnits} unit${input.todayUnits === 1 ? "" : "s"}`
        : "";
    const products =
      input.todayProducts != null
        ? ` · ${input.todayProducts} product${input.todayProducts === 1 ? "" : "s"}`
        : "";
    lines.push(`Ordered today: ${formatGbp(input.todayNetSales)}${units}${products}`);
  }

  const lead = input.reasons[0]?.code;
  if (lead === "DORMANT" || lead === "PURCHASE_GAP") {
    if (input.daysSinceLastPurchase != null && input.daysSinceLastPurchase > 0) {
      lines.push(`No order for ${input.daysSinceLastPurchase} days`);
    }
    lines.push(cadenceHumanLabel(input.typicalIntervalDays));
  } else if (lead === "DECLINING") {
    lines.push(`${formatGbp(input.currentNetSales)} ${input.periodShortLabel}`);
    const behind = absMoneyDisplay(input.movement);
    const pct =
      input.movementPercent != null ? ` (${Math.abs(input.movementPercent).toFixed(0)}%)` : "";
    lines.push(`${behind} lower than ${input.comparisonPhrase}${pct}`);
  } else if (lead === "STOPPED_BUYING") {
    lines.push(cadenceHumanLabel(input.typicalIntervalDays));
    if (!input.purchasedToday) {
      lines.push(`${formatGbp(input.currentNetSales)} ${input.periodShortLabel}`);
    }
  } else if (!input.purchasedToday) {
    lines.push(cadenceHumanLabel(input.typicalIntervalDays));
  } else {
    lines.push(cadenceHumanLabel(input.typicalIntervalDays));
  }

  return lines;
}

export function presentOpportunityLine(
  opp: PortfolioOpportunity,
  opts: {
    productName?: string | null;
    seedLabel?: string | null;
    earlyPeriod: boolean;
  },
): DailyBriefOpportunityLine {
  const sku = opp.sku ?? null;
  const productLabel =
    (opts.productName?.trim() || opp.brandName?.trim() || sku || "Opportunity").trim();

  if (opp.type === "CROSS_SELL") {
    const seed = opts.seedLabel?.trim() || opp.seedSku || "products they already buy";
    const secondary =
      opp.evidenceNumerator != null && opp.evidenceDenominator != null
        ? `${opp.evidenceNumerator} of ${opp.evidenceDenominator} customers in this comparison group`
        : null;
    return {
      type: opp.type,
      productLabel,
      sku,
      brandName: opp.brandName ?? null,
      primaryText: `Often bought by customers who also buy ${seed}.`,
      secondaryText: secondary,
    };
  }

  if (opp.type === "BRAND_GAP") {
    return {
      type: opp.type,
      productLabel: opp.brandName ?? productLabel,
      sku,
      brandName: opp.brandName ?? null,
      primaryText: `Other customers in their group buy ${opp.brandName ?? "this brand"}; they have not yet.`,
      secondaryText: null,
    };
  }

  // STOPPED_PRODUCT
  const countMatch = opp.title.match(/^(\d+)/);
  const count = countMatch ? Number(countMatch[1]) : null;
  const strong = opp.title.toLowerCase().includes("stopped");
  if (opts.earlyPeriod && !strong) {
    return {
      type: opp.type,
      productLabel: count != null ? `${count} products to keep an eye on` : "Products to keep an eye on",
      sku,
      brandName: null,
      primaryText:
        "These products were bought in the comparison period but haven’t been ordered yet this period.",
      secondaryText: null,
    };
  }
  if (strong) {
    return {
      type: opp.type,
      productLabel:
        count != null
          ? `${count} product${count === 1 ? "" : "s"} worth checking`
          : "Products worth checking",
      sku,
      brandName: null,
      primaryText: "Previously purchased products with no order yet this period.",
      secondaryText: null,
    };
  }
  return {
    type: opp.type,
    productLabel:
      count != null
        ? `${count} product${count === 1 ? "" : "s"} not reordered yet`
        : "Products not reordered yet",
    sku,
    brandName: null,
    primaryText:
      "These products were bought in the comparison period but haven’t been ordered yet this period.",
    secondaryText: null,
  };
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
  return pickDailyBriefPriorities(rows, { earlyPeriod: false, limit });
}

/**
 * Daily Brief priority selection with conservative presentation filtering.
 * Portfolio classifications themselves are unchanged.
 */
export function pickDailyBriefPriorities(
  rows: PortfolioCustomerRow[],
  opts: { earlyPeriod: boolean; limit?: number },
): PortfolioCustomerRow[] {
  const limit = opts.limit ?? DAILY_BRIEF_ATTENTION_LIMIT;
  return [...rows]
    .filter((r) => r.needsAttention)
    .filter(
      (r) =>
        !shouldSuppressDailyBriefPriority({
          reasons: r.attentionReasons,
          typicalIntervalDays: r.typicalIntervalDays,
          daysSinceLastPurchase: r.daysSinceLastPurchase,
          earlyPeriod: opts.earlyPeriod,
        }),
    )
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

export function toAttentionItem(
  row: PortfolioCustomerRow,
  opts: {
    purchasedToday: boolean;
    todayNetSales: string | null;
    todayUnits: number | null;
    todayProducts: number | null;
    comparisonPhrase: string;
    periodShortLabel: string;
  },
): DailyBriefAttentionItem {
  const priorityLabel = leadPriorityLabel(row.attentionReasons);
  const cadenceHuman = cadenceHumanLabel(row.typicalIntervalDays);
  return {
    companyId: row.companyId,
    companyName: row.companyName,
    customerGroupName: row.customerGroupName,
    salesRepName: row.salesRepName,
    mamAccount: row.mamAccount,
    attentionReasons: row.attentionReasons,
    priorityLabel,
    cadenceSummary: row.cadenceSummary,
    cadenceIntervalLabel: row.cadenceIntervalLabel,
    cadenceLastPurchaseLabel: row.cadenceLastPurchaseLabel,
    cadenceHuman,
    currentNetSales: row.currentNetSales,
    previousNetSales: row.previousNetSales,
    movement: row.movement,
    movementPercent: row.movementPercent,
    daysSinceLastPurchase: row.daysSinceLastPurchase,
    typicalIntervalDays: row.typicalIntervalDays,
    purchasedToday: opts.purchasedToday,
    todayNetSales: opts.todayNetSales,
    todayUnits: opts.todayUnits,
    todayProducts: opts.todayProducts,
    summaryLines: buildPrioritySummaryLines({
      reasons: row.attentionReasons,
      currentNetSales: row.currentNetSales,
      movement: row.movement,
      movementPercent: row.movementPercent,
      daysSinceLastPurchase: row.daysSinceLastPurchase,
      typicalIntervalDays: row.typicalIntervalDays,
      purchasedToday: opts.purchasedToday,
      todayNetSales: opts.todayNetSales,
      todayUnits: opts.todayUnits,
      todayProducts: opts.todayProducts,
      comparisonPhrase: opts.comparisonPhrase,
      periodShortLabel: opts.periodShortLabel,
    }),
  };
}

export function toOpportunityItem(
  row: PortfolioCustomerRow,
  opts: {
    productNameBySku: Map<string, string>;
    earlyPeriod: boolean;
  },
): DailyBriefOpportunityItem {
  const lines = row.opportunities.slice(0, 3).map((o) => {
    const skuKey = o.sku?.toUpperCase() ?? "";
    const seedKey = o.seedSku?.toUpperCase() ?? "";
    return presentOpportunityLine(o, {
      productName: skuKey ? opts.productNameBySku.get(skuKey) ?? null : null,
      seedLabel: seedKey
        ? opts.productNameBySku.get(seedKey) ?? o.seedSku ?? null
        : o.seedSku ?? null,
      earlyPeriod: opts.earlyPeriod,
    });
  });
  return {
    companyId: row.companyId,
    companyName: row.companyName,
    customerGroupName: row.customerGroupName,
    salesRepName: row.salesRepName,
    mamAccount: row.mamAccount,
    opportunityCount: row.opportunityCount,
    opportunities: row.opportunities,
    lines,
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

export function periodElapsedDays(range: { from: string; to: string }): number {
  return daysInclusive(range);
}

export const DAILY_BRIEF_METHODOLOGY = {
  purpose:
    "Daily Sales Brief surfaces what to do today in salesperson language. Sales Rep Portfolio remains the analytical workspace for why.",
  purchasingPresence:
    "A customer “purchased today” / “ordered today” only when they have at least one AutopartSalesLine on an INVOICE document dated today (Europe/London). Credits never create purchasing presence.",
  netSalesToday:
    "Net sales today sum signed AutopartSalesLine.salesNet for documents dated today (invoices and credits).",
  attention:
    "Priorities reuse Sales Rep Portfolio classifications (dormant, purchase gap, material decline, significant stopped buying). Opportunity alone never creates a priority.",
  earlyPeriodSuppression:
    `Daily Brief applies conservative presentation filtering on top of Portfolio. Early in THIS_MONTH / THIS_QUARTER / THIS_YEAR (≤ ${DAILY_BRIEF_EARLY_PERIOD_DAYS} days), missing reorders or a soft month-start decline alone are not treated as a chase. Customer purchasing cadence is also considered: stopped-product-only priorities are held back while days since last invoice purchase are still within the typical cadence. Dormant and purchase-gap priorities still appear. Detailed analysis remains in Portfolio; underlying classifications are unchanged.`,
  opportunities:
    "Opportunities reuse Portfolio evidence (stopped-product re-engagement, brand gap, cross-sell). Product names come from the current catalogue when mapped; otherwise SKU is shown. No probability, opportunity £, or AI score.",
  crossSellEvidence:
    "Cross-sell primary wording is commercial; cohort counts (e.g. 8 of 8 customers in this comparison group) remain as supporting evidence.",
  returnedCustomer:
    "Returned Customer fires only when today’s invoice purchase ends a dormant inactivity period under Portfolio cadence rules (evaluated on invoice dates before today).",
  firstProduct:
    "First-time product: customer has a positive INVOICE line for the SKU today and no prior INVOICE purchase of that SKU. Credits do not establish prior purchase.",
  firstBrand:
    "First-time brand only when today’s SKU maps authoritatively via ProductVariant → Product → Brand.",
  positiveMovement:
    "Good News is conservative: returned dormant customers, material Portfolio growth, first-time product, and first-time brand (when provable).",
  comparablePeriod:
    "Decline/growth use the same Portfolio comparable calendar period via previousComparableBusinessPeriod(). Salesperson UI says e.g. “same point last month” instead of “comparable period”.",
  followUps:
    "Follow-ups reuse the CRM Task model (overdue / due today, Europe/London). Create Follow-up is human-confirmed only.",
  freshness:
    "Sales data freshness reuses the existing Sales Intelligence feed freshness implementation. Not real-time.",
  credits:
    "Credits reduce net sales, never create invoice purchasing presence, cadence dates, first-product events, or returned-customer events.",
  thresholds:
    "Material decline for Portfolio Needs Attention requires ≥ £100 absolute fall and ≥ 20% fall vs the comparable period. Those thresholds are not shown on Daily Brief cards.",
} as const;
