/**
 * Admin → Dashboard — production operations overview.
 * Real aggregated DB data only. No fabricated metrics.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";
import { moneyToString, moneyZero, parseMoney } from "@/domain/money";
import {
  DASHBOARD_ATTENTION_APPLICATION_STATUSES,
  DASHBOARD_OPEN_ORDER_STATUSES,
  DASHBOARD_OPEN_QUOTE_STATUSES,
  DASHBOARD_ORDER_VALUE_EXCLUDED_STATUSES,
  DASHBOARD_PROCESSING_ORDER_STATUSES,
  formatGbpIncVat,
  stockHealthLabel,
  type AttentionItem,
} from "@/domain/admin-dashboard";
import { OPEN_APPLICATION_STATUSES } from "@/domain/trade-application";
import { customerOrderStatusLabel } from "@/domain/order-status";
import { AUTOPART_504C_SCHEDULE_LABEL } from "@/domain/autopart-504c-schedule";
import {
  formatAuditDateTime,
  formatDate,
  formatDateTime,
  londonCalendarDayBounds,
} from "@/lib/datetime";
import { ROUTES } from "@/lib/app-nav";

function orderCompanyScope(accessible: string[] | "all"): Prisma.OrderWhereInput {
  if (accessible === "all") return {};
  if (accessible.length === 0) return { companyId: { in: ["__none__"] } };
  return { companyId: { in: accessible } };
}

function decimalSumToMoneyString(value: unknown): string {
  if (value == null) return moneyToString(moneyZero(), 2);
  const parsed = parseMoney(String(value));
  return moneyToString(parsed ?? moneyZero(), 2);
}

const MEANINGFUL_AUDIT_ACTIONS = [
  "order.created",
  "order.autopart_export",
  "order.autopart_batch_export",
  "order.autopart_reexport",
  "order.autopart_504c_import",
  "application.submitted",
  "application.under_review",
  "application.more_info_required",
  "application.approved",
  "application.rejected",
  "quote.sent",
  "quote.declined",
  "quote.converted",
  "callback.request_submitted",
  "sales_rep.company_assigned",
  "sales_rep.company_reassigned",
  "stock.sync.manual",
  "stock.sync.failed",
] as const;

function humanizeAuditAction(action: string): string {
  const map: Record<string, string> = {
    "order.created": "Order received",
    "order.autopart_export": "Order exported to Autopart",
    "order.autopart_batch_export": "Orders exported to Autopart",
    "order.autopart_reexport": "Order re-exported to Autopart",
    "order.autopart_504c_import": "504C despatch reconciled",
    "application.submitted": "Trade application submitted",
    "application.under_review": "Trade application under review",
    "application.more_info_required": "Trade application needs more information",
    "application.approved": "Trade account approved",
    "application.rejected": "Trade application rejected",
    "quote.sent": "Quote sent",
    "quote.declined": "Quote declined",
    "quote.converted": "Quote converted to order",
    "callback.request_submitted": "Callback requested",
    "sales_rep.company_assigned": "Company assigned to sales rep",
    "sales_rep.company_reassigned": "Company reassigned to sales rep",
    "stock.sync.manual": "Autopart stock sync ran",
    "stock.sync.failed": "Autopart stock sync failed",
  };
  return map[action] ?? action.replace(/\./g, " ");
}

export type AdminDashboardOrderRow = {
  id: string;
  orderNumber: string;
  companyName: string;
  status: string;
  statusLabel: string;
  placedAt: string | null;
  placedAtLabel: string;
  grandTotal: string;
  grandTotalLabel: string;
  autopartExportStatus: string;
  autopartLabel: string;
  href: string;
  /** Derived after newer 407P100 — order still HOLD/REVIEW until staff release. */
  creditNowAvailable?: boolean;
  creditHint?: string | null;
};

export type AdminDashboardApplicationRow = {
  id: string;
  reference: string;
  companyName: string;
  status: string;
  statusLabel: string;
  submittedAt: string;
  submittedAtLabel: string;
  href: string;
};

export type AdminDashboardActivityRow = {
  id: string;
  when: string;
  whenLabel: string;
  who: string;
  what: string;
};

export type AdminDashboardPayload = {
  generatedAt: string;
  scope: "all" | "sales";
  summary: {
    ordersToday: { count: number; orderValueIncVat: string; orderValueLabel: string };
    openOrders: { count: number };
    activeTradeCustomers: { count: number };
    tradeApplicationsAttention: { count: number };
    openQuotes: { count: number } | null;
  };
  ordersAttention: {
    readyForExport: { count: number; items: AdminDashboardOrderRow[] };
    processing: { count: number; items: AdminDashboardOrderRow[] };
    exportBlocked: { count: number; items: AdminDashboardOrderRow[] };
    creditHold: { count: number; items: AdminDashboardOrderRow[] };
    creditReview: { count: number; items: AdminDashboardOrderRow[] };
    /** Outstanding backorder operational metrics (real records only). */
    backorderedOrders: {
      count: number;
      units: number;
      skusAffected: number;
      stockNowAvailableSkus: number;
    };
  };
  applications: {
    submitted: number;
    underReview: number;
    moreInfoRequired: number;
    attentionItems: AdminDashboardApplicationRow[];
  };
  recentOrders: AdminDashboardOrderRow[];
  recentActivity: AdminDashboardActivityRow[];
  callbacks: { openCount: number } | null;
  quotes: {
    draft: number;
    sentOrViewed: number;
    expiringSoon: number;
  } | null;
  customers: {
    active: number;
    newlyApproved7d: number;
  };
  stock: {
    lastSuccessAt: string | null;
    lastSuccessLabel: string | null;
    matched: number;
    updated: number;
    notInCatalogue: number;
    /** Ignored INVALID/DUPLICATE diagnostics — informational only. */
    ignoredRows: number;
    /** Actionable/fatal issue count (CONFLICT, PARSE, …). Drives Needs Attention. */
    actionableIssues: number;
    /** @deprecated Use ignoredRows / actionableIssues. Kept as ignoredRows for older clients. */
    issues: number;
    statusLabel: "Healthy" | "Attention required" | "No sync yet";
    href: string;
  } | null;
  autopart504c: {
    configured: boolean;
    enabled: boolean;
    automaticPolling: "ON" | "OFF";
    statusLabel: string;
    scheduleLabel: string;
    href: string;
    informational: true;
  } | null;
  email: {
    configured: boolean;
    enabled: boolean;
    recentFailures: number;
    href: string;
  } | null;
  needsAttention: AttentionItem[];
};

function mapOrderRow(row: {
  id: string;
  orderNumber: string;
  status: string;
  placedAt: Date | null;
  grandTotal: unknown;
  autopartExportStatus: string;
  company: { name: string };
}): AdminDashboardOrderRow {
  const grandTotal = decimalSumToMoneyString(row.grandTotal);
  const autopartLabel =
    row.autopartExportStatus === "EXPORTED"
      ? "Exported"
      : row.status === "CANCELLED"
        ? "—"
        : "Not exported";
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    companyName: row.company.name,
    status: row.status,
    statusLabel: customerOrderStatusLabel(row.status),
    placedAt: row.placedAt?.toISOString() ?? null,
    placedAtLabel: row.placedAt ? formatDate(row.placedAt) ?? "—" : "—",
    grandTotal,
    grandTotalLabel: formatGbpIncVat(grandTotal),
    autopartExportStatus: row.autopartExportStatus,
    autopartLabel,
    href: ROUTES.adminOrder(row.id),
  };
}

export async function getAdminDashboard(actorUserId: string): Promise<AdminDashboardPayload> {
  const profile = await requireAuthenticatedUser(actorUserId);
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Admin dashboard requires internal access", "FORBIDDEN", 403);
  }

  const canSeeOrders = hasPermission(profile, "orders.view") || hasPermission(profile, "admin.access");
  const canSeeCompanies =
    hasPermission(profile, "companies.view") || hasPermission(profile, "admin.access");
  const canSeeApplications =
    hasPermission(profile, "applications.view") || hasPermission(profile, "admin.access");
  const canSeeQuotes = hasPermission(profile, "quotes.view") || hasPermission(profile, "admin.access");
  const canSeeStock =
    hasPermission(profile, "inventory.view") ||
    hasPermission(profile, "products.view") ||
    hasPermission(profile, "admin.access");
  const canSeeEmail = hasPermission(profile, "settings.view") || hasPermission(profile, "admin.access");
  const canSeeAudit = hasPermission(profile, "audit.view") || hasPermission(profile, "admin.access");
  const canSeeTasks = hasPermission(profile, "tasks.view") || hasPermission(profile, "admin.access");

  if (!canSeeOrders && !canSeeCompanies && !canSeeApplications && !hasPermission(profile, "admin.access")) {
    throw new AuthError("Insufficient permissions for dashboard", "FORBIDDEN", 403);
  }

  const accessible = await getAccessibleCompanyIdsForSales(profile);
  const scope: "all" | "sales" = accessible === "all" ? "all" : "sales";
  const orderScope = orderCompanyScope(accessible);
  const { start: dayStart, end: dayEnd } = londonCalendarDayBounds(new Date());
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const readyWhere: Prisma.OrderWhereInput = {
    ...orderScope,
    autopartExportStatus: "NOT_EXPORTED",
    status: { notIn: ["DRAFT", "CANCELLED"] },
    creditStatus: { in: ["APPROVED", "NOT_REQUIRED"] },
    autopartAccountLinked: true,
    autopartCustomerCodeSnapshot: { not: null },
    items: { some: {} },
  };

  const blockedWhere: Prisma.OrderWhereInput = {
    ...orderScope,
    autopartExportStatus: "NOT_EXPORTED",
    status: { notIn: ["DRAFT", "CANCELLED"] },
    OR: [
      { autopartAccountLinked: false },
      { autopartCustomerCodeSnapshot: null },
      { items: { none: {} } },
      { creditStatus: { in: ["HOLD", "REVIEW_REQUIRED"] } },
    ],
  };

  const creditHoldWhere: Prisma.OrderWhereInput = {
    ...orderScope,
    creditStatus: "HOLD",
    status: { notIn: ["DRAFT", "CANCELLED"] },
  };

  const creditReviewWhere: Prisma.OrderWhereInput = {
    ...orderScope,
    creditStatus: "REVIEW_REQUIRED",
    status: { notIn: ["DRAFT", "CANCELLED"] },
  };

  const processingWhere: Prisma.OrderWhereInput = {
    ...orderScope,
    autopartExportStatus: "EXPORTED",
    status: { in: [...DASHBOARD_PROCESSING_ORDER_STATUSES] },
  };

  const ordersTodayWhere: Prisma.OrderWhereInput = {
    ...orderScope,
    status: { notIn: [...DASHBOARD_ORDER_VALUE_EXCLUDED_STATUSES] },
    placedAt: { gte: dayStart, lt: dayEnd },
  };

  const openOrdersWhere: Prisma.OrderWhereInput = {
    ...orderScope,
    status: { in: [...DASHBOARD_OPEN_ORDER_STATUSES] },
  };

  const companyWhere: Prisma.CompanyWhereInput =
    accessible === "all"
      ? { status: "ACTIVE" }
      : { status: "ACTIVE", id: { in: accessible.length ? accessible : ["__none__"] } };

  async function safe<T>(enabled: boolean, fn: () => Promise<T>, fallback: T): Promise<T> {
    if (!enabled) return fallback;
    try {
      return await fn();
    } catch {
      return fallback;
    }
  }

  const [
    ordersTodayAgg,
    openOrderCount,
    activeCustomerCount,
    newlyApproved7d,
    appSubmitted,
    appUnderReview,
    appMoreInfo,
    attentionApps,
    readyCount,
    processingCount,
    blockedCount,
    readyItems,
    processingItems,
    blockedItems,
    recentOrderRows,
    quoteDraft,
    quoteSentViewed,
    quoteExpiring,
    openCallbackCount,
    auditRows,
    stockSuccess,
    emailDto,
    emailFailures,
    feed504c,
  ] = await Promise.all([
    canSeeOrders
      ? prisma.order.aggregate({
          where: ordersTodayWhere,
          _count: { _all: true },
          _sum: { grandTotal: true },
        })
      : Promise.resolve({ _count: { _all: 0 }, _sum: { grandTotal: null } }),
    canSeeOrders ? prisma.order.count({ where: openOrdersWhere }) : Promise.resolve(0),
    canSeeCompanies ? prisma.company.count({ where: companyWhere }) : Promise.resolve(0),
    canSeeApplications
      ? prisma.tradeApplication.count({
          where: {
            status: "APPROVED",
            decidedAt: { gte: sevenDaysAgo },
          },
        })
      : Promise.resolve(0),
    canSeeApplications
      ? prisma.tradeApplication.count({ where: { status: "SUBMITTED" } })
      : Promise.resolve(0),
    canSeeApplications
      ? prisma.tradeApplication.count({ where: { status: "UNDER_REVIEW" } })
      : Promise.resolve(0),
    canSeeApplications
      ? prisma.tradeApplication.count({ where: { status: "MORE_INFO_REQUIRED" } })
      : Promise.resolve(0),
    canSeeApplications
      ? prisma.tradeApplication.findMany({
          where: { status: { in: [...OPEN_APPLICATION_STATUSES] } },
          orderBy: { submittedAt: "desc" },
          take: 8,
          select: {
            id: true,
            reference: true,
            companyName: true,
            status: true,
            submittedAt: true,
          },
        })
      : Promise.resolve([]),
    canSeeOrders ? prisma.order.count({ where: readyWhere }) : Promise.resolve(0),
    canSeeOrders ? prisma.order.count({ where: processingWhere }) : Promise.resolve(0),
    canSeeOrders ? prisma.order.count({ where: blockedWhere }) : Promise.resolve(0),
    canSeeOrders
      ? prisma.order.findMany({
          where: readyWhere,
          orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
          take: 5,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            placedAt: true,
            grandTotal: true,
            autopartExportStatus: true,
            company: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    canSeeOrders
      ? prisma.order.findMany({
          where: processingWhere,
          orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
          take: 5,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            placedAt: true,
            grandTotal: true,
            autopartExportStatus: true,
            company: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    canSeeOrders
      ? prisma.order.findMany({
          where: blockedWhere,
          orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
          take: 5,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            placedAt: true,
            grandTotal: true,
            autopartExportStatus: true,
            company: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    canSeeOrders
      ? prisma.order.findMany({
          where: { ...orderScope, status: { not: "DRAFT" } },
          orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
          take: 8,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            placedAt: true,
            grandTotal: true,
            autopartExportStatus: true,
            company: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    canSeeQuotes
      ? prisma.quote.count({
          where: {
            status: "DRAFT",
            ...(accessible === "all" ? {} : { companyId: { in: accessible.length ? accessible : ["__none__"] } }),
          },
        })
      : Promise.resolve(0),
    canSeeQuotes
      ? prisma.quote.count({
          where: {
            status: { in: ["SENT", "VIEWED"] },
            ...(accessible === "all" ? {} : { companyId: { in: accessible.length ? accessible : ["__none__"] } }),
          },
        })
      : Promise.resolve(0),
    canSeeQuotes
      ? prisma.quote.count({
          where: {
            status: { in: ["SENT", "VIEWED"] },
            expiresAt: {
              gte: new Date(),
              lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
            ...(accessible === "all" ? {} : { companyId: { in: accessible.length ? accessible : ["__none__"] } }),
          },
        })
      : Promise.resolve(0),
    canSeeTasks
      ? prisma.task.count({
          where: {
            status: "OPEN",
            title: "Call customer",
            ...(accessible === "all"
              ? {}
              : { companyId: { in: accessible.length ? accessible : ["__none__"] } }),
          },
        })
      : Promise.resolve(0),
    canSeeAudit
      ? prisma.auditEvent.findMany({
          where: {
            action: { in: [...MEANINGFUL_AUDIT_ACTIONS] },
            ...(accessible === "all"
              ? {}
              : { companyId: { in: accessible.length ? accessible : ["__none__"] } }),
          },
          orderBy: { createdAt: "desc" },
          take: 12,
          select: {
            id: true,
            action: true,
            createdAt: true,
            actor: { select: { name: true, email: true } },
            metadata: true,
          },
        })
      : Promise.resolve([]),
    canSeeStock
      ? prisma.stockSyncRun.findFirst({
          where: { status: { in: ["SUCCESS", "PARTIAL"] }, mode: "live" },
          orderBy: { completedAt: "desc" },
        })
      : Promise.resolve(null),
    safe(canSeeEmail, async () => {
      const { getOrCreateEmailSettings } = await import("@/server/email/settings");
      const { isSmtpConfigured, isSenderConfigured } = await import("@/domain/email-settings");
      const row = await getOrCreateEmailSettings();
      const smtpConfigured = isSmtpConfigured({
        smtpHost: row.smtpHost,
        smtpUsername: row.smtpUsername,
        smtpPasswordConfigured: Boolean(row.smtpPasswordEncrypted),
      });
      const senderConfigured = isSenderConfigured({ fromEmail: row.fromEmail, fromName: row.fromName });
      return {
        configured: smtpConfigured && senderConfigured,
        enabled: row.enabled,
      };
    }, null),
    canSeeEmail
      ? prisma.transactionalEmail.count({
          where: {
            status: "FAILED",
            createdAt: { gte: sevenDaysAgo },
          },
        })
      : Promise.resolve(0),
    canSeeOrders
      ? (async () => {
          const { getAutopart504cFeedSettings } = await import("@/server/orders/autopart-504c");
          return getAutopart504cFeedSettings();
        })()
      : Promise.resolve(null),
  ]);

  const backorderMetrics = canSeeOrders
    ? await (async () => {
        const lines = await prisma.orderItem.findMany({
          where: {
            backorderQtyAtOrder: { gt: 0 },
            order: {
              ...orderScope,
              status: {
                in: ["SUBMITTED", "CONFIRMED", "PICKING", "PARTIALLY_DESPATCHED", "ON_HOLD"],
              },
            },
          },
          select: {
            qty: true,
            availableQtyAtOrder: true,
            backorderQtyAtOrder: true,
            despatchedQty: true,
            sku: true,
            variantId: true,
            orderId: true,
          },
          take: 2000,
        });
        const orderIds = new Set<string>();
        const skus = new Set<string>();
        let units = 0;
        const variantIds = new Set<string>();
        for (const line of lines) {
          const outstanding =
            line.despatchedQty > 0
              ? Math.max(0, line.qty - line.despatchedQty)
              : line.backorderQtyAtOrder;
          if (outstanding <= 0) continue;
          orderIds.add(line.orderId);
          skus.add(line.sku);
          units += outstanding;
          if (line.variantId) variantIds.add(line.variantId);
        }
        let stockNowAvailableSkus = 0;
        if (variantIds.size > 0) {
          const { AUTOPART_WAREHOUSE_CODE } = await import("@/domain/stock");
          const inv = await prisma.inventory.findMany({
            where: {
              variantId: { in: [...variantIds] },
              warehouse: { code: AUTOPART_WAREHOUSE_CODE },
              qtyOnHand: { gt: 0 },
            },
            select: { variantId: true },
          });
          stockNowAvailableSkus = new Set(inv.map((i) => i.variantId)).size;
        }
        return {
          count: orderIds.size,
          units,
          skusAffected: skus.size,
          stockNowAvailableSkus,
        };
      })()
    : { count: 0, units: 0, skusAffected: 0, stockNowAvailableSkus: 0 };

  const orderValue = decimalSumToMoneyString(ordersTodayAgg._sum.grandTotal);
  const openQuotesCount = canSeeQuotes ? quoteDraft + quoteSentViewed : null;

  const attentionAppsMapped: AdminDashboardApplicationRow[] = attentionApps.map((a) => ({
    id: a.id,
    reference: a.reference,
    companyName: a.companyName,
    status: a.status,
    statusLabel: a.status.replace(/_/g, " "),
    submittedAt: a.submittedAt.toISOString(),
    submittedAtLabel: formatDateTime(a.submittedAt, { seconds: false }) ?? "—",
    href: ROUTES.adminApplications,
  }));

  const stockActionableIssues = stockSuccess
    ? await prisma.stockSyncIssue.count({
        where: {
          runId: stockSuccess.id,
          severity: { in: ["ACTION_REQUIRED", "FATAL", "WARNING"] },
        },
      })
    : 0;
  const stockIgnoredRows = stockSuccess
    ? stockSuccess.invalid + stockSuccess.duplicates
    : 0;

  const stock = stockSuccess
    ? {
        lastSuccessAt: stockSuccess.completedAt?.toISOString() ?? stockSuccess.startedAt.toISOString(),
        lastSuccessLabel:
          formatDateTime(stockSuccess.completedAt ?? stockSuccess.startedAt, { seconds: false }) ??
          null,
        matched: stockSuccess.matched,
        updated: stockSuccess.updated,
        notInCatalogue: stockSuccess.unmatched,
        ignoredRows: stockIgnoredRows,
        actionableIssues: stockActionableIssues,
        issues: stockIgnoredRows,
        statusLabel: stockHealthLabel({
          hasSuccess: true,
          actionableIssueCount: stockActionableIssues,
          status: stockSuccess.status === "FAILED" ? "FAILED" : "SUCCESS",
        }),
        href: ROUTES.adminStockSync,
      }
    : canSeeStock
      ? {
          lastSuccessAt: null,
          lastSuccessLabel: null,
          matched: 0,
          updated: 0,
          notInCatalogue: 0,
          ignoredRows: 0,
          actionableIssues: 0,
          issues: 0,
          statusLabel: "No sync yet" as const,
          href: ROUTES.adminStockSync,
        }
      : null;

  const autopart504c = feed504c
    ? {
        configured: feed504c.configured,
        enabled: feed504c.enabled,
        automaticPolling: feed504c.automaticPolling,
        statusLabel: feed504c.statusLabel,
        scheduleLabel: feed504c.scheduleLabel || AUTOPART_504C_SCHEDULE_LABEL,
        href: ROUTES.adminSettings,
        informational: true as const,
      }
    : null;

  const email = emailDto
    ? {
        configured: emailDto.configured,
        enabled: emailDto.enabled,
        recentFailures: emailFailures,
        href: ROUTES.adminSettings,
      }
    : null;

  const recentActivity: AdminDashboardActivityRow[] = auditRows.map((row) => ({
    id: row.id,
    when: row.createdAt.toISOString(),
    whenLabel: formatAuditDateTime(row.createdAt) ?? "—",
    who: row.actor?.name?.trim() || row.actor?.email || "System",
    what: humanizeAuditAction(row.action),
  }));

  const needsAttention: AttentionItem[] = [];
  const appAttention = appSubmitted + appUnderReview + appMoreInfo;
  if (appAttention > 0) {
    needsAttention.push({
      id: "applications",
      label: "Trade applications awaiting review",
      count: appAttention,
      href: ROUTES.adminApplications,
      severity: "action",
    });
  }
  const [creditHoldCount, creditReviewCount, creditHoldRaw, creditReviewRaw] = canSeeOrders
    ? await Promise.all([
        prisma.order.count({ where: creditHoldWhere }),
        prisma.order.count({ where: creditReviewWhere }),
        prisma.order.findMany({
          where: creditHoldWhere,
          orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
          take: 5,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            placedAt: true,
            grandTotal: true,
            autopartExportStatus: true,
            creditStatus: true,
            paymentTermsSnapshot: true,
            companyId: true,
            company: {
              select: {
                name: true,
                paymentTerms: true,
                autopartCustomerCode: true,
                autopartCustomerCodeVerifiedAt: true,
              },
            },
          },
        }),
        prisma.order.findMany({
          where: creditReviewWhere,
          orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
          take: 5,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            placedAt: true,
            grandTotal: true,
            autopartExportStatus: true,
            creditStatus: true,
            paymentTermsSnapshot: true,
            companyId: true,
            company: {
              select: {
                name: true,
                paymentTerms: true,
                autopartCustomerCode: true,
                autopartCustomerCodeVerifiedAt: true,
              },
            },
          },
        }),
      ])
    : [0, 0, [], []];

  type CreditAttentionRow = {
    id: string;
    orderNumber: string;
    status: string;
    placedAt: Date | null;
    grandTotal: unknown;
    autopartExportStatus: string;
    creditStatus: string;
    paymentTermsSnapshot: string | null;
    companyId: string;
    company: {
      name: string;
      paymentTerms: string | null;
      autopartCustomerCode: string | null;
      autopartCustomerCodeVerifiedAt: Date | null;
    };
  };

  const { evaluateHeldOrderCreditNow } = await import("@/server/orders/credit-control");
  async function withCreditHints(
    items: CreditAttentionRow[],
    status: "HOLD" | "REVIEW_REQUIRED",
  ): Promise<AdminDashboardOrderRow[]> {
    const mapped: AdminDashboardOrderRow[] = [];
    for (const row of items) {
      const base = mapOrderRow(row);
      try {
        const hint = await evaluateHeldOrderCreditNow({
          orderId: row.id,
          orderNumber: row.orderNumber,
          companyId: row.companyId,
          grandTotal: row.grandTotal,
          paymentTerms: row.paymentTermsSnapshot ?? row.company.paymentTerms,
          hasVerifiedAutopartAccount: Boolean(
            row.company.autopartCustomerCode && row.company.autopartCustomerCodeVerifiedAt,
          ),
          currentCreditStatus: status,
        });
        mapped.push({
          ...base,
          creditNowAvailable: hint.creditNowAvailable,
          creditHint: hint.message,
        });
      } catch {
        mapped.push(base);
      }
    }
    return mapped;
  }

  const creditHoldItems = canSeeOrders
    ? await withCreditHints(creditHoldRaw as CreditAttentionRow[], "HOLD")
    : [];
  const creditReviewItems = canSeeOrders
    ? await withCreditHints(creditReviewRaw as CreditAttentionRow[], "REVIEW_REQUIRED")
    : [];

  if (creditHoldCount > 0) {
    const available = creditHoldItems.filter((i) => i.creditNowAvailable).length;
    needsAttention.push({
      id: "credit-hold",
      label:
        available > 0
          ? `Credit Hold (${available} now available)`
          : "Credit Hold",
      count: creditHoldCount,
      href: `${ROUTES.adminOrders}?credit=HOLD`,
      severity: "action",
    });
  }
  if (creditReviewCount > 0) {
    const available = creditReviewItems.filter((i) => i.creditNowAvailable).length;
    needsAttention.push({
      id: "credit-review",
      label:
        available > 0
          ? `Credit Review (${available} now available)`
          : "Credit Review",
      count: creditReviewCount,
      href: `${ROUTES.adminOrders}?credit=REVIEW`,
      severity: "action",
    });
  }
  if (readyCount > 0) {
    needsAttention.push({
      id: "export-ready",
      label: "Orders ready for Autopart export",
      count: readyCount,
      href: `${ROUTES.adminOrders}?autopartExport=READY`,
      severity: "action",
    });
  }
  if (blockedCount > 0) {
    needsAttention.push({
      id: "export-blocked",
      label: "Orders blocked from Autopart export",
      count: blockedCount,
      href: `${ROUTES.adminOrders}?autopartExport=BLOCKED`,
      severity: "action",
    });
  }
  if (openCallbackCount > 0 && canSeeTasks) {
    needsAttention.push({
      id: "callbacks",
      label: "Open callback tasks",
      count: openCallbackCount,
      href: ROUTES.adminCustomers,
      severity: "action",
    });
  }
  if (email && email.recentFailures > 0) {
    needsAttention.push({
      id: "email-failures",
      label: "Failed transactional emails (7 days)",
      count: email.recentFailures,
      href: ROUTES.adminSettings,
      severity: "action",
    });
  }
  if (stock && stock.actionableIssues > 0) {
    needsAttention.push({
      id: "stock-issues",
      label: "Actionable issues in latest stock sync",
      count: stock.actionableIssues,
      href: ROUTES.adminStockSync,
      severity: "action",
    });
  }
  if (autopart504c && !autopart504c.configured) {
    needsAttention.push({
      id: "504c-not-configured",
      label: "504C invoice/despatch feed not configured (waiting on Autopart)",
      count: null,
      href: ROUTES.adminSettings,
      severity: "info",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    scope,
    summary: {
      ordersToday: {
        count: ordersTodayAgg._count._all,
        orderValueIncVat: orderValue,
        orderValueLabel: formatGbpIncVat(orderValue),
      },
      openOrders: { count: openOrderCount },
      activeTradeCustomers: { count: activeCustomerCount },
      tradeApplicationsAttention: { count: appAttention },
      openQuotes: openQuotesCount == null ? null : { count: openQuotesCount },
    },
    ordersAttention: {
      readyForExport: { count: readyCount, items: readyItems.map(mapOrderRow) },
      processing: { count: processingCount, items: processingItems.map(mapOrderRow) },
      exportBlocked: { count: blockedCount, items: blockedItems.map(mapOrderRow) },
      creditHold: { count: creditHoldCount, items: creditHoldItems },
      creditReview: { count: creditReviewCount, items: creditReviewItems },
      backorderedOrders: backorderMetrics,
    },
    applications: {
      submitted: appSubmitted,
      underReview: appUnderReview,
      moreInfoRequired: appMoreInfo,
      attentionItems: attentionAppsMapped,
    },
    recentOrders: recentOrderRows.map(mapOrderRow),
    recentActivity,
    callbacks: canSeeTasks ? { openCount: openCallbackCount } : null,
    quotes: canSeeQuotes
      ? {
          draft: quoteDraft,
          sentOrViewed: quoteSentViewed,
          expiringSoon: quoteExpiring,
        }
      : null,
    customers: {
      active: activeCustomerCount,
      newlyApproved7d,
    },
    stock,
    autopart504c,
    email,
    needsAttention,
  };
}

// Re-export for tests / docs clarity
export {
  DASHBOARD_ATTENTION_APPLICATION_STATUSES,
  DASHBOARD_OPEN_ORDER_STATUSES,
  DASHBOARD_OPEN_QUOTE_STATUSES,
};
