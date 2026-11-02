import { describe, expect, it } from "vitest";

import { MICROSOFT_TODO_INBOUND_JOB_KIND } from "@/domain/microsoft-todo-inbound";
import {
  parseMicrosoftTodoDeltaItem,
  processInboundJob,
  runInboundBatch,
  type InboundConnection,
  type InboundCrmTask,
  type InboundGraph,
  type InboundJob,
  type InboundMapping,
  type InboundRuntime,
  type InboundStore,
} from "@/server/microsoft-365/inbound-sync";
import { isOutboundSuppressed, withOutboundSuppressed } from "@/server/microsoft-365/outbound-suppress";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const LIST_ID = "list-ab";

function connection(partial: Partial<InboundConnection> = {}): InboundConnection {
  return {
    id: "conn-a",
    userId: "user-a",
    status: "CONNECTED",
    tenantId: "11111111-1111-4111-8111-111111111111",
    microsoftUserId: "oid-a",
    scopes: "openid profile offline_access User.Read Tasks.ReadWrite",
    taskSyncEnabled: true,
    todoListId: LIST_ID,
    taskInboundEnabledAt: new Date("2026-10-01T00:00:00.000Z"),
    inboundBaselineAt: null,
    lastInboundSyncAt: null,
    accessTokenEncrypted: "v2:token",
    refreshTokenEncrypted: "v2:refresh",
    accessTokenExpiresAt: new Date("2026-11-01T13:00:00.000Z"),
    lastError: null,
    ...partial,
  };
}

function task(partial: Partial<InboundCrmTask> = {}): InboundCrmTask {
  return {
    id: "task-1",
    assigneeId: "user-a",
    title: "Call the buyer",
    description: "Bring samples",
    status: "OPEN",
    priority: "NORMAL",
    dueAt: new Date("2026-11-02T12:00:00.000Z"),
    completedAt: null,
    updatedAt: new Date("2026-10-15T00:00:00.000Z"),
    companyId: "co-1",
    createdById: "user-a",
    ...partial,
  };
}

function mapping(partial: Partial<InboundMapping> = {}): InboundMapping {
  return {
    id: "map-1",
    taskId: "task-1",
    userId: "user-a",
    connectionId: "conn-a",
    tenantId: "11111111-1111-4111-8111-111111111111",
    microsoftUserId: "oid-a",
    listId: LIST_ID,
    microsoftTaskId: "ms-1",
    remoteEtag: null,
    lastCrmRevision: null,
    syncedSnapshot: null,
    priorCrmStatus: null,
    syncStatus: "SYNCED",
    lastError: null,
    lastSyncedAt: null,
    deletedAt: null,
    ...partial,
  };
}

function job(partial: Partial<InboundJob> = {}): InboundJob {
  return {
    id: "job-in-1",
    connectionId: "conn-a",
    userId: "user-a",
    kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
    status: "RUNNING",
    attempt: 1,
    runAfter: NOW,
    leaseOwner: "worker-1",
    leaseUntil: new Date(NOW.getTime() + 60_000),
    lastError: null,
    dedupeKey: "todo-inbound:conn-a",
    payload: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function memory(options?: {
  connection?: InboundConnection | null;
  task?: InboundCrmTask | null;
  mapping?: InboundMapping | null;
  cursor?: string | null;
  outboundRunning?: boolean;
}) {
  const state = {
    connection: options && "connection" in options ? options.connection ?? null : connection(),
    task: options && "task" in options ? options.task ?? null : task(),
    mapping: options && "mapping" in options ? options.mapping ?? null : mapping(),
    jobs: [] as InboundJob[],
    cursor: options && "cursor" in options ? options.cursor ?? null : null,
    events: [] as string[],
    outboundRunning: options?.outboundRunning ?? false,
    updates: 0,
    failSaveJobAfter: null as null | number,
    saveJobCount: 0,
    failFinalize: false,
    rejectLeaseOnFinalize: false,
  };
  const store: InboundStore = {
    async findConnection() {
      return state.connection;
    },
    async saveConnection(row) {
      state.connection = row;
    },
    async claimInboundJobs() {
      return state.jobs.filter((item) => item.status === "QUEUED").slice(0, 5).map((item) => ({
        ...item,
        status: "RUNNING" as const,
        leaseOwner: "worker-1",
      }));
    },
    async saveJob(next, opts) {
      state.saveJobCount += 1;
      if (state.failSaveJobAfter != null && state.saveJobCount > state.failSaveJobAfter) {
        throw new Error("injected saveJob failure");
      }
      if (opts?.requireLeaseOwner) {
        const current = state.jobs.find((item) => item.id === next.id);
        if (!current || current.status !== "RUNNING" || current.leaseOwner !== opts.requireLeaseOwner) {
          return false;
        }
      }
      const idx = state.jobs.findIndex((item) => item.id === next.id);
      if (idx >= 0) state.jobs[idx] = next;
      else state.jobs.push(next);
      return true;
    },
    async findMappingByMicrosoftTaskId(_connectionId, microsoftTaskId) {
      return state.mapping?.microsoftTaskId === microsoftTaskId ? state.mapping : null;
    },
    async findMappingsForList() {
      return state.mapping ? [state.mapping] : [];
    },
    async saveMapping(row) {
      state.mapping = row;
    },
    async findTask(taskId) {
      return state.task?.id === taskId ? state.task : null;
    },
    async updateTaskFields(taskId, data) {
      if (!state.task || state.task.id !== taskId) return { ok: false as const, reason: "missing" as const };
      if (state.task.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        return { ok: false as const, reason: "revision" as const };
      }
      state.updates += 1;
      state.task = {
        ...state.task,
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.dueAt !== undefined ? { dueAt: data.dueAt } : {}),
        ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
        updatedAt: new Date(state.task.updatedAt.getTime() + 1000),
      };
      return { ok: true as const, task: state.task };
    },
    async getCursor() {
      return state.cursor;
    },
    async saveCursor(_connectionId, _resource, deltaLink) {
      state.cursor = deltaLink;
    },
    async clearCursor() {
      state.cursor = null;
    },
    async finalizeInboundRound(input) {
      if (state.failFinalize) throw new Error("injected finalize failure");
      if (state.rejectLeaseOnFinalize) return false;
      const current = state.jobs.find((item) => item.id === input.job.id);
      if (!current || current.status !== "RUNNING" || current.leaseOwner !== input.requireLeaseOwner) {
        return false;
      }
      state.cursor = input.deltaLink;
      state.connection = input.connection;
      const idx = state.jobs.findIndex((item) => item.id === input.job.id);
      if (idx >= 0) state.jobs[idx] = input.job;
      return true;
    },
    async appendEvent(input) {
      state.events.push(input.kind);
    },
    async hasRunningOutboundForTask() {
      return state.outboundRunning;
    },
    async withTaskLock(_taskId, fn) {
      return fn();
    },
  };
  return { state, store };
}

function graphOf(
  handler: (path: string) => { status: number; json: unknown; retryAfter?: string | null; networkError?: boolean },
): InboundGraph {
  return {
    async request({ path }) {
      const result = handler(path);
      return {
        status: result.status,
        json: result.json,
        retryAfter: result.retryAfter ?? null,
        ...(result.networkError ? { networkError: true } : {}),
      };
    },
  };
}

function runtime(store: InboundStore, graph: InboundGraph, allowed = true): InboundRuntime {
  return {
    now: () => NOW,
    graphAllowed: () => allowed,
    store,
    graph,
    async tokenFor() {
      return { ok: true, accessToken: "token" };
    },
  };
}

function deltaPage(items: unknown[], links?: { next?: string; delta?: string }) {
  return {
    status: 200,
    json: {
      value: items,
      ...(links?.next ? { "@odata.nextLink": links.next } : {}),
      ...(links?.delta ? { "@odata.deltaLink": links.delta } : {}),
    },
  };
}

describe("Microsoft To Do inbound sync", () => {
  it("does nothing while the inbound feature flag is off", async () => {
    const { state, store } = memory();
    state.jobs = [job({ status: "QUEUED" })];
    const result = await runInboundBatch(runtime(store, graphOf(() => ({ status: 500, json: null })), false));
    expect(result.processed).toBe(0);
    expect(state.updates).toBe(0);
  });

  it("baselines without modifying CRM task data", async () => {
    const { state, store } = memory();
    state.jobs = [job()];
    const graph = graphOf((path) => {
      expect(path).toContain(`/todo/lists/${encodeURIComponent(LIST_ID)}/tasks/delta`);
      return deltaPage(
        [
          {
            id: "ms-1",
            title: "Different Microsoft title",
            status: "completed",
            importance: "high",
            body: { content: "Remote notes\n\nCRM reference: ab-crm-task:task-1" },
            "@odata.etag": "etag-1",
          },
        ],
        { delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=base` },
      );
    });
    await processInboundJob(job(), runtime(store, graph));
    expect(state.updates).toBe(0);
    expect(state.task?.title).toBe("Call the buyer");
    expect(state.mapping?.syncStatus).toBe("CONFLICT");
    expect(state.cursor).toContain("$deltatoken=base");
    expect(state.connection?.inboundBaselineAt).not.toBeNull();
    expect(state.events).toContain("TODO_INBOUND_BASELINE_DIFF");
    expect(state.events).toContain("TODO_INBOUND_BASELINE");
  });

  it("applies completion, due date, priority, title and description after baseline", async () => {
    const { state, store } = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      mapping: mapping({
        lastCrmRevision: "2026-10-15T00:00:00.000Z",
        syncedSnapshot: {
          title: "Call the buyer",
          description: "Bring samples",
          status: "OPEN",
          priority: "NORMAL",
          dueAt: "2026-11-02T12:00:00.000Z",
          completedAt: null,
        },
      }),
      cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=prev`,
    });
    state.jobs = [job()];
    const graph = graphOf(() =>
      deltaPage(
        [
          {
            id: "ms-1",
            title: "Call the buyer today",
            status: "completed",
            importance: "high",
            body: { content: "Updated notes\n\nCRM reference: ab-crm-task:task-1" },
            dueDateTime: { dateTime: "2026-11-04T00:00:00", timeZone: "UTC" },
            completedDateTime: { dateTime: "2026-11-01T12:00:00", timeZone: "UTC" },
            "@odata.etag": "etag-2",
          },
        ],
        { delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=next` },
      ),
    );
    await processInboundJob(job(), runtime(store, graph));
    expect(state.updates).toBe(1);
    expect(state.task?.status).toBe("DONE");
    expect(state.task?.priority).toBe("HIGH");
    expect(state.task?.title).toBe("Call the buyer today");
    expect(state.task?.description).toBe("Updated notes");
    expect(state.task?.dueAt?.toISOString()).toBe("2026-11-04T12:00:00.000Z");
    expect(state.mapping?.syncStatus).toBe("SYNCED");
    expect(state.events).toContain("TODO_INBOUND_APPLIED");
  });

  it("paginates nextLink before committing deltaLink", async () => {
    const { state, store } = memory({ connection: connection({ inboundBaselineAt: NOW }), cursor: null });
    state.mapping = null;
    state.jobs = [job()];
    let pages = 0;
    const graph = graphOf((path) => {
      pages += 1;
      if (path.includes("$skiptoken=1") || path.includes("skiptoken=1")) {
        return deltaPage([], {
          delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=done`,
        });
      }
      return deltaPage([], {
        next: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$skiptoken=1`,
      });
    });
    state.cursor = `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=start`;
    await processInboundJob(job(), runtime(store, graph));
    expect(pages).toBe(2);
    expect(state.cursor).toContain("$deltatoken=done");
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
  });

  it("ignores unknown Microsoft tasks and forged cross-user mappings", async () => {
    const unknown = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      mapping: null,
      cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=x`,
    });
    unknown.state.jobs = [job()];
    await processInboundJob(
      job(),
      runtime(
        unknown.store,
        graphOf(() =>
          deltaPage([{ id: "ms-unknown", title: "Personal", status: "notStarted" }], {
            delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=y`,
          }),
        ),
      ),
    );
    expect(unknown.state.updates).toBe(0);
    expect(unknown.state.events).toContain("TODO_INBOUND_UNKNOWN");

    const cross = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      mapping: mapping({ userId: "other-user", connectionId: "conn-other" }),
      cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=x`,
    });
    cross.state.jobs = [job()];
    await processInboundJob(
      job(),
      runtime(
        cross.store,
        graphOf(() =>
          deltaPage([{ id: "ms-1", title: "X", status: "completed" }], {
            delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=y`,
          }),
        ),
      ),
    );
    expect(cross.state.updates).toBe(0);
    expect(cross.state.events).toContain("TODO_INBOUND_REJECTED");
  });

  it("records remote deletion without deleting the CRM task", async () => {
    const { state, store } = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=x`,
    });
    state.jobs = [job()];
    await processInboundJob(
      job(),
      runtime(
        store,
        graphOf(() =>
          deltaPage([{ id: "ms-1", "@removed": { reason: "deleted" } }], {
            delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=y`,
          }),
        ),
      ),
    );
    expect(state.task?.id).toBe("task-1");
    expect(state.updates).toBe(0);
    expect(state.mapping?.syncStatus).toBe("REMOVED");
    expect(state.events).toContain("TODO_INBOUND_REMOVED");
  });

  it("does not reopen a cancelled CRM task", async () => {
    const { state, store } = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      task: task({ status: "CANCELLED" }),
      mapping: mapping({
        lastCrmRevision: "2026-10-15T00:00:00.000Z",
        syncedSnapshot: {
          title: "Call the buyer",
          description: "Bring samples",
          status: "CANCELLED",
          priority: "NORMAL",
          dueAt: "2026-11-02T12:00:00.000Z",
          completedAt: null,
        },
      }),
      cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=x`,
    });
    state.jobs = [job()];
    await processInboundJob(
      job(),
      runtime(
        store,
        graphOf(() =>
          deltaPage([{ id: "ms-1", title: "Call the buyer", status: "notStarted" }], {
            delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=y`,
          }),
        ),
      ),
    );
    expect(state.updates).toBe(0);
    expect(state.task?.status).toBe("CANCELLED");
    expect(state.mapping?.syncStatus).toBe("CONFLICT");
  });

  it("defers while outbound is running for the same task", async () => {
    const { state, store } = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      outboundRunning: true,
      mapping: mapping({
        lastCrmRevision: "2026-10-15T00:00:00.000Z",
        syncedSnapshot: {
          title: "Call the buyer",
          description: "Bring samples",
          status: "OPEN",
          priority: "NORMAL",
          dueAt: "2026-11-02T12:00:00.000Z",
          completedAt: null,
        },
      }),
      cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=x`,
    });
    state.jobs = [job()];
    await processInboundJob(
      job(),
      runtime(
        store,
        graphOf(() =>
          deltaPage([{ id: "ms-1", title: "Call the buyer", status: "completed" }], {
            delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=y`,
          }),
        ),
      ),
    );
    expect(state.updates).toBe(0);
    expect(state.jobs[0]?.status).toBe("QUEUED");
    expect(state.jobs[0]?.payload.staged?.length).toBe(1);
    expect(state.cursor).toContain("$deltatoken=x");
  });

  it("rejects invalid delta URLs and handles 401/403/429/5xx", async () => {
    const invalid = memory({ connection: connection({ inboundBaselineAt: NOW }), cursor: "https://evil.example/delta" });
    invalid.state.jobs = [job()];
    await processInboundJob(job(), runtime(invalid.store, graphOf(() => ({ status: 200, json: { value: [] } }))));
    expect(invalid.state.jobs[0]?.status).toBe("FAILED");

    for (const [statusCode, expected] of [
      [403, "FAILED"],
      [429, "QUEUED"],
      [503, "QUEUED"],
    ] as const) {
      const { state, store } = memory({
        connection: connection({ inboundBaselineAt: NOW }),
        cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=x`,
      });
      state.jobs = [job()];
      await processInboundJob(
        job(),
        runtime(
          store,
          graphOf(() => ({ status: statusCode, json: {}, retryAfter: statusCode === 429 ? "5" : null })),
        ),
      );
      expect(state.jobs[0]?.status).toBe(expected);
    }
  });

  it("resets an expired delta cursor without replaying as fresh CRM edits", async () => {
    const { state, store } = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=stale`,
    });
    state.jobs = [job()];
    await processInboundJob(
      job(),
      runtime(
        store,
        graphOf(() => ({ status: 410, json: {} })),
      ),
    );
    expect(state.cursor).toBeNull();
    expect(state.connection?.inboundBaselineAt).toBeNull();
    expect(state.updates).toBe(0);
  });

  it("suppresses outbound enqueue during inbound apply", async () => {
    expect(isOutboundSuppressed()).toBe(false);
    await withOutboundSuppressed(async () => {
      expect(isOutboundSuppressed()).toBe(true);
    });
    expect(isOutboundSuppressed()).toBe(false);
  });

  it("parses removed delta items", () => {
    expect(parseMicrosoftTodoDeltaItem({ id: "ms-1", "@removed": { reason: "deleted" } })).toMatchObject({
      id: "ms-1",
      removed: true,
    });
  });

  it("keeps the latest repeated Microsoft task across paginated delta pages", async () => {
    const { state, store } = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      mapping: mapping({
        lastCrmRevision: "2026-10-15T00:00:00.000Z",
        syncedSnapshot: {
          title: "Call the buyer",
          description: "Bring samples",
          status: "OPEN",
          priority: "NORMAL",
          dueAt: "2026-11-02T12:00:00.000Z",
          completedAt: null,
        },
      }),
      cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=start`,
    });
    state.jobs = [job()];
    const graph = graphOf((path) => {
      if (path.includes("$skiptoken=1")) {
        return deltaPage(
          [{ id: "ms-1", title: "Final title", status: "completed", lastModifiedDateTime: "2026-11-01T12:30:00Z" }],
          { delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=done` },
        );
      }
      return deltaPage(
        [{ id: "ms-1", title: "First title", status: "notStarted", lastModifiedDateTime: "2026-11-01T12:00:00Z" }],
        { next: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$skiptoken=1` },
      );
    });
    await processInboundJob(job(), runtime(store, graph));
    expect(state.task?.title).toBe("Final title");
    expect(state.task?.status).toBe("DONE");
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
  });

  it("applies deletion when a task is updated then removed later in the round", async () => {
    const { state, store } = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      mapping: mapping({
        lastCrmRevision: "2026-10-15T00:00:00.000Z",
        syncedSnapshot: {
          title: "Call the buyer",
          description: "Bring samples",
          status: "OPEN",
          priority: "NORMAL",
          dueAt: "2026-11-02T12:00:00.000Z",
          completedAt: null,
        },
      }),
      cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=start`,
    });
    state.jobs = [job()];
    await processInboundJob(
      job(),
      runtime(
        store,
        graphOf(() =>
          deltaPage(
            [
              { id: "ms-1", title: "Updated", status: "completed" },
              { id: "ms-1", "@removed": { reason: "deleted" } },
            ],
            { delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=done` },
          ),
        ),
      ),
    );
    expect(state.updates).toBe(0);
    expect(state.task?.id).toBe("task-1");
    expect(state.mapping?.syncStatus).toBe("REMOVED");
  });

  it("resumes after a crash mid-apply without duplicating CRM writes", async () => {
    const { state, store } = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      mapping: mapping({
        lastCrmRevision: "2026-10-15T00:00:00.000Z",
        syncedSnapshot: {
          title: "Call the buyer",
          description: "Bring samples",
          status: "OPEN",
          priority: "NORMAL",
          dueAt: "2026-11-02T12:00:00.000Z",
          completedAt: null,
        },
      }),
    });
    const stagedPayload = {
      listId: LIST_ID,
      staged: [
        {
          id: "ms-1",
          etag: "e2",
          title: "Call the buyer today",
          bodyContent: "Updated notes",
          status: "completed" as const,
          importance: "high" as const,
          dueDateTime: { dateTime: "2026-11-04T00:00:00", timeZone: "UTC" },
          completedDateTime: { dateTime: "2026-11-01T12:00:00", timeZone: "UTC" },
          lastModifiedDateTime: "2026-11-01T12:00:00Z",
          removed: false,
        },
      ],
      appliedIds: ["ms-1"],
      nextLink: null,
      pendingDeltaLink: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=done`,
      baseline: false,
    };
    state.jobs = [job({ payload: stagedPayload })];
    await processInboundJob(job({ payload: stagedPayload }), runtime(store, graphOf(() => ({ status: 500, json: null }))));
    expect(state.updates).toBe(0);
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
    expect(state.cursor).toContain("$deltatoken=done");
  });

  it("does not advance the cursor when finalize loses the lease", async () => {
    const { state, store } = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=start`,
    });
    state.rejectLeaseOnFinalize = true;
    state.mapping = null;
    state.jobs = [job()];
    const before = state.cursor;
    await processInboundJob(
      job(),
      runtime(
        store,
        graphOf(() =>
          deltaPage([], {
            delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=done`,
          }),
        ),
      ),
    );
    expect(state.cursor).toBe(before);
    expect(state.jobs[0]?.status).toBe("RUNNING");
  });

  it("cancels when the connection is revoked during processing", async () => {
    const { state, store } = memory({
      connection: connection({ inboundBaselineAt: NOW }),
      cursor: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=start`,
      mapping: mapping({
        lastCrmRevision: "2026-10-15T00:00:00.000Z",
        syncedSnapshot: {
          title: "Call the buyer",
          description: "Bring samples",
          status: "OPEN",
          priority: "NORMAL",
          dueAt: "2026-11-02T12:00:00.000Z",
          completedAt: null,
        },
      }),
    });
    state.jobs = [job()];
    const originalFind = store.findConnection.bind(store);
    let checks = 0;
    store.findConnection = async () => {
      checks += 1;
      if (checks > 1) {
        return connection({ status: "REVOKED", inboundBaselineAt: NOW });
      }
      return originalFind("user-a");
    };
    await processInboundJob(
      job(),
      runtime(
        store,
        graphOf(() =>
          deltaPage([{ id: "ms-1", title: "X", status: "completed" }], {
            delta: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$deltatoken=done`,
          }),
        ),
      ),
    );
    expect(state.updates).toBe(0);
    expect(state.jobs[0]?.status).toBe("CANCELLED");
  });

  it("discards incomplete staged work when the delta cursor expires mid-round", async () => {
    const { state, store } = memory({
      connection: connection({ inboundBaselineAt: NOW }),
    });
    const payload = {
      listId: LIST_ID,
      staged: [
        {
          id: "ms-1",
          etag: null,
          title: "Partial",
          bodyContent: null,
          status: "completed" as const,
          importance: null,
          dueDateTime: null,
          completedDateTime: null,
          lastModifiedDateTime: null,
          removed: false,
        },
      ],
      nextLink: `https://graph.microsoft.com/v1.0/me/todo/lists/${LIST_ID}/tasks/delta?$skiptoken=1`,
      pendingDeltaLink: null,
      baseline: false,
    };
    state.jobs = [job({ payload })];
    await processInboundJob(
      job({ payload }),
      runtime(
        store,
        graphOf(() => ({ status: 410, json: {} })),
      ),
    );
    expect(state.cursor).toBeNull();
    expect(state.connection?.inboundBaselineAt).toBeNull();
    expect(state.jobs[0]?.payload.staged).toBeUndefined();
    expect(state.jobs[0]?.payload.baseline).toBe(true);
    expect(state.updates).toBe(0);
  });
});
