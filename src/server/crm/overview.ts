import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { todayLondonDateOnly, addDaysIso } from "@/domain/sales-history-period";
import { OPEN_OPPORTUNITY_STAGES } from "@/domain/crm";
import {
  londonDayBounds,
  requireCrmViewer,
  resolveCrmCompanyScope,
} from "@/server/crm/scope";
import { hasPermission } from "@/server/rbac/access";

const viewSchema = z.object({
  view: z.enum(["MY", "TEAM"]).optional(),
  ownerId: z.string().optional().nullable(),
});

export async function getCrmOverview(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  const input = viewSchema.parse(raw ?? {});
  const today = todayLondonDateOnly();
  const { start: todayStart, end: todayEnd } = londonDayBounds(today);
  const upcomingEnd = new Date(`${addDaysIso(today, 7)}T23:59:59.999Z`);

  const canTeam =
    hasPermission(profile, "crm.manage") ||
    hasPermission(profile, "sales.view_team_accounts") ||
    hasPermission(profile, "sales.view_all_accounts") ||
    hasPermission(profile, "admin.access");

  const view = input.view === "TEAM" && canTeam ? "TEAM" : "MY";
  const scope = await resolveCrmCompanyScope(profile);

  const companyFilter: Prisma.TaskWhereInput =
    scope === "all" ? {} : { companyId: { in: scope.length ? scope : ["__none__"] } };

  const ownerFilter =
    view === "MY"
      ? { assigneeId: actorUserId }
      : input.ownerId
        ? { assigneeId: input.ownerId }
        : {};

  const taskBase: Prisma.TaskWhereInput = {
    ...companyFilter,
    ...ownerFilter,
    status: { in: ["OPEN", "IN_PROGRESS"] },
  };

  const oppOwner =
    view === "MY"
      ? { ownerId: actorUserId }
      : input.ownerId
        ? { ownerId: input.ownerId }
        : {};

  const oppBase: Prisma.OpportunityWhereInput = {
    ...(scope === "all" ? {} : { companyId: { in: scope.length ? scope : ["__none__"] } }),
    ...oppOwner,
    stage: { in: [...OPEN_OPPORTUNITY_STAGES] },
  };

  const leadOwner =
    view === "MY"
      ? { ownerId: actorUserId }
      : input.ownerId
        ? { ownerId: input.ownerId }
        : {};

  const leadBase: Prisma.LeadWhereInput = {
    ...leadOwner,
    status: { in: ["NEW", "CONTACTED", "QUALIFIED"] },
  };

  const activityUser =
    view === "MY"
      ? { userId: actorUserId }
      : input.ownerId
        ? { userId: input.ownerId }
        : {};

  const [
    dueToday,
    overdue,
    openOpps,
    activeLeads,
    overdueTasks,
    todayTasks,
    upcomingTasks,
    opportunities,
    recentActivity,
    recentLeads,
  ] = await Promise.all([
    prisma.task.count({
      where: { ...taskBase, dueAt: { gte: todayStart, lte: todayEnd } },
    }),
    prisma.task.count({
      where: { ...taskBase, dueAt: { lt: todayStart } },
    }),
    prisma.opportunity.count({ where: oppBase }),
    prisma.lead.count({ where: leadBase }),
    prisma.task.findMany({
      where: { ...taskBase, dueAt: { lt: todayStart } },
      orderBy: { dueAt: "asc" },
      take: 8,
      select: taskSelect,
    }),
    prisma.task.findMany({
      where: { ...taskBase, dueAt: { gte: todayStart, lte: todayEnd } },
      orderBy: { dueAt: "asc" },
      take: 8,
      select: taskSelect,
    }),
    prisma.task.findMany({
      where: {
        ...taskBase,
        dueAt: { gt: todayEnd, lte: upcomingEnd },
      },
      orderBy: { dueAt: "asc" },
      take: 8,
      select: taskSelect,
    }),
    prisma.opportunity.findMany({
      where: oppBase,
      orderBy: [{ expectedClose: "asc" }, { updatedAt: "desc" }],
      take: 8,
      select: {
        id: true,
        title: true,
        stage: true,
        value: true,
        expectedClose: true,
        company: { select: { id: true, name: true, autopartCustomerCode: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.activity.findMany({
      where: {
        ...activityUser,
        ...(scope === "all"
          ? {}
          : {
              OR: [
                { companyId: { in: scope.length ? scope : ["__none__"] } },
                { companyId: null, userId: actorUserId },
              ],
            }),
      },
      orderBy: { occurredAt: "desc" },
      take: 12,
      select: {
        id: true,
        type: true,
        subject: true,
        body: true,
        occurredAt: true,
        company: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.lead.findMany({
      where: leadBase,
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        companyName: true,
        contactName: true,
        status: true,
        source: true,
        createdAt: true,
        owner: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return {
    view,
    canTeamView: canTeam,
    today,
    counts: {
      tasksDueToday: dueToday,
      overdueTasks: overdue,
      openOpportunities: openOpps,
      activeLeads,
    },
    myDay: {
      overdue: overdueTasks.map(mapTask),
      dueToday: todayTasks.map(mapTask),
      upcoming: upcomingTasks.map(mapTask),
    },
    opportunities: opportunities.map((o) => ({
      id: o.id,
      title: o.title,
      stage: o.stage,
      value: o.value?.toString() ?? null,
      expectedClose: o.expectedClose?.toISOString() ?? null,
      company: o.company,
      ownerName: o.owner?.name || o.owner?.email || null,
    })),
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      body: a.body,
      occurredAt: a.occurredAt.toISOString(),
      company: a.company,
      actorName: a.user?.name || a.user?.email || null,
    })),
    recentLeads: recentLeads.map((l) => ({
      id: l.id,
      companyName: l.companyName,
      contactName: l.contactName,
      status: l.status,
      source: l.source,
      createdAt: l.createdAt.toISOString(),
      ownerName: l.owner?.name || l.owner?.email || null,
    })),
  };
}

const taskSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueAt: true,
  sourceModule: true,
  sourceReason: true,
  company: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true } },
} as const;

function mapTask(t: {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: Date | null;
  sourceModule: string | null;
  sourceReason: string | null;
  company: { id: string; name: string } | null;
  assignee: { id: string; name: string | null; email: string } | null;
}) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueAt: t.dueAt?.toISOString() ?? null,
    sourceModule: t.sourceModule,
    sourceReason: t.sourceReason,
    company: t.company,
    assigneeName: t.assignee?.name || t.assignee?.email || null,
  };
}
