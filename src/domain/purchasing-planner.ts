/**
 * Supplier-aware Purchase Planner — deterministic, explainable rules.
 *
 * Builds on the existing forecast engine (`suggestedPurchaseQty`, weighted demand, confidence).
 * Never creates purchase orders, never treats Incoming as Available, never invents ETAs.
 */
import { moneyToString, parseMoney, mulQty, roundGbpDisplay } from "@/domain/money";
import {
  suggestedPurchaseQty,
  type ForecastConfidence,
  type PurchasingStatus,
} from "@/domain/purchasing-forecast";

export const PLANNER_RECOMMENDATIONS = [
  "BACKORDERS_AT_RISK",
  "ORDER_NOW",
  "NO_SUPPLIER",
  "ORDER_SOON",
  "COVERED_BY_INCOMING",
  "REVIEW",
  "ADEQUATE_STOCK",
  "NO_VERIFIED_DEMAND",
] as const;
export type PlannerRecommendation = (typeof PLANNER_RECOMMENDATIONS)[number];

export const PLANNER_RECOMMENDATION_LABEL: Record<PlannerRecommendation, string> = {
  BACKORDERS_AT_RISK: "Backorders at risk",
  ORDER_NOW: "Order now",
  NO_SUPPLIER: "No supplier",
  ORDER_SOON: "Order soon",
  COVERED_BY_INCOMING: "Covered by incoming",
  REVIEW: "Review",
  ADEQUATE_STOCK: "Adequate stock",
  NO_VERIFIED_DEMAND: "No verified demand",
};

/** Lower = higher priority. Default planner sort. */
export const PLANNER_RECOMMENDATION_PRIORITY: Record<PlannerRecommendation, number> = {
  BACKORDERS_AT_RISK: 1,
  ORDER_NOW: 2,
  NO_SUPPLIER: 3,
  ORDER_SOON: 4,
  COVERED_BY_INCOMING: 5,
  REVIEW: 6,
  ADEQUATE_STOCK: 7,
  NO_VERIFIED_DEMAND: 8,
};

export function isPlannerRecommendation(value: unknown): value is PlannerRecommendation {
  return typeof value === "string" && (PLANNER_RECOMMENDATIONS as readonly string[]).includes(value);
}

/** Recommendations that represent a purchasing action to consider. */
export function isActionableRecommendation(rec: PlannerRecommendation): boolean {
  return rec === "BACKORDERS_AT_RISK" || rec === "ORDER_NOW" || rec === "NO_SUPPLIER" || rec === "ORDER_SOON";
}

// ---------------------------------------------------------------------------
// Supplier constraints
// ---------------------------------------------------------------------------

export function applyOrderConstraints(input: {
  rawRequirement: number;
  minimumOrderQty: number | null;
  orderMultiple: number | null;
}): { afterMoq: number; suggestedQty: number; moqApplied: boolean; multipleApplied: boolean } {
  const raw = Math.max(0, Math.ceil(input.rawRequirement));
  if (raw <= 0) return { afterMoq: 0, suggestedQty: 0, moqApplied: false, multipleApplied: false };
  let qty = raw;
  let moqApplied = false;
  if (input.minimumOrderQty != null && input.minimumOrderQty > 0 && qty < input.minimumOrderQty) {
    qty = input.minimumOrderQty;
    moqApplied = true;
  }
  const afterMoq = qty;
  let multipleApplied = false;
  if (input.orderMultiple != null && input.orderMultiple > 1 && qty % input.orderMultiple !== 0) {
    qty = Math.ceil(qty / input.orderMultiple) * input.orderMultiple;
    multipleApplied = true;
  }
  return { afterMoq, suggestedQty: qty, moqApplied, multipleApplied };
}

/** Warnings for a user-entered planned quantity. Advisory only — overrides are allowed. */
export function plannedQtyWarnings(input: {
  plannedQty: number;
  minimumOrderQty: number | null;
  orderMultiple: number | null;
}): string[] {
  const warnings: string[] = [];
  const q = input.plannedQty;
  if (!Number.isFinite(q) || q < 0 || !Number.isInteger(q)) return ["Enter a whole number of units (0 or more)."];
  if (q === 0) return warnings;
  if (input.minimumOrderQty != null && input.minimumOrderQty > 0 && q < input.minimumOrderQty) {
    warnings.push(`Below supplier MOQ of ${input.minimumOrderQty}.`);
  }
  if (input.orderMultiple != null && input.orderMultiple > 1 && q % input.orderMultiple !== 0) {
    warnings.push(`Not a multiple of ${input.orderMultiple}.`);
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Backorders
// ---------------------------------------------------------------------------

export type BackorderCoverage = "NONE" | "COVERED_BY_STOCK" | "COVERED_AFTER_INCOMING" | "AT_RISK";

/**
 * Known customer backorders vs current Avail and Incoming. Incoming is on-order, not available,
 * and has no ETA — "covered after incoming" means covered once that stock arrives.
 */
export function backorderCoverage(input: {
  backorderUnits: number;
  availableQty: number;
  incomingQty: number;
}): { coverage: BackorderCoverage; shortfall: number } {
  const backorders = Math.max(0, input.backorderUnits);
  if (backorders <= 0) return { coverage: "NONE", shortfall: 0 };
  const avail = Math.max(0, input.availableQty);
  const incoming = Math.max(0, input.incomingQty);
  if (avail >= backorders) return { coverage: "COVERED_BY_STOCK", shortfall: 0 };
  if (avail + incoming >= backorders) return { coverage: "COVERED_AFTER_INCOMING", shortfall: 0 };
  return { coverage: "AT_RISK", shortfall: backorders - avail - incoming };
}

// ---------------------------------------------------------------------------
// Suggested quantity
// ---------------------------------------------------------------------------

export type PlannerCalcStep = { label: string; value: string };

export type PlannerPurchaseCalc = {
  weeklyDemand: number | null;
  leadTimeDemand: number | null;
  targetStock: number | null;
  demandRequirement: number;
  requirementBeforeIncoming: number;
  backorderShortfall: number;
  rawRequirement: number;
  rawBasis: "DEMAND" | "BACKORDERS" | "NONE";
  afterMoq: number;
  suggestedQty: number;
  moqApplied: boolean;
  multipleApplied: boolean;
  steps: PlannerCalcStep[];
};

/**
 * Suggested order quantity.
 *
 * demandRequirement = max(0, targetStock − Available − Incoming)   (existing forecast engine)
 * backorderShortfall = max(0, Backorders − Available − Incoming)
 * rawRequirement     = max(demandRequirement, backorderShortfall)
 *
 * The max (not a sum) avoids double counting: outstanding customer orders are already part of the
 * demand the forecast is built from. Backorders only raise the requirement when known orders alone
 * exceed stock + incoming. Supplier MOQ, then order multiple, are applied to the raw requirement.
 */
export function plannerPurchaseQty(input: {
  availableQty: number;
  incomingQty: number;
  backorderUnits: number;
  recommendedWeekly: number | null;
  targetCoverWeeks: number;
  safetyStockQty: number;
  leadTimeDays: number | null;
  minimumOrderQty: number | null;
  orderMultiple: number | null;
}): PlannerPurchaseCalc {
  const avail = input.availableQty;
  const incoming = Math.max(0, input.incomingQty);
  const base = suggestedPurchaseQty({
    availableQty: avail,
    incomingQty: incoming,
    recommendedWeekly: input.recommendedWeekly,
    targetCoverWeeks: input.targetCoverWeeks,
    safetyStockQty: input.safetyStockQty,
    minimumOrderQty: null,
    orderMultiple: null,
  });
  const weekly = input.recommendedWeekly != null && input.recommendedWeekly > 0 ? input.recommendedWeekly : null;
  const leadTimeDemand =
    weekly != null && input.leadTimeDays != null && input.leadTimeDays > 0
      ? Math.ceil((weekly / 7) * input.leadTimeDays)
      : null;
  const demandRequirement = base.rawRequirement;
  const { shortfall } = backorderCoverage({
    backorderUnits: input.backorderUnits,
    availableQty: avail,
    incomingQty: incoming,
  });
  const rawRequirement = Math.max(demandRequirement, shortfall);
  const rawBasis: PlannerPurchaseCalc["rawBasis"] =
    rawRequirement <= 0 ? "NONE" : shortfall > demandRequirement ? "BACKORDERS" : "DEMAND";
  const constrained = applyOrderConstraints({
    rawRequirement,
    minimumOrderQty: input.minimumOrderQty,
    orderMultiple: input.orderMultiple,
  });

  const steps: PlannerCalcStep[] = [
    { label: "Demand rate", value: weekly == null ? "No usable demand rate" : `${round1(weekly)} units/week` },
    {
      label: "Lead-time demand",
      value:
        leadTimeDemand == null
          ? input.leadTimeDays == null
            ? "Lead time not configured"
            : "No demand rate"
          : `${leadTimeDemand} units over ${input.leadTimeDays} days`,
    },
    {
      label: "Safety / target stock",
      value:
        base.targetStock == null
          ? "Not calculated (no demand rate)"
          : `${base.targetStock} (${input.targetCoverWeeks} weeks cover + safety ${Math.max(0, input.safetyStockQty)})`,
    },
    { label: "Available", value: String(avail) },
    { label: "Incoming (on order, no ETA)", value: String(incoming) },
    { label: "Demand requirement", value: `max(0, target − available − incoming) = ${demandRequirement}` },
    {
      label: "Known customer backorders",
      value:
        input.backorderUnits > 0
          ? `${input.backorderUnits} units · shortfall after stock + incoming = ${shortfall}`
          : "None",
    },
    {
      label: "Raw requirement",
      value:
        rawBasis === "BACKORDERS"
          ? `${rawRequirement} (backorder shortfall exceeds demand requirement; not added on top)`
          : `${rawRequirement}`,
    },
    {
      label: "MOQ adjustment",
      value:
        input.minimumOrderQty == null || input.minimumOrderQty <= 0
          ? "No MOQ"
          : constrained.moqApplied
            ? `Raised to MOQ ${input.minimumOrderQty}`
            : `MOQ ${input.minimumOrderQty} already met`,
    },
    {
      label: "Order-multiple adjustment",
      value:
        input.orderMultiple == null || input.orderMultiple <= 1
          ? "No order multiple"
          : constrained.multipleApplied
            ? `Rounded up to multiple of ${input.orderMultiple} → ${constrained.suggestedQty}`
            : `Already a multiple of ${input.orderMultiple}`,
    },
    { label: "Final suggested quantity", value: String(constrained.suggestedQty) },
  ];

  return {
    weeklyDemand: weekly,
    leadTimeDemand,
    targetStock: base.targetStock,
    demandRequirement,
    requirementBeforeIncoming: base.targetStock == null ? 0 : Math.max(0, base.targetStock - avail),
    backorderShortfall: shortfall,
    rawRequirement,
    rawBasis,
    afterMoq: constrained.afterMoq,
    suggestedQty: constrained.suggestedQty,
    moqApplied: constrained.moqApplied,
    multipleApplied: constrained.multipleApplied,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export type PurchasingCostSource = "SUPPLIER_OVERRIDE" | "LATEST_COST" | "MISSING";

export const PURCHASING_COST_SOURCE_LABEL: Record<PurchasingCostSource, string> = {
  SUPPLIER_OVERRIDE: "Supplier cost override",
  LATEST_COST: "Autopart Latest Cost",
  MISSING: "Cost missing",
};

function validCost(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  const parsed = parseMoney(String(raw));
  if (!parsed || parsed.minor <= 0n) return null;
  return moneyToString(parsed, 4);
}

/** Supplier override → Autopart Latest Cost → missing. Missing is never £0. */
export function resolvePurchasingCost(input: {
  supplierUnitCost: string | null | undefined;
  latestCost: string | null | undefined;
}): { cost: string | null; source: PurchasingCostSource } {
  const override = validCost(input.supplierUnitCost);
  if (override != null) return { cost: override, source: "SUPPLIER_OVERRIDE" };
  const latest = validCost(input.latestCost);
  if (latest != null) return { cost: latest, source: "LATEST_COST" };
  return { cost: null, source: "MISSING" };
}

/** qty × cost rounded to pence. Null when cost is missing; "0.00" when qty is 0. */
export function estimatedLineValue(qty: number, cost: string | null): string | null {
  if (cost == null) return null;
  const parsed = parseMoney(cost);
  if (!parsed) return null;
  if (qty <= 0) return "0.00";
  return moneyToString(roundGbpDisplay(mulQty(parsed, qty)), 2);
}

// ---------------------------------------------------------------------------
// Supplier resolution
// ---------------------------------------------------------------------------

export type SupplierRelationLike = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierActive: boolean;
  active: boolean;
  isPreferred: boolean;
};

export type PlanningSupplierState = "ASSIGNED" | "NONE" | "AMBIGUOUS";

/**
 * Planning supplier for a product: the active preferred relationship, or the only active
 * relationship. Several active suppliers with none preferred is AMBIGUOUS — never guessed.
 */
export function resolvePlanningSupplier<T extends SupplierRelationLike>(
  relations: T[],
): { state: PlanningSupplierState; relation: T | null; activeCount: number } {
  const usable = relations.filter((r) => r.active && r.supplierActive);
  const preferred = usable.filter((r) => r.isPreferred);
  if (preferred.length === 1) return { state: "ASSIGNED", relation: preferred[0]!, activeCount: usable.length };
  if (preferred.length > 1) return { state: "AMBIGUOUS", relation: null, activeCount: usable.length };
  if (usable.length === 1) return { state: "ASSIGNED", relation: usable[0]!, activeCount: 1 };
  if (usable.length === 0) return { state: "NONE", relation: null, activeCount: 0 };
  return { state: "AMBIGUOUS", relation: null, activeCount: usable.length };
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

/** ORDER NOW requires verified history that is not VERY_LOW coverage. */
export function demandConfidenceSufficient(input: {
  verified: boolean;
  confidence: ForecastConfidence;
}): boolean {
  return input.verified && input.confidence !== "UNVERIFIED" && input.confidence !== "VERY_LOW";
}

export function classifyPlannerRecommendation(input: {
  stockStale: boolean;
  recommendedWeekly: number | null;
  confidenceSufficient: boolean;
  forecastStatus: PurchasingStatus;
  suggestedQty: number;
  /** max(0, targetStock − Available): what would be needed if nothing were on order. */
  requirementBeforeIncoming: number;
  backorderCoverage: BackorderCoverage;
  supplierState: PlanningSupplierState;
  incomingQty: number;
}): { recommendation: PlannerRecommendation; reason: string } {
  if (input.stockStale) {
    return {
      recommendation: "REVIEW",
      reason: "Autopart stock data is stale. Re-check after the next 231PO3NEW import before ordering.",
    };
  }
  if (input.backorderCoverage === "AT_RISK") {
    const supplierNote =
      input.supplierState === "NONE"
        ? " No supplier is configured."
        : input.supplierState === "AMBIGUOUS"
          ? " Several suppliers, none preferred."
          : "";
    return {
      recommendation: "BACKORDERS_AT_RISK",
      reason: `Known customer backorders exceed Available + Incoming.${supplierNote}`,
    };
  }
  if (input.suggestedQty > 0) {
    if (input.supplierState === "NONE") {
      return {
        recommendation: "NO_SUPPLIER",
        reason: "A purchase is suggested but no supplier relationship is configured.",
      };
    }
    if (input.supplierState === "AMBIGUOUS") {
      return {
        recommendation: "REVIEW",
        reason: "A purchase is suggested but several suppliers are active and none is preferred.",
      };
    }
    if (!input.confidenceSufficient) {
      return {
        recommendation: "REVIEW",
        reason: "A purchase is suggested but sales history is unverified or too short — quantity is indicative only.",
      };
    }
    if (input.forecastStatus === "CRITICAL" || input.forecastStatus === "REORDER") {
      return {
        recommendation: "ORDER_NOW",
        reason: "Projected stock after incoming is below the calculated requirement.",
      };
    }
    return {
      recommendation: "ORDER_SOON",
      reason: "Approaching the reorder requirement; stock after incoming is below target cover.",
    };
  }
  if (input.recommendedWeekly == null || input.recommendedWeekly <= 0) {
    return {
      recommendation: "NO_VERIFIED_DEMAND",
      reason: "No usable sales demand to plan from.",
    };
  }
  if (
    input.incomingQty > 0 &&
    (input.requirementBeforeIncoming > 0 ||
      input.forecastStatus === "INCOMING_COVERS_REQUIREMENT" ||
      input.backorderCoverage === "COVERED_AFTER_INCOMING")
  ) {
    return {
      recommendation: "COVERED_BY_INCOMING",
      reason: "Current stock is low, but incoming on-order stock covers the requirement. Arrival date is not available.",
    };
  }
  return { recommendation: "ADEQUATE_STOCK", reason: "No purchasing action needed on current cover." };
}

export function comparePlannerPriority(
  a: { recommendation: PlannerRecommendation; estimatedValue: string | null; backorderShortfall: number; weeksCover: number | null; sku: string },
  b: { recommendation: PlannerRecommendation; estimatedValue: string | null; backorderShortfall: number; weeksCover: number | null; sku: string },
): number {
  const p = PLANNER_RECOMMENDATION_PRIORITY[a.recommendation] - PLANNER_RECOMMENDATION_PRIORITY[b.recommendation];
  if (p !== 0) return p;
  const shortfall = b.backorderShortfall - a.backorderShortfall;
  if (shortfall !== 0) return shortfall;
  const value = Number(b.estimatedValue ?? -1) - Number(a.estimatedValue ?? -1);
  if (value !== 0) return value;
  const cover = (a.weeksCover ?? Number.POSITIVE_INFINITY) - (b.weeksCover ?? Number.POSITIVE_INFINITY);
  if (cover !== 0 && Number.isFinite(cover)) return cover;
  return a.sku.localeCompare(b.sku);
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

function sumMoney(values: string[]): string {
  let total = 0n;
  for (const v of values) {
    const parsed = parseMoney(v);
    if (parsed) total += parsed.minor;
  }
  return moneyToString({ minor: total }, 2);
}

export type SupplierPlanSummary = {
  productsToConsider: number;
  orderNow: number;
  backordersAtRisk: number;
  suggestedUnits: number;
  knownValue: string;
  missingCostLines: number;
  valueComplete: boolean;
  minimumOrderValue: string | null;
  belowMinimumBy: string | null;
  meetsMinimum: boolean | null;
};

export function summarizeSupplierPlan(
  rows: Array<{
    recommendation: PlannerRecommendation;
    suggestedQty: number;
    estimatedValue: string | null;
    costMissing: boolean;
  }>,
  minimumOrderValue: string | null,
): SupplierPlanSummary {
  const consider = rows.filter((r) => r.suggestedQty > 0);
  const knownValue = sumMoney(consider.map((r) => r.estimatedValue).filter((v): v is string => v != null));
  const missingCostLines = consider.filter((r) => r.costMissing).length;
  const mov = validCost(minimumOrderValue);
  let belowMinimumBy: string | null = null;
  let meetsMinimum: boolean | null = null;
  if (mov != null) {
    const gap = (parseMoney(mov)?.minor ?? 0n) - (parseMoney(knownValue)?.minor ?? 0n);
    meetsMinimum = gap <= 0n;
    belowMinimumBy = gap > 0n ? moneyToString({ minor: gap }, 2) : null;
  }
  return {
    productsToConsider: consider.length,
    orderNow: rows.filter((r) => r.recommendation === "ORDER_NOW").length,
    backordersAtRisk: rows.filter((r) => r.recommendation === "BACKORDERS_AT_RISK").length,
    suggestedUnits: consider.reduce((s, r) => s + r.suggestedQty, 0),
    knownValue,
    missingCostLines,
    valueComplete: missingCostLines === 0,
    minimumOrderValue: mov == null ? null : moneyToString(parseMoney(mov)!, 2),
    belowMinimumBy,
    meetsMinimum,
  };
}

export type PlannerSelectionItem = {
  sku: string;
  plannedQty: number;
  cost: string | null;
  minimumOrderQty: number | null;
  orderMultiple: number | null;
};

export function summarizePlannerSelection(items: PlannerSelectionItem[]): {
  products: number;
  units: number;
  knownValue: string;
  missingCostLines: number;
  warningLines: number;
} {
  const values: string[] = [];
  let missing = 0;
  let warningLines = 0;
  for (const item of items) {
    const value = estimatedLineValue(item.plannedQty, item.cost);
    if (value == null) {
      if (item.plannedQty > 0) missing += 1;
    } else values.push(value);
    if (plannedQtyWarnings(item).length) warningLines += 1;
  }
  return {
    products: items.length,
    units: items.reduce((s, i) => s + (Number.isFinite(i.plannedQty) ? Math.max(0, i.plannedQty) : 0), 0),
    knownValue: sumMoney(values),
    missingCostLines: missing,
    warningLines,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
