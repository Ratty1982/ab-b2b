/**
 * Sales Intelligence — Daily Sales Brief.
 *
 * Reuses getSalesRepPortfolio for attention / opportunities / growth.
 * Today’s activity, returned customers, and first-time product/brand use
 * SQL aggregation (no full AutopartSalesLine history load into Node).
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { chunkArray, SAFE_IN_LIST_CHUNK } from "@/server/db/prisma-in-chunks";
import { addDaysIso, todayLondonDateOnly } from "@/domain/sales-history-period";
import { formatGbp, moneyMinorToDto, parseSalesNetMinor } from "@/domain/sales-intelligence";
import { compareOpportunityRows, PORTFOLIO_DEFAULT_PERIOD } from "@/domain/sales-portfolio";
import {
  activityStatus,
  cadenceHumanLabel,
  DAILY_BRIEF_ACTIVITY_PAGE_SIZE,
  DAILY_BRIEF_FIRST_EVENT_LIMIT,
  DAILY_BRIEF_FOLLOWUP_LIMIT,
  DAILY_BRIEF_METHODOLOGY,
  DAILY_BRIEF_OPPORTUNITY_LIMIT,
  DAILY_BRIEF_POSITIVE_LIMIT,
  formatLondonBriefDate,
  formatPurchaseDateLabel,
  humanComparisonPhrase,
  isEarlyCalendarPeriod,
  isNewCustomerToday,
  isReturnedCustomerFromCadence,
  periodElapsedDays,
  personalisedGreetingLine,
  pickDailyBriefPriorities,
  positiveMovementSortRank,
  previousLondonCivilDay,
  toAttentionItem,
  toOpportunityItem,
  type DailyBriefActivityRow,
  type DailyBriefFollowUpItem,
  type DailyBriefPositiveItem,
  type DailyBriefSinceYesterday,
  type DailyBriefSummary,
} from "@/domain/sales-daily-brief";
import { getSalesRepPortfolio } from "@/server/sales-intelligence/portfolio";
import { listCrmTasks, completeCrmTask } from "@/server/sales-intelligence/followup";
import { siFollowupReasonLabel } from "@/domain/sales-followup";

async function requireBriefActor(actorUserId: string): Promise<LoadedAccessProfile> {
  const profile = await requireSystemPermission(actorUserId, "sales_intelligence.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Sales Intelligence is internal only", "FORBIDDEN", 403);
  }
  return profile;
}

const querySchema = z.object({
  salesRepId: z.string().optional().nullable(),
  unassigned: z.boolean().optional().nullable(),
  customerGroupId: z.string().optional().nullable(),
  activityPage: z.number().int().min(1).optional().nullable(),
  activityPageSize: z.number().int().min(1).max(100).optional().nullable(),
});

type DayAgg = {
  companyId: string;
  net: Prisma.Decimal | null;
  units: Prisma.Decimal | null;
  products: bigint | number | null;
  hasInvoice: boolean;
};

async function todayActivityByCompany(
  companyIds: string[],
  day: string,
): Promise<Map<string, { netMinor: bigint; units: number; products: number; hasInvoice: boolean }>> {
  const out = new Map<string, { netMinor: bigint; units: number; products: number; hasInvoice: boolean }>();
  if (companyIds.length === 0) return out;
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const dayEnd = new Date(`${day}T23:59:59.999Z`);

  for (const chunk of chunkArray(companyIds, SAFE_IN_LIST_CHUNK)) {
    const rows = await prisma.$queryRaw<DayAgg[]>`
      SELECT
        l."companyId" AS "companyId",
        COALESCE(SUM(l."salesNet"), 0) AS net,
        COALESCE(SUM(l.units), 0) AS units,
        COUNT(DISTINCT CASE WHEN l."documentType" = 'INVOICE' THEN UPPER(l.sku) END) AS products,
        BOOL_OR(l."documentType" = 'INVOICE') AS "hasInvoice"
      FROM "AutopartSalesLine" l
      INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l."companyId" IN (${Prisma.join(chunk)})
        AND d."companyId" IS NOT NULL
        AND d."documentDate" >= ${dayStart}
        AND d."documentDate" <= ${dayEnd}
      GROUP BY l."companyId"
    `;
    for (const r of rows) {
      out.set(r.companyId, {
        netMinor: parseSalesNetMinor(r.net),
        units: Number(r.units ?? 0),
        products: Number(r.products ?? 0),
        hasInvoice: Boolean(r.hasInvoice),
      });
    }
  }
  return out;
}

async function invoicePurchaseDatesByCompany(
  companyIds: string[],
  lookbackFrom: string,
  asOf: string,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (companyIds.length === 0) return out;
  const bounds = {
    gte: new Date(`${lookbackFrom}T00:00:00.000Z`),
    lte: new Date(`${asOf}T23:59:59.999Z`),
  };
  for (const chunk of chunkArray(companyIds, SAFE_IN_LIST_CHUNK)) {
    const rows = await prisma.$queryRaw<Array<{ companyId: string; d: Date }>>`
      SELECT DISTINCT l."companyId" AS "companyId", d."documentDate" AS d
      FROM "AutopartSalesLine" l
      INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l."companyId" IN (${Prisma.join(chunk)})
        AND l."documentType" = 'INVOICE'
        AND d."companyId" IS NOT NULL
        AND d."documentDate" IS NOT NULL
        AND d."documentDate" >= ${bounds.gte}
        AND d."documentDate" <= ${bounds.lte}
    `;
    for (const r of rows) {
      const iso = r.d.toISOString().slice(0, 10);
      const list = out.get(r.companyId) ?? [];
      list.push(iso);
      out.set(r.companyId, list);
    }
  }
  return out;
}

type FirstSkuRow = {
  companyId: string;
  sku: string;
  net: Prisma.Decimal | null;
};

type FirstBrandRow = {
  companyId: string;
  brandId: string;
  brandName: string;
  sampleSku: string;
};

/**
 * First-time SKU purchases today: invoice line today AND no prior invoice for that SKU.
 * Uses NOT EXISTS — does not load full customer histories.
 */
async function firstTimeSkuPurchasesToday(
  companyIds: string[],
  today: string,
): Promise<FirstSkuRow[]> {
  if (companyIds.length === 0) return [];
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const dayEnd = new Date(`${today}T23:59:59.999Z`);
  const out: FirstSkuRow[] = [];

  for (const chunk of chunkArray(companyIds, SAFE_IN_LIST_CHUNK)) {
    const rows = await prisma.$queryRaw<FirstSkuRow[]>`
      SELECT
        l."companyId" AS "companyId",
        UPPER(l.sku) AS sku,
        SUM(l."salesNet") AS net
      FROM "AutopartSalesLine" l
      INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l."companyId" IN (${Prisma.join(chunk)})
        AND l."documentType" = 'INVOICE'
        AND d."companyId" IS NOT NULL
        AND d."documentDate" >= ${dayStart}
        AND d."documentDate" <= ${dayEnd}
        AND NOT EXISTS (
          SELECT 1
          FROM "AutopartSalesLine" p
          INNER JOIN "AutopartSalesDocument" pd ON pd.id = p."documentId"
          WHERE p."companyId" = l."companyId"
            AND UPPER(p.sku) = UPPER(l.sku)
            AND p."documentType" = 'INVOICE'
            AND pd."companyId" IS NOT NULL
            AND pd."documentDate" IS NOT NULL
            AND pd."documentDate" < ${dayStart}
        )
      GROUP BY l."companyId", UPPER(l.sku)
      ORDER BY l."companyId", UPPER(l.sku)
      LIMIT ${DAILY_BRIEF_FIRST_EVENT_LIMIT * 4}
    `;
    out.push(...rows);
  }
  return out;
}

/**
 * First-time brand purchases today — only where ProductVariant → Product → Brand is reliable.
 * Unmapped historic SKUs never produce a brand event.
 */
async function firstTimeBrandPurchasesToday(
  companyIds: string[],
  today: string,
): Promise<FirstBrandRow[]> {
  if (companyIds.length === 0) return [];
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const dayEnd = new Date(`${today}T23:59:59.999Z`);
  const out: FirstBrandRow[] = [];

  for (const chunk of chunkArray(companyIds, SAFE_IN_LIST_CHUNK)) {
    const rows = await prisma.$queryRaw<FirstBrandRow[]>`
      SELECT
        t."companyId" AS "companyId",
        t."brandId" AS "brandId",
        t."brandName" AS "brandName",
        MIN(t.sku) AS "sampleSku"
      FROM (
        SELECT DISTINCT
          l."companyId",
          p."brandId",
          b.name AS "brandName",
          UPPER(l.sku) AS sku
        FROM "AutopartSalesLine" l
        INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
        INNER JOIN "ProductVariant" pv ON UPPER(pv.sku) = UPPER(l.sku)
        INNER JOIN "Product" p ON p.id = pv."productId"
        INNER JOIN "Brand" b ON b.id = p."brandId"
        WHERE l."companyId" IN (${Prisma.join(chunk)})
          AND l."documentType" = 'INVOICE'
          AND d."companyId" IS NOT NULL
          AND d."documentDate" >= ${dayStart}
          AND d."documentDate" <= ${dayEnd}
          AND p."brandId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "AutopartSalesLine" p2
            INNER JOIN "AutopartSalesDocument" pd ON pd.id = p2."documentId"
            INNER JOIN "ProductVariant" pv2 ON UPPER(pv2.sku) = UPPER(p2.sku)
            INNER JOIN "Product" pr2 ON pr2.id = pv2."productId"
            WHERE p2."companyId" = l."companyId"
              AND p2."documentType" = 'INVOICE'
              AND pd."companyId" IS NOT NULL
              AND pd."documentDate" IS NOT NULL
              AND pd."documentDate" < ${dayStart}
              AND pr2."brandId" = p."brandId"
          )
      ) t
      GROUP BY t."companyId", t."brandId", t."brandName"
      ORDER BY t."companyId", t."brandName"
      LIMIT ${DAILY_BRIEF_FIRST_EVENT_LIMIT * 2}
    `;
    out.push(...rows);
  }
  return out;
}

async function resolveProductMeta(skus: string[]): Promise<
  Map<string, { productName: string | null; brandId: string | null; brandName: string | null }>
> {
  const out = new Map<
    string,
    { productName: string | null; brandId: string | null; brandName: string | null }
  >();
  if (skus.length === 0) return out;
  for (const chunk of chunkArray(skus, 200)) {
    const variants = await prisma.productVariant.findMany({
      where: { OR: chunk.map((sku) => ({ sku: { equals: sku, mode: "insensitive" } })) },
      select: {
        sku: true,
        product: {
          select: {
            name: true,
            brandId: true,
            brand: { select: { name: true } },
          },
        },
      },
    });
    for (const v of variants) {
      out.set(v.sku.toUpperCase(), {
        productName: v.product.name,
        brandId: v.product.brandId,
        brandName: v.product.brand?.name ?? null,
      });
    }
  }
  return out;
}

async function followUpCountsForDay(
  profile: LoadedAccessProfile,
  actorUserId: string,
  day: string,
  companyIds: string[] | null,
): Promise<{ created: number; completed: number }> {
  if (!hasPermission(profile, "tasks.view")) {
    return { created: 0, completed: 0 };
  }
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const dayEnd = new Date(`${day}T23:59:59.999Z`);
  const companyFilter: Prisma.TaskWhereInput =
    companyIds == null
      ? {}
      : companyIds.length === 0
        ? { companyId: { in: ["__none__"] } }
        : { companyId: { in: companyIds } };

  const base: Prisma.TaskWhereInput = { ...companyFilter };
  if (
    !hasPermission(profile, "crm.manage") &&
    !hasPermission(profile, "sales.view_all_accounts") &&
    !hasPermission(profile, "admin.access")
  ) {
    base.AND = [{ OR: [{ assigneeId: actorUserId }, { createdById: actorUserId }] }];
  }

  const [created, completed] = await Promise.all([
    prisma.task.count({
      where: { ...base, createdAt: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.task.count({
      where: {
        ...base,
        status: "DONE",
        completedAt: { gte: dayStart, lte: dayEnd },
      },
    }),
  ]);
  return { created, completed };
}

async function loadBriefFollowUps(
  actorUserId: string,
  profile: LoadedAccessProfile,
): Promise<{ overdue: DailyBriefFollowUpItem[]; dueToday: DailyBriefFollowUpItem[]; canComplete: boolean }> {
  const canComplete = hasPermission(profile, "tasks.manage");
  if (!hasPermission(profile, "tasks.view")) {
    return { overdue: [], dueToday: [], canComplete: false };
  }

  try {
    const [overdueRes, todayRes] = await Promise.all([
      listCrmTasks(actorUserId, {
        due: "OVERDUE",
        status: "OPEN_ACTIVE",
        page: 1,
        pageSize: DAILY_BRIEF_FOLLOWUP_LIMIT,
      }),
      listCrmTasks(actorUserId, {
        due: "TODAY",
        status: "OPEN_ACTIVE",
        page: 1,
        pageSize: DAILY_BRIEF_FOLLOWUP_LIMIT,
      }),
    ]);

    const mapItem = (
      t: (typeof overdueRes.items)[number],
      bucket: "OVERDUE" | "DUE_TODAY",
    ): DailyBriefFollowUpItem => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt,
      sourceLabel: t.sourceLabel,
      sourceReason: t.sourceReason
        ? siFollowupReasonLabel(t.sourceReason)
        : null,
      sourceSku: t.sourceSku,
      companyId: t.company?.id ?? null,
      companyName: t.company?.name ?? null,
      assigneeName: t.assigneeName,
      bucket,
    });

    return {
      overdue: overdueRes.items.map((t) => mapItem(t, "OVERDUE")),
      dueToday: todayRes.items.map((t) => mapItem(t, "DUE_TODAY")),
      canComplete,
    };
  } catch {
    return { overdue: [], dueToday: [], canComplete: false };
  }
}

export async function getDailySalesBrief(actorUserId: string, raw: unknown) {
  const profile = await requireBriefActor(actorUserId);
  const input = querySchema.parse(raw ?? {});
  const today = todayLondonDateOnly();
  const yesterday = previousLondonCivilDay(today);
  const briefDateLabel = formatLondonBriefDate(today);

  const { recordStaffWorkspaceOpen } = await import("@/server/audit/staff-workspace-open");
  void recordStaffWorkspaceOpen({
    actorUserId: profile.userId,
    action: "si.daily_brief.opened",
    detail: "Viewed sales brief",
  });

  // Reuse Portfolio engine for attention / opportunities / growth (THIS_MONTH comparable period).
  const portfolio = await getSalesRepPortfolio(actorUserId, {
    period: PORTFOLIO_DEFAULT_PERIOD,
    salesRepId: input.salesRepId ?? null,
    unassigned: input.unassigned ?? false,
    customerGroupId: input.customerGroupId ?? null,
    filter: "ALL",
    page: 1,
    allRows: true,
    skipWorkspaceOpen: true,
  });

  const companyIds = portfolio.rows.map((r) => r.companyId);
  const byId = new Map(portfolio.rows.map((r) => [r.companyId, r]));

  const cadenceFrom = addDaysIso(today, -729);
  const [todayAgg, purchaseDates, firstSkus, firstBrands, followUps, crmDayCounts] =
    await Promise.all([
      todayActivityByCompany(companyIds, today),
      invoicePurchaseDatesByCompany(companyIds, cadenceFrom, today),
      firstTimeSkuPurchasesToday(companyIds, today),
      firstTimeBrandPurchasesToday(companyIds, today),
      loadBriefFollowUps(actorUserId, profile),
      followUpCountsForDay(profile, actorUserId, today, companyIds),
    ]);

  // Customers with invoice presence today
  const purchasedTodayIds = [...todayAgg.entries()]
    .filter(([, v]) => v.hasInvoice)
    .map(([id]) => id);

  let netSalesTodayMinor = 0n;
  for (const v of todayAgg.values()) netSalesTodayMinor += v.netMinor;

  const elapsedDays = periodElapsedDays({
    from: portfolio.period.displayFrom,
    to: portfolio.period.displayTo,
  });
  const earlyPeriod = isEarlyCalendarPeriod({
    periodKey: portfolio.period.key,
    elapsedDays,
  });
  const comparisonPhrase = humanComparisonPhrase(portfolio.period.key);
  const periodShortLabel =
    portfolio.period.key === "THIS_MONTH"
      ? "this month"
      : portfolio.period.key === "THIS_QUARTER"
        ? "this quarter"
        : portfolio.period.key === "THIS_YEAR"
          ? "this year"
          : "this period";

  const priorityEligible = pickDailyBriefPriorities(portfolio.rows, {
    earlyPeriod,
    limit: Math.max(portfolio.rows.length, 1),
  });
  const priorityRows = priorityEligible.slice(0, 5);
  const opportunityRows = [...portfolio.rows]
    .filter((r) => r.opportunityCount > 0)
    .sort(compareOpportunityRows)
    .slice(0, DAILY_BRIEF_OPPORTUNITY_LIMIT);

  // Returned + positive movement
  const positive: DailyBriefPositiveItem[] = [];
  const returnedIds = new Set<string>();
  const newTodayIds = new Set<string>();

  for (const companyId of purchasedTodayIds) {
    const dates = purchaseDates.get(companyId) ?? [];
    const row = byId.get(companyId);
    if (!row) continue;

    if (isNewCustomerToday(dates, today)) {
      newTodayIds.add(companyId);
    }

    const ret = isReturnedCustomerFromCadence({ invoicePurchaseDates: dates, today });
    if (ret.returned) {
      returnedIds.add(companyId);
      const dayNet = todayAgg.get(companyId);
      const amount = dayNet ? formatGbp(moneyMinorToDto(dayNet.netMinor)) : "£0.00";
      positive.push({
        kind: "RETURNED_CUSTOMER",
        companyId,
        companyName: row.companyName,
        customerGroupName: row.customerGroupName,
        salesRepName: row.salesRepName,
        mamAccount: row.mamAccount,
        headline: "Customer returned",
        detail:
          ret.daysInactive != null
            ? `${row.companyName} ordered ${amount} today after ${ret.daysInactive} days.`
            : `${row.companyName} ordered ${amount} today after a quiet spell.`,
        netSalesToday: dayNet ? moneyMinorToDto(dayNet.netMinor) : "0",
        daysInactive: ret.daysInactive,
        typicalIntervalDays: ret.typicalIntervalDays,
      });
    }
  }

  // Material growth (Portfolio classification) — prefer customers with today invoice activity
  const growing = portfolio.rows
    .filter((r) => r.growing)
    .sort((a, b) => {
      const aToday = todayAgg.get(a.companyId)?.hasInvoice ? 1 : 0;
      const bToday = todayAgg.get(b.companyId)?.hasInvoice ? 1 : 0;
      if (aToday !== bToday) return bToday - aToday;
      return Number(b.movement) - Number(a.movement);
    })
    .slice(0, 5);

  for (const row of growing) {
    if (returnedIds.has(row.companyId)) continue;
    const ahead = formatGbp(row.movement.startsWith("-") ? row.movement.slice(1) : row.movement);
    positive.push({
      kind: "GROWING",
      companyId: row.companyId,
      companyName: row.companyName,
      customerGroupName: row.customerGroupName,
      salesRepName: row.salesRepName,
      mamAccount: row.mamAccount,
      headline: "Sales growth",
      detail: `${row.companyName} is ${ahead} ahead of ${comparisonPhrase}.`,
      netSalesToday: todayAgg.has(row.companyId)
        ? moneyMinorToDto(todayAgg.get(row.companyId)!.netMinor)
        : null,
    });
  }

  const firstSkuLimited = firstSkus.slice(0, DAILY_BRIEF_FIRST_EVENT_LIMIT);
  const oppSkus = opportunityRows.flatMap((r) =>
    r.opportunities.flatMap((o) => [o.sku, o.seedSku].filter(Boolean) as string[]),
  );
  const meta = await resolveProductMeta([...firstSkuLimited.map((r) => r.sku), ...oppSkus]);
  const productNameBySku = new Map<string, string>();
  for (const [sku, m] of meta) {
    if (m.productName) productNameBySku.set(sku, m.productName);
  }

  for (const fs of firstSkuLimited) {
    const row = byId.get(fs.companyId);
    if (!row) continue;
    const m = meta.get(fs.sku.toUpperCase());
    const label = m?.productName ?? fs.sku;
    positive.push({
      kind: "FIRST_PRODUCT",
      companyId: fs.companyId,
      companyName: row.companyName,
      customerGroupName: row.customerGroupName,
      salesRepName: row.salesRepName,
      mamAccount: row.mamAccount,
      headline: "New product purchase",
      detail: `${row.companyName} bought ${label} for the first time.`,
      netSalesToday: moneyMinorToDto(parseSalesNetMinor(fs.net)),
      sku: fs.sku,
      productName: m?.productName ?? null,
      brandName: m?.brandName ?? null,
    });
  }

  for (const fb of firstBrands.slice(0, DAILY_BRIEF_FIRST_EVENT_LIMIT)) {
    const row = byId.get(fb.companyId);
    if (!row) continue;
    positive.push({
      kind: "FIRST_BRAND",
      companyId: fb.companyId,
      companyName: row.companyName,
      customerGroupName: row.customerGroupName,
      salesRepName: row.salesRepName,
      mamAccount: row.mamAccount,
      headline: "New brand purchase",
      detail: `${row.companyName} bought ${fb.brandName} for the first time.`,
      netSalesToday: todayAgg.has(fb.companyId)
        ? moneyMinorToDto(todayAgg.get(fb.companyId)!.netMinor)
        : null,
      sku: fb.sampleSku,
      brandName: fb.brandName,
    });
  }

  positive.sort((a, b) => {
    const ra = positiveMovementSortRank(a.kind);
    const rb = positiveMovementSortRank(b.kind);
    if (ra !== rb) return ra - rb;
    return a.companyName.localeCompare(b.companyName);
  });

  // Today's activity table (invoice presence only)
  const activityAll: DailyBriefActivityRow[] = [];
  for (const companyId of purchasedTodayIds) {
    const row = byId.get(companyId);
    const agg = todayAgg.get(companyId);
    if (!row || !agg) continue;
    const dates = purchaseDates.get(companyId) ?? [];
    const lastBefore = dates.filter((d) => d < today).sort().at(-1) ?? null;
    const returned = returnedIds.has(companyId);
    const newToday = newTodayIds.has(companyId);
    activityAll.push({
      companyId,
      companyName: row.companyName,
      customerGroupName: row.customerGroupName,
      salesRepName: row.salesRepName,
      mamAccount: row.mamAccount,
      netSalesToday: moneyMinorToDto(agg.netMinor),
      units: agg.units,
      products: agg.products,
      lastPurchaseBeforeToday: lastBefore,
      lastPurchaseBeforeTodayLabel: formatPurchaseDateLabel(lastBefore, today),
      cadenceHuman: cadenceHumanLabel(row.typicalIntervalDays),
      status: activityStatus({
        returned,
        newToday,
        growing: row.growing,
      }),
    });
  }
  activityAll.sort(
    (a, b) =>
      Number(b.netSalesToday) - Number(a.netSalesToday) ||
      a.companyName.localeCompare(b.companyName),
  );

  const activityPage = input.activityPage ?? 1;
  const activityPageSize = input.activityPageSize ?? DAILY_BRIEF_ACTIVITY_PAGE_SIZE;
  const activityTotal = activityAll.length;
  const activityRows = activityAll.slice(
    (activityPage - 1) * activityPageSize,
    activityPage * activityPageSize,
  );

  const summary: DailyBriefSummary = {
    customersPurchased: purchasedTodayIds.length,
    netSalesToday: moneyMinorToDto(netSalesTodayMinor),
    needAttention: priorityEligible.length,
    newOpportunities: portfolio.rows.filter((r) => r.opportunityCount > 0).length,
    followUpsDueToday: followUps.dueToday.length,
    overdueFollowUps: followUps.overdue.length,
  };

  const personalized = !portfolio.canSelectSalesRep;
  const greeting = personalized
    ? {
        personalized: true as const,
        line: personalisedGreetingLine(profile.name),
        subtitle: "Here's what is happening across your customers today.",
      }
    : {
        personalized: false as const,
        line: "Daily Sales Brief",
        subtitle: "Here's what is happening across the selected customer portfolio today.",
        viewingLabel: portfolio.salesRepFilterLabel,
      };

  // For due today / overdue totals, listCrmTasks already capped — refetch counts when possible.
  let followUpsDueTodayCount = followUps.dueToday.length;
  let overdueFollowUpsCount = followUps.overdue.length;
  if (hasPermission(profile, "tasks.view")) {
    try {
      const [od, td] = await Promise.all([
        listCrmTasks(actorUserId, { due: "OVERDUE", status: "OPEN_ACTIVE", page: 1, pageSize: 1 }),
        listCrmTasks(actorUserId, { due: "TODAY", status: "OPEN_ACTIVE", page: 1, pageSize: 1 }),
      ]);
      overdueFollowUpsCount = od.total;
      followUpsDueTodayCount = td.total;
      summary.overdueFollowUps = overdueFollowUpsCount;
      summary.followUpsDueToday = followUpsDueTodayCount;
    } catch {
      /* keep list lengths */
    }
  }

  const sinceYesterday: DailyBriefSinceYesterday = {
    customersPurchased: purchasedTodayIds.length,
    dormantReturned: returnedIds.size,
    firstTimeProductPurchases: firstSkuLimited.length,
    followUpsCreated: crmDayCounts.created,
    followUpsCompleted: crmDayCounts.completed,
  };

  return {
    businessDate: today,
    businessDateLabel: briefDateLabel,
    yesterday,
    greeting,
    comparisonPhrase,
    earlyPeriod,
    salesRepFilterLabel: portfolio.salesRepFilterLabel,
    canSelectSalesRep: portfolio.canSelectSalesRep,
    actorSalesRepId: portfolio.actorSalesRepId,
    salesReps: portfolio.salesReps,
    customerGroups: portfolio.customerGroups,
    period: portfolio.period,
    comparison: portfolio.comparison,
    summary,
    sinceYesterday,
    needsAttention: priorityRows.map((row) => {
      const day = todayAgg.get(row.companyId);
      const purchasedToday = Boolean(day?.hasInvoice);
      return toAttentionItem(row, {
        purchasedToday,
        todayNetSales: day ? moneyMinorToDto(day.netMinor) : null,
        todayUnits: day?.units ?? null,
        todayProducts: day?.products ?? null,
        comparisonPhrase,
        periodShortLabel,
      });
    }),
    opportunities: opportunityRows.map((row) =>
      toOpportunityItem(row, { productNameBySku, earlyPeriod }),
    ),
    positiveMovement: positive.slice(0, DAILY_BRIEF_POSITIVE_LIMIT),
    followUps: {
      overdue: followUps.overdue,
      dueToday: followUps.dueToday,
      overdueTotal: overdueFollowUpsCount,
      dueTodayTotal: followUpsDueTodayCount,
      canComplete: followUps.canComplete,
    },
    activity: {
      rows: activityRows,
      page: activityPage,
      pageSize: activityPageSize,
      total: activityTotal,
    },
    portfolioHref: {
      path: "/sales/sales-intelligence/portfolio",
      filterNeedsAttention: "NEEDS_ATTENTION",
      filterOpportunities: "HAS_OPPORTUNITIES",
    },
    methodology: DAILY_BRIEF_METHODOLOGY,
  };
}

/** Complete a CRM follow-up from Daily Brief when permitted. */
export async function completeDailyBriefFollowUp(actorUserId: string, raw: unknown) {
  await requireBriefActor(actorUserId);
  return completeCrmTask(actorUserId, raw);
}
