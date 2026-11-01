/**
 * Prisma adapter for outbound To Do jobs. Claim uses updateMany so two workers cannot take the same row.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/infra/database/client";
import type { OutboundTaskSnapshot } from "@/domain/microsoft-todo-outbound";
import {
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
  return {
    taskId,
    ...(row["explicit"] === true ? { explicit: true } : {}),
    ...(row["release"] === true ? { release: true } : {}),
    ...(row["reviewed"] === true ? { reviewed: true } : {}),
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
    async saveJob(job) {
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
}): Promise<"created" | "exists" | "requeued"> {
  const dedupeKey = outboundDedupeKey(input.connection.userId, input.taskId, input.release);
  const payload: OutboundJobPayload = {
    taskId: input.taskId,
    ...(input.release ? { release: true } : {}),
    ...(input.explicit ? { explicit: true } : {}),
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
  if (current.status === "QUEUED" || current.status === "RUNNING" || current.status === "NEEDS_REVIEW") return "exists";
  await prisma.microsoftSyncJob.update({
    where: { id: current.id },
    data: { status: "QUEUED", runAfter: new Date(), attempt: 0, leaseOwner: null, leaseUntil: null, lastError: null, payload },
  });
  return "requeued";
}

export async function retryOutboundJobs(userId: string): Promise<number> {
  const rows = await prisma.microsoftSyncJob.findMany({
    where: { userId, kind: "TODO_OUTBOUND", status: { in: ["FAILED", "NEEDS_REVIEW"] } },
  });
  for (const row of rows) {
    const payload = asPayload(row.payload);
    await prisma.microsoftSyncJob.update({
      where: { id: row.id },
      data: {
        status: "QUEUED",
        runAfter: new Date(),
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
        payload: { ...payload, reviewed: true },
      },
    });
  }
  return rows.length;
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
