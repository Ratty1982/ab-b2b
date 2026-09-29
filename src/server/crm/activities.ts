import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError } from "@/server/rbac/guards";
import { dueAtFromDateOnly } from "@/domain/sales-followup";
import { CALL_OUTCOMES } from "@/domain/crm";
import {
  assertCrmCompanyAccess,
  assertLeadAccess,
  canLogCrmActivity,
  requireCrmViewer,
  resolveCrmCompanyScope,
} from "@/server/crm/scope";

const listSchema = z.object({
  q: z.string().max(200).optional().nullable(),
  type: z
    .enum([
      "CALL",
      "EMAIL",
      "MEETING",
      "VISIT",
      "NOTE",
      "TASK",
      "FOLLOW_UP",
      "SYSTEM",
      "CALLBACK_REQUEST",
      "ALL",
    ])
    .optional()
    .nullable(),
  userId: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export async function listCrmActivities(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  const input = listSchema.parse(raw ?? {});
  const scope = await resolveCrmCompanyScope(profile);
  const where: Prisma.ActivityWhereInput = {
    ...(scope === "all"
      ? {}
      : {
          OR: [
            { companyId: { in: scope.length ? scope : ["__none__"] } },
            { companyId: null, userId: actorUserId },
          ],
        }),
  };
  if (input.type && input.type !== "ALL") where.type = input.type;
  if (input.userId) where.userId = input.userId;
  if (input.companyId) where.companyId = input.companyId;
  if (input.from || input.to) {
    where.occurredAt = {};
    if (input.from) where.occurredAt.gte = new Date(`${input.from}T00:00:00.000Z`);
    if (input.to) where.occurredAt.lte = new Date(`${input.to}T23:59:59.999Z`);
  }
  if (input.q?.trim()) {
    const qq = input.q.trim();
    where.AND = [
      {
        OR: [
          { subject: { contains: qq, mode: "insensitive" } },
          { body: { contains: qq, mode: "insensitive" } },
          { company: { name: { contains: qq, mode: "insensitive" } } },
        ],
      },
    ];
  }

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 40;
  const [total, rows] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        subject: true,
        body: true,
        occurredAt: true,
        company: { select: { id: true, name: true } },
        lead: { select: { id: true, companyName: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return {
    items: rows.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      body: a.body,
      occurredAt: a.occurredAt.toISOString(),
      company: a.company,
      lead: a.lead,
      actorName: a.user?.name || a.user?.email || null,
    })),
    page,
    pageSize,
    total,
  };
}

const logSchema = z.object({
  type: z.enum(["CALL", "EMAIL", "MEETING", "NOTE"]),
  companyId: z.string().optional().nullable(),
  leadId: z.string().optional().nullable(),
  opportunityId: z.string().optional().nullable(),
  subject: z.string().max(300).optional().nullable(),
  body: z.string().max(8000).optional().nullable(),
  occurredAt: z.string().datetime().optional().nullable(),
  outcome: z.string().max(80).optional().nullable(),
  createFollowUpTask: z.boolean().optional(),
  followUpDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  followUpTitle: z.string().max(200).optional().nullable(),
});

export async function logCrmActivity(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  if (!canLogCrmActivity(profile)) {
    throw new AuthError("Not permitted to log CRM activity", "FORBIDDEN", 403);
  }
  const input = logSchema.parse(raw ?? {});
  if (!input.companyId && !input.leadId) {
    throw new AuthError("Customer or lead is required", "BAD_REQUEST", 400);
  }
  if (input.companyId) await assertCrmCompanyAccess(profile, input.companyId);
  if (input.leadId) await assertLeadAccess(profile, input.leadId);

  if (input.type === "CALL" && input.outcome) {
    if (!(CALL_OUTCOMES as readonly string[]).includes(input.outcome)) {
      throw new AuthError("Invalid call outcome", "BAD_REQUEST", 400);
    }
  }

  const subject =
    input.subject?.trim() ||
    (input.type === "CALL"
      ? `Call${input.outcome ? ` — ${input.outcome}` : ""}`
      : input.type === "EMAIL"
        ? "Email logged"
        : input.type === "MEETING"
          ? "Meeting"
          : "Note");

  const companyStatusBefore = input.companyId
    ? (
        await prisma.company.findUnique({
          where: { id: input.companyId },
          select: { status: true },
        })
      )?.status
    : null;

  const activity = await prisma.activity.create({
    data: {
      companyId: input.companyId ?? null,
      leadId: input.leadId ?? null,
      opportunityId: input.opportunityId ?? null,
      userId: actorUserId,
      type: input.type,
      subject,
      body: input.body?.trim() || null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      metadata: {
        kind: "manual_log",
        outcome: input.outcome ?? null,
        emailSent: false,
      },
    },
  });

  if (input.companyId && companyStatusBefore) {
    const after = await prisma.company.findUnique({
      where: { id: input.companyId },
      select: { status: true },
    });
    if (after?.status !== companyStatusBefore) {
      throw new AuthError("Company status changed unexpectedly", "INTERNAL", 500);
    }
  }

  // Touch lead status lightly when logging first call
  if (input.leadId && input.type === "CALL") {
    const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
    if (lead?.status === "NEW") {
      await prisma.lead.update({
        where: { id: input.leadId },
        data: { status: "CONTACTED" },
      });
    }
  }

  let taskId: string | null = null;
  if (input.createFollowUpTask && input.companyId) {
    const due = input.followUpDueDate
      ? dueAtFromDateOnly(input.followUpDueDate)
      : dueAtFromDateOnly(
          new Date().toISOString().slice(0, 10),
        );
    const task = await prisma.task.create({
      data: {
        companyId: input.companyId,
        assigneeId: actorUserId,
        createdById: actorUserId,
        title:
          input.followUpTitle?.trim() ||
          `Follow up — ${subject}`,
        status: "OPEN",
        priority: "NORMAL",
        taskType: "FOLLOW_UP",
        dueAt: due,
      },
    });
    taskId = task.id;
  }

  // Notes also persist to Note model when type NOTE + company
  if (input.type === "NOTE" && input.companyId && input.body?.trim()) {
    await prisma.note.create({
      data: {
        companyId: input.companyId,
        authorId: actorUserId,
        body: input.body.trim(),
      },
    });
  }

  await recordAuditEvent({
    action: "crm.activity.created",
    entityType: "Activity",
    entityId: activity.id,
    actorUserId,
    companyId: input.companyId ?? null,
    metadata: { type: input.type, taskId },
  });

  return { id: activity.id, taskId };
}

export async function createCrmTask(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  const { hasPermission } = await import("@/server/rbac/access");
  if (!hasPermission(profile, "tasks.manage") && !canLogCrmActivity(profile)) {
    throw new AuthError("Not permitted to create tasks", "FORBIDDEN", 403);
  }
  const input = z
    .object({
      companyId: z.string().min(1),
      title: z.string().min(1).max(200),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional(),
      taskType: z.enum(["CALL", "EMAIL", "MEETING", "FOLLOW_UP", "GENERAL"]).optional(),
      notes: z.string().max(4000).optional().nullable(),
      assigneeId: z.string().optional().nullable(),
    })
    .parse(raw ?? {});
  await assertCrmCompanyAccess(profile, input.companyId);
  const statusBefore = (
    await prisma.company.findUnique({
      where: { id: input.companyId },
      select: { status: true },
    })
  )?.status;

  const task = await prisma.task.create({
    data: {
      companyId: input.companyId,
      title: input.title.trim(),
      description: input.notes?.trim() || null,
      assigneeId: input.assigneeId || actorUserId,
      createdById: actorUserId,
      status: "OPEN",
      priority: input.priority ?? "NORMAL",
      taskType: input.taskType ?? "GENERAL",
      dueAt: dueAtFromDateOnly(input.dueDate),
    },
  });

  const statusAfter = (
    await prisma.company.findUnique({
      where: { id: input.companyId },
      select: { status: true },
    })
  )?.status;
  if (statusBefore !== statusAfter) {
    throw new AuthError("Company status changed unexpectedly", "INTERNAL", 500);
  }

  await prisma.activity.create({
    data: {
      companyId: input.companyId,
      userId: actorUserId,
      type: "TASK",
      subject: "Task created",
      body: task.title,
      metadata: { taskId: task.id },
    },
  });

  await recordAuditEvent({
    action: "crm.task.created",
    entityType: "Task",
    entityId: task.id,
    actorUserId,
    companyId: input.companyId,
  });

  return { id: task.id };
}
