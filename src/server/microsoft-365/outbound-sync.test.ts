import { describe, expect, it } from "vitest";

import { MICROSOFT_365_TASK_LIST_NAME } from "@/domain/microsoft-365-crm";
import { crmTaskReference, type OutboundTaskSnapshot } from "@/domain/microsoft-todo-outbound";
import {
  processOutboundJob,
  runOutboundBatch,
  type OutboundConnection,
  type OutboundGraph,
  type OutboundJob,
  type OutboundMapping,
  type OutboundRuntime,
  type OutboundStore,
} from "@/server/microsoft-365/outbound-sync";

const NOW = new Date("2026-11-01T12:00:00.000Z");

function task(partial: Partial<OutboundTaskSnapshot> = {}): OutboundTaskSnapshot {
  return {
    id: "task-1",
    assigneeId: "user-a",
    title: "Call the buyer",
    description: "Product: Brake fluid\nAccount code: ABC123",
    status: "OPEN",
    priority: "HIGH",
    dueAt: new Date("2026-11-02T12:00:00.000Z"),
    completedAt: null,
    createdAt: new Date("2026-10-15T00:00:00.000Z"),
    updatedAt: new Date("2026-10-15T00:00:00.000Z"),
    ...partial,
  };
}

function connection(partial: Partial<OutboundConnection> = {}): OutboundConnection {
  return {
    id: "conn-a",
    userId: "user-a",
    status: "CONNECTED",
    tenantId: "11111111-1111-4111-8111-111111111111",
    microsoftUserId: "oid-a",
    scopes: "openid profile offline_access User.Read Tasks.ReadWrite",
    taskSyncEnabled: true,
    taskOutboundEnabledAt: new Date("2026-10-01T00:00:00.000Z"),
    todoListId: "list-1",
    accessTokenEncrypted: "v2:token",
    refreshTokenEncrypted: "v2:refresh",
    accessTokenExpiresAt: new Date("2026-11-01T13:00:00.000Z"),
    lastTaskSyncAt: null,
    lastError: null,
    ...partial,
  };
}

function job(partial: Partial<OutboundJob> = {}): OutboundJob {
  return {
    id: "job-1",
    connectionId: "conn-a",
    userId: "user-a",
    kind: "TODO_OUTBOUND",
    status: "RUNNING",
    attempt: 1,
    runAfter: NOW,
    leaseOwner: "worker-1",
    leaseUntil: new Date(NOW.getTime() + 60_000),
    lastError: null,
    dedupeKey: "todo:user-a:task-1:upsert",
    payload: { taskId: "task-1" },
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function memory(options?: { task?: OutboundTaskSnapshot | null; connection?: OutboundConnection | null; mapping?: OutboundMapping | null }) {
  const state = {
    task: options && "task" in options ? options.task ?? null : task(),
    connection: options && "connection" in options ? options.connection ?? null : connection(),
    mapping: options?.mapping ?? null,
    jobs: [] as OutboundJob[],
    events: [] as string[],
    listSaves: 0,
    failListSave: false,
    failMappingSave: false,
    onBeforeGraphWrite: null as null | (() => void),
  };
  const store: OutboundStore = {
    async findConnection() {
      return state.connection;
    },
    async saveConnection(row) {
      state.listSaves += 1;
      if (state.failListSave && row.todoListId && state.connection?.todoListId == null) {
        state.failListSave = false;
        throw new Error("database write failed after Microsoft accepted the list");
      }
      state.connection = row;
    },
    async withConnectionLock(_id, fn) {
      return fn();
    },
    async findTask(taskId) {
      return state.task?.id === taskId ? state.task : null;
    },
    async findMapping() {
      return state.mapping;
    },
    async saveMapping(row) {
      if (state.failMappingSave) {
        state.failMappingSave = false;
        throw new Error("mapping write failed after Microsoft accepted the task");
      }
      state.mapping = row;
    },
    async findJob(jobId) {
      return state.jobs.find((item) => item.id === jobId) ?? null;
    },
    async saveJob(next, opts) {
      if (opts?.requireLeaseOwner) {
        const current = state.jobs.find((item) => item.id === next.id);
        if (!current || current.status !== "RUNNING" || current.leaseOwner !== opts.requireLeaseOwner) return false;
      }
      state.jobs = [next];
      return true;
    },
    async holdsJobLease(jobId, owner) {
      const current = state.jobs.find((item) => item.id === jobId);
      return Boolean(current && current.status === "RUNNING" && current.leaseOwner === owner);
    },
    async appendEvent(event) {
      state.events.push(event.kind);
    },
    async claimJobs(now, owner) {
      const row = state.jobs.find((item) => item.status === "QUEUED" && item.runAfter <= now)
        ?? state.jobs.find((item) => item.status === "RUNNING" && item.leaseUntil && item.leaseUntil < now);
      if (!row) return [];
      row.status = "RUNNING";
      row.leaseOwner = owner;
      row.attempt += 1;
      return [{ ...row, payload: { ...row.payload } }];
    },
  };
  return { state, store };
}

function graphOf(handler: (method: string, path: string, body: unknown) => { status: number; json: unknown; retryAfter?: string; networkError?: boolean }) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const graph: OutboundGraph = {
    async request({ method, path, body }) {
      calls.push({ method, path, body: body ?? null });
      const result = handler(method, path, body ?? null);
      return { status: result.status, json: result.json, retryAfter: result.retryAfter ?? null, ...(result.networkError ? { networkError: true } : {}) };
    },
  };
  return { graph, calls };
}

function runtime(store: OutboundStore, graph: OutboundGraph, allowed = true): OutboundRuntime {
  return {
    store,
    graph,
    tokenFor: async () => ({ ok: true, accessToken: "access-token" }),
    now: () => NOW,
    graphAllowed: () => allowed,
    newId: () => "map-1",
  };
}

function happyGraph(extra?: { postStatus?: number; postJson?: unknown; lookup?: unknown; network?: boolean; retryAfter?: string; onPost?: () => void }) {
  return graphOf((method, path) => {
    if (path.startsWith("/me/todo/lists") && !path.includes("/tasks") && method === "GET") {
      return { status: 200, json: { value: [{ id: "list-1", displayName: MICROSOFT_365_TASK_LIST_NAME, createdDateTime: "2026-10-01T00:00:00Z" }] } };
    }
    if (method === "GET" && path.includes("/tasks")) {
      return { status: 200, json: extra?.lookup ?? { value: [] } };
    }
    if (method === "POST" && path.endsWith("/tasks")) {
      extra?.onPost?.();
      if (extra?.network) return { status: 0, json: null, networkError: true };
      return { status: extra?.postStatus ?? 201, json: extra?.postJson ?? { id: "ms-1" }, ...(extra?.retryAfter ? { retryAfter: extra.retryAfter } : {}) };
    }
    if (method === "PATCH") return { status: 200, json: { id: "ms-1" } };
    return { status: 201, json: { id: "link-1" } };
  });
}

describe("outbound Microsoft To Do sync", () => {
  it("does not claim or call Graph when the feature is disabled", async () => {
    const { state, store } = memory();
    state.jobs = [job({ status: "QUEUED", attempt: 0 })];
    const { graph, calls } = happyGraph();
    const result = await runOutboundBatch(runtime(store, graph, false), "worker-1");
    expect(result).toEqual({ processed: 0, graphCalls: false });
    expect(calls).toHaveLength(0);
    expect(state.jobs[0]?.status).toBe("QUEUED");
  });

  it("does not call Graph without a connection, preference, or Tasks.ReadWrite", async () => {
    for (const partial of [
      { connection: null as OutboundConnection | null },
      { connection: connection({ taskSyncEnabled: false }) },
      { connection: connection({ scopes: "openid profile offline_access User.Read" }) },
      { connection: connection({ status: "REVOKED" as const }) },
    ]) {
      const { state, store } = memory(partial);
      state.jobs = [job()];
      const { graph, calls } = happyGraph();
      await processOutboundJob(job(), runtime(store, graph));
      expect(calls).toHaveLength(0);
      expect(state.jobs[0]?.status === "CANCELLED" || state.jobs[0]?.status === "FAILED").toBe(true);
    }
  });

  it("creates a task in the existing list and keeps account codes out of the body", async () => {
    const { state, store } = memory();
    state.jobs = [job()];
    const { graph, calls } = happyGraph();
    await processOutboundJob(job(), runtime(store, graph));
    const created = calls.find((call) => call.method === "POST" && call.path.endsWith("/tasks"));
    expect(created).toBeTruthy();
    const body = created?.body as { title: string; body: { content: string }; importance: string };
    expect(body.title).toBe("Call the buyer");
    expect(body.body.content).toContain("Brake fluid");
    expect(body.body.content).not.toContain("ABC123");
    expect(body.body.content).toContain(crmTaskReference("task-1"));
    expect(body.importance).toBe("high");
    expect(state.mapping?.microsoftTaskId).toBe("ms-1");
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
    expect(state.jobs[0]?.payload.createUncertain).toBe(false);
  });

  it("patches an existing mapped task when it is edited, completed, or rescheduled", async () => {
    const mapping: OutboundMapping = {
      id: "map-1",
      taskId: "task-1",
      userId: "user-a",
      connectionId: "conn-a",
      tenantId: "11111111-1111-4111-8111-111111111111",
      microsoftUserId: "oid-a",
      listId: "list-1",
      microsoftTaskId: "ms-1",
      syncStatus: "SYNCED",
      lastError: null,
      lastSyncedAt: NOW,
      deletedAt: null,
    };
    const edited = memory({ mapping, task: task({ title: "Call again", priority: "LOW", dueAt: new Date("2026-11-03T12:00:00.000Z") }) });
    edited.state.jobs = [job()];
    const editGraph = happyGraph();
    await processOutboundJob(job(), runtime(edited.store, editGraph.graph));
    expect(editGraph.calls.some((call) => call.method === "PATCH")).toBe(true);
    expect(editGraph.calls.some((call) => call.method === "POST" && call.path.endsWith("/tasks"))).toBe(false);

    const done = memory({ mapping, task: task({ status: "DONE", completedAt: new Date("2026-11-01T11:00:00.000Z") }) });
    done.state.jobs = [job()];
    const doneGraph = happyGraph();
    await processOutboundJob(job(), runtime(done.store, doneGraph.graph));
    const patchBody = doneGraph.calls.find((call) => call.method === "PATCH")?.body as { status: string };
    expect(patchBody.status).toBe("completed");
  });

  it("defers a cancelled task and a previous assignee's task without copying the description", async () => {
    const mapping: OutboundMapping = {
      id: "map-1",
      taskId: "task-1",
      userId: "user-a",
      connectionId: "conn-a",
      tenantId: "11111111-1111-4111-8111-111111111111",
      microsoftUserId: "oid-a",
      listId: "list-1",
      microsoftTaskId: "ms-1",
      syncStatus: "SYNCED",
      lastError: null,
      lastSyncedAt: NOW,
      deletedAt: null,
    };
    const cancelled = memory({ mapping, task: task({ status: "CANCELLED" }) });
    cancelled.state.jobs = [job()];
    const cancelGraph = happyGraph();
    await processOutboundJob(job(), runtime(cancelled.store, cancelGraph.graph));
    const cancelBody = cancelGraph.calls.find((call) => call.method === "PATCH")?.body as { title: string; body: { content: string }; status: string };
    expect(cancelBody.title).toBe("Cancelled CRM task");
    expect(cancelBody.body.content).not.toContain("ABC123");
    expect(cancelBody.status).toBe("deferred");
    expect(cancelled.state.mapping?.syncStatus).toBe("TOMBSTONED");

    const released = memory({
      mapping: { ...mapping, userId: "user-a" },
      task: task({ assigneeId: "user-b" }),
    });
    released.state.jobs = [job({ payload: { taskId: "task-1", release: true } })];
    const releaseGraph = happyGraph();
    await processOutboundJob(job({ payload: { taskId: "task-1", release: true } }), runtime(released.store, releaseGraph.graph));
    const releaseBody = releaseGraph.calls.find((call) => call.method === "PATCH")?.body as { title: string; body: { content: string } };
    expect(releaseBody.title).toBe("CRM task reassigned");
    expect(releaseBody.body.content).not.toContain("Brake fluid");
    expect(releaseGraph.calls.some((call) => call.method === "POST" && call.path.endsWith("/tasks"))).toBe(false);
  });

  it("reuses a list and does not create a second one after a failed save", async () => {
    const first = memory({ connection: connection({ todoListId: null }) });
    first.state.failListSave = true;
    first.state.jobs = [job()];
    const created = graphOf((method, path) => {
      if (method === "GET" && path.startsWith("/me/todo/lists")) return { status: 200, json: { value: [] } };
      if (method === "POST" && path === "/me/todo/lists") return { status: 201, json: { id: "list-new" } };
      return { status: 500, json: {} };
    });
    await processOutboundJob(job(), runtime(first.store, created.graph));
    expect(created.calls.filter((call) => call.method === "POST" && call.path === "/me/todo/lists")).toHaveLength(1);
    expect(first.state.jobs[0]?.status).not.toBe("SUCCEEDED");

    const second = memory({ connection: connection({ todoListId: null }) });
    second.state.jobs = [job()];
    const reused = graphOf((method, path) => {
      if (method === "GET" && path.startsWith("/me/todo/lists") && !path.includes("/tasks")) {
        return { status: 200, json: { value: [{ id: "list-new", displayName: MICROSOFT_365_TASK_LIST_NAME }] } };
      }
      if (method === "GET") return { status: 200, json: { value: [] } };
      if (method === "POST" && path.endsWith("/tasks")) return { status: 201, json: { id: "ms-1" } };
      return { status: 201, json: { id: "link-1" } };
    });
    await processOutboundJob(job(), runtime(second.store, reused.graph));
    expect(reused.calls.some((call) => call.method === "POST" && call.path === "/me/todo/lists")).toBe(false);
    expect(second.state.connection?.todoListId).toBe("list-new");
  });

  it("adopts an existing task after an ambiguous create instead of posting another", async () => {
    const { state, store } = memory();
    state.jobs = [job()];
    let posts = 0;
    const { graph } = graphOf((method, path) => {
      if (method === "GET" && path.includes("/tasks")) {
        return posts === 0
          ? { status: 200, json: { value: [] } }
          : { status: 200, json: { value: [{ id: "ms-existing", body: { content: `CRM reference: ${crmTaskReference("task-1")}` } }] } };
      }
      if (method === "POST" && path.endsWith("/tasks")) {
        posts += 1;
        return { status: 0, json: null, networkError: true };
      }
      if (method === "PATCH") return { status: 200, json: { id: "ms-existing" } };
      return { status: 201, json: {} };
    });
    await processOutboundJob(job(), runtime(store, graph));
    expect(posts).toBe(1);
    expect(state.mapping?.microsoftTaskId).toBe("ms-existing");
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
  });

  it("marks an incomplete lookup as needs review and does not create another task", async () => {
    const beforeCreate = memory();
    beforeCreate.state.jobs = [job()];
    let earlyPosts = 0;
    const early = graphOf((method, path) => {
      if (method === "GET" && path.includes("/tasks")) {
        return { status: 200, json: { value: [], "@odata.nextLink": "https://evil.example/tasks" } };
      }
      if (method === "POST" && path.endsWith("/tasks")) {
        earlyPosts += 1;
        return { status: 201, json: { id: "ms-should-not-exist" } };
      }
      return { status: 500, json: {} };
    });
    await processOutboundJob(job(), runtime(beforeCreate.store, early.graph));
    expect(beforeCreate.state.jobs[0]?.status).toBe("NEEDS_REVIEW");
    expect(earlyPosts).toBe(0);
    expect(beforeCreate.state.mapping).toBeNull();

    const afterCreate = memory();
    afterCreate.state.jobs = [job()];
    let posts = 0;
    let lookups = 0;
    const later = graphOf((method, path) => {
      if (method === "GET" && path.includes("/tasks")) {
        lookups += 1;
        return lookups === 1
          ? { status: 200, json: { value: [] } }
          : { status: 200, json: { value: [], "@odata.nextLink": "https://evil.example/tasks" } };
      }
      if (method === "POST" && path.endsWith("/tasks")) {
        posts += 1;
        return { status: 0, json: null, networkError: true };
      }
      return { status: 500, json: {} };
    });
    await processOutboundJob(job(), runtime(afterCreate.store, later.graph));
    expect(afterCreate.state.jobs[0]?.status).toBe("NEEDS_REVIEW");
    expect(afterCreate.state.jobs[0]?.payload.createUncertain).toBe(true);
    expect(posts).toBe(1);
    expect(afterCreate.state.mapping).toBeNull();
  });

  it("does not POST again after a completed empty lookup following a timed-out create", async () => {
    const first = memory();
    first.state.jobs = [job()];
    const firstGraph = happyGraph({ network: true });
    await processOutboundJob(job(), runtime(first.store, firstGraph.graph));
    expect(first.state.jobs[0]?.status).toBe("NEEDS_REVIEW");
    expect(first.state.jobs[0]?.payload.createUncertain).toBe(true);
    expect(firstGraph.calls.filter((call) => call.method === "POST" && call.path.endsWith("/tasks"))).toHaveLength(1);

    // Operator did not review. A later worker must look up only.
    const second = memory();
    second.state.jobs = [job({ payload: { taskId: "task-1", createUncertain: true }, status: "RUNNING" })];
    let posts = 0;
    const secondGraph = graphOf((method, path) => {
      if (method === "GET" && path.includes("/tasks")) return { status: 200, json: { value: [] } };
      if (method === "POST" && path.endsWith("/tasks")) {
        posts += 1;
        return { status: 201, json: { id: "ms-dup" } };
      }
      return { status: 200, json: {} };
    });
    await processOutboundJob(job({ payload: { taskId: "task-1", createUncertain: true } }), runtime(second.store, secondGraph.graph));
    expect(posts).toBe(0);
    expect(second.state.jobs[0]?.status).toBe("NEEDS_REVIEW");
    expect(second.state.mapping).toBeNull();
  });

  it("does not POST again after HTTP 5xx with an empty lookup, including at max attempts", async () => {
    const flaky = memory();
    flaky.state.jobs = [job()];
    const flakyGraph = happyGraph({ postStatus: 503 });
    await processOutboundJob(job(), runtime(flaky.store, flakyGraph.graph));
    expect(flaky.state.jobs[0]?.status).toBe("NEEDS_REVIEW");
    expect(flaky.state.jobs[0]?.payload.createUncertain).toBe(true);

    const persistent = memory();
    persistent.state.jobs = [job({ attempt: 5 })];
    const persistentGraph = graphOf((method, path) => {
      if (method === "GET") return { status: 200, json: { value: [] } };
      if (method === "POST" && path.endsWith("/tasks")) return { status: 503, json: {} };
      return { status: 500, json: {} };
    });
    await processOutboundJob(job({ attempt: 5 }), runtime(persistent.store, persistentGraph.graph));
    expect(persistent.state.jobs[0]?.status).toBe("NEEDS_REVIEW");
    expect(persistent.state.jobs[0]?.payload.createUncertain).toBe(true);
  });

  it("waits for Retry-After without marking create uncertain", async () => {
    const limited = memory();
    limited.state.jobs = [job()];
    const limitedGraph = happyGraph({ postStatus: 429, retryAfter: "12" });
    await processOutboundJob(job(), runtime(limited.store, limitedGraph.graph));
    expect(limited.state.jobs[0]?.status).toBe("QUEUED");
    expect(limited.state.jobs[0]?.payload.createUncertain).toBeUndefined();
    expect(limited.state.jobs[0]?.runAfter.toISOString()).toBe("2026-11-01T12:00:12.000Z");
  });

  it("keeps a known Microsoft task id when the local mapping write fails", async () => {
    const { state, store } = memory();
    state.jobs = [job()];
    state.failMappingSave = true;
    const { graph, calls } = happyGraph();
    await processOutboundJob(job(), runtime(store, graph));
    expect(state.jobs[0]?.status).toBe("NEEDS_REVIEW");
    expect(state.jobs[0]?.payload.createUncertain).toBe(true);
    expect(state.jobs[0]?.payload.knownMicrosoftTaskId).toBe("ms-1");
    expect(state.mapping).toBeNull();

    state.jobs = [job({ payload: { taskId: "task-1", createUncertain: true, knownMicrosoftTaskId: "ms-1", reviewed: true } })];
    const retry = happyGraph();
    await processOutboundJob(job({ payload: { taskId: "task-1", createUncertain: true, knownMicrosoftTaskId: "ms-1", reviewed: true } }), runtime(store, retry.graph));
    expect(retry.calls.some((call) => call.method === "POST" && call.path.endsWith("/tasks"))).toBe(false);
    expect(retry.calls.some((call) => call.method === "PATCH")).toBe(true);
    expect(state.mapping?.microsoftTaskId).toBe("ms-1");
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
    expect(calls.filter((call) => call.method === "POST" && call.path.endsWith("/tasks"))).toHaveLength(1);
  });

  it("leaves the latest CRM revision queued after a successful write of an older revision", async () => {
    const { state, store } = memory();
    state.jobs = [job()];
    const { graph, calls } = happyGraph({
      onPost: () => {
        state.task = task({
          title: "Updated title",
          updatedAt: new Date("2026-10-16T00:00:00.000Z"),
        });
      },
    });
    await processOutboundJob(job(), runtime(store, graph));
    expect(calls.some((call) => call.method === "POST" && call.path.endsWith("/tasks"))).toBe(true);
    expect(state.mapping?.microsoftTaskId).toBe("ms-1");
    expect(state.jobs[0]?.status).toBe("QUEUED");
    expect(state.jobs[0]?.payload.taskRevision).toBe("2026-10-16T00:00:00.000Z");
    expect(state.jobs[0]?.payload.revisionDirty).toBe(false);
    expect(state.jobs[0]?.payload.knownMicrosoftTaskId).toBe("ms-1");
  });

  it("requeues a release when the CRM task is reassigned during an in-flight create", async () => {
    const { state, store } = memory();
    state.jobs = [job()];
    const { graph } = happyGraph({
      onPost: () => {
        state.task = task({ assigneeId: "user-b", updatedAt: new Date("2026-10-16T00:00:00.000Z") });
      },
    });
    await processOutboundJob(job(), runtime(store, graph));
    expect(state.jobs[0]?.status).toBe("QUEUED");
    expect(state.jobs[0]?.payload.release).toBe(true);
    expect(state.jobs[0]?.payload.knownMicrosoftTaskId).toBe("ms-1");
  });

  it("honours revisionDirty set by a concurrent enqueue while the worker runs", async () => {
    const { state, store } = memory();
    state.jobs = [job()];
    const { graph } = happyGraph({
      onPost: () => {
        const current = state.jobs[0];
        if (current) current.payload = { ...current.payload, revisionDirty: true, taskRevision: "2026-10-16T00:00:00.000Z" };
        state.task = task({ title: "Newer", updatedAt: new Date("2026-10-16T00:00:00.000Z") });
      },
    });
    await processOutboundJob(job(), runtime(store, graph));
    expect(state.jobs[0]?.status).toBe("QUEUED");
    expect(state.jobs[0]?.payload.revisionDirty).toBe(false);
    expect(state.jobs[0]?.payload.taskRevision).toBe("2026-10-16T00:00:00.000Z");
  });

  it("does not let a stale worker overwrite job state after losing its lease", async () => {
    const { state, store } = memory();
    state.jobs = [job()];
    const { graph } = happyGraph({
      onPost: () => {
        state.jobs = [job({ status: "RUNNING", leaseOwner: "worker-2", attempt: 2, payload: { taskId: "task-1", revisionDirty: true } })];
      },
    });
    await processOutboundJob(job(), runtime(store, graph));
    expect(state.jobs[0]?.leaseOwner).toBe("worker-2");
    expect(state.jobs[0]?.status).toBe("RUNNING");
    expect(state.jobs[0]?.payload.revisionDirty).toBe(true);
  });

  it("refreshes an expired token before calling Graph", async () => {
    const { state, store } = memory({ connection: connection({ accessTokenExpiresAt: new Date("2026-11-01T12:00:30.000Z") }) });
    state.jobs = [job()];
    const { graph, calls } = happyGraph();
    let refreshes = 0;
    const custom = runtime(store, graph);
    custom.tokenFor = async () => {
      refreshes += 1;
      return { ok: true, accessToken: "refreshed-token" };
    };
    await processOutboundJob(job(), custom);
    expect(refreshes).toBe(1);
    expect(calls.length).toBeGreaterThan(0);
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
  });

  it("lets only one of two workers claim the same queued job", async () => {
    const { state, store } = memory();
    state.jobs = [job({ status: "QUEUED", attempt: 0 })];
    const [first, second] = await Promise.all([
      store.claimJobs(NOW, "worker-1", 1, 60_000),
      store.claimJobs(NOW, "worker-2", 1, 60_000),
    ]);
    expect(first.length + second.length).toBe(1);
    expect(state.jobs[0]?.status).toBe("RUNNING");
    expect(state.jobs[0]?.attempt).toBe(1);
  });

  it("skips a historical task that was not explicitly selected", async () => {
    const { state, store } = memory({ task: task({ createdAt: new Date("2026-01-01T00:00:00.000Z") }) });
    state.jobs = [job()];
    const { graph, calls } = happyGraph();
    await processOutboundJob(job(), runtime(store, graph));
    expect(calls).toHaveLength(0);
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
    expect(state.mapping).toBeNull();
  });

  it("does not sync a task assigned to someone else", async () => {
    const { state, store } = memory({ task: task({ assigneeId: "user-b" }) });
    state.jobs = [job()];
    const { graph, calls } = happyGraph();
    await processOutboundJob(job(), runtime(store, graph));
    expect(calls).toHaveLength(0);
    expect(state.mapping).toBeNull();
  });
});
