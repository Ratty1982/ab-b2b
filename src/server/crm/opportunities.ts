import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError } from "@/server/rbac/guards";
import { dueAtFromDateOnly } from "@/domain/sales-followup";
import { OPEN_OPPORTUNITY_STAGES, OPPORTUNITY_STAGES } from "@/domain/crm";
import { resolveSalesRepAssignmentRoute } from "@/server/sales/account-manager";
import {
  assertCrmCompanyAccess,
  assertOpportunityAccess,
  requireCrmMutator,
  requireCrmViewer,
  resolveCrmCompanyScope,
} from "@/server/crm/scope";

const listSchema = z.object({
  q: z.string().max(200).optional().nullable(),
  stage: z
    .enum([
      "NEW_LEAD",
      "QUALIFIED",
      "CONTACTED",
      "MEETING",
      "QUOTE_REQUIRED",
      "QUOTE_SENT",
      "NEGOTIATION",
      "WON",
      "LOST",
      "OPEN",
      "ALL",
    ])
    .optional()
    .nullable(),
  ownerId: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export async function listCrmOpportunities(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  const input = listSchema.parse(raw ?? {});
  const scope = await resolveCrmCompanyScope(profile);
  const where: Prisma.OpportunityWhereInput = {
    ...(scope === "all" ? {} : { companyId: { in: scope.length ? scope : ["__none__"] } }),
  };
  if (!input.stage || input.stage === "OPEN") {
    where.stage = { in: [...OPEN_OPPORTUNITY_STAGES] };
  } else if (input.stage !== "ALL") {
    where.stage = input.stage as (typeof OPPORTUNITY_STAGES)[number];
  }
  if (input.ownerId) where.ownerId = input.ownerId;
  if (input.companyId) where.companyId = input.companyId;
  if (input.q?.trim()) {
    const qq = input.q.trim();
    where.OR = [
      { title: { contains: qq, mode: "insensitive" } },
      { company: { name: { contains: qq, mode: "insensitive" } } },
    ];
  }

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const [total, rows, stageGroups] = await Promise.all([
    prisma.opportunity.count({ where }),
    prisma.opportunity.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: oppSelect,
    }),
    prisma.opportunity.groupBy({
      by: ["stage"],
      where: {
        ...(scope === "all" ? {} : { companyId: { in: scope.length ? scope : ["__none__"] } }),
        stage: { in: [...OPEN_OPPORTUNITY_STAGES] },
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      },
      _count: { _all: true },
      _sum: { value: true },
    }),
  ]);

  return {
    items: rows.map(mapOpp),
    page,
    pageSize,
    total,
    stageTotals: stageGroups.map((g) => ({
      stage: g.stage,
      count: g._count._all,
      /** Sum of non-null entered estimates only — Opportunity Value, not revenue. */
      opportunityValue: g._sum.value?.toString() ?? null,
    })),
  };
}

const oppSelect = {
  id: true,
  title: true,
  stage: true,
  value: true,
  expectedClose: true,
  description: true,
  lostReason: true,
  wonAt: true,
  lostAt: true,
  updatedAt: true,
  createdAt: true,
  company: { select: { id: true, name: true, autopartCustomerCode: true } },
  owner: { select: { id: true, name: true, email: true } },
} as const;

function mapOpp(o: {
  id: string;
  title: string;
  stage: string;
  value: Prisma.Decimal | null;
  expectedClose: Date | null;
  description: string | null;
  lostReason: string | null;
  wonAt: Date | null;
  lostAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  company: { id: string; name: string; autopartCustomerCode: string | null };
  owner: { id: string; name: string | null; email: string } | null;
}) {
  return {
    id: o.id,
    title: o.title,
    stage: o.stage,
    value: o.value?.toString() ?? null,
    expectedClose: o.expectedClose?.toISOString() ?? null,
    description: o.description,
    lostReason: o.lostReason,
    wonAt: o.wonAt?.toISOString() ?? null,
    lostAt: o.lostAt?.toISOString() ?? null,
    updatedAt: o.updatedAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    company: o.company,
    ownerId: o.owner?.id ?? null,
    ownerName: o.owner?.name || o.owner?.email || null,
  };
}

export async function getCrmOpportunity(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  const { opportunityId } = z.object({ opportunityId: z.string().min(1) }).parse(raw ?? {});
  await assertOpportunityAccess(profile, opportunityId);
  const opp = await prisma.opportunity.findUniqueOrThrow({
    where: { id: opportunityId },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          tradingName: true,
          autopartCustomerCode: true,
          status: true,
        },
      },
      owner: { select: { id: true, name: true, email: true } },
      activities: {
        orderBy: { occurredAt: "desc" },
        take: 25,
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      quotes: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          quoteNumber: true,
          status: true,
          grandTotal: true,
          createdAt: true,
          sentAt: true,
        },
      },
    },
  });
  const openTasks = await prisma.task.findMany({
    where: {
      companyId: opp.companyId,
      status: { in: ["OPEN", "IN_PROGRESS"] },
    },
    orderBy: { dueAt: "asc" },
    take: 8,
    select: {
      id: true,
      title: true,
      dueAt: true,
      status: true,
      sourceModule: true,
    },
  });
  return {
    ...mapOpp(opp),
    company: opp.company,
    owner: opp.owner
      ? { id: opp.owner.id, name: opp.owner.name || opp.owner.email }
      : null,
    activities: opp.activities.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      body: a.body,
      occurredAt: a.occurredAt.toISOString(),
      actorName: a.user?.name || a.user?.email || null,
    })),
    quotes: opp.quotes.map((q) => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      status: q.status,
      grandTotal: q.grandTotal.toString(),
      createdAt: q.createdAt.toISOString(),
      sentAt: q.sentAt?.toISOString() ?? null,
    })),
    openTasks: openTasks.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt?.toISOString() ?? null,
      status: t.status,
      sourceModule: t.sourceModule,
    })),
  };
}

const createSchema = z.object({
  companyId: z.string().min(1),
  title: z.string().min(1).max(200),
  stage: z
    .enum([
      "NEW_LEAD",
      "QUALIFIED",
      "CONTACTED",
      "MEETING",
      "QUOTE_REQUIRED",
      "QUOTE_SENT",
      "NEGOTIATION",
      "WON",
      "LOST",
    ])
    .optional(),
  value: z.union([z.string(), z.number()]).optional().nullable(),
  expectedClose: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  ownerId: z.string().optional().nullable(),
});

export async function createCrmOpportunity(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  requireCrmMutator(profile);
  const input = createSchema.parse(raw ?? {});
  await assertCrmCompanyAccess(profile, input.companyId);

  let ownerId = input.ownerId || null;
  if (!ownerId) {
    const route = await resolveSalesRepAssignmentRoute(input.companyId);
    ownerId = route?.assigneeUserId ?? actorUserId;
  }

  const value =
    input.value == null || input.value === ""
      ? null
      : new Prisma.Decimal(String(input.value));

  const companyBefore = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { status: true },
  });

  const opp = await prisma.opportunity.create({
    data: {
      companyId: input.companyId,
      title: input.title.trim(),
      stage: input.stage && input.stage !== "WON" && input.stage !== "LOST" ? input.stage : "NEW_LEAD",
      value,
      expectedClose: input.expectedClose ? dueAtFromDateOnly(input.expectedClose) : null,
      description: input.description?.trim() || null,
      ownerId,
    },
  });

  // Guard: opportunity create must not alter company lifecycle.
  const companyAfter = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { status: true },
  });
  if (companyBefore?.status !== companyAfter?.status) {
    throw new AuthError("Company status changed unexpectedly", "INTERNAL", 500);
  }

  await prisma.activity.create({
    data: {
      companyId: input.companyId,
      opportunityId: opp.id,
      userId: actorUserId,
      type: "SYSTEM",
      subject: "Opportunity created",
      body: opp.title,
      metadata: { kind: "opportunity_created" },
    },
  });

  await recordAuditEvent({
    action: "crm.opportunity.created",
    entityType: "Opportunity",
    entityId: opp.id,
    actorUserId,
    companyId: input.companyId,
    metadata: { stage: opp.stage },
  });

  return { id: opp.id };
}

const stageSchema = z.object({
  opportunityId: z.string().min(1),
  stage: z.enum([
    "NEW_LEAD",
    "QUALIFIED",
    "CONTACTED",
    "MEETING",
    "QUOTE_REQUIRED",
    "QUOTE_SENT",
    "NEGOTIATION",
    "WON",
    "LOST",
  ]),
  value: z.union([z.string(), z.number()]).optional().nullable(),
  lostReason: z.string().max(200).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  confirmWonLost: z.boolean().optional(),
});

export async function updateCrmOpportunityStage(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  requireCrmMutator(profile);
  const input = stageSchema.parse(raw ?? {});
  const existing = await assertOpportunityAccess(profile, input.opportunityId);

  if ((input.stage === "WON" || input.stage === "LOST") && !input.confirmWonLost) {
    throw new AuthError("Confirmation required to mark Won or Lost", "BAD_REQUEST", 400);
  }
  if (input.stage === "LOST" && !input.lostReason?.trim()) {
    throw new AuthError("Loss reason is required", "BAD_REQUEST", 400);
  }

  const data: Prisma.OpportunityUpdateInput = {
    stage: input.stage,
  };
  if (input.stage === "WON") {
    data.wonAt = new Date();
    data.lostAt = null;
    data.lostReason = null;
    if (input.value != null && input.value !== "") {
      data.value = new Prisma.Decimal(String(input.value));
    }
  } else if (input.stage === "LOST") {
    data.lostAt = new Date();
    data.wonAt = null;
    data.lostReason = input.lostReason!.trim();
  }

  const opp = await prisma.opportunity.update({
    where: { id: input.opportunityId },
    data,
  });

  await prisma.activity.create({
    data: {
      companyId: existing.companyId,
      opportunityId: opp.id,
      userId: actorUserId,
      type: "SYSTEM",
      subject:
        input.stage === "WON"
          ? "Opportunity won"
          : input.stage === "LOST"
            ? "Opportunity lost"
            : "Opportunity stage changed",
      body: input.note?.trim() || `${existing.stage} → ${input.stage}`,
      metadata: {
        kind: "opportunity_stage",
        from: existing.stage,
        to: input.stage,
      },
    },
  });

  const action =
    input.stage === "WON"
      ? "crm.opportunity.won"
      : input.stage === "LOST"
        ? "crm.opportunity.lost"
        : "crm.opportunity.stage_changed";

  await recordAuditEvent({
    action,
    entityType: "Opportunity",
    entityId: opp.id,
    actorUserId,
    companyId: existing.companyId,
    metadata: { from: existing.stage, to: input.stage, lostReason: input.lostReason ?? null },
  });

  return { id: opp.id, stage: opp.stage };
}

export async function updateCrmOpportunity(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  requireCrmMutator(profile);
  const input = z
    .object({
      opportunityId: z.string().min(1),
      title: z.string().min(1).max(200).optional(),
      value: z.union([z.string(), z.number()]).optional().nullable(),
      expectedClose: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      description: z.string().max(4000).optional().nullable(),
      ownerId: z.string().optional().nullable(),
    })
    .parse(raw ?? {});
  await assertOpportunityAccess(profile, input.opportunityId);
  const opp = await prisma.opportunity.update({
    where: { id: input.opportunityId },
    data: {
      ...(input.title != null ? { title: input.title.trim() } : {}),
      ...(input.value !== undefined
        ? {
            value:
              input.value == null || input.value === ""
                ? null
                : new Prisma.Decimal(String(input.value)),
          }
        : {}),
      ...(input.expectedClose !== undefined
        ? {
            expectedClose: input.expectedClose
              ? dueAtFromDateOnly(input.expectedClose)
              : null,
          }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
    },
  });
  return { id: opp.id };
}

export async function linkQuoteToOpportunity(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  requireCrmMutator(profile);
  const input = z
    .object({
      opportunityId: z.string().min(1),
      quoteId: z.string().min(1),
    })
    .parse(raw ?? {});
  const opp = await assertOpportunityAccess(profile, input.opportunityId);
  const quote = await prisma.quote.findUnique({
    where: { id: input.quoteId },
    select: { id: true, companyId: true },
  });
  if (!quote) throw new AuthError("Quote not found", "NOT_FOUND", 404);
  if (quote.companyId !== opp.companyId) {
    throw new AuthError("Quote company does not match opportunity", "BAD_REQUEST", 400);
  }
  await prisma.quote.update({
    where: { id: quote.id },
    data: { opportunityId: opp.id },
  });
  return { ok: true as const };
}
