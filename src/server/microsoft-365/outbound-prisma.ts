/**
 * Prisma adapter for outbound To Do jobs. Claim uses updateMany so two workers cannot take the same row.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/infra/database/client";
import { ordinaryRetryIncludesJob, type OutboundTaskSnapshot } from "@/domain/microsoft-todo-outbound";
import {
  mergeOutboundPayload,
  outboundDedupeKey,
  type OutboundConnection,
  type OutboundJob,
  type OutboundJobPayload,
  type OutboundMapping,
  type OutboundStore,
} from "@/server/microsoft-365/outbound-sync";

function asPayload(value: Prisma.JsonValue | null): OutboundJobPayload {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const taskId = typeof row["taskId"] === "string" ? row["taskId"] : "";
  const approvalRaw = row["createApproval"];
  const approval =
    approvalRaw && typeof approvalRaw === "object" && !Array.isArray(approvalRaw)
      ? (approvalRaw as Record<string, unknown>)
      : null;
  return {
    taskId,
    ...(row["explicit"] === true ? { explicit: true } : {}),
    ...(row["release"] === true ? { release: true } : {}),
    ...(row["reviewed"] === true ? { reviewed: true } : {}),
    ...(row["createUncertain"] === true ? { createUncertain: true } : {}),
    ...(row["authorizeCreateOnce"] === true ? { authorizeCreateOnce: true } : {}),
    ...(row["recheckOnly"] === true ? { recheckOnly: true } : {}),
    ...(typeof row["knownMicrosoftTaskId"] === "string" ? { knownMicrosoftTaskId: row["knownMicrosoftTaskId"] } : {}),
    ...(typeof row["taskRevision"] === "string" ? { taskRevision: row["taskRevision"] } : {}),
    ...(row["revisionDirty"] === true ? { revisionDirty: true } : {}),
    ...(approval &&
    typeof approval["approvedByUserId"] === "string" &&
    typeof approval["approvedAt"] === "string" &&
    typeof approval["jobId"] === "string" &&
    typeof approval["taskId"] === "string" &&
    typeof approval["connectionId"] === "string" &&
    typeof approval["taskRevision"] === "string" &&
    approval["acknowledgedDuplicateRisk"] === true
      ? {
          createApproval: {
            approvedByUserId: approval["approvedByUserId"],
            approvedAt: approval["approvedAt"],
            jobId: approval["jobId"],
            taskId: approval["taskId"],
            connectionId: approval["connectionId"],
            taskRevision: approval["taskRevision"],
            acknowledgedDuplicateRisk: true as const,
          },
        }
      : {}),
  };
}

function mapConnection(row: {
  id: string;
  userId: string;
  status: OutboundConnection["status"];
  tenantId: string;
  microsoftUserId: string;
  scopes: string;
  taskSyncEnabled: boolean;
  taskOutboundEnabledAt: Date | null;
  todoListId: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  lastTaskSyncAt: Date | null;
  lastError: string | null;
}): OutboundConnection {
  return row;
}

function mapJob(row: {
  id: string;
  connectionId: string;
  userId: string;
  kind: string;
  status: OutboundJob["status"];
  attempt: number;
  runAfter: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  lastError: string | null;
  dedupeKey: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): OutboundJob {
  return {
    id: row.id,
    connectionId: row.connectionId,
    userId: row.userId,
    kind: "TODO_OUTBOUND",
    status: row.status,
    attempt: row.attempt,
    runAfter: row.runAfter,
    leaseOwner: row.leaseOwner,
    leaseUntil: row.leaseUntil,
    lastError: row.lastError,
    dedupeKey: row.dedupeKey ?? outboundDedupeKey(row.userId, asPayload(row.payload).taskId, false),
    payload: asPayload(row.payload),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createPrismaOutboundStore(): OutboundStore {
  return {
    async findConnection(userId) {
      const row = await prisma.microsoftAccountConnection.findUnique({ where: { userId } });
      return row ? mapConnection(row) : null;
    },
    async saveConnection(row) {
      await prisma.microsoftAccountConnection.updateMany({
        where: { id: row.id, status: "CONNECTED" },
        data: {
          todoListId: row.todoListId,
          lastTaskSyncAt: row.lastTaskSyncAt,
          lastError: row.lastError,
        },
      });
    },
    async withConnectionLock(connectionId, fn) {
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${connectionId}))`;
          return fn();
        },
        { maxWait: 10_000, timeout: 60_000 },
      );
    },
    async findTask(taskId) {
      const row = await prisma.task.findUnique({ where: { id: taskId } });
      if (!row) return null;
      const task: OutboundTaskSnapshot = {
        id: row.id,
        assigneeId: row.assigneeId,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        dueAt: row.dueAt,
        completedAt: row.completedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      return task;
    },
    async findMapping(userId, taskId) {
      const row = await prisma.microsoftTaskMapping.findUnique({ where: { userId_taskId: { userId, taskId } } });
      return row?.taskId ? mapMapping({ ...row, taskId: row.taskId }) : null;
    },
    async saveMapping(row) {
      const data = {
        taskId: row.taskId,
        userId: row.userId,
        connectionId: row.connectionId,
        tenantId: row.tenantId,
        microsoftUserId: row.microsoftUserId,
        listId: row.listId,
        microsoftTaskId: row.microsoftTaskId,
        syncStatus: row.syncStatus,
        lastError: row.lastError,
        lastSyncedAt: row.lastSyncedAt,
        deletedAt: row.deletedAt,
      };
      await prisma.microsoftTaskMapping.upsert({
        where: { userId_taskId: { userId: row.userId, taskId: row.taskId } },
        create: { id: row.id, ...data },
        update: data,
      });
    },
    async findJob(jobId) {
      const row = await prisma.microsoftSyncJob.findUnique({ where: { id: jobId } });
      return row ? mapJob(row) : null;
    },
    async saveJob(job, opts) {
      if (opts?.requireLeaseOwner) {
        const updated = await prisma.microsoftSyncJob.updateMany({
          where: { id: job.id, status: "RUNNING", leaseOwner: opts.requireLeaseOwner },
          data: {
            status: job.status,
            attempt: job.attempt,
            runAfter: job.runAfter,
            leaseOwner: job.leaseOwner,
            leaseUntil: job.leaseUntil,
            lastError: job.lastError,
            payload: job.payload,
            dedupeKey: job.dedupeKey,
          },
        });
        return updated.count === 1;
      }
      await prisma.microsoftSyncJob.update({
        where: { id: job.id },
        data: {
          status: job.status,
          attempt: job.attempt,
          runAfter: job.runAfter,
          leaseOwner: job.leaseOwner,
          leaseUntil: job.leaseUntil,
          lastError: job.lastError,
          payload: job.payload,
          dedupeKey: job.dedupeKey,
        },
      });
      return true;
    },
    async holdsJobLease(jobId, owner) {
      const row = await prisma.microsoftSyncJob.findFirst({
        where: { id: jobId, status: "RUNNING", leaseOwner: owner },
        select: { id: true },
      });
      return Boolean(row);
    },
    async appendEvent(event) {
      await prisma.microsoftSyncEvent.create({
        data: {
          id: eventId(),
          userId: event.userId,
          connectionId: event.connectionId,
          kind: event.kind,
          message: event.message,
          createdAt: event.createdAt,
        },
      });
    },
    async claimJobs(now, owner, limit, leaseMs) {
      const candidates = await prisma.microsoftSyncJob.findMany({
        where: {
          kind: "TODO_OUTBOUND",
          OR: [
            { status: "QUEUED", runAfter: { lte: now } },
            { status: "RUNNING", leaseUntil: { lt: now } },
          ],
        },
        orderBy: { runAfter: "asc" },
        take: Math.max(limit, 1) * 3,
      });
      const leaseUntil = new Date(now.getTime() + leaseMs);
      const claimed: OutboundJob[] = [];
      for (const row of candidates) {
        if (claimed.length >= limit) break;
        const updated = await prisma.microsoftSyncJob.updateMany({
          where: {
            id: row.id,
            OR: [
              { status: "QUEUED", runAfter: { lte: now } },
              { status: "RUNNING", leaseUntil: { lt: now } },
            ],
          },
          data: { status: "RUNNING", leaseOwner: owner, leaseUntil, attempt: { increment: 1 } },
        });
        if (updated.count === 1) {
          claimed.push(mapJob({ ...row, status: "RUNNING", leaseOwner: owner, leaseUntil, attempt: row.attempt + 1 }));
        }
      }
      return claimed;
    },
  };
}

function mapMapping(row: OutboundMapping & { taskId: string }): OutboundMapping {
  return {
    id: row.id,
    taskId: row.taskId ?? "",
    userId: row.userId,
    connectionId: row.connectionId,
    tenantId: row.tenantId,
    microsoftUserId: row.microsoftUserId,
    listId: row.listId,
    microsoftTaskId: row.microsoftTaskId,
    syncStatus: row.syncStatus,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt,
    deletedAt: row.deletedAt,
  };
}

function eventId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

export async function enqueueOutboundJob(input: {
  connection: OutboundConnection;
  taskId: string;
  release: boolean;
  explicit: boolean;
  taskRevision?: string;
}): Promise<"created" | "exists" | "requeued" | "marked_dirty"> {
  const dedupeKey = outboundDedupeKey(input.connection.userId, input.taskId, input.release);
  const payload: OutboundJobPayload = {
    taskId: input.taskId,
    ...(input.release ? { release: true } : {}),
    ...(input.explicit ? { explicit: true } : {}),
    ...(input.taskRevision ? { taskRevision: input.taskRevision } : {}),
  };
  const existing = await prisma.microsoftSyncJob.findUnique({ where: { dedupeKey } });
  if (!existing) {
    try {
      await prisma.microsoftSyncJob.create({
        data: {
          connectionId: input.connection.id,
          userId: input.connection.userId,
          kind: "TODO_OUTBOUND",
          status: "QUEUED",
          dedupeKey,
          payload,
        },
      });
      return "created";
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
  const current = existing ?? (await prisma.microsoftSyncJob.findUnique({ where: { dedupeKey } }));
  if (!current) throw new Error("Microsoft To Do job could not be queued");
  if (current.status === "QUEUED" || current.status === "RUNNING") {
    const merged = mergeOutboundPayload(asPayload(current.payload), payload, { markDirty: current.status === "RUNNING" });
    await prisma.microsoftSyncJob.update({
      where: { id: current.id },
      data: { payload: merged },
    });
    return current.status === "RUNNING" ? "marked_dirty" : "exists";
  }
  if (current.status === "NEEDS_REVIEW") {
    const merged = mergeOutboundPayload(asPayload(current.payload), payload, { markDirty: true });
    await prisma.microsoftSyncJob.update({
      where: { id: current.id },
      data: { payload: merged },
    });
    return "exists";
  }
  await prisma.microsoftSyncJob.update({
    where: { id: current.id },
    data: {
      status: "QUEUED",
      runAfter: new Date(),
      attempt: 0,
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      payload: mergeOutboundPayload(asPayload(current.payload), payload),
    },
  });
  return "requeued";
}

/**
 * Ordinary retry for FAILED jobs and non-uncertain NEEDS_REVIEW rows.
 * Never sets authorizeCreateOnce and never retries createUncertain jobs.
 */
export async function retryOutboundJobs(userId: string): Promise<number> {
  const rows = await prisma.microsoftSyncJob.findMany({
    where: { userId, kind: "TODO_OUTBOUND", status: { in: ["FAILED", "NEEDS_REVIEW"] } },
  });
  let retried = 0;
  for (const row of rows) {
    const payload = asPayload(row.payload);
    if (!ordinaryRetryIncludesJob({ status: row.status, createUncertain: payload.createUncertain })) continue;
    const nextPayload: OutboundJobPayload = {
      ...payload,
      ...(row.status === "FAILED" ? { reviewed: true } : {}),
    };
    delete nextPayload.authorizeCreateOnce;
    delete nextPayload.createApproval;
    delete nextPayload.recheckOnly;
    await prisma.microsoftSyncJob.update({
      where: { id: row.id },
      data: {
        status: "QUEUED",
        runAfter: new Date(),
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
        payload: nextPayload,
      },
    });
    retried += 1;
  }
  return retried;
}

export type UncertainOutboundJobView = {
  jobId: string;
  taskId: string;
  taskTitle: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  lastError: string | null;
  knownMicrosoftTaskId: string | null;
  connectionId: string;
  updatedAt: string;
};

export async function listUncertainOutboundJobs(userId: string): Promise<UncertainOutboundJobView[]> {
  const rows = await prisma.microsoftSyncJob.findMany({
    where: { userId, kind: "TODO_OUTBOUND", status: "NEEDS_REVIEW" },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const uncertain = rows.filter((row) => asPayload(row.payload).createUncertain);
  const taskIds = uncertain.map((row) => asPayload(row.payload).taskId).filter(Boolean);
  const tasks = taskIds.length
    ? await prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: {
          id: true,
          title: true,
          assignee: { select: { name: true, email: true } },
        },
      })
    : [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return uncertain.map((row) => {
    const payload = asPayload(row.payload);
    const task = byId.get(payload.taskId);
    return {
      jobId: row.id,
      taskId: payload.taskId,
      taskTitle: task?.title ?? null,
      assigneeName: task?.assignee?.name ?? null,
      assigneeEmail: task?.assignee?.email ?? null,
      lastError: row.lastError,
      knownMicrosoftTaskId: payload.knownMicrosoftTaskId ?? null,
      connectionId: row.connectionId,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function prepareUncertainRecheckJob(userId: string, jobId: string): Promise<OutboundJob> {
  const row = await prisma.microsoftSyncJob.findFirst({
    where: { id: jobId, userId, kind: "TODO_OUTBOUND", status: "NEEDS_REVIEW" },
  });
  if (!row) throw new Error("Uncertain Microsoft To Do job was not found");
  const payload = asPayload(row.payload);
  if (!payload.createUncertain) throw new Error("That job is not waiting for uncertain create review");
  const nextPayload: OutboundJobPayload = {
    ...payload,
    recheckOnly: true,
    authorizeCreateOnce: false,
  };
  delete nextPayload.createApproval;
  const updated = await prisma.microsoftSyncJob.update({
    where: { id: row.id },
    data: {
      status: "RUNNING",
      attempt: Math.max(row.attempt, 1),
      leaseOwner: `recheck-${userId}`,
      leaseUntil: new Date(Date.now() + 120_000),
      lastError: null,
      payload: nextPayload,
    },
  });
  return mapJob(updated);
}

export async function approveUncertainOutboundCreate(input: {
  userId: string;
  jobId: string;
  acknowledgedDuplicateRisk: true;
}): Promise<OutboundJob> {
  const row = await prisma.microsoftSyncJob.findFirst({
    where: { id: input.jobId, userId: input.userId, kind: "TODO_OUTBOUND", status: "NEEDS_REVIEW" },
  });
  if (!row) throw new Error("Uncertain Microsoft To Do job was not found");
  const payload = asPayload(row.payload);
  if (!payload.createUncertain) throw new Error("That job is not waiting for uncertain create review");
  const connection = await prisma.microsoftAccountConnection.findUnique({ where: { id: row.connectionId } });
  if (!connection || connection.userId !== input.userId || connection.status !== "CONNECTED") {
    throw new Error("The Microsoft connection for this job is no longer available");
  }
  const task = await prisma.task.findUnique({ where: { id: payload.taskId } });
  if (!task) throw new Error("The CRM task for this job no longer exists");
  if (task.assigneeId !== input.userId) {
    throw new Error("The CRM task is no longer assigned to this Microsoft account");
  }
  const taskRevision = task.updatedAt.toISOString();
  const approval = {
    approvedByUserId: input.userId,
    approvedAt: new Date().toISOString(),
    jobId: row.id,
    taskId: payload.taskId,
    connectionId: row.connectionId,
    taskRevision,
    acknowledgedDuplicateRisk: true as const,
  };
  const nextPayload: OutboundJobPayload = {
    ...payload,
    authorizeCreateOnce: true,
    recheckOnly: false,
    createApproval: approval,
    taskRevision,
    revisionDirty: false,
  };
  const updated = await prisma.microsoftSyncJob.update({
    where: { id: row.id },
    data: {
      status: "QUEUED",
      runAfter: new Date(),
      attempt: 0,
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      payload: nextPayload,
    },
  });
  return mapJob(updated);
}

export async function outboundCounts(userId: string): Promise<{ pending: number; failed: number; needsReview: number }> {
  const [pending, failed, needsReview] = await Promise.all([
    prisma.microsoftSyncJob.count({ where: { userId, kind: "TODO_OUTBOUND", status: { in: ["QUEUED", "RUNNING"] } } }),
    prisma.microsoftSyncJob.count({ where: { userId, kind: "TODO_OUTBOUND", status: "FAILED" } }),
    prisma.microsoftSyncJob.count({ where: { userId, kind: "TODO_OUTBOUND", status: "NEEDS_REVIEW" } }),
  ]);
  return { pending, failed, needsReview };
}

export async function prepareReleaseJob(connection: OutboundConnection, taskId: string): Promise<OutboundJob> {
  await enqueueOutboundJob({ connection, taskId, release: true, explicit: false });
  const dedupeKey = outboundDedupeKey(connection.userId, taskId, true);
  const row = await prisma.microsoftSyncJob.findUniqueOrThrow({ where: { dedupeKey } });
  const payload = { ...asPayload(row.payload), taskId, release: true as const };
  const updated = await prisma.microsoftSyncJob.update({
    where: { id: row.id },
    data: { status: "RUNNING", payload, attempt: Math.max(row.attempt, 1), leaseOwner: "user-delete", leaseUntil: new Date(Date.now() + 60_000) },
  });
  return mapJob(updated);
}

export async function cancelQueuedOutboundJobs(userId: string): Promise<void> {
  await prisma.microsoftSyncJob.updateMany({
    where: { userId, kind: "TODO_OUTBOUND", status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELLED", leaseOwner: null, leaseUntil: null, lastError: "Microsoft 365 account disconnected" },
  });
}
