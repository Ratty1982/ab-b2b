import { describe, expect, it } from "vitest";

import { notifyCrmTaskOutbound, type OutboundNotice } from "@/server/microsoft-365/outbound-queue";
import type { OutboundConnection } from "@/server/microsoft-365/outbound-sync";

const notice: OutboundNotice = {
  taskId: "task-1",
  assigneeId: "user-a",
  createdAt: new Date("2026-10-15T00:00:00.000Z"),
  reason: "created",
};

function connection(): OutboundConnection {
  return {
    id: "conn-1",
    userId: "user-a",
    status: "CONNECTED",
    tenantId: "11111111-1111-4111-8111-111111111111",
    microsoftUserId: "oid",
    scopes: "Tasks.ReadWrite User.Read",
    taskSyncEnabled: true,
    taskOutboundEnabledAt: new Date("2026-10-01T00:00:00.000Z"),
    todoListId: null,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    accessTokenExpiresAt: null,
    lastTaskSyncAt: null,
    lastError: null,
  };
}

describe("outbound queue gate", () => {
  it("does not read connections or enqueue when the outbound flag is off", async () => {
    const calls: string[] = [];
    await notifyCrmTaskOutbound(notice, {
      graphAllowed: () => false,
      findConnection: async () => {
        calls.push("connection");
        return connection();
      },
      hasActiveMapping: async () => {
        calls.push("mapping");
        return false;
      },
      enqueue: async () => {
        calls.push("enqueue");
      },
      record: async () => {
        calls.push("record");
      },
    });
    expect(calls).toEqual([]);
  });

  it("does not enqueue when task sync is off or Tasks.ReadWrite is missing", async () => {
    const queued: string[] = [];
    const base = {
      graphAllowed: () => true,
      hasActiveMapping: async () => false,
      enqueue: async () => {
        queued.push("enqueue");
      },
      record: async () => undefined,
    };
    await notifyCrmTaskOutbound(notice, {
      ...base,
      findConnection: async () => ({ ...connection(), taskSyncEnabled: false }),
    });
    await notifyCrmTaskOutbound(notice, {
      ...base,
      findConnection: async () => ({ ...connection(), scopes: "User.Read" }),
    });
    await notifyCrmTaskOutbound(notice, {
      ...base,
      findConnection: async () => null,
    });
    expect(queued).toEqual([]);
  });

  it("enqueues one upsert for an eligible assignee and a release for the previous assignee", async () => {
    const queued: Array<{ userId: string; release: boolean }> = [];
    await notifyCrmTaskOutbound(
      { ...notice, previousAssigneeId: "user-b", reason: "assigned" },
      {
        graphAllowed: () => true,
        findConnection: async (userId) => ({ ...connection(), id: `conn-${userId}`, userId }),
        hasActiveMapping: async (userId) => userId === "user-b",
        enqueue: async (input) => {
          queued.push({ userId: input.connection.userId, release: input.release });
        },
        record: async () => undefined,
      },
    );
    expect(queued).toEqual([
      { userId: "user-b", release: true },
      { userId: "user-a", release: false },
    ]);
  });
});
