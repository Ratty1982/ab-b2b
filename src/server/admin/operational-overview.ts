/**
 * Main dashboard operational overview.
 * Aggregates existing services. Does not reimplement forecast, backorder identity, or cost rules.
 */
import { Prisma, type Prisma as PrismaTypes } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { autopartConditionLabel } from "@/domain/autopart-product-condition";
import {
  AUTOPART_216V_SCHEDULE_LABEL,
  AUTOPART_216V_SCHEDULE_MINUTE,
  headline216vFeedHealth,
  resolveAutopart216vFreshness,
} from "@/domain/autopart-216v-freshness";
import { isLondonWorkingDayOngoing } from "@/domain/autopart-ongoing-sales-schedule";
import {
  AUTOPART_ONGOING_SALES_SCHEDULE_LABEL,
  AUTOPART_ONGOING_SALES_SCHEDULE_MINUTE,
  dueOngoingSalesWindow,
} from "@/domain/autopart-ongoing-sales-schedule";
import { STOCK_SCHEDULE_LABEL, londonCivilTime } from "@/domain/stock-schedule";
import {
  DASHBOARD_SALES_TREND_DAYS,
  FRESHNESS_STATUS_LABEL,
  OPERATIONAL_LINKS,
  backorderConditionHref,
  buildOperationalAttention,
  classifyManualImport,
  classifyPairedFeed,
  classifyScheduledImport,
  fillSalesTrendDays,
  minutesUntilOngoingSalesWindow,
  minutesUntilStockWindow,
  salesVersusYesterday,
  type AttentionFacts,
  type FreshnessStatus,
  type OperationalAttentionItem,
  type SalesDayPoint,
} from "@/domain/operational-dashboard";
import { dateOnlyIsoFromDate, todayLondonDateOnly } from "@/domain/sales-history-period";
import { moneyToString, parseMoney } from "@/domain/money";
import { formatGbpIncVat } from "@/domain/admin-dashboard";
import { formatOperationalDateTime, londonCalendarDayBounds, londonWallTimeToUtc } from "@/lib/datetime";
import { getBackorderWorkspace } from "@/server/purchasing/backorders";
import { loadFbaFreshness } from "@/server/purchasing/fba-stock";
import { summarisePurchasingAttention } from "@/server/purchasing/service";
import { latestSalesUpdatedAt } from "@/server/purchasing/demand";
import { stockFreshness } from "@/server/stock/service";

const CONDITION_CODES = ["O", "D", "S", "M"] as const;

export type PurchasingAttentionSummary = Awaited<ReturnType<typeof summarisePurchasingAttention>>;

export type OperationalBackorders = {
  outstandingOrders: number;
  outstandingUnits: number;
  outstandingValue: string;
  movement: { new: number; increased: number; reduced: number; cleared: number };
  noStockNoIncoming: number;
};

export type FreshnessRow = {
  id: string;
  label: string;
  status: FreshnessStatus;
  statusLabel: string;
  detail: string;
  scheduleLabel: string | null;
  href: string | null;
  kind: "scheduled" | "manual";
};

export type OperationalOverview = {
  sales: {
    error: string | null;
    today: {
      orders: number;
      valueIncVat: string;
      valueLabel: string;
      versusYesterday: string | null;
    } | null;
    trend: SalesDayPoint[] | null;
  } | null;
  backorders: { error: string | null; summary: OperationalBackorders | null } | null;
  purchasing: { error: string | null; summary: PurchasingAttentionSummary | null } | null;
  conditions: {
    error: string | null;
    items: Array<{ code: string; label: string; count: number; href: string }>;
  } | null;
  crm: {
    error: string | null;
    openLeads: number | null;
    openOpportunities: number | null;
    overdueTasks: number | null;
    tasksDueToday: number | null;
    tradeApplications: number | null;
  } | null;
  freshness: { error: string | null; rows: FreshnessRow[] };
  attention: OperationalAttentionItem[];
};

function widgetError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "This section is unavailable";
}

function money2(value: unknown): string {
  const parsed = parseMoney(typeof value === "object" && value && "toString" in value ? String(value) : String(value ?? "0"));
  return parsed ? moneyToString(parsed, 2) : "0.00";
}

function versusLabel(delta: string): string {
  const amount = Number(delta);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return "Same as yesterday";
  const formatted = formatGbpIncVat(Math.abs(amount).toFixed(2));
  return amount > 0 ? `${formatted} up on yesterday` : `${formatted} down on yesterday`;
}

async function loadSales(accessible: string[] | "all"): Promise<OperationalOverview["sales"]> {
  try {
    const today = todayLondonDateOnly();
    const startIso = fillSalesTrendDays(today, DASHBOARD_SALES_TREND_DAYS, [])[0]!.day;
    const [year, month, day] = startIso.split("-").map(Number);
    const since = londonWallTimeToUtc(year!, month!, day!, 0, 0, 0);
    const { end } = londonCalendarDayBounds(new Date());
    type Row = { day: string; orders: number; value: unknown };
    const rows =
      accessible === "all"
        ? await prisma.$queryRaw<Row[]>`
            SELECT to_char(("placedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day,
                   COUNT(*)::int AS orders,
                   COALESCE(SUM("grandTotal"), 0) AS value
            FROM "Order"
            WHERE "placedAt" >= ${since}
              AND "placedAt" < ${end}
              AND "status" NOT IN ('DRAFT', 'CANCELLED')
            GROUP BY 1
            ORDER BY 1`
        : accessible.length === 0
          ? []
          : await prisma.$queryRaw<Row[]>`
              SELECT to_char(("placedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day,
                     COUNT(*)::int AS orders,
                     COALESCE(SUM("grandTotal"), 0) AS value
              FROM "Order"
              WHERE "placedAt" >= ${since}
                AND "placedAt" < ${end}
                AND "status" NOT IN ('DRAFT', 'CANCELLED')
                AND "companyId" IN (${Prisma.join(accessible)})
              GROUP BY 1
              ORDER BY 1`;
    const trend = fillSalesTrendDays(
      today,
      DASHBOARD_SALES_TREND_DAYS,
      rows.map((row) => ({
        day: row.day,
        orders: Number(row.orders),
        value: money2(row.value),
      })),
    );
    const todayPoint = trend[trend.length - 1] ?? { day: today, orders: 0, value: "0.00" };
    const compared = salesVersusYesterday(trend, today);
    return {
      error: null,
      today: {
        orders: todayPoint.orders,
        valueIncVat: todayPoint.value,
        valueLabel: formatGbpIncVat(todayPoint.value),
        versusYesterday: compared ? versusLabel(compared.delta) : null,
      },
      trend,
    };
  } catch (error) {
    return { error: widgetError(error), today: null, trend: null };
  }
}

async function loadBackorderSummary(actorUserId: string): Promise<NonNullable<OperationalOverview["backorders"]>> {
  try {
    const workspace = await getBackorderWorkspace(actorUserId);
    const current = workspace.current;
    return {
      error: null,
      summary: {
        outstandingOrders: current?.outstandingOrders ?? 0,
        outstandingUnits: current ? Number(current.outstandingUnits) : 0,
        outstandingValue: current?.outstandingValue ?? "0.00",
        movement: {
          new: current?.newToday ?? 0,
          increased: current?.increasedSincePrevious ?? 0,
          reduced: current?.reducedSincePrevious ?? 0,
          cleared: current?.clearedSincePrevious ?? 0,
        },
        noStockNoIncoming: workspace.attentionSummary.NO_STOCK_NO_INCOMING,
      },
    };
  } catch (error) {
    return { error: widgetError(error), summary: null };
  }
}

async function loadConditionCounts(): Promise<NonNullable<OperationalOverview["conditions"]>> {
  try {
    const snapshot = await prisma.autopartBackorderSnapshot.findFirst({
      where: { status: "COMMITTED" },
      orderBy: { importedAt: "desc" },
      select: { id: true },
    });
    if (!snapshot) return { error: null, items: [] };
    const grouped = await prisma.$queryRaw<Array<{ code: string; count: number }>>`
      SELECT COALESCE(p."conditionCode", pm."conditionCode") AS code,
             COUNT(*)::int AS count
      FROM "AutopartBackorderLine" l
      LEFT JOIN "AutopartProduct" p ON p.id = l."autopartProductId"
      LEFT JOIN "AutopartProduct" pm
        ON l."autopartProductId" IS NULL AND pm."matchKey" = l."partMatchKey"
      WHERE l."snapshotId" = ${snapshot.id}
        AND l."changeStatus" <> 'CLEARED'
        AND COALESCE(p."conditionCode", pm."conditionCode") IN ('O', 'D', 'S', 'M')
      GROUP BY 1`;
    const byCode = new Map(grouped.map((row) => [row.code, Number(row.count)]));
    return {
      error: null,
      items: CONDITION_CODES.flatMap((code) => {
        const count = byCode.get(code) ?? 0;
        if (count <= 0) return [];
        return [{ code, label: autopartConditionLabel(code) ?? code, count, href: backorderConditionHref(code) }];
      }),
    };
  } catch (error) {
    return { error: widgetError(error), items: [] };
  }
}

function companyScope(accessible: string[] | "all"): PrismaTypes.OpportunityWhereInput {
  if (accessible === "all") return {};
  return { companyId: { in: accessible.length ? accessible : ["__none__"] } };
}

async function loadCrm(input: {
  actorUserId: string;
  accessible: string[] | "all";
  canSeeCrm: boolean;
  canSeeTasks: boolean;
  canSeeApplications: boolean;
  tradeApplications: number;
}): Promise<NonNullable<OperationalOverview["crm"]>> {
  try {
    const { start, end } = londonCalendarDayBounds(new Date());
    const now = new Date();
    const leadWhere: PrismaTypes.LeadWhereInput = {
      status: { in: ["NEW", "CONTACTED", "QUALIFIED"] },
      ...(input.accessible === "all"
        ? {}
        : {
            OR: [
              { ownerId: input.actorUserId },
              { companyId: { in: input.accessible.length ? input.accessible : ["__none__"] } },
            ],
          }),
    };
    const taskScope: PrismaTypes.TaskWhereInput =
      input.accessible === "all"
        ? {}
        : {
            OR: [
              { assigneeId: input.actorUserId },
              { companyId: { in: input.accessible.length ? input.accessible : ["__none__"] } },
            ],
          };
    const [openLeads, openOpportunities, overdueTasks, tasksDueToday] = await Promise.all([
      input.canSeeCrm ? prisma.lead.count({ where: leadWhere }) : Promise.resolve(null),
      input.canSeeCrm
        ? prisma.opportunity.count({
            where: { stage: { notIn: ["WON", "LOST"] }, ...companyScope(input.accessible) },
          })
        : Promise.resolve(null),
      input.canSeeTasks
        ? prisma.task.count({
            where: {
              status: { in: ["OPEN", "IN_PROGRESS"] },
              dueAt: { lt: now },
              ...taskScope,
            },
          })
        : Promise.resolve(null),
      input.canSeeTasks
        ? prisma.task.count({
            where: {
              status: { in: ["OPEN", "IN_PROGRESS"] },
              dueAt: { gte: start, lt: end },
              ...taskScope,
            },
          })
        : Promise.resolve(null),
    ]);
    return {
      error: null,
      openLeads,
      openOpportunities,
      overdueTasks,
      tasksDueToday,
      tradeApplications: input.canSeeApplications ? input.tradeApplications : null,
    };
  } catch (error) {
    return {
      error: widgetError(error),
      openLeads: null,
      openOpportunities: null,
      overdueTasks: null,
      tasksDueToday: null,
      tradeApplications: input.canSeeApplications ? input.tradeApplications : null,
    };
  }
}

function freshnessRow(
  row: Omit<FreshnessRow, "statusLabel"> & { status: FreshnessStatus },
): FreshnessRow {
  return { ...row, statusLabel: FRESHNESS_STATUS_LABEL[row.status] };
}

async function loadFreshness(input: {
  canSeeStock: boolean;
  canSeePurchasing: boolean;
  canSeeOrders: boolean;
  canSeeSettings: boolean;
  purchasing: PurchasingAttentionSummary | null;
}): Promise<FreshnessRow[]> {
  const now = new Date();
  const rows: FreshnessRow[] = [];
  if (input.canSeeStock) {
    const [latest, fresh] = await Promise.all([
      prisma.stockSyncRun.findFirst({
        where: { mode: "live" },
        orderBy: { startedAt: "desc" },
        select: { status: true, completedAt: true, startedAt: true },
      }),
      stockFreshness(now),
    ]);
    const status = classifyScheduledImport({
      latestStatus: latest?.status ?? null,
      stale: fresh.stale,
      minutesUntilNext: minutesUntilStockWindow(now),
    });
    const when = formatOperationalDateTime(latest?.completedAt ?? latest?.startedAt ?? fresh.lastSuccessAt);
    const failedNote =
      latest?.status === "FAILED" && fresh.lastSuccessAt
        ? `Last success ${formatOperationalDateTime(fresh.lastSuccessAt) ?? "unknown"}`
        : null;
    rows.push(
      freshnessRow({
        id: "warehouse-stock",
        label: "Warehouse stock",
        status,
        detail: failedNote ?? when ?? "Not imported",
        scheduleLabel: STOCK_SCHEDULE_LABEL,
        href: OPERATIONAL_LINKS.warehouseStock,
        kind: "scheduled",
      }),
    );
  }
  if (input.canSeePurchasing) {
    const snapshot = await prisma.autopartBackorderSnapshot.findFirst({
      where: { status: "COMMITTED" },
      orderBy: { importedAt: "desc" },
      select: { importedAt: true, businessDate: true },
    });
    const settings = await prisma.autopartBackorderFeedSettings.findUnique({ where: { id: "default" } });
    const lastBusinessDate = snapshot ? dateOnlyIsoFromDate(snapshot.businessDate) : null;
    const resolved = resolveAutopart216vFreshness({
      lastSuccessAt: snapshot?.importedAt ?? settings?.lastSuccessAt ?? null,
      lastBusinessDate,
      now,
      ...(settings?.scheduleHour != null ? { scheduleHour: settings.scheduleHour } : {}),
    });
    const headline = headline216vFeedHealth({
      status: resolved.status,
      stale: resolved.stale,
      lastError: settings?.lastError ?? null,
      lastBusinessDate,
      now,
    });
    let status: FreshnessStatus = "current";
    if (headline.key === "IMPORT_FAILED") status = "failed";
    else if (resolved.status === "NO_SNAPSHOT") status = "no_data";
    else if (resolved.status === "EXPECTED_REPORT_NOT_RECEIVED") status = "late";
    else if (resolved.status === "CURRENT" && isLondonWorkingDayOngoing(now)) {
      const local = londonCivilTime(now);
      const due = (settings?.scheduleHour ?? 18) * 60 + AUTOPART_216V_SCHEDULE_MINUTE;
      const until = due - (local.hour * 60 + local.minute);
      status = until >= 0 && until <= 30 ? "due_soon" : "current";
    }
    rows.push(
      freshnessRow({
        id: "backorders",
        label: "Backorders",
        status,
        detail: snapshot ? (formatOperationalDateTime(snapshot.importedAt) ?? "Imported") : "No snapshot yet",
        scheduleLabel: AUTOPART_216V_SCHEDULE_LABEL,
        href: OPERATIONAL_LINKS.backorders,
        kind: "scheduled",
      }),
    );
  }
  if (input.canSeeOrders) {
    const settings = await prisma.autopartOngoingSalesFeedSettings.findUnique({ where: { id: "default" } });
    const first = settings?.lastSuccess504At ?? null;
    const second = settings?.lastSuccessTrm21qcAt ?? null;
    const due = dueOngoingSalesWindow(now, true);
    let slot: Date | null = null;
    if (due) {
      const [year, month, day] = due.businessDate.split("-").map(Number);
      slot = londonWallTimeToUtc(year!, month!, day!, due.hour, AUTOPART_ONGOING_SALES_SCHEDULE_MINUTE, 0);
    }
    const older = first && second ? (first < second ? first : second) : null;
    const missed = Boolean(slot && older && older.getTime() < slot.getTime());
    const minutesSince = slot ? Math.round((now.getTime() - slot.getTime()) / 60_000) : null;
    const status = classifyPairedFeed({
      lastError: Boolean(settings?.lastError),
      hasFirst: Boolean(first),
      hasSecond: Boolean(second),
      missedCurrentWindow: missed,
      minutesSinceWindowOpened: minutesSince,
      minutesUntilNext: minutesUntilOngoingSalesWindow(now),
    });
    const latest = first && second ? (first > second ? first : second) : first ?? second;
    rows.push(
      freshnessRow({
        id: "fulfilment",
        label: "Fulfilment",
        status,
        detail: settings?.lastError
          ? "Latest import reported an error"
          : (formatOperationalDateTime(latest) ?? "Not imported"),
        scheduleLabel: AUTOPART_ONGOING_SALES_SCHEDULE_LABEL,
        href: input.canSeeSettings ? OPERATIONAL_LINKS.fulfilmentSettings : null,
        kind: "scheduled",
      }),
    );
    const salesAt = await latestSalesUpdatedAt();
    rows.push(
      freshnessRow({
        id: "sales-history",
        label: "Sales history",
        status: classifyManualImport({
          updatedAt: salesAt?.toISOString() ?? null,
          stale: false,
        }),
        detail: formatOperationalDateTime(salesAt) ?? "Not imported",
        scheduleLabel: null,
        href: input.canSeePurchasing ? OPERATIONAL_LINKS.forecast : null,
        kind: "manual",
      }),
    );
  }
  if (input.canSeePurchasing) {
    const fba = input.purchasing
      ? {
          updatedAt: input.purchasing.fbaUpdatedAt,
          updatedLabel: input.purchasing.fbaUpdatedLabel,
          stale: input.purchasing.fbaStale,
        }
      : await loadFbaFreshness(now);
    const updatedAt = "updatedAt" in fba ? fba.updatedAt : null;
    const stale = fba.stale;
    const label = "updatedLabel" in fba ? fba.updatedLabel : "Not imported";
    rows.push(
      freshnessRow({
        id: "fba-stock",
        label: "FBA stock",
        status: classifyManualImport({ updatedAt, stale }),
        detail: label,
        scheduleLabel: "Manual import",
        href: OPERATIONAL_LINKS.forecast,
        kind: "manual",
      }),
    );
  }
  return rows;
}

export async function ensureDashboardAnnouncement(): Promise<void> {
  const version = "2026.10.08-dashboard";
  const existing = await prisma.versionUpdate.findFirst({ where: { version }, select: { id: true } });
  if (existing) return;
  await prisma.versionUpdate.create({
    data: {
      version,
      title: "Improved Dashboard & Navigation",
      summary: "A clearer view of what needs attention, and an easier main navigation.",
      content: {
        intro:
          "The Dashboard now gives you a clearer view of what needs attention across Sales, CRM, stock and purchasing. We've also reorganised the main navigation to make the most-used areas easier to find.",
        sections: [
          {
            heading: "Purchasing",
            body: "Purchasing now brings Stock Forecast, Purchase Planner, Backorders, Suppliers and Cost Intelligence together in one area.",
          },
        ],
      },
      status: "PUBLISHED",
      audience: { mode: "ALL_INTERNAL" },
      publishedAt: new Date(),
    },
  });
}

export async function loadOperationalOverview(input: {
  actorUserId: string;
  accessible: string[] | "all";
  canSeeOrders: boolean;
  canSeeApplications: boolean;
  canSeePurchasing: boolean;
  canSeeCrm: boolean;
  canSeeTasks: boolean;
  canSeeStock: boolean;
  canSeeSettings: boolean;
  tradeApplications: number;
}): Promise<OperationalOverview> {
  try {
    await ensureDashboardAnnouncement();
  } catch {
    /* Announcement failure must not blank the dashboard. */
  }

  const [sales, backorders, purchasingResult, conditions, crm] = await Promise.all([
    input.canSeeOrders ? loadSales(input.accessible) : Promise.resolve(null),
    input.canSeePurchasing ? loadBackorderSummary(input.actorUserId) : Promise.resolve(null),
    input.canSeePurchasing
      ? summarisePurchasingAttention(input.actorUserId)
          .then((summary) => ({ error: null, summary }))
          .catch((error: unknown) => ({ error: widgetError(error), summary: null }))
      : Promise.resolve(null),
    input.canSeePurchasing ? loadConditionCounts() : Promise.resolve(null),
    input.canSeeCrm || input.canSeeTasks || input.canSeeApplications
      ? loadCrm(input)
      : Promise.resolve(null),
  ]);

  let freshness: OperationalOverview["freshness"];
  try {
    freshness = {
      error: null,
      rows: await loadFreshness({
        canSeeStock: input.canSeeStock,
        canSeePurchasing: input.canSeePurchasing,
        canSeeOrders: input.canSeeOrders,
        canSeeSettings: input.canSeeSettings,
        purchasing: purchasingResult?.summary ?? null,
      }),
    };
  } catch (error) {
    freshness = { error: widgetError(error), rows: [] };
  }

  const facts: AttentionFacts = {};
  if (input.canSeeApplications && input.tradeApplications > 0) facts.tradeApplications = input.tradeApplications;
  if (crm?.overdueTasks) facts.overdueTasks = crm.overdueTasks;
  if (backorders?.summary && backorders.summary.noStockNoIncoming > 0) {
    facts.noStockNoIncoming = backorders.summary.noStockNoIncoming;
  }
  if (purchasingResult?.summary) {
    const summary = purchasingResult.summary;
    if (summary.backordersNoSupplier > 0) facts.backordersNoSupplier = summary.backordersNoSupplier;
    if (summary.backordersAtRisk > 0) facts.backordersAtRisk = summary.backordersAtRisk;
    if (summary.orderNow > 0) facts.orderNow = summary.orderNow;
    if (summary.missingCost > 0) facts.missingCost = summary.missingCost;
    if (summary.fbaStale) {
      facts.fbaStale = true;
      facts.fbaUpdatedLabel = summary.fbaUpdatedLabel;
    }
  }
  const warehouse = freshness.rows.find((row) => row.id === "warehouse-stock");
  if (warehouse?.status === "failed") facts.warehouseImportFailed = true;

  return {
    sales,
    backorders,
    purchasing: purchasingResult,
    conditions,
    crm,
    freshness,
    attention: buildOperationalAttention(facts),
  };
}
