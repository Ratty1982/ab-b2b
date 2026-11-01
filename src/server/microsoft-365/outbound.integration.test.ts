/**
 * Durable job rows against a dedicated local database.
 * Requires TEST_DATABASE_URL. Refuses the application database.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/infra/database/client";
import {
  createPrismaOutboundStore,
  enqueueOutboundJob,
} from "@/server/microsoft-365/outbound-prisma";
import type { OutboundConnection } from "@/server/microsoft-365/outbound-sync";

const suffix = `todo-${Date.now().toString(36)}`;
let userId = "";
let connectionId = "";
let taskId = "";

function asConnection(row: {
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

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `${suffix}@example.invalid`,
      name: "Outbound test",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  userId = user.id;
  const connection = await prisma.microsoftAccountConnection.create({
    data: {
      userId,
      status: "CONNECTED",
      tenantId: "11111111-1111-4111-8111-111111111111",
      microsoftUserId: suffix,
      activeIdentityKey: `11111111-1111-4111-8111-111111111111:${suffix}`,
      scopes: "openid profile offline_access User.Read Tasks.ReadWrite",
      taskSyncEnabled: true,
      taskOutboundEnabledAt: new Date("2026-10-01T00:00:00.000Z"),
      accessTokenEncrypted: "v2:test-access",
      refreshTokenEncrypted: "v2:test-refresh",
    },
  });
  connectionId = connection.id;
  const task = await prisma.task.create({
    data: { title: "Integration follow-up", assigneeId: userId, createdById: userId },
  });
  taskId = task.id;
});

afterAll(async () => {
  if (userId) {
    await prisma.task.deleteMany({ where: { assigneeId: userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe("outbound job durability", () => {
  it("stores one job for duplicate delivery and lets one worker claim it", async () => {
    const row = await prisma.microsoftAccountConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const connection = asConnection(row);
    const first = await enqueueOutboundJob({ connection, taskId, release: false, explicit: false });
    const second = await enqueueOutboundJob({ connection, taskId, release: false, explicit: true });
    expect(first).toBe("created");
    expect(second).toBe("exists");
    const jobs = await prisma.microsoftSyncJob.findMany({ where: { userId, dedupeKey: `todo:${userId}:${taskId}:upsert` } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toEqual({ taskId, explicit: true });

    const store = createPrismaOutboundStore();
    const now = new Date();
    const [left, right] = await Promise.all([
      store.claimJobs(now, "worker-a", 5, 120_000),
      store.claimJobs(now, "worker-b", 5, 120_000),
    ]);
    const claimed = [...left, ...right].filter((job) => job.userId === userId && job.payload.taskId === taskId);
    expect(claimed).toHaveLength(1);
    const winner = claimed[0];
    if (!winner) throw new Error("job was not claimed");
    expect(winner.status).toBe("RUNNING");
    expect(winner.attempt).toBe(1);
    const stored = await prisma.microsoftSyncJob.findUniqueOrThrow({ where: { id: winner.id } });
    expect(stored.leaseOwner === "worker-a" || stored.leaseOwner === "worker-b").toBe(true);

    const dirty = await enqueueOutboundJob({
      connection,
      taskId,
      release: false,
      explicit: false,
      taskRevision: "2026-11-01T12:30:00.000Z",
    });
    expect(dirty).toBe("marked_dirty");
    const afterDirty = await prisma.microsoftSyncJob.findUniqueOrThrow({ where: { id: winner.id } });
    expect(afterDirty.payload).toMatchObject({
      taskId,
      explicit: true,
      revisionDirty: true,
      taskRevision: "2026-11-01T12:30:00.000Z",
    });
    expect(afterDirty.status).toBe("RUNNING");

    const stolen = await store.saveJob(
      {
        ...winner,
        status: "SUCCEEDED",
        leaseOwner: null,
        leaseUntil: null,
        payload: { taskId, createUncertain: false },
      },
      { requireLeaseOwner: "stale-worker" },
    );
    expect(stolen).toBe(false);
    const stillRunning = await prisma.microsoftSyncJob.findUniqueOrThrow({ where: { id: winner.id } });
    expect(stillRunning.status).toBe("RUNNING");
    expect(stillRunning.payload).toMatchObject({ revisionDirty: true });
  });

  it("does not turn a revoked account back on when a job saves the list id", async () => {
    const store = createPrismaOutboundStore();
    const before = await store.findConnection(userId);
    if (!before) throw new Error("connection missing");
    expect(before.status).toBe("CONNECTED");
    await store.saveConnection({ ...before, todoListId: "list-kept" });
    await prisma.microsoftAccountConnection.update({
      where: { id: connectionId },
      data: { status: "REVOKED", activeIdentityKey: null, accessTokenEncrypted: null, refreshTokenEncrypted: null },
    });
    const revoked = await store.findConnection(userId);
    if (!revoked) throw new Error("connection missing");
    await store.saveConnection({ ...revoked, status: "CONNECTED", todoListId: "list-should-not-stick", lastError: null });
    const after = await prisma.microsoftAccountConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(after.status).toBe("REVOKED");
    expect(after.todoListId).toBe("list-kept");
    expect(after.accessTokenEncrypted).toBeNull();
  });

  it("holds the list lock until the first critical section finishes", async () => {
    const store = createPrismaOutboundStore();
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const first = store.withConnectionLock(connectionId, async () => {
      order.push("first-start");
      markStarted();
      await hold;
      order.push("first-end");
    });
    await started;
    const second = store.withConnectionLock(connectionId, async () => {
      order.push("second");
    });
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
    const needsReview = await prisma.microsoftSyncJob.create({
      data: {
        connectionId,
        userId,
        kind: "TODO_OUTBOUND",
        status: "NEEDS_REVIEW",
        dedupeKey: `todo:${userId}:${taskId}:release`,
        payload: { taskId, release: true },
      },
    });
    expect(needsReview.status).toBe("NEEDS_REVIEW");
  });
});
