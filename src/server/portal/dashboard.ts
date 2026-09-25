/**
 * Trade portal dashboard — company-scoped live data only.
 * Never invents credit, invoices, quotes, or account managers.
 */

import { prisma } from "@/infra/database/client";
import { AuthError, requireAuthenticatedUser, requireCompanyPermission } from "@/server/rbac/guards";
import { getBasketSummary } from "@/server/basket/service";
import { moneyToString, moneyZero, parseMoney } from "@/domain/money";

const OPEN_ORDER_STATUSES = [
  "SUBMITTED",
  "CONFIRMED",
  "PICKING",
  "DISPATCHED",
  "ON_HOLD",
] as const;

async function requireTradePortalCompany(userId: string) {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType !== "TRADE" && profile.actorType !== "INTERNAL") {
    throw new AuthError("Trade portal access required", "FORBIDDEN", 403);
  }
  const membership =
    profile.companyMemberships.find((m) => m.isDefault && m.status === "ACTIVE") ??
    profile.companyMemberships.find((m) => m.status === "ACTIVE") ??
    profile.companyMemberships[0];
  if (!membership) {
    throw new AuthError("No company membership for portal", "FORBIDDEN", 403);
  }
  await requireCompanyPermission(userId, membership.companyId, "orders.view");

  const company = await prisma.company.findUnique({
    where: { id: membership.companyId },
    select: {
      id: true,
      name: true,
      tradingName: true,
      status: true,
      paymentTerms: true,
      creditLimit: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      assignments: {
        where: { isPrimary: true },
        take: 1,
        include: {
          salesRep: {
            include: {
              user: { select: { id: true, name: true, email: true, status: true } },
            },
          },
        },
      },
    },
  });
  if (!company) {
    throw new AuthError("Company not found", "NOT_FOUND", 404);
  }

  return { profile, membership, company };
}

function mapOrderRow(row: {
  id: string;
  orderNumber: string;
  status: string;
  placedAt: Date | null;
  createdAt: Date;
  poNumber: string | null;
  grandTotal: unknown;
  currency: string;
  _count: { items: number };
}) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    placedAt: (row.placedAt ?? row.createdAt).toISOString(),
    poNumber: row.poNumber,
    grandTotal: moneyToString(parseMoney(String(row.grandTotal)) ?? moneyZero(), 2),
    currency: row.currency,
    lineCount: row._count.items,
  };
}

/**
 * Single batched dashboard loader for the authenticated trade company.
 * Company id is resolved server-side from membership — never from the client.
 */
export async function getPortalDashboard(userId: string) {
  const { membership, company } = await requireTradePortalCompany(userId);

  const orderWhere = { companyId: company.id, status: { not: "DRAFT" as const } };
  const openWhere = {
    companyId: company.id,
    status: { in: [...OPEN_ORDER_STATUSES] },
  };

  const [openOrders, recentOrders, openOrderCount, totalOrderCount, basket] = await Promise.all([
    prisma.order.findMany({
      where: openWhere,
      orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
      take: 10,
      include: { _count: { select: { items: true } } },
    }),
    prisma.order.findMany({
      where: orderWhere,
      orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      include: { _count: { select: { items: true } } },
    }),
    prisma.order.count({ where: openWhere }),
    prisma.order.count({ where: orderWhere }),
    getBasketSummary(userId),
  ]);

  const assignment = company.assignments[0] ?? null;
  const repUser = assignment?.salesRep.user ?? null;
  const accountManager =
    repUser && repUser.status === "ACTIVE"
      ? {
          name: repUser.name?.trim() || repUser.email,
          email: repUser.email,
          code: assignment!.salesRep.code,
        }
      : null;

  const autopartVerified = Boolean(
    company.autopartCustomerCode && company.autopartCustomerCodeVerifiedAt,
  );

  const creditLimit =
    company.creditLimit == null
      ? null
      : typeof company.creditLimit === "object" &&
          company.creditLimit !== null &&
          "toNumber" in company.creditLimit &&
          typeof (company.creditLimit as { toNumber: () => number }).toNumber === "function"
        ? (company.creditLimit as { toNumber: () => number }).toNumber()
        : Number(company.creditLimit);

  return {
    company: {
      id: company.id,
      name: company.name,
      tradingName: company.tradingName,
      status: company.status,
      paymentTerms: company.paymentTerms,
      /** Only verified Autopart codes — never claimed application codes. */
      autopartCustomerCode: autopartVerified ? company.autopartCustomerCode : null,
      autopartVerified,
    },
    membershipStatus: membership.status,
    /** Authoritative credit limit when set; null hides the metric. No invented default. */
    creditLimit: Number.isFinite(creditLimit) ? creditLimit : null,
    /** Not available without accounting integration. */
    availableCredit: null as null,
    outstandingBalance: null as null,
    openQuotesValue: null as null,
    basket: {
      lineCount: basket.lineCount,
      unitCount: basket.unitCount,
      companyId: basket.companyId,
    },
    openOrderCount,
    totalOrderCount,
    openOrders: openOrders.map(mapOrderRow),
    recentOrders: recentOrders.map(mapOrderRow),
    accountManager,
    features: {
      quotes: false,
      invoices: false,
      favourites: false,
      reorder: false,
      quickOrder: false,
      companyUsers: false,
      downloads: false,
    },
  };
}

export type PortalDashboard = Awaited<ReturnType<typeof getPortalDashboard>>;

/** Support page contact — same company-scoped account manager (or none). */
export async function getPortalSupportContact(userId: string) {
  const dash = await getPortalDashboard(userId);
  return {
    companyName: dash.company.name,
    accountManager: dash.accountManager,
    paymentTerms: dash.company.paymentTerms,
    autopartCustomerCode: dash.company.autopartCustomerCode,
  };
}
