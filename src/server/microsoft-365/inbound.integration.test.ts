/**
 * Durable inbound cursor/job rows against a dedicated local database.
 * Requires TEST_DATABASE_URL. Refuses the application database.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  inboundCursorResource,
  MICROSOFT_TODO_INBOUND_JOB_KIND,
} from "@/domain/microsoft-todo-inbound";
import { prisma } from "@/infra/database/client";
import {
  createPrismaInboundStore,
  ensureInboundJobForConnection,
} from "@/server/microsoft-365/inbound-prisma";
import { inboundDedupeKey, type InboundConnection } from "@/server/microsoft-365/inbound-sync";

const suffix = `todo-in-${Date.now().toString(36)}`;
let userId = "";
let connectionId = "";
const listId = "list-inbound-int";
const previousEncryptionKey = process.env["MICROSOFT_365_ENCRYPTION_KEY"];

beforeAll(async () => {
  process.env["MICROSOFT_365_ENCRYPTION_KEY"] = "inbound-integration-test-encryption-key-32chars-min";
  const user = await prisma.user.create({
    data: {
      email: `${suffix}@example.invalid`,
      name: "Inbound test",
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
      todoListId: listId,
      taskInboundEnabledAt: new Date("2026-10-01T00:00:00.000Z"),
      accessTokenEncrypted: "v2:test-access",
      refreshTokenEncrypted: "v2:test-refresh",
    },
  });
  connectionId = connection.id;
});

afterAll(async () => {
  if (userId) {
    await prisma.microsoftSyncJob.deleteMany({ where: { userId } });
    await prisma.microsoftSyncCursor.deleteMany({ where: { connectionId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  if (previousEncryptionKey === undefined) delete process.env["MICROSOFT_365_ENCRYPTION_KEY"];
  else process.env["MICROSOFT_365_ENCRYPTION_KEY"] = previousEncryptionKey;
  await prisma.$disconnect();
});

describe("inbound job and cursor durability", () => {
  it("dedupes inbound jobs per connection and lets only one worker claim", async () => {
    const store = createPrismaInboundStore();
    const connection = (await store.findConnection(userId)) as InboundConnection;
    await ensureInboundJobForConnection(connection, { forceCheck: true });
    await ensureInboundJobForConnection(connection, { forceCheck: true });
    const rows = await prisma.microsoftSyncJob.findMany({
      where: { connectionId, kind: MICROSOFT_TODO_INBOUND_JOB_KIND },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupeKey).toBe(inboundDedupeKey(connectionId));

    const first = await store.claimInboundJobs(5, "worker-a", new Date());
    const second = await store.claimInboundJobs(5, "worker-b", new Date());
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("commits cursor and job success in one transaction under the lease", async () => {
    const store = createPrismaInboundStore();
    const connection = (await store.findConnection(userId)) as InboundConnection;
    const resource = inboundCursorResource(listId);
    const job = await prisma.microsoftSyncJob.findUniqueOrThrow({
      where: { dedupeKey: inboundDedupeKey(connectionId) },
    });
    await prisma.microsoftSyncJob.update({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        leaseOwner: "worker-final",
        leaseUntil: new Date(Date.now() + 60_000),
        payload: { listId, staged: [{ id: "ms-1" }], appliedIds: ["ms-1"] },
      },
    });

    const ok = await store.finalizeInboundRound({
      job: {
        id: job.id,
        connectionId,
        userId,
        kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
        status: "SUCCEEDED",
        attempt: 1,
        runAfter: new Date(),
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
        dedupeKey: inboundDedupeKey(connectionId),
        payload: { listId, baseline: false },
        createdAt: job.createdAt,
        updatedAt: new Date(),
      },
      requireLeaseOwner: "worker-final",
      connection: {
        ...connection,
        lastInboundSyncAt: new Date("2026-11-02T09:00:00.000Z"),
        inboundBaselineAt: new Date("2026-11-02T09:00:00.000Z"),
        taskInboundEnabledAt: connection.taskInboundEnabledAt,
        lastError: null,
      },
      resource,
      deltaLink: `https://graph.microsoft.com/v1.0/me/todo/lists/${listId}/tasks/delta?$deltatoken=committed`,
      now: new Date(),
    });
    expect(ok).toBe(true);

    const saved = await store.getCursor(connectionId, resource);
    expect(saved).toContain("$deltatoken=committed");
    const done = await prisma.microsoftSyncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.leaseOwner).toBeNull();
    expect(done.payload).toMatchObject({ listId, baseline: false });

    const stolen = await store.finalizeInboundRound({
      job: {
        id: job.id,
        connectionId,
        userId,
        kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
        status: "SUCCEEDED",
        attempt: 2,
        runAfter: new Date(),
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
        dedupeKey: inboundDedupeKey(connectionId),
        payload: { listId, baseline: false },
        createdAt: job.createdAt,
        updatedAt: new Date(),
      },
      requireLeaseOwner: "worker-stale",
      connection,
      resource,
      deltaLink: `https://graph.microsoft.com/v1.0/me/todo/lists/${listId}/tasks/delta?$deltatoken=stale`,
      now: new Date(),
    });
    expect(stolen).toBe(false);
    const cursorAgain = await store.getCursor(connectionId, resource);
    expect(cursorAgain).toContain("$deltatoken=committed");
  });
});
