/**
 * Main dashboard operational overview — pure aggregation, priority, and freshness.
 * Counts come from existing domain services. This module does not forecast, price, or invent alerts.
 */
import { addDaysIso } from "@/domain/sales-history-period";
import {
  STOCK_SCHEDULE_MINUTE,
  nextStockWindow,
} from "@/domain/stock-schedule";
import {
  AUTOPART_ONGOING_SALES_SCHEDULE_MINUTE,
  nextOngoingSalesWindow,
} from "@/domain/autopart-ongoing-sales-schedule";
import { londonWallTimeToUtc } from "@/lib/datetime";

export const DASHBOARD_DUE_SOON_MINUTES = 30;
export const DASHBOARD_SALES_TREND_DAYS = 90;

export const OPERATIONAL_LINKS = {
  plannerOrderNow: "/purchasing/planner?recommendation=ORDER_NOW",
  plannerBackordersAtRisk: "/purchasing/planner?recommendation=BACKORDERS_AT_RISK",
  plannerMissingSupplier: "/purchasing/planner?missingSupplier=1",
  plannerMissingSupplierBackorders: "/purchasing/planner?missingSupplier=1&backordersOnly=1",
  plannerMissingCost: "/purchasing/planner?missingCost=1",
  forecastCritical: "/purchasing/forecast?status=CRITICAL",
  forecast: "/purchasing/forecast",
  backorders: "/purchasing/backorders",
  backordersNoStock: "/purchasing/backorders?position=NO_STOCK_NO_INCOMING",
  backordersMovementNew: "/purchasing/backorders?movement=NEW",
  backordersMovementIncreased: "/purchasing/backorders?movement=INCREASED",
  backordersMovementReduced: "/purchasing/backorders?movement=REDUCED",
  backordersMovementCleared: "/purchasing/backorders?movement=CLEARED",
  warehouseStock: "/admin/products/stock",
  tradeApplications: "/admin/applications",
  crmTasks: "/crm/tasks",
  crmLeads: "/crm/leads",
  crmOpportunities: "/crm",
  orders: "/admin/orders",
  fulfilmentSettings: "/admin/settings?tab=autopart",
} as const;

export function backorderConditionHref(code: string): string {
  return `/purchasing/backorders?condition=${encodeURIComponent(code)}`;
}

export type OperationalSeverity = "critical" | "warning" | "info";

export type OperationalAttentionItem = {
  id: string;
  severity: OperationalSeverity;
  count: number;
  label: string;
  href: string;
  actionLabel: string;
};

const SEVERITY_RANK: Record<OperationalSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export type AttentionFacts = {
  noStockNoIncoming?: number;
  backordersAtRisk?: number;
  backordersNoSupplier?: number;
  orderNow?: number;
  missingCost?: number;
  warehouseImportFailed?: boolean;
  fbaStale?: boolean;
  fbaUpdatedLabel?: string | null;
  tradeApplications?: number;
  overdueTasks?: number;
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** One aggregated row per condition. Omitted facts are not alerts. */
export function buildOperationalAttention(facts: AttentionFacts): OperationalAttentionItem[] {
  const items: OperationalAttentionItem[] = [];
  const noIncoming = facts.noStockNoIncoming ?? 0;
  if (noIncoming > 0) {
    items.push({
      id: "backorders-no-incoming",
      severity: "critical",
      count: noIncoming,
      label: `${noIncoming} customer backorder ${plural(noIncoming, "line has", "lines have")} no warehouse stock and no incoming`,
      href: OPERATIONAL_LINKS.backordersNoStock,
      actionLabel: "VIEW",
    });
  }
  if (facts.warehouseImportFailed) {
    items.push({
      id: "warehouse-import-failed",
      severity: "critical",
      count: 1,
      label: "Warehouse stock import failed",
      href: OPERATIONAL_LINKS.warehouseStock,
      actionLabel: "FIX",
    });
  }
  const noSupplier = facts.backordersNoSupplier ?? 0;
  if (noSupplier > 0) {
    items.push({
      id: "backorders-no-supplier",
      severity: "warning",
      count: noSupplier,
      label: `${noSupplier} backordered ${plural(noSupplier, "product has", "products have")} no supplier`,
      href: OPERATIONAL_LINKS.plannerMissingSupplierBackorders,
      actionLabel: "REVIEW",
    });
  }
  const atRisk = facts.backordersAtRisk ?? 0;
  if (atRisk > 0) {
    items.push({
      id: "backorders-at-risk",
      severity: "warning",
      count: atRisk,
      label: `${atRisk} ${plural(atRisk, "product has", "products have")} backorders at risk`,
      href: OPERATIONAL_LINKS.plannerBackordersAtRisk,
      actionLabel: "REVIEW",
    });
  }
  const orderNow = facts.orderNow ?? 0;
  if (orderNow > 0) {
    items.push({
      id: "order-now",
      severity: "warning",
      count: orderNow,
      label: `${orderNow} ${plural(orderNow, "product is", "products are")} likely to run out before supplier lead time`,
      href: OPERATIONAL_LINKS.plannerOrderNow,
      actionLabel: "REVIEW",
    });
  }
  const missingCost = facts.missingCost ?? 0;
  if (missingCost > 0) {
    items.push({
      id: "missing-cost",
      severity: "warning",
      count: missingCost,
      label: `${missingCost} ${plural(missingCost, "product is", "products are")} missing cost data`,
      href: OPERATIONAL_LINKS.plannerMissingCost,
      actionLabel: "REVIEW",
    });
  }
  if (facts.fbaStale) {
    const when = facts.fbaUpdatedLabel?.trim();
    items.push({
      id: "fba-stale",
      severity: "warning",
      count: 1,
      label: when && when !== "Not imported" ? `FBA stock last updated ${when}` : "FBA stock has not been imported",
      href: OPERATIONAL_LINKS.forecast,
      actionLabel: "VIEW",
    });
  }
  const apps = facts.tradeApplications ?? 0;
  if (apps > 0) {
    items.push({
      id: "applications",
      severity: "info",
      count: apps,
      label: `${apps} trade ${plural(apps, "application is", "applications are")} awaiting review`,
      href: OPERATIONAL_LINKS.tradeApplications,
      actionLabel: "REVIEW",
    });
  }
  const overdue = facts.overdueTasks ?? 0;
  if (overdue > 0) {
    items.push({
      id: "crm-overdue",
      severity: "warning",
      count: overdue,
      label: `${overdue} overdue CRM ${plural(overdue, "task", "tasks")}`,
      href: OPERATIONAL_LINKS.crmTasks,
      actionLabel: "REVIEW",
    });
  }
  return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);
}

export type SalesDayPoint = {
  day: string;
  orders: number;
  value: string;
};

/** Fill London civil days in [today − (dayCount − 1), today]. Days outside that range are dropped. */
export function fillSalesTrendDays(today: string, dayCount: number, points: SalesDayPoint[]): SalesDayPoint[] {
  const start = addDaysIso(today, -(dayCount - 1));
  const byDay = new Map(
    points.filter((point) => point.day >= start && point.day <= today).map((point) => [point.day, point]),
  );
  const out: SalesDayPoint[] = [];
  for (let i = 0; i < dayCount; i += 1) {
    const day = addDaysIso(start, i);
    out.push(byDay.get(day) ?? { day, orders: 0, value: "0.00" });
  }
  return out;
}

export function salesVersusYesterday(
  series: SalesDayPoint[],
  today: string,
): { todayValue: string; yesterdayValue: string; delta: string } | null {
  const todayPoint = series.find((point) => point.day === today);
  const yesterday = series.find((point) => point.day === addDaysIso(today, -1));
  if (!todayPoint || !yesterday) return null;
  const left = Number(todayPoint.value);
  const right = Number(yesterday.value);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return {
    todayValue: todayPoint.value,
    yesterdayValue: yesterday.value,
    delta: (left - right).toFixed(2),
  };
}

export type FreshnessStatus = "current" | "due_soon" | "late" | "failed" | "partial" | "no_data";

export const FRESHNESS_STATUS_LABEL: Record<FreshnessStatus, string> = {
  current: "Current",
  due_soon: "Due soon",
  late: "Late",
  failed: "Failed",
  partial: "Partial",
  no_data: "No data",
};

export type ScheduledRunStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "RUNNING" | null;

/**
 * Latest FAILED or PARTIAL wins over an older success.
 * Manual imports must not use this — they are not failed scheduled jobs.
 */
export function classifyScheduledImport(input: {
  latestStatus: ScheduledRunStatus;
  stale: boolean;
  minutesUntilNext: number | null;
}): FreshnessStatus {
  if (input.latestStatus === "FAILED") return "failed";
  if (input.latestStatus === "PARTIAL") return "partial";
  if (input.latestStatus == null) return "no_data";
  if (input.stale) return "late";
  if (
    input.minutesUntilNext != null &&
    input.minutesUntilNext >= 0 &&
    input.minutesUntilNext <= DASHBOARD_DUE_SOON_MINUTES
  ) {
    return "due_soon";
  }
  return "current";
}

/** Manual imports are never a failed scheduled job. Stale uses the caller's existing stale rule. */
export function classifyManualImport(input: { updatedAt: string | null; stale: boolean }): FreshnessStatus {
  if (!input.updatedAt) return "no_data";
  if (input.stale) return "late";
  return "current";
}

export function classifyPairedFeed(input: {
  lastError: boolean;
  hasFirst: boolean;
  hasSecond: boolean;
  missedCurrentWindow: boolean;
  minutesSinceWindowOpened: number | null;
  minutesUntilNext: number | null;
}): FreshnessStatus {
  if (input.lastError) return "failed";
  if (!input.hasFirst && !input.hasSecond) return "no_data";
  if (!input.hasFirst || !input.hasSecond) return "partial";
  if (input.missedCurrentWindow) {
    if (
      input.minutesSinceWindowOpened != null &&
      input.minutesSinceWindowOpened >= 0 &&
      input.minutesSinceWindowOpened <= DASHBOARD_DUE_SOON_MINUTES
    ) {
      return "due_soon";
    }
    return "late";
  }
  if (
    input.minutesUntilNext != null &&
    input.minutesUntilNext >= 0 &&
    input.minutesUntilNext <= DASHBOARD_DUE_SOON_MINUTES
  ) {
    return "due_soon";
  }
  return "current";
}

function minutesUntilSlot(now: Date, businessDate: string, hour: number, minute: number): number {
  const [year, month, day] = businessDate.split("-").map(Number);
  const at = londonWallTimeToUtc(year!, month!, day!, hour, minute, 0);
  return Math.round((at.getTime() - now.getTime()) / 60_000);
}

export function minutesUntilStockWindow(now: Date): number {
  const next = nextStockWindow(now);
  return minutesUntilSlot(now, next.businessDate, next.hour, STOCK_SCHEDULE_MINUTE);
}

export function minutesUntilOngoingSalesWindow(now: Date): number {
  const next = nextOngoingSalesWindow(now, true);
  return minutesUntilSlot(now, next.businessDate, next.hour, AUTOPART_ONGOING_SALES_SCHEDULE_MINUTE);
}
