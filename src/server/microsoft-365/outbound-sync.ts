/**
 * Outbound CRM → Microsoft To Do worker step.
 * Microsoft task creation does not support an idempotency header.
 * A create that times out is reconciled by `ab-crm-task:{taskId}` in the dedicated list
 * before another task is posted. If that lookup is incomplete, the job becomes NEEDS_REVIEW.
 */
import { MICROSOFT_365_TASK_LIST_NAME, sanitizeMicrosoftMessage } from "@/domain/microsoft-365-crm";
import {
  MICROSOFT_TODO_LOOKUP_MAX_PAGES,
  MICROSOFT_TODO_LOOKUP_PAGE_SIZE,
  MICROSOFT_TODO_MAX_ATTEMPTS,
  assertTodoGraphUrl,
  buildTodoTaskBody,
  chooseCrmTodoList,
  classifyOutboundTask,
  crmTaskReference,
  hasTasksReadWrite,
  outboundRetryDelayMs,
  taskBodyContainsReference,
  type OutboundTaskSnapshot,
} from "@/domain/microsoft-todo-outbound";

export type OutboundJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "NEEDS_REVIEW";

export type OutboundJobPayload = {
  taskId: string;
  explicit?: boolean;
  release?: boolean;
  reviewed?: boolean;
};

export type OutboundJob = {
  id: string;
  connectionId: string;
  userId: string;
  kind: "TODO_OUTBOUND";
  status: OutboundJobStatus;
  attempt: number;
  runAfter: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  lastError: string | null;
  dedupeKey: string;
  payload: OutboundJobPayload;
  createdAt: Date;
  updatedAt: Date;
};

export type OutboundConnection = {
  id: string;
  userId: string;
  status: "CONNECTED" | "REVOKED" | "ERROR";
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
};

export type OutboundMapping = {
  id: string;
  taskId: string;
  userId: string;
  connectionId: string;
  tenantId: string;
  microsoftUserId: string;
  listId: string;
  microsoftTaskId: string;
  syncStatus: "PENDING" | "SYNCED" | "FAILED" | "CONFLICT" | "SKIPPED" | "TOMBSTONED";
  lastError: string | null;
  lastSyncedAt: Date | null;
  deletedAt: Date | null;
};

export type GraphResult = {
  status: number;
  json: unknown;
  retryAfter: string | null;
  networkError?: boolean;
};

export type OutboundGraph = {
  request(input: { method: "GET" | "POST" | "PATCH"; path: string; token: string; body?: unknown }): Promise<GraphResult>;
};

export type OutboundToken = { ok: true; accessToken: string } | { ok: false; code: "REVOKED" | "RATE_LIMITED" | "TOKEN"; retryAfter: string | null; message: string };

export type OutboundStore = {
  findConnection(userId: string): Promise<OutboundConnection | null>;
  saveConnection(row: OutboundConnection): Promise<void>;
  withConnectionLock<T>(connectionId: string, fn: () => Promise<T>): Promise<T>;
  findTask(taskId: string): Promise<OutboundTaskSnapshot | null>;
  findMapping(userId: string, taskId: string): Promise<OutboundMapping | null>;
  saveMapping(row: OutboundMapping): Promise<void>;
  saveJob(job: OutboundJob): Promise<void>;
  appendEvent(event: { userId: string | null; connectionId: string | null; kind: string; message: string; createdAt: Date }): Promise<void>;
  claimJobs(now: Date, owner: string, limit: number, leaseMs: number): Promise<OutboundJob[]>;
};

export type OutboundRuntime = {
  store: OutboundStore;
  graph: OutboundGraph;
  tokenFor: (connection: OutboundConnection) => Promise<OutboundToken>;
  now: () => Date;
  graphAllowed: () => boolean;
  newId: () => string;
};

function safe(error: unknown): string {
  return sanitizeMicrosoftMessage(error instanceof Error ? error.message : String(error));
}

function requeue(job: OutboundJob, now: Date, message: string, retryAfter: string | null, terminal: OutboundJobStatus | null): OutboundJob {
  if (terminal) {
    return { ...job, status: terminal, leaseOwner: null, leaseUntil: null, lastError: message, updatedAt: now };
  }
  if (job.attempt >= MICROSOFT_TODO_MAX_ATTEMPTS) {
    return { ...job, status: "FAILED", leaseOwner: null, leaseUntil: null, lastError: message, updatedAt: now };
  }
  return {
    ...job,
    status: "QUEUED",
    leaseOwner: null,
    leaseUntil: null,
    lastError: message,
    runAfter: new Date(now.getTime() + outboundRetryDelayMs(job.attempt, retryAfter, now)),
    updatedAt: now,
  };
}

async function callGraph(
  runtime: OutboundRuntime,
  connection: OutboundConnection,
  input: { method: "GET" | "POST" | "PATCH"; path: string; body?: unknown },
  token: string,
  refreshed: boolean,
): Promise<{ result: GraphResult; token: string; connection: OutboundConnection } | { stop: OutboundJob }> {
  assertTodoGraphUrl(input.path);
  let result: GraphResult;
  try {
    result = await runtime.graph.request({ ...input, token });
  } catch (error) {
    result = { status: 0, json: null, retryAfter: null, networkError: true };
    if (!(error instanceof Error)) {
      result = { status: 0, json: null, retryAfter: null, networkError: true };
    }
  }
  if (result.status === 401 && !refreshed) {
    const next = await runtime.tokenFor(connection);
    if (!next.ok) {
      const now = runtime.now();
      return {
        stop: requeue(
          { id: "", connectionId: connection.id, userId: connection.userId, kind: "TODO_OUTBOUND", status: "RUNNING", attempt: 1, runAfter: now, leaseOwner: null, leaseUntil: null, lastError: null, dedupeKey: "", payload: { taskId: "" }, createdAt: now, updatedAt: now },
          now,
          next.message,
          next.retryAfter,
          next.code === "REVOKED" ? "CANCELLED" : null,
        ),
      };
    }
    const latest = (await runtime.store.findConnection(connection.userId)) ?? connection;
    return callGraph(runtime, latest, input, next.accessToken, true);
  }
  return { result, token, connection };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function lookupTask(
  runtime: OutboundRuntime,
  connection: OutboundConnection,
  listId: string,
  taskId: string,
  token: string,
): Promise<{ id: string | null; ambiguous: boolean; token: string; rate: GraphResult | null; fatal: number | null }> {
  let path = `/me/todo/lists/${encodeURIComponent(listId)}/tasks?$select=id,body&$top=${MICROSOFT_TODO_LOOKUP_PAGE_SIZE}`;
  for (let page = 0; page < MICROSOFT_TODO_LOOKUP_MAX_PAGES; page += 1) {
    const called = await callGraph(runtime, connection, { method: "GET", path }, token, false);
    if ("stop" in called) return { id: null, ambiguous: true, token, rate: null, fatal: 401 };
    token = called.token;
    const result = called.result;
    if (result.networkError || result.status === 429 || result.status >= 500) {
      return { id: null, ambiguous: true, token, rate: result, fatal: null };
    }
    if (result.status === 400 || result.status === 403 || result.status === 404) {
      return { id: null, ambiguous: true, token, rate: null, fatal: result.status };
    }
    if (result.status !== 200) return { id: null, ambiguous: true, token, rate: null, fatal: result.status };
    const record = asRecord(result.json);
    const value = record && Array.isArray(record["value"]) ? record["value"] : [];
    const hits = value.filter((item) => taskBodyContainsReference(asRecord(item)?.["body"], taskId));
    if (hits.length > 1) return { id: null, ambiguous: true, token, rate: null, fatal: 409 };
    const first = hits[0];
    const id = asRecord(first)?.["id"];
    if (typeof id === "string") return { id, ambiguous: false, token, rate: null, fatal: null };
    const next = record?.["@odata.nextLink"];
    if (typeof next !== "string" || !next) return { id: null, ambiguous: false, token, rate: null, fatal: null };
    try {
      path = assertTodoGraphUrl(next);
    } catch {
      return { id: null, ambiguous: true, token, rate: null, fatal: null };
    }
  }
  return { id: null, ambiguous: true, token, rate: null, fatal: null };
}

async function ensureList(
  runtime: OutboundRuntime,
  connection: OutboundConnection,
  token: string,
): Promise<{ listId: string; token: string } | { error: GraphResult | null; message: string; ambiguous: boolean }> {
  return runtime.store.withConnectionLock(connection.id, async () => {
    const fresh = (await runtime.store.findConnection(connection.userId)) ?? connection;
    if (fresh.todoListId) return { listId: fresh.todoListId, token };
    const listed = await callGraph(runtime, fresh, { method: "GET", path: "/me/todo/lists?$select=id,displayName,wellknownListName,createdDateTime" }, token, false);
    if ("stop" in listed) return { error: null, message: "Microsoft 365 needs to be connected again", ambiguous: false };
    if (listed.result.networkError || listed.result.status >= 500 || listed.result.status === 429) {
      return { error: listed.result, message: "Microsoft To Do list could not be read", ambiguous: false };
    }
    if (listed.result.status !== 200) return { error: listed.result, message: "Microsoft To Do list could not be read", ambiguous: false };
    const value = asRecord(listed.result.json)?.["value"];
    const lists = Array.isArray(value)
      ? value.flatMap((item) => {
          const row = asRecord(item);
          return row && typeof row["id"] === "string"
            ? [{
                id: row["id"],
                displayName: typeof row["displayName"] === "string" ? row["displayName"] : undefined,
                wellknownListName: typeof row["wellknownListName"] === "string" ? row["wellknownListName"] : null,
                createdDateTime: typeof row["createdDateTime"] === "string" ? row["createdDateTime"] : undefined,
              }]
            : [];
        })
      : [];
    const choice = chooseCrmTodoList(lists, fresh.todoListId);
    if (choice.action === "use") {
      try {
        await runtime.store.saveConnection({ ...fresh, todoListId: choice.id });
      } catch {
        return { error: null, message: "Microsoft To Do list was found but could not be stored", ambiguous: false };
      }
      if (choice.duplicates) {
        await runtime.store.appendEvent({
          userId: fresh.userId,
          connectionId: fresh.id,
          kind: "TODO_LIST_DUPLICATE",
          message: "More than one Automotive Brands CRM list exists. The oldest matching list is reused.",
          createdAt: runtime.now(),
        });
      }
      return { listId: choice.id, token: listed.token };
    }
    const created = await callGraph(
      runtime,
      fresh,
      { method: "POST", path: "/me/todo/lists", body: { displayName: MICROSOFT_365_TASK_LIST_NAME } },
      listed.token,
      false,
    );
    if ("stop" in created) return { error: null, message: "Microsoft 365 needs to be connected again", ambiguous: false };
    if (created.result.networkError || created.result.status >= 500) {
      return { error: created.result, message: "Microsoft To Do list could not be created", ambiguous: false };
    }
    const id = asRecord(created.result.json)?.["id"];
    if (created.result.status !== 201 || typeof id !== "string") {
      return { error: created.result, message: "Microsoft To Do list could not be created", ambiguous: created.result.status === 409 };
    }
    try {
      await runtime.store.saveConnection({ ...fresh, todoListId: id });
    } catch {
      return { error: null, message: "Microsoft To Do list was created but could not be stored", ambiguous: false };
    }
    return { listId: id, token: created.token };
  });
}

function mappingFrom(connection: OutboundConnection, taskId: string, listId: string, microsoftTaskId: string, now: Date, id: string): OutboundMapping {
  return {
    id,
    taskId,
    userId: connection.userId,
    connectionId: connection.id,
    tenantId: connection.tenantId,
    microsoftUserId: connection.microsoftUserId,
    listId,
    microsoftTaskId,
    syncStatus: "SYNCED",
    lastError: null,
    lastSyncedAt: now,
    deletedAt: null,
  };
}

export async function processOutboundJob(job: OutboundJob, runtime: OutboundRuntime): Promise<void> {
  const now = runtime.now();
  const finish = async (next: OutboundJob) => {
    await runtime.store.saveJob(next);
  };
  if (!runtime.graphAllowed()) {
    await finish({ ...job, status: "QUEUED", leaseOwner: null, leaseUntil: null, updatedAt: now });
    return;
  }
  const connection = await runtime.store.findConnection(job.userId);
  if (!connection || connection.status !== "CONNECTED" || !connection.taskSyncEnabled) {
    await finish(requeue(job, now, "Microsoft 365 task sync is not connected", null, "CANCELLED"));
    return;
  }
  if (connection.id !== job.connectionId) {
    await finish(requeue(job, now, "Microsoft connection changed", null, "CANCELLED"));
    return;
  }
  if (!hasTasksReadWrite(connection.scopes)) {
    await finish(requeue(job, now, "Microsoft To Do permission is missing", null, "FAILED"));
    await runtime.store.saveConnection({ ...connection, lastError: "Microsoft To Do permission is missing" });
    return;
  }
  const task = await runtime.store.findTask(job.payload.taskId);
  if (!task) {
    await finish(requeue(job, now, "CRM task no longer exists", null, "CANCELLED"));
    return;
  }
  const mapping = await runtime.store.findMapping(job.userId, task.id);
  const active = Boolean(mapping && mapping.deletedAt == null && mapping.syncStatus !== "TOMBSTONED");
  const kind = classifyOutboundTask({
    task,
    connectionUserId: connection.userId,
    taskOutboundEnabledAt: connection.taskOutboundEnabledAt,
    explicit: Boolean(job.payload.explicit),
    release: Boolean(job.payload.release),
    hasActiveMapping: active,
  });
  if (kind === "skip") {
    await finish({ ...job, status: "SUCCEEDED", leaseOwner: null, leaseUntil: null, lastError: null, updatedAt: now });
    return;
  }
  const tokenResult = await runtime.tokenFor(connection);
  if (!tokenResult.ok) {
    await finish(requeue(job, now, tokenResult.message, tokenResult.retryAfter, tokenResult.code === "REVOKED" ? "CANCELLED" : null));
    return;
  }
  const mode = kind === "release" ? "release" : task.status === "CANCELLED" ? "cancel" : "sync";
  let token = tokenResult.accessToken;
  const list = await ensureList(runtime, connection, token);
  if (!("listId" in list)) {
    const terminal = list.ambiguous ? "NEEDS_REVIEW" : null;
    await finish(requeue(job, now, list.message, list.error?.retryAfter ?? null, list.error?.status === 403 ? "FAILED" : terminal));
    if (list.ambiguous) {
      await runtime.store.appendEvent({
        userId: connection.userId,
        connectionId: connection.id,
        kind: "TODO_NEEDS_REVIEW",
        message: list.message,
        createdAt: now,
      });
    }
    return;
  }
  token = list.token;
  const latest = (await runtime.store.findConnection(connection.userId)) ?? connection;
  if (latest.status !== "CONNECTED" || !latest.taskSyncEnabled || latest.id !== connection.id) {
    await finish(requeue(job, now, "Microsoft connection changed", null, "CANCELLED"));
    return;
  }
  const body = buildTodoTaskBody(task, mode);
  const existingId = mapping?.microsoftTaskId && mapping.listId === list.listId ? mapping.microsoftTaskId : null;

  const write = async (microsoftTaskId: string | null, allowCreate: boolean): Promise<{ id: string } | { held: OutboundJob } | { absent: true }> => {
    if (!microsoftTaskId) {
      const found = await lookupTask(runtime, latest, list.listId, task.id, token);
      token = found.token;
      if (found.rate) {
        return { held: requeue(job, now, "Microsoft To Do lookup did not finish", found.rate.retryAfter, found.ambiguous && !found.rate.networkError && found.rate.status !== 429 && found.rate.status < 500 ? "NEEDS_REVIEW" : null) };
      }
      if (found.ambiguous && !found.id) {
        return { held: requeue(job, now, "Microsoft To Do create needs review before retrying", null, "NEEDS_REVIEW") };
      }
      if (found.id) microsoftTaskId = found.id;
      else if (!allowCreate) return { absent: true };
    }
    if (microsoftTaskId) {
      const patched = await callGraph(
        runtime,
        latest,
        { method: "PATCH", path: `/me/todo/lists/${encodeURIComponent(list.listId)}/tasks/${encodeURIComponent(microsoftTaskId)}`, body },
        token,
        false,
      );
      if ("stop" in patched) return { held: { ...job, ...patched.stop, id: job.id, payload: job.payload, dedupeKey: job.dedupeKey, attempt: job.attempt, connectionId: job.connectionId } };
      token = patched.token;
      if (patched.result.status === 404) {
        if (!job.payload.reviewed || !allowCreate) {
          return { held: requeue(job, now, "Mapped Microsoft To Do task was not found", null, "NEEDS_REVIEW") };
        }
        return write(null, true);
      }
      if (patched.result.status === 429 || patched.result.networkError || patched.result.status >= 500) {
        return { held: requeue(job, now, "Microsoft To Do update did not finish", patched.result.retryAfter, null) };
      }
      if (patched.result.status === 403) return { held: requeue(job, now, "Microsoft To Do permission is missing", null, "FAILED") };
      if (patched.result.status !== 200) return { held: requeue(job, now, "Microsoft To Do update was rejected", null, patched.result.status === 409 ? "NEEDS_REVIEW" : null) };
      return { id: microsoftTaskId };
    }
    const created = await callGraph(
      runtime,
      latest,
      { method: "POST", path: `/me/todo/lists/${encodeURIComponent(list.listId)}/tasks`, body },
      token,
      false,
    );
    if ("stop" in created) return { held: { ...job, ...patchedStop(created.stop, job) } };
    token = created.token;
    if (created.result.networkError || created.result.status >= 500 || created.result.status === 409) {
      const again = await lookupTask(runtime, latest, list.listId, task.id, token);
      token = again.token;
      if (again.id) return { id: again.id };
      const duplicatePossible = again.ambiguous || created.result.status === 409;
      return {
        held: requeue(
          job,
          now,
          duplicatePossible ? "Microsoft To Do create needs review before retrying" : "Microsoft To Do could not be reached",
          created.result.retryAfter,
          duplicatePossible ? "NEEDS_REVIEW" : null,
        ),
      };
    }
    if (created.result.status === 404) {
      await runtime.store.saveConnection({ ...latest, todoListId: null });
      return { held: requeue(job, now, "Microsoft To Do list was not found", null, null) };
    }
    if (created.result.status === 429) return { held: requeue(job, now, "Microsoft rate limited To Do sync", created.result.retryAfter, null) };
    if (created.result.status === 403) return { held: requeue(job, now, "Microsoft To Do permission is missing", null, "FAILED") };
    const id = asRecord(created.result.json)?.["id"];
    if (created.result.status !== 201 || typeof id !== "string") {
      return { held: requeue(job, now, "Microsoft To Do create was rejected", null, null) };
    }
    return { id };
  };

  const written = await write(mode === "sync" && !active ? null : existingId, mode === "sync");
  if ("absent" in written) {
    await finish({ ...job, status: "SUCCEEDED", leaseOwner: null, leaseUntil: null, lastError: null, updatedAt: now });
    return;
  }
  if ("held" in written) {
    await finish(written.held);
    if (written.held.status === "NEEDS_REVIEW" || written.held.status === "FAILED") {
      await runtime.store.appendEvent({
        userId: connection.userId,
        connectionId: connection.id,
        kind: written.held.status === "NEEDS_REVIEW" ? "TODO_NEEDS_REVIEW" : "TODO_FAILED",
        message: written.held.lastError ?? "Microsoft To Do sync needs attention",
        createdAt: now,
      });
      if (mapping) {
        await runtime.store.saveMapping({
          ...mapping,
          syncStatus: written.held.status === "NEEDS_REVIEW" ? "CONFLICT" : "FAILED",
          lastError: written.held.lastError,
        });
      }
    }
    return;
  }
  const saved = mappingFrom(latest, task.id, list.listId, written.id, now, mapping?.id ?? runtime.newId());
  if (mode !== "sync") {
    saved.syncStatus = "TOMBSTONED";
    saved.deletedAt = now;
  }
  try {
    await runtime.store.saveMapping(saved);
  } catch {
    await finish(requeue(job, now, "Microsoft To Do task was saved remotely but the CRM mapping could not be stored", null, null));
    return;
  }
  if (mode === "sync") {
    await callGraph(
      runtime,
      latest,
      {
        method: "POST",
        path: `/me/todo/lists/${encodeURIComponent(list.listId)}/tasks/${encodeURIComponent(written.id)}/linkedResources`,
        body: {
          applicationName: "Automotive Brands CRM",
          displayName: "CRM task",
          externalId: crmTaskReference(task.id),
        },
      },
      token,
      false,
    ).catch(() => undefined);
  }
  await runtime.store.saveConnection({ ...latest, todoListId: list.listId, lastTaskSyncAt: now, lastError: null });
  await finish({ ...job, status: "SUCCEEDED", leaseOwner: null, leaseUntil: null, lastError: null, updatedAt: now });
}

function patchedStop(stop: OutboundJob, job: OutboundJob): OutboundJob {
  return { ...stop, id: job.id, payload: job.payload, dedupeKey: job.dedupeKey, attempt: job.attempt, connectionId: job.connectionId, userId: job.userId, kind: job.kind, createdAt: job.createdAt };
}

export async function runOutboundBatch(runtime: OutboundRuntime, owner: string, limit = 5): Promise<{ processed: number; graphCalls: boolean }> {
  if (!runtime.graphAllowed()) return { processed: 0, graphCalls: false };
  const jobs = await runtime.store.claimJobs(runtime.now(), owner, limit, 120_000);
  let processed = 0;
  for (const job of jobs) {
    if (!runtime.graphAllowed()) {
      await runtime.store.saveJob({ ...job, status: "QUEUED", leaseOwner: null, leaseUntil: null, updatedAt: runtime.now() });
      break;
    }
    try {
      await processOutboundJob(job, runtime);
    } catch (error) {
      await runtime.store.saveJob(requeue(job, runtime.now(), safe(error), null, null));
    }
    processed += 1;
  }
  return { processed, graphCalls: processed > 0 };
}

export function outboundDedupeKey(userId: string, taskId: string, release: boolean): string {
  return `todo:${userId}:${taskId}:${release ? "release" : "upsert"}`;
}
