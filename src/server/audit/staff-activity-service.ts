import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";
import { formatAuditDateTime, londonCalendarDayBounds } from "@/lib/datetime";
import {
  humanStaffActivityAction,
  LOGIN_SUCCESS_ACTIONS,
  MEANINGFUL_STAFF_ACTIONS,
  SECURITY_STAFF_ACTIONS,
  STAFF_ACTIVITY_BREAKDOWN,
  staffActivityAreaForAction,
  staffActivityAreaLabel,
  type StaffActivityArea,
  type StaffActivityBreakdownKey,
  type StaffActivityPeriod,
} from "@/domain/staff-activity";

async function requireSuperAdmin(userId: string) {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType === "TRADE" || !profile.systemRoles.includes("SUPER_ADMIN")) {
    throw new AuthError("Only Super Admin can view staff activity", "FORBIDDEN", 403);
  }
  return profile;
}

function periodBounds(period: StaffActivityPeriod, fromIso?: string | null, toIso?: string | null) {
  const now = new Date();
  if (period === "custom") {
    const from = fromIso ? new Date(fromIso) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const to = toIso ? new Date(toIso) : now;
    return { from, to };
  }
  if (period === "today") {
    const day = londonCalendarDayBounds(now);
    return { from: day.start, to: day.end };
  }
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  return { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), to: now };
}

function actionsForArea(area: StaffActivityArea | "all"): string[] | null {
  if (area === "all") return null;
  // Broad prefix + known list — filter in SQL where possible via action list.
  const known = Object.entries(
    // rebuild from catalog via helper over a seed list of known actions
    Object.fromEntries(
      [
        ...SECURITY_STAFF_ACTIONS,
        ...MEANINGFUL_STAFF_ACTIONS,
        "si.daily_brief.opened",
        "si.portfolio.opened",
        "si.enquiry.opened",
        "si.gaps.opened",
        "si.opportunities.opened",
        "si.rebate.opened",
      ].map((action) => [action, staffActivityAreaForAction(action)]),
    ),
  )
    .filter(([, a]) => a === area)
    .map(([action]) => action);
  return known.length ? known : null;
}

function snapshotLabel(metadata: unknown, entityType: string, entityId: string | null): string | null {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const meta = metadata as Record<string, unknown>;
    for (const key of [
      "companyName",
      "customerName",
      "name",
      "label",
      "orderNumber",
      "quoteNumber",
      "reference",
      "sku",
      "subject",
      "detail",
      "title",
    ]) {
      const value = meta[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  if (entityType === "User" && entityId) return "User account";
  if (entityType && entityId) return `${entityType}`;
  return null;
}

function detailFromEvent(metadata: unknown, before: unknown, after: unknown): string | null {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const meta = metadata as Record<string, unknown>;
    for (const key of ["detail", "subject", "summary", "note", "reason", "changes"]) {
      const value = meta[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value && typeof value === "object") {
        try {
          return JSON.stringify(value);
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (after && typeof after === "object") {
    try {
      const keys = Object.keys(after as object);
      if (keys.length && keys.length <= 6) return `Updated: ${keys.join(", ")}`;
    } catch {
      /* ignore */
    }
  }
  void before;
  return null;
}

function recordHref(entityType: string, entityId: string | null, companyId: string | null): string | null {
  if (companyId) return `/admin/customers/${companyId}`;
  if (!entityId) return null;
  if (entityType === "Company") return `/admin/customers/${entityId}`;
  if (entityType === "Order") return `/admin/orders/${entityId}`;
  if (entityType === "Quote") return `/admin/quotes/${entityId}`;
  if (entityType === "Product") return `/admin/products/${entityId}`;
  if (entityType === "TradeApplication" || entityType === "Application") {
    return `/admin/applications/${entityId}`;
  }
  return null;
}

export type StaffActivityOverview = {
  internalUsers: number;
  loggedInToday: number;
  activeToday: number;
  meaningfulActionsToday: number;
};

export type StaffUserActivitySummary = {
  lastLoginAt: string | null;
  lastLoginLabel: string;
  lastActiveAt: string | null;
  lastActiveLabel: string;
  actions30d: number;
};

export async function getStaffActivityOverview(actorUserId: string): Promise<StaffActivityOverview> {
  await requireSuperAdmin(actorUserId);
  const { start, end } = londonCalendarDayBounds(new Date());

  const [internalUsers, loggedInToday, activeToday, meaningfulActionsToday] = await Promise.all([
    prisma.user.count({ where: { actorType: "INTERNAL" } }),
    prisma.user.count({
      where: { actorType: "INTERNAL", lastLoginAt: { gte: start, lt: end } },
    }),
    prisma.user.count({
      where: { actorType: "INTERNAL", lastActiveAt: { gte: start, lt: end } },
    }),
    prisma.auditEvent.count({
      where: {
        createdAt: { gte: start, lt: end },
        actor: { actorType: "INTERNAL" },
        action: { in: [...MEANINGFUL_STAFF_ACTIONS] },
      },
    }),
  ]);

  return { internalUsers, loggedInToday, activeToday, meaningfulActionsToday };
}

export async function staffActivitySummariesForUsers(
  actorUserId: string,
  userIds: string[],
): Promise<Map<string, StaffUserActivitySummary>> {
  await requireSuperAdmin(actorUserId);
  const map = new Map<string, StaffUserActivitySummary>();
  if (!userIds.length) return map;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, actorType: "INTERNAL" },
    select: { id: true, lastLoginAt: true, lastActiveAt: true },
  });
  const counts = await prisma.auditEvent.groupBy({
    by: ["actorUserId"],
    where: {
      actorUserId: { in: userIds },
      createdAt: { gte: since },
      action: { in: [...MEANINGFUL_STAFF_ACTIONS] },
    },
    _count: { _all: true },
  });
  const countByUser = new Map(counts.map((row) => [row.actorUserId!, row._count._all]));

  for (const user of users) {
    map.set(user.id, {
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      lastLoginLabel: formatAuditDateTime(user.lastLoginAt) ?? "Never",
      lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
      lastActiveLabel: formatAuditDateTime(user.lastActiveAt) ?? "—",
      actions30d: countByUser.get(user.id) ?? 0,
    });
  }
  return map;
}

const activityQuerySchema = z.object({
  userId: z.string().min(1),
  period: z.enum(["today", "7d", "30d", "90d", "custom"]).default("30d"),
  from: z.string().datetime().optional().nullable(),
  to: z.string().datetime().optional().nullable(),
  area: z
    .enum([
      "all",
      "security",
      "customers",
      "crm",
      "sales",
      "sales_intelligence",
      "catalogue",
      "administration",
      "other",
    ])
    .default("all"),
  actionFilter: z.string().max(120).optional().nullable(),
  q: z.string().max(120).optional().nullable(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  breakdownKey: z.string().max(64).optional().nullable(),
});

export type StaffActivityTimelineRow = {
  id: string;
  at: string;
  atLabel: string;
  action: string;
  actionLabel: string;
  area: StaffActivityArea;
  areaLabel: string;
  recordLabel: string | null;
  recordHref: string | null;
  detail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export type StaffActivityDetail = {
  user: {
    id: string;
    name: string;
    email: string;
    roleLabel: string;
    status: string;
    statusLabel: string;
  };
  lastLoginAt: string | null;
  lastLoginLabel: string;
  lastActiveAt: string | null;
  lastActiveLabel: string;
  logins30d: number;
  actions30d: number;
  followUps30d: number;
  customersWorked30d: number;
  breakdown: Array<{ key: StaffActivityBreakdownKey; label: string; count: number }>;
  timeline: StaffActivityTimelineRow[];
  total: number;
  page: number;
  pageSize: number;
  period: StaffActivityPeriod;
  area: StaffActivityArea | "all";
};

export async function getStaffUserActivity(
  actorUserId: string,
  raw: unknown,
): Promise<StaffActivityDetail> {
  await requireSuperAdmin(actorUserId);
  const input = activityQuerySchema.parse(raw);
  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { userRoles: { include: { role: true }, take: 1 } },
  });
  if (!target || target.actorType !== "INTERNAL") {
    throw new AuthError("User not found", "NOT_FOUND", 404);
  }

  const bounds = periodBounds(input.period, input.from, input.to);
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const areaActions = actionsForArea(input.area);
  let actionIn: string[] | undefined;
  if (input.breakdownKey) {
    const cat = STAFF_ACTIVITY_BREAKDOWN.find((row) => row.key === input.breakdownKey);
    if (cat) actionIn = [...cat.actions];
  } else if (input.actionFilter) {
    actionIn = [input.actionFilter];
  } else if (areaActions) {
    actionIn = areaActions;
  }

  const search = input.q?.trim();
  const where = {
    actorUserId: target.id,
    createdAt: { gte: bounds.from, lte: bounds.to },
    ...(actionIn ? { action: { in: actionIn } } : {}),
    ...(search
      ? {
          OR: [
            { action: { contains: search, mode: "insensitive" as const } },
            { entityType: { contains: search, mode: "insensitive" as const } },
            { entityId: { contains: search, mode: "insensitive" as const } },
            { company: { name: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [
    total,
    rows,
    logins30d,
    actions30d,
    followUps30d,
    customerEvents,
    breakdownGroups,
  ] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        companyId: true,
        metadata: true,
        before: true,
        after: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        company: { select: { id: true, name: true } },
      },
    }),
    prisma.auditEvent.count({
      where: {
        actorUserId: target.id,
        createdAt: { gte: since30 },
        action: { in: [...LOGIN_SUCCESS_ACTIONS] },
      },
    }),
    prisma.auditEvent.count({
      where: {
        actorUserId: target.id,
        createdAt: { gte: since30 },
        action: { in: [...MEANINGFUL_STAFF_ACTIONS] },
      },
    }),
    prisma.auditEvent.count({
      where: {
        actorUserId: target.id,
        createdAt: { gte: since30 },
        action: {
          in: [
            "sales_followup.created",
            "sales_followup.duplicate_override",
            "sales_followup.completed",
            "crm.task.created",
            "crm.task.completed",
          ],
        },
      },
    }),
    prisma.auditEvent.findMany({
      where: {
        actorUserId: target.id,
        createdAt: { gte: since30 },
        companyId: { not: null },
      },
      distinct: ["companyId"],
      select: { companyId: true },
    }),
    prisma.auditEvent.groupBy({
      by: ["action"],
      where: {
        actorUserId: target.id,
        createdAt: { gte: since30 },
        action: {
          in: STAFF_ACTIVITY_BREAKDOWN.flatMap((row) => [...row.actions]),
        },
      },
      _count: { _all: true },
    }),
  ]);

  const countByAction = new Map(breakdownGroups.map((row) => [row.action, row._count._all]));
  const breakdown = STAFF_ACTIVITY_BREAKDOWN.map((row) => ({
    key: row.key,
    label: row.label,
    count: row.actions.reduce((sum, action) => sum + (countByAction.get(action) ?? 0), 0),
  }));

  const roleKey = target.userRoles[0]?.role.key ?? null;
  const roleLabel =
    roleKey === "SUPER_ADMIN"
      ? "Super Admin"
      : roleKey === "SALES_REPRESENTATIVE"
        ? "Sales Rep"
        : roleKey?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ?? "No role";

  const statusLabel =
    target.status === "ACTIVE" ? "Active" : target.status === "DISABLED" ? "Disabled" : "Invited";

  return {
    user: {
      id: target.id,
      name: target.name?.trim() || target.email,
      email: target.email,
      roleLabel,
      status: target.status,
      statusLabel,
    },
    lastLoginAt: target.lastLoginAt?.toISOString() ?? null,
    lastLoginLabel: formatAuditDateTime(target.lastLoginAt) ?? "Never",
    lastActiveAt: target.lastActiveAt?.toISOString() ?? null,
    lastActiveLabel: formatAuditDateTime(target.lastActiveAt) ?? "—",
    logins30d,
    actions30d,
    followUps30d,
    customersWorked30d: customerEvents.length,
    breakdown,
    timeline: rows.map((row) => {
      const area = staffActivityAreaForAction(row.action);
      const companyLabel = row.company?.name ?? null;
      const snap = snapshotLabel(row.metadata, row.entityType, row.entityId);
      return {
        id: row.id,
        at: row.createdAt.toISOString(),
        atLabel: formatAuditDateTime(row.createdAt) ?? "—",
        action: row.action,
        actionLabel: humanStaffActivityAction(row.action),
        area,
        areaLabel: staffActivityAreaLabel(area),
        recordLabel: companyLabel ?? snap,
        recordHref: recordHref(row.entityType, row.entityId, row.companyId),
        detail: detailFromEvent(row.metadata, row.before, row.after),
        ipAddress: SECURITY_STAFF_ACTIONS.includes(row.action as (typeof SECURITY_STAFF_ACTIONS)[number])
          ? row.ipAddress
          : null,
        userAgent: SECURITY_STAFF_ACTIONS.includes(row.action as (typeof SECURITY_STAFF_ACTIONS)[number])
          ? row.userAgent
          : null,
      };
    }),
    total,
    page: input.page,
    pageSize: input.pageSize,
    period: input.period,
    area: input.area,
  };
}

export async function listStaffLoginHistory(
  actorUserId: string,
  raw: unknown,
): Promise<{ items: StaffActivityTimelineRow[]; total: number }> {
  await requireSuperAdmin(actorUserId);
  const input = z
    .object({
      userId: z.string().min(1),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
    })
    .parse(raw);

  const where = {
    actorUserId: input.userId,
    action: { in: [...SECURITY_STAFF_ACTIONS] },
  };
  const [total, rows] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return {
    total,
    items: rows.map((row) => {
      const area = staffActivityAreaForAction(row.action);
      return {
        id: row.id,
        at: row.createdAt.toISOString(),
        atLabel: formatAuditDateTime(row.createdAt) ?? "—",
        action: row.action,
        actionLabel: humanStaffActivityAction(row.action),
        area,
        areaLabel: staffActivityAreaLabel(area),
        recordLabel: null,
        recordHref: null,
        detail: detailFromEvent(row.metadata, row.before, row.after),
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
      };
    }),
  };
}
