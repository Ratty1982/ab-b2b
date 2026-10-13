/**
 * Promotion performance from placed order lines.
 * OrderItem.promotionId is the only attribution source.
 * Baskets, page views, and current catalogue prices are not used.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireAnySystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";
import { moneyFromUnknown, moneyToString } from "@/domain/money";
import { campaignDisplayStatus } from "@/domain/promotion-campaigns";

export async function getCampaignPerformance(
  actorUserId: string,
  raw: {
    promotionId: string;
    page?: number;
    pageSize?: number;
    from?: string | null;
    to?: string | null;
  },
) {
  const profile = await requireAnySystemPermission(actorUserId, ["promotions.report", "promotions.approve"]);
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Trade users cannot view promotion reports", "FORBIDDEN", 403);
  }
  const promotion = await prisma.promotion.findUnique({ where: { id: raw.promotionId } });
  if (!promotion) throw new AuthError("Promotion not found", "NOT_FOUND", 404);

  const companyIds = await getAccessibleCompanyIdsForSales(profile);
  const page = Math.max(1, raw.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, raw.pageSize ?? 25));
  const from = raw.from ? new Date(raw.from) : null;
  const to = raw.to ? new Date(raw.to) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    throw new AuthError("Invalid report date", "VALIDATION", 400);
  }

  const scopeSql =
    companyIds === "all"
      ? Prisma.sql`TRUE`
      : companyIds.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`o."companyId" IN (${Prisma.join(companyIds)})`;
  const fromSql = from ? Prisma.sql`COALESCE(o."placedAt", o."createdAt") >= ${from}` : Prisma.sql`TRUE`;
  const toSql = to ? Prisma.sql`COALESCE(o."placedAt", o."createdAt") < ${to}` : Prisma.sql`TRUE`;
  const whereSql = Prisma.sql`
    i."promotionId" = ${promotion.id}
    AND ${scopeSql}
    AND ${fromSql}
    AND ${toSql}
  `;

  const [headline] = await prisma.$queryRaw<
    Array<{
      placed_orders: number;
      placed_customers: number;
      placed_units: number;
      placed_revenue: Prisma.Decimal;
      standing_orders: number;
      standing_customers: number;
      standing_units: number;
      standing_revenue: Prisma.Decimal;
      completed_orders: number;
      completed_units: number;
      completed_revenue: Prisma.Decimal;
      cancelled_orders: number;
      cancelled_units: number;
      cancelled_revenue: Prisma.Decimal;
      savings: Prisma.Decimal;
      lines_with_baseline: number;
      lines_without_baseline: number;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(DISTINCT o.id) FILTER (WHERE o.status::text <> 'DRAFT')::int AS placed_orders,
      COUNT(DISTINCT o."companyId") FILTER (WHERE o.status::text <> 'DRAFT')::int AS placed_customers,
      COALESCE(SUM(i.qty) FILTER (WHERE o.status::text <> 'DRAFT'), 0)::int AS placed_units,
      COALESCE(SUM(i."lineTotal") FILTER (WHERE o.status::text <> 'DRAFT'), 0) AS placed_revenue,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status::text <> 'DRAFT' AND o.status::text <> 'CANCELLED')::int AS standing_orders,
      COUNT(DISTINCT o."companyId") FILTER (WHERE o.status::text <> 'DRAFT' AND o.status::text <> 'CANCELLED')::int AS standing_customers,
      COALESCE(SUM(i.qty) FILTER (WHERE o.status::text <> 'DRAFT' AND o.status::text <> 'CANCELLED'), 0)::int AS standing_units,
      COALESCE(SUM(i."lineTotal") FILTER (WHERE o.status::text <> 'DRAFT' AND o.status::text <> 'CANCELLED'), 0) AS standing_revenue,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status::text IN ('DISPATCHED', 'DELIVERED'))::int AS completed_orders,
      COALESCE(SUM(i.qty) FILTER (WHERE o.status::text IN ('DISPATCHED', 'DELIVERED')), 0)::int AS completed_units,
      COALESCE(SUM(i."lineTotal") FILTER (WHERE o.status::text IN ('DISPATCHED', 'DELIVERED')), 0) AS completed_revenue,
      COUNT(DISTINCT o.id) FILTER (WHERE o.status::text = 'CANCELLED')::int AS cancelled_orders,
      COALESCE(SUM(i.qty) FILTER (WHERE o.status::text = 'CANCELLED'), 0)::int AS cancelled_units,
      COALESCE(SUM(i."lineTotal") FILTER (WHERE o.status::text = 'CANCELLED'), 0) AS cancelled_revenue,
      COALESCE(SUM(
        CASE
          WHEN o.status::text <> 'DRAFT' AND o.status::text <> 'CANCELLED'
           AND i."promotionBaselineUnitPrice" IS NOT NULL
           AND i."promotionBaselineUnitPrice" >= i."unitPrice"
          THEN (i."promotionBaselineUnitPrice" - i."unitPrice") * i.qty
          ELSE 0
        END
      ), 0) AS savings,
      COUNT(*) FILTER (
        WHERE o.status::text <> 'DRAFT' AND o.status::text <> 'CANCELLED'
          AND i."promotionBaselineUnitPrice" IS NOT NULL
          AND i."promotionBaselineUnitPrice" >= i."unitPrice"
      )::int AS lines_with_baseline,
      COUNT(*) FILTER (
        WHERE o.status::text <> 'DRAFT' AND o.status::text <> 'CANCELLED'
          AND (
            i."promotionBaselineUnitPrice" IS NULL
            OR i."promotionBaselineUnitPrice" < i."unitPrice"
          )
      )::int AS lines_without_baseline
    FROM "OrderItem" i
    JOIN "Order" o ON o.id = i."orderId"
    WHERE ${whereSql}
  `);

  const [credits] = await prisma.$queryRaw<Array<{ credit_count: number; credit_subtotal: Prisma.Decimal }>>(Prisma.sql`
    SELECT COUNT(*)::int AS credit_count, COALESCE(SUM(inv.subtotal), 0) AS credit_subtotal
    FROM "Invoice" inv
    WHERE inv."autopartDocumentKind"::text = 'CREDIT'
      AND inv.status::text <> 'VOID'
      AND inv."orderId" IN (
        SELECT DISTINCT o.id
        FROM "OrderItem" i
        JOIN "Order" o ON o.id = i."orderId"
        WHERE ${whereSql}
          AND o.status::text <> 'DRAFT'
      )
  `);

  const months = await prisma.$queryRaw<
    Array<{ month: Date; orders: number; units: number; revenue: Prisma.Decimal }>
  >(Prisma.sql`
    SELECT
      date_trunc('month', COALESCE(o."placedAt", o."createdAt")) AS month,
      COUNT(DISTINCT o.id)::int AS orders,
      COALESCE(SUM(i.qty), 0)::int AS units,
      COALESCE(SUM(i."lineTotal"), 0) AS revenue
    FROM "OrderItem" i
    JOIN "Order" o ON o.id = i."orderId"
    WHERE ${whereSql}
      AND o.status::text <> 'DRAFT'
      AND o.status::text <> 'CANCELLED'
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const reps = await prisma.$queryRaw<
    Array<{ rep_name: string; orders: number; units: number; revenue: Prisma.Decimal }>
  >(Prisma.sql`
    SELECT
      COALESCE(NULLIF(o."salesRepNameSnapshot", ''), 'Unassigned') AS rep_name,
      COUNT(DISTINCT o.id)::int AS orders,
      COALESCE(SUM(i.qty), 0)::int AS units,
      COALESCE(SUM(i."lineTotal"), 0) AS revenue
    FROM "OrderItem" i
    JOIN "Order" o ON o.id = i."orderId"
    WHERE ${whereSql}
      AND o.status::text <> 'DRAFT'
      AND o.status::text <> 'CANCELLED'
    GROUP BY 1
    ORDER BY revenue DESC
    LIMIT 50
  `);

  const orders = await prisma.$queryRaw<
    Array<{
      id: string;
      order_number: string;
      status: string;
      company_id: string;
      company_name: string;
      placed_at: Date | null;
      rep_name: string | null;
      lines: number;
      units: number;
      revenue: Prisma.Decimal;
    }>
  >(Prisma.sql`
    SELECT
      o.id,
      o."orderNumber" AS order_number,
      o.status::text AS status,
      o."companyId" AS company_id,
      c.name AS company_name,
      o."placedAt" AS placed_at,
      o."salesRepNameSnapshot" AS rep_name,
      COUNT(i.id)::int AS lines,
      COALESCE(SUM(i.qty), 0)::int AS units,
      COALESCE(SUM(i."lineTotal"), 0) AS revenue
    FROM "OrderItem" i
    JOIN "Order" o ON o.id = i."orderId"
    JOIN "Company" c ON c.id = o."companyId"
    WHERE ${whereSql}
      AND o.status::text <> 'DRAFT'
    GROUP BY o.id, c.name
    ORDER BY COALESCE(o."placedAt", o."createdAt") DESC
    LIMIT ${pageSize}
    OFFSET ${(page - 1) * pageSize}
  `);

  const customers = await prisma.$queryRaw<
    Array<{
      company_id: string;
      company_name: string;
      orders: number;
      units: number;
      revenue: Prisma.Decimal;
    }>
  >(Prisma.sql`
    SELECT
      o."companyId" AS company_id,
      c.name AS company_name,
      COUNT(DISTINCT o.id)::int AS orders,
      COALESCE(SUM(i.qty), 0)::int AS units,
      COALESCE(SUM(i."lineTotal"), 0) AS revenue
    FROM "OrderItem" i
    JOIN "Order" o ON o.id = i."orderId"
    JOIN "Company" c ON c.id = o."companyId"
    WHERE ${whereSql}
      AND o.status::text <> 'DRAFT'
      AND o.status::text <> 'CANCELLED'
    GROUP BY o."companyId", c.name
    ORDER BY revenue DESC
    LIMIT ${pageSize}
    OFFSET ${(page - 1) * pageSize}
  `);

  const stats = headline ?? emptyHeadline();
  const withBaseline = Number(stats.lines_with_baseline ?? 0);
  const withoutBaseline = Number(stats.lines_without_baseline ?? 0);
  const coverage =
    withBaseline === 0 ? "unavailable" : withoutBaseline === 0 ? "complete" : "partial";
  const display = campaignDisplayStatus({
    campaignStatus: promotion.campaignStatus,
    isActive: promotion.isActive,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    at: new Date(),
  });
  const organisation =
    companyIds === "all" ||
    hasPermission(profile, "sales.view_all_accounts") ||
    hasPermission(profile, "admin.access");

  return {
    campaign: {
      id: promotion.id,
      code: promotion.code,
      name: promotion.name,
      displayStatus: display.status,
      displayLabel: display.label,
      startsAt: promotion.startsAt?.toISOString() ?? null,
      endsAt: promotion.endsAt?.toISOString() ?? null,
    },
    scope: organisation ? "organisation" : "assigned_accounts",
    placed: bucket(stats.placed_orders, stats.placed_customers, stats.placed_units, stats.placed_revenue),
    standing: bucket(stats.standing_orders, stats.standing_customers, stats.standing_units, stats.standing_revenue),
    completed: {
      orders: Number(stats.completed_orders ?? 0),
      units: Number(stats.completed_units ?? 0),
      revenueExVat: moneyString(stats.completed_revenue),
    },
    cancelled: {
      orders: Number(stats.cancelled_orders ?? 0),
      units: Number(stats.cancelled_units ?? 0),
      revenueExVat: moneyString(stats.cancelled_revenue),
    },
    savings: {
      coverage,
      savingsExVat: coverage === "unavailable" ? null : moneyString(stats.savings),
      linesWithBaseline: withBaseline,
      linesWithoutBaseline: withoutBaseline,
      note:
        coverage === "complete"
          ? "Savings use the order-time price before the promotion."
          : "Savings are unavailable where the order line has no pre-promotion baseline. Current catalogue prices are not used.",
    },
    credits: {
      attributable: false as const,
      linkedCreditDocuments: Number(credits?.credit_count ?? 0),
      linkedCreditSubtotalExVat: moneyString(credits?.credit_subtotal),
      note: "Reported revenue is ex VAT and before credit-note adjustments. Linked credit documents are counted only and are not deducted, because credit lines are not attributed to the promotion.",
    },
    revenueNote: "Revenue is ex VAT and before credit-note adjustments.",
    netAfterCancellationExVat: moneyString(stats.standing_revenue),
    months: months.map((row) => ({
      month: monthLabel(row.month),
      orders: Number(row.orders),
      units: Number(row.units),
      revenueExVat: moneyString(row.revenue),
    })),
    representatives: reps.map((row) => ({
      name: row.rep_name,
      orders: Number(row.orders),
      units: Number(row.units),
      revenueExVat: moneyString(row.revenue),
    })),
    orders: {
      page,
      pageSize,
      total: Number(stats.placed_orders ?? 0),
      items: orders.map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        status: row.status,
        companyId: row.company_id,
        companyName: row.company_name,
        placedAt: row.placed_at ? new Date(row.placed_at).toISOString() : null,
        salesRepresentative: row.rep_name,
        lines: Number(row.lines),
        units: Number(row.units),
        revenueExVat: moneyString(row.revenue),
      })),
    },
    customers: {
      page,
      pageSize,
      total: Number(stats.standing_customers ?? 0),
      items: customers.map((row) => ({
        companyId: row.company_id,
        companyName: row.company_name,
        orders: Number(row.orders),
        units: Number(row.units),
        revenueExVat: moneyString(row.revenue),
      })),
    },
  };
}

function bucket(orders: number, customers: number, units: number, revenue: Prisma.Decimal | undefined) {
  return {
    orders: Number(orders ?? 0),
    customers: Number(customers ?? 0),
    units: Number(units ?? 0),
    revenueExVat: moneyString(revenue),
  };
}

function monthLabel(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 7);
}

function moneyString(value: unknown): string {
  return moneyToString(moneyFromUnknown(value) ?? { minor: 0n }, 2);
}

function emptyHeadline() {
  const zero = new Prisma.Decimal(0);
  return {
    placed_orders: 0,
    placed_customers: 0,
    placed_units: 0,
    placed_revenue: zero,
    standing_orders: 0,
    standing_customers: 0,
    standing_units: 0,
    standing_revenue: zero,
    completed_orders: 0,
    completed_units: 0,
    completed_revenue: zero,
    cancelled_orders: 0,
    cancelled_units: 0,
    cancelled_revenue: zero,
    savings: zero,
    lines_with_baseline: 0,
    lines_without_baseline: 0,
  };
}
