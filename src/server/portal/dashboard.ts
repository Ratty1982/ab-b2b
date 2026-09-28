/**
 * Trade portal dashboard — company-scoped live data only.
 * Never invents credit, invoices, quotes, or account managers.
 */

import { prisma } from "@/infra/database/client";
import { AuthError, requireAuthenticatedUser, requireCompanyPermission } from "@/server/rbac/guards";
import { getBasketSummary } from "@/server/basket/service";
import { moneyToString, moneyZero, parseMoney } from "@/domain/money";
import {
  summariseCustomerOrderFulfilment,
  backorderUnitsLabel,
} from "@/domain/customer-fulfilment";
import { orderIsFullyBackordered } from "@/domain/backorder";
import {
  resolveAccountManagerForCompany,
  resolveGeneralTradeContact,
} from "@/server/sales/account-manager";

const OPEN_ORDER_STATUSES = [
  "SUBMITTED",
  "CONFIRMED",
  "PICKING",
  "PARTIALLY_DESPATCHED",
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
  items: Array<{
    qty: number;
    availableQtyAtOrder: number | null;
    backorderQtyAtOrder: number;
    despatchedQty: number;
  }>;
}) {
  const fulfilment = summariseCustomerOrderFulfilment({
    status: row.status,
    items: row.items,
  });
  const fullyBackordered = orderIsFullyBackordered(row.items);
  const hint =
    fulfilment.hasOutstandingBackorder && fulfilment.outstandingBackorderUnits > 0
      ? backorderUnitsLabel(fulfilment.outstandingBackorderUnits)
      : fulfilment.hasOutstandingBackorder
        ? "Items awaiting stock"
        : null;
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    placedAt: (row.placedAt ?? row.createdAt).toISOString(),
    poNumber: row.poNumber,
    grandTotal: moneyToString(parseMoney(String(row.grandTotal)) ?? moneyZero(), 2),
    currency: row.currency,
    lineCount: row._count.items,
    hasBackorderItems: fulfilment.hasBackorderAtPlacement,
    hasOutstandingBackorder: fulfilment.hasOutstandingBackorder,
    outstandingBackorderUnits: fulfilment.outstandingBackorderUnits,
    fullyBackordered,
    statusLabel: fulfilment.orderStatusLabel,
    statusBadge: fulfilment.orderStatusBadge,
    backorderHint: hint,
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
  const orderInclude = {
    _count: { select: { items: true } },
    items: {
      select: {
        qty: true,
        availableQtyAtOrder: true,
        backorderQtyAtOrder: true,
        despatchedQty: true,
      },
    },
  } as const;

  const [openOrders, recentOrders, openOrderCount, totalOrderCount, basket, backorderCandidates] =
    await Promise.all([
      prisma.order.findMany({
        where: openWhere,
        orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
        take: 10,
        include: orderInclude,
      }),
      prisma.order.findMany({
        where: orderWhere,
        orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
        take: 5,
        include: orderInclude,
      }),
      prisma.order.count({ where: openWhere }),
      prisma.order.count({ where: orderWhere }),
      getBasketSummary(userId),
      prisma.order.findMany({
        where: {
          companyId: company.id,
          status: {
            in: ["SUBMITTED", "CONFIRMED", "PICKING", "PARTIALLY_DESPATCHED", "ON_HOLD"],
          },
          OR: [
            { status: "PARTIALLY_DESPATCHED" },
            { items: { some: { backorderQtyAtOrder: { gt: 0 } } } },
          ],
        },
        select: {
          id: true,
          status: true,
          items: {
            select: {
              qty: true,
              availableQtyAtOrder: true,
              backorderQtyAtOrder: true,
              despatchedQty: true,
            },
          },
        },
        take: 100,
      }),
    ]);

  const [accountManager, generalContact] = await Promise.all([
    resolveAccountManagerForCompany(company.id),
    resolveGeneralTradeContact(),
  ]);

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

  let backorderOrderCount = 0;
  let backorderUnitCount = 0;
  for (const order of backorderCandidates) {
    const summary = summariseCustomerOrderFulfilment({
      status: order.status,
      items: order.items,
    });
    if (!summary.hasOutstandingBackorder) continue;
    backorderOrderCount += 1;
    backorderUnitCount += summary.outstandingBackorderUnits;
  }

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
    /** Omitted from UI when null — never show an empty permanent Backorders card. */
    backorders:
      backorderOrderCount > 0
        ? {
            orderCount: backorderOrderCount,
            unitCount: backorderUnitCount,
            summary:
              backorderUnitCount > 0
                ? `${backorderUnitCount} unit${backorderUnitCount === 1 ? "" : "s"} awaiting stock across ${backorderOrderCount} order${backorderOrderCount === 1 ? "" : "s"}`
                : `${backorderOrderCount} order${backorderOrderCount === 1 ? "" : "s"} have items awaiting stock`,
          }
        : null,
    accountManager,
    /** Fallback when no SalesRep is assigned — configured reply-to/from only. */
    generalContact,
    features: {
      quotes: true,
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
    generalContact: dash.generalContact,
    paymentTerms: dash.company.paymentTerms,
    autopartCustomerCode: dash.company.autopartCustomerCode,
  };
}
