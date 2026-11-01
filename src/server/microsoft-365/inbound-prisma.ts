/**
 * Prisma adapter for inbound To Do delta jobs and cursors.
 */
import { Prisma } from "@prisma/client";

import {
  inboundCursorResource,
  type InboundSyncedSnapshot,
  MICROSOFT_TODO_INBOUND_JOB_KIND,
} from "@/domain/microsoft-todo-inbound";
import { prisma } from "@/infra/database/client";
import { decryptMicrosoftToken, encryptMicrosoftToken } from "@/server/microsoft-365/token-cipher";
import {
  inboundDedupeKey,
  type InboundConnection,
  type InboundCrmTask,
  type InboundJob,
  type InboundJobPayload,
  type InboundMapping,
  type InboundStore,
} from "@/server/microsoft-365/inbound-sync";

function asPayload(value: Prisma.JsonValue | null): InboundJobPayload {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const stagedRaw = Array.isArray(row["staged"]) ? row["staged"] : [];
  const staged = stagedRaw.filter((item) => item && typeof item === "object") as NonNullable<InboundJobPayload["staged"]>;
  const payload: InboundJobPayload = {};
  if (typeof row["listId"] === "string") payload.listId = row["listId"];
  if (typeof row["nextLink"] === "string" || row["nextLink"] === null) payload.nextLink = row["nextLink"] as string | null;
  if (typeof row["pendingDeltaLink"] === "string" || row["pendingDeltaLink"] === null) {
    payload.pendingDeltaLink = row["pendingDeltaLink"] as string | null;
  }
  if (row["baseline"] === true) payload.baseline = true;
  if (row["forceCheck"] === true) payload.forceCheck = true;
  if (staged.length) payload.staged = staged;
  return payload;
}

function asSnapshot(value: Prisma.JsonValue | null): InboundSyncedSnapshot | null {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!row) return null;
  if (typeof row["title"] !== "string") return null;
  if (
    row["status"] !== "OPEN" &&
    row["status"] !== "IN_PROGRESS" &&
    row["status"] !== "DONE" &&
    row["status"] !== "CANCELLED"
  ) {
    return null;
  }
  if (row["priority"] !== "LOW" && row["priority"] !== "NORMAL" && row["priority"] !== "HIGH") return null;
  return {
    title: row["title"],
    description: typeof row["description"] === "string" ? row["description"] : null,
    status: row["status"],
    priority: row["priority"],
    dueAt: typeof row["dueAt"] === "string" ? row["dueAt"] : null,
    completedAt: typeof row["completedAt"] === "string" ? row["completedAt"] : null,
  };
}

function mapConnection(row: {
  id: string;
  userId: string;
  status: InboundConnection["status"];
  tenantId: string;
  microsoftUserId: string;
  scopes: string;
  taskSyncEnabled: boolean;
  todoListId: string | null;
  taskInboundEnabledAt: Date | null;
  inboundBaselineAt: Date | null;
  lastInboundSyncAt: Date | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  lastError: string | null;
}): InboundConnection {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    tenantId: row.tenantId,
    microsoftUserId: row.microsoftUserId,
    scopes: row.scopes,
    taskSyncEnabled: row.taskSyncEnabled,
    todoListId: row.todoListId,
    taskInboundEnabledAt: row.taskInboundEnabledAt,
    inboundBaselineAt: row.inboundBaselineAt,
    lastInboundSyncAt: row.lastInboundSyncAt,
    accessTokenEncrypted: row.accessTokenEncrypted,
    refreshTokenEncrypted: row.refreshTokenEncrypted,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    lastError: row.lastError,
  };
}

function mapJob(row: {
  id: string;
  connectionId: string;
  userId: string;
  status: InboundJob["status"];
  attempt: number;
  runAfter: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  lastError: string | null;
  dedupeKey: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): InboundJob {
  return {
    id: row.id,
    connectionId: row.connectionId,
    userId: row.userId,
    kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
    status: row.status,
    attempt: row.attempt,
    runAfter: row.runAfter,
    leaseOwner: row.leaseOwner,
    leaseUntil: row.leaseUntil,
    lastError: row.lastError,
    dedupeKey: row.dedupeKey ?? inboundDedupeKey(row.connectionId),
    payload: asPayload(row.payload),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMapping(row: {
  id: string;
  taskId: string | null;
  userId: string;
  connectionId: string;
  tenantId: string;
  microsoftUserId: string;
  listId: string;
  microsoftTaskId: string;
  remoteEtag: string | null;
  lastCrmRevision: string | null;
  syncedSnapshot: Prisma.JsonValue | null;
  priorCrmStatus: string | null;
  syncStatus: InboundMapping["syncStatus"];
  lastError: string | null;
  lastSyncedAt: Date | null;
  deletedAt: Date | null;
}): InboundMapping {
  return {
    id: row.id,
    taskId: row.taskId,
    userId: row.userId,
    connectionId: row.connectionId,
    tenantId: row.tenantId,
    microsoftUserId: row.microsoftUserId,
    listId: row.listId,
    microsoftTaskId: row.microsoftTaskId,
    remoteEtag: row.remoteEtag,
    lastCrmRevision: row.lastCrmRevision,
    syncedSnapshot: asSnapshot(row.syncedSnapshot),
    priorCrmStatus: row.priorCrmStatus,
    syncStatus: row.syncStatus,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt,
    deletedAt: row.deletedAt,
  };
}

function mapTask(row: {
  id: string;
  assigneeId: string | null;
  title: string;
  description: string | null;
  status: InboundCrmTask["status"];
  priority: InboundCrmTask["priority"];
  dueAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  companyId: string | null;
  createdById: string | null;
}): InboundCrmTask {
  return row;
}

export function createPrismaInboundStore(): InboundStore {
  return {
    async findConnection(userId) {
      const row = await prisma.microsoftAccountConnection.findUnique({ where: { userId } });
      return row ? mapConnection(row) : null;
    },
    async saveConnection(row) {
      await prisma.microsoftAccountConnection.update({
        where: { id: row.id },
        data: {
          todoListId: row.todoListId,
          taskInboundEnabledAt: row.taskInboundEnabledAt,
          inboundBaselineAt: row.inboundBaselineAt,
          lastInboundSyncAt: row.lastInboundSyncAt,
          lastError: row.lastError,
          accessTokenEncrypted: row.accessTokenEncrypted,
          refreshTokenEncrypted: row.refreshTokenEncrypted,
          accessTokenExpiresAt: row.accessTokenExpiresAt,
        },
      });
    },
    async claimInboundJobs(limit, owner, now) {
      const due = await prisma.microsoftSyncJob.findMany({
        where: {
          kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
          status: { in: ["QUEUED", "RUNNING"] },
          runAfter: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }, { status: "QUEUED" }],
        },
        orderBy: { runAfter: "asc" },
        take: limit * 3,
      });
      const claimed: InboundJob[] = [];
      for (const row of due) {
        if (claimed.length >= limit) break;
        const result = await prisma.microsoftSyncJob.updateMany({
          where: {
            id: row.id,
            kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
            status: { in: ["QUEUED", "RUNNING"] },
            runAfter: { lte: now },
            OR: [{ leaseOwner: null }, { leaseUntil: null }, { leaseUntil: { lt: now } }, { status: "QUEUED" }],
          },
          data: {
            status: "RUNNING",
            leaseOwner: owner,
            leaseUntil: new Date(now.getTime() + 120_000),
            attempt: { increment: row.status === "QUEUED" ? 1 : 0 },
          },
        });
        if (result.count !== 1) continue;
        const fresh = await prisma.microsoftSyncJob.findUniqueOrThrow({ where: { id: row.id } });
        claimed.push(mapJob(fresh));
      }
      return claimed;
    },
    async saveJob(job, opts) {
      if (opts?.requireLeaseOwner) {
        const result = await prisma.microsoftSyncJob.updateMany({
          where: { id: job.id, leaseOwner: opts.requireLeaseOwner, status: "RUNNING" },
          data: {
            status: job.status,
            attempt: job.attempt,
            runAfter: job.runAfter,
            leaseOwner: job.leaseOwner,
            leaseUntil: job.leaseUntil,
            lastError: job.lastError,
            payload: job.payload as Prisma.InputJsonValue,
          },
        });
        return result.count === 1;
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
          payload: job.payload as Prisma.InputJsonValue,
        },
      });
      return true;
    },
    async findMappingByMicrosoftTaskId(connectionId, microsoftTaskId) {
      const row = await prisma.microsoftTaskMapping.findFirst({
        where: { connectionId, microsoftTaskId },
      });
      return row ? mapMapping(row) : null;
    },
    async findMappingsForList(connectionId, listId) {
      const rows = await prisma.microsoftTaskMapping.findMany({ where: { connectionId, listId } });
      return rows.map(mapMapping);
    },
    async saveMapping(row) {
      await prisma.microsoftTaskMapping.update({
        where: { id: row.id },
        data: {
          remoteEtag: row.remoteEtag,
          lastCrmRevision: row.lastCrmRevision,
          syncedSnapshot: row.syncedSnapshot === null ? Prisma.JsonNull : (row.syncedSnapshot as Prisma.InputJsonValue),
          priorCrmStatus: row.priorCrmStatus,
          syncStatus: row.syncStatus,
          lastError: row.lastError,
          lastSyncedAt: row.lastSyncedAt,
          deletedAt: row.deletedAt,
        },
      });
    },
    async findTask(taskId) {
      const row = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          assigneeId: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          dueAt: true,
          completedAt: true,
          updatedAt: true,
          companyId: true,
          createdById: true,
        },
      });
      return row ? mapTask(row) : null;
    },
    async updateTaskFields(taskId, data) {
      try {
        const updated = await prisma.task.updateMany({
          where: { id: taskId, updatedAt: data.expectedUpdatedAt },
          data: {
            ...(data.title !== undefined ? { title: data.title } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.priority !== undefined ? { priority: data.priority } : {}),
            ...(data.dueAt !== undefined ? { dueAt: data.dueAt } : {}),
            ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
          },
        });
        if (updated.count !== 1) {
          const exists = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
          return { ok: false as const, reason: exists ? ("revision" as const) : ("missing" as const) };
        }
        const task = await prisma.task.findUniqueOrThrow({
          where: { id: taskId },
          select: {
            id: true,
            assigneeId: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            dueAt: true,
            completedAt: true,
            updatedAt: true,
            companyId: true,
            createdById: true,
          },
        });
        return { ok: true as const, task: mapTask(task) };
      } catch {
        return { ok: false as const, reason: "missing" as const };
      }
    },
    async getCursor(connectionId, resource) {
      const row = await prisma.microsoftSyncCursor.findUnique({
        where: { connectionId_resource: { connectionId, resource } },
      });
      if (!row?.deltaLinkEncrypted) return null;
      return decryptMicrosoftToken(row.deltaLinkEncrypted);
    },
    async saveCursor(connectionId, resource, deltaLink) {
      const encrypted = deltaLink ? encryptMicrosoftToken(deltaLink) : null;
      await prisma.microsoftSyncCursor.upsert({
        where: { connectionId_resource: { connectionId, resource } },
        create: { connectionId, resource, deltaLinkEncrypted: encrypted },
        update: { deltaLinkEncrypted: encrypted },
      });
    },
    async clearCursor(connectionId, resource) {
      await prisma.microsoftSyncCursor.deleteMany({ where: { connectionId, resource } });
    },
    async appendEvent(input) {
      await prisma.microsoftSyncEvent.create({
        data: {
          userId: input.userId,
          connectionId: input.connectionId,
          kind: input.kind,
          message: input.message,
          ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
          createdAt: input.createdAt,
        },
      });
    },
    async hasRunningOutboundForTask(userId, taskId) {
      const rows = await prisma.microsoftSyncJob.findMany({
        where: { userId, kind: "TODO_OUTBOUND", status: "RUNNING" },
        select: { payload: true },
        take: 20,
      });
      return rows.some((row) => {
        const payload =
          row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
            ? (row.payload as Record<string, unknown>)
            : {};
        return payload["taskId"] === taskId;
      });
    },
    async withTaskLock(taskId, fn) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`todo-sync:${taskId}`}))`;
        return fn();
      });
    },
  };
}

export async function ensureInboundJobForConnection(connection: InboundConnection, options?: { forceCheck?: boolean; baseline?: boolean }) {
  if (!connection.todoListId) return null;
  const dedupeKey = inboundDedupeKey(connection.id);
  const existing = await prisma.microsoftSyncJob.findUnique({ where: { dedupeKey } });
  const payload: InboundJobPayload = {
    listId: connection.todoListId,
    ...(options?.forceCheck ? { forceCheck: true } : {}),
    ...(options?.baseline || !connection.inboundBaselineAt ? { baseline: true } : {}),
  };
  if (!existing) {
    return prisma.microsoftSyncJob.create({
      data: {
        connectionId: connection.id,
        userId: connection.userId,
        kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
        status: "QUEUED",
        runAfter: new Date(),
        dedupeKey,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }
  if (existing.status === "RUNNING") {
    return existing;
  }
  return prisma.microsoftSyncJob.update({
    where: { id: existing.id },
    data: {
      status: "QUEUED",
      runAfter: new Date(),
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      payload: payload as Prisma.InputJsonValue,
      ...(existing.status === "FAILED" || existing.status === "CANCELLED" || existing.status === "SUCCEEDED"
        ? { attempt: 0 }
        : {}),
    },
  });
}

export async function enqueueInboundForEligibleConnections(): Promise<number> {
  const rows = await prisma.microsoftAccountConnection.findMany({
    where: {
      status: "CONNECTED",
      taskSyncEnabled: true,
      todoListId: { not: null },
    },
    take: 50,
  });
  let queued = 0;
  for (const row of rows) {
    await ensureInboundJobForConnection(mapConnection(row));
    queued += 1;
  }
  return queued;
}

export async function inboundCounts(userId: string): Promise<{
  pending: number;
  failed: number;
  conflicts: number;
  removed: number;
  lastInboundSyncAt: string | null;
  inboundBaselineAt: string | null;
}> {
  const connection = await prisma.microsoftAccountConnection.findUnique({ where: { userId } });
  const [pending, failed, conflicts, removed] = await Promise.all([
    prisma.microsoftSyncJob.count({
      where: { userId, kind: MICROSOFT_TODO_INBOUND_JOB_KIND, status: { in: ["QUEUED", "RUNNING"] } },
    }),
    prisma.microsoftSyncJob.count({
      where: { userId, kind: MICROSOFT_TODO_INBOUND_JOB_KIND, status: "FAILED" },
    }),
    prisma.microsoftTaskMapping.count({
      where: { userId, syncStatus: "CONFLICT", deletedAt: null },
    }),
    prisma.microsoftTaskMapping.count({
      where: { userId, syncStatus: "REMOVED" },
    }),
  ]);
  return {
    pending,
    failed,
    conflicts,
    removed,
    lastInboundSyncAt: connection?.lastInboundSyncAt?.toISOString() ?? null,
    inboundBaselineAt: connection?.inboundBaselineAt?.toISOString() ?? null,
  };
}

export async function listInboundConflicts(userId: string) {
  const rows = await prisma.microsoftTaskMapping.findMany({
    where: { userId, syncStatus: { in: ["CONFLICT", "REMOVED"] } },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { task: { select: { id: true, title: true, status: true, assigneeId: true } } },
  });
  return rows.map((row) => ({
    mappingId: row.id,
    taskId: row.taskId,
    taskTitle: row.task?.title ?? null,
    taskStatus: row.task?.status ?? null,
    microsoftTaskId: row.microsoftTaskId,
    syncStatus: row.syncStatus,
    lastError: row.lastError,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function prepareRecreateRemovedMicrosoftMapping(input: {
  userId: string;
  mappingId: string;
}): Promise<{ taskId: string } | { error: string }> {
  const mapping = await prisma.microsoftTaskMapping.findFirst({
    where: { id: input.mappingId, userId: input.userId, syncStatus: "REMOVED" },
  });
  if (!mapping?.taskId) return { error: "Removed Microsoft mapping was not found" };
  await prisma.microsoftTaskMapping.delete({ where: { id: mapping.id } });
  return { taskId: mapping.taskId };
}

export async function unlinkRemovedMicrosoftMapping(input: { userId: string; mappingId: string }) {
  const mapping = await prisma.microsoftTaskMapping.findFirst({
    where: { id: input.mappingId, userId: input.userId, syncStatus: { in: ["REMOVED", "CONFLICT"] } },
  });
  if (!mapping) throw new Error("Microsoft mapping was not found");
  await prisma.microsoftTaskMapping.update({
    where: { id: mapping.id },
    data: {
      syncStatus: "TOMBSTONED",
      deletedAt: new Date(),
      lastError: "Unlinked from Microsoft To Do by an authorised user",
    },
  });
}

export { inboundCursorResource };
