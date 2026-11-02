/**
 * Microsoft To Do → CRM inbound worker.
 * Applies only mapped tasks from the dedicated Automotive Brands CRM list.
 * Baseline rounds never mutate CRM task data.
 */
import {
  absorbDeltaPage,
  assertTodoDeltaGraphUrl,
  coalesceDeltaItems,
  inboundCursorResource,
  inboundGraphAllowed,
  inboundRetryDelayMs,
  mapMicrosoftStatusToCrm,
  microsoftFieldsToSnapshot,
  planInboundFieldUpdates,
  snapshotFromCrmTask,
  snapshotsEqual,
  type InboundSyncedSnapshot,
  type MicrosoftTodoInboundFields,
  MICROSOFT_TODO_INBOUND_JOB_KIND,
  MICROSOFT_TODO_INBOUND_MAX_ATTEMPTS,
  MICROSOFT_TODO_INBOUND_PAGE_SIZE,
} from "@/domain/microsoft-todo-inbound";
import { hasTasksReadWrite } from "@/domain/microsoft-todo-outbound";
import { withOutboundSuppressed } from "@/server/microsoft-365/outbound-suppress";

export type InboundJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "NEEDS_REVIEW";

export type InboundJobPayload = {
  listId?: string;
  /** Coalesced delta items awaiting apply before the delta cursor advances. */
  staged?: MicrosoftTodoInboundFields[];
  /** Microsoft task ids already applied in this round; skipped on resume for idempotency. */
  appliedIds?: string[];
  nextLink?: string | null;
  pendingDeltaLink?: string | null;
  baseline?: boolean;
  forceCheck?: boolean;
};

export type InboundJob = {
  id: string;
  connectionId: string;
  userId: string;
  kind: typeof MICROSOFT_TODO_INBOUND_JOB_KIND;
  status: InboundJobStatus;
  attempt: number;
  runAfter: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  lastError: string | null;
  dedupeKey: string;
  payload: InboundJobPayload;
  createdAt: Date;
  updatedAt: Date;
};

export type InboundConnection = {
  id: string;
  userId: string;
  status: "CONNECTED" | "REVOKED" | "ERROR";
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
};

export type InboundMapping = {
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
  syncedSnapshot: InboundSyncedSnapshot | null;
  priorCrmStatus: string | null;
  syncStatus: "PENDING" | "SYNCED" | "FAILED" | "CONFLICT" | "SKIPPED" | "TOMBSTONED" | "REMOVED";
  lastError: string | null;
  lastSyncedAt: Date | null;
  deletedAt: Date | null;
};

export type InboundCrmTask = {
  id: string;
  assigneeId: string | null;
  title: string;
  description: string | null;
  status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "LOW" | "NORMAL" | "HIGH";
  dueAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  companyId: string | null;
  createdById: string | null;
};

export type InboundGraphResult = {
  status: number;
  json: unknown;
  retryAfter: string | null;
  networkError?: boolean;
};

export type InboundGraph = {
  request: (input: {
    method: "GET";
    path: string;
    token: string;
  }) => Promise<InboundGraphResult>;
};

export type InboundToken =
  | { ok: true; accessToken: string }
  | { ok: false; code: "TOKEN" | "REVOKED" | "RATE_LIMITED"; retryAfter: string | null; message: string };

export type InboundStore = {
  findConnection: (userId: string) => Promise<InboundConnection | null>;
  saveConnection: (row: InboundConnection) => Promise<void>;
  claimInboundJobs: (limit: number, owner: string, now: Date) => Promise<InboundJob[]>;
  saveJob: (job: InboundJob, opts?: { requireLeaseOwner?: string }) => Promise<boolean>;
  findMappingByMicrosoftTaskId: (
    connectionId: string,
    microsoftTaskId: string,
  ) => Promise<InboundMapping | null>;
  findMappingsForList: (connectionId: string, listId: string) => Promise<InboundMapping[]>;
  saveMapping: (row: InboundMapping) => Promise<void>;
  findTask: (taskId: string) => Promise<InboundCrmTask | null>;
  updateTaskFields: (
    taskId: string,
    data: {
      title?: string;
      description?: string | null;
      status?: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
      priority?: "LOW" | "NORMAL" | "HIGH";
      dueAt?: Date | null;
      completedAt?: Date | null;
      expectedUpdatedAt: Date;
    },
  ) => Promise<{ ok: true; task: InboundCrmTask } | { ok: false; reason: "revision" | "missing" }>;
  getCursor: (connectionId: string, resource: string) => Promise<string | null>;
  /** Persist only after the round's staged changes were applied. */
  saveCursor: (connectionId: string, resource: string, deltaLink: string | null) => Promise<void>;
  clearCursor: (connectionId: string, resource: string) => Promise<void>;
  /**
   * Atomically commit the deltaLink, refresh inbound timestamps, and mark the job SUCCEEDED.
   * Prevents advancing the cursor without durable completion, and vice versa.
   */
  finalizeInboundRound: (input: {
    job: InboundJob;
    requireLeaseOwner: string;
    connection: InboundConnection;
    resource: string;
    deltaLink: string;
    now: Date;
  }) => Promise<boolean>;
  appendEvent: (input: {
    userId: string;
    connectionId: string;
    kind: string;
    message: string;
    metadata?: Record<string, unknown>;
    createdAt: Date;
  }) => Promise<void>;
  hasRunningOutboundForTask: (userId: string, taskId: string) => Promise<boolean>;
  withTaskLock: <T>(taskId: string, fn: () => Promise<T>) => Promise<T>;
};

export type InboundRuntime = {
  now: () => Date;
  graphAllowed: () => boolean;
  store: InboundStore;
  graph: InboundGraph;
  tokenFor: (connection: InboundConnection) => Promise<InboundToken>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseMicrosoftTodoDeltaItem(raw: unknown): MicrosoftTodoInboundFields | null {
  const row = asRecord(raw);
  if (!row) return null;
  const removed = row["@removed"] != null;
  const id = typeof row["id"] === "string" ? row["id"] : null;
  if (!id) return null;
  const body = asRecord(row["body"]);
  const due = asRecord(row["dueDateTime"]);
  const completed = asRecord(row["completedDateTime"]);
  const status = typeof row["status"] === "string" ? row["status"] : null;
  const importance = typeof row["importance"] === "string" ? row["importance"] : null;
  return {
    id,
    etag: typeof row["@odata.etag"] === "string" ? row["@odata.etag"] : typeof row["etag"] === "string" ? row["etag"] : null,
    title: typeof row["title"] === "string" ? row["title"] : null,
    bodyContent: typeof body?.["content"] === "string" ? body["content"] : null,
    status:
      status === "notStarted" ||
      status === "inProgress" ||
      status === "completed" ||
      status === "waitingOnOthers" ||
      status === "deferred"
        ? status
        : null,
    importance: importance === "low" || importance === "normal" || importance === "high" ? importance : null,
    dueDateTime:
      due && typeof due["dateTime"] === "string" && typeof due["timeZone"] === "string"
        ? { dateTime: due["dateTime"], timeZone: due["timeZone"] }
        : null,
    completedDateTime:
      completed && typeof completed["dateTime"] === "string" && typeof completed["timeZone"] === "string"
        ? { dateTime: completed["dateTime"], timeZone: completed["timeZone"] }
        : null,
    lastModifiedDateTime: typeof row["lastModifiedDateTime"] === "string" ? row["lastModifiedDateTime"] : null,
    removed,
  };
}

function requeue(job: InboundJob, now: Date, message: string, retryAfter: string | null, status: InboundJobStatus | null): InboundJob {
  const attempt = job.attempt + (status === "QUEUED" || status == null ? 1 : 0);
  const failed = attempt >= MICROSOFT_TODO_INBOUND_MAX_ATTEMPTS && (status === "QUEUED" || status == null);
  return {
    ...job,
    status: failed ? "FAILED" : status ?? "QUEUED",
    attempt: failed ? attempt : status === "QUEUED" || status == null ? attempt : job.attempt,
    runAfter: new Date(now.getTime() + inboundRetryDelayMs(job.attempt, retryAfter, now)),
    leaseOwner: null,
    leaseUntil: null,
    lastError: message,
    updatedAt: now,
  };
}

async function fetchDeltaPage(
  runtime: InboundRuntime,
  connection: InboundConnection,
  listId: string,
  pathOrUrl: string,
  token: string,
): Promise<
  | { ok: true; items: MicrosoftTodoInboundFields[]; nextLink: string | null; deltaLink: string | null; token: string }
  | { ok: false; hold: InboundJob; token: string }
> {
  let safe: string;
  try {
    safe = assertTodoDeltaGraphUrl(pathOrUrl, listId);
  } catch {
    return {
      ok: false,
      hold: {
        id: "invalid",
        connectionId: connection.id,
        userId: connection.userId,
        kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
        status: "FAILED",
        attempt: 0,
        runAfter: runtime.now(),
        leaseOwner: null,
        leaseUntil: null,
        lastError: "Microsoft To Do delta URL was rejected",
        dedupeKey: "",
        payload: {},
        createdAt: runtime.now(),
        updatedAt: runtime.now(),
      },
      token,
    };
  }
  const result = await runtime.graph.request({ method: "GET", path: safe, token });
  if (result.status === 401) {
    const refreshed = await runtime.tokenFor(connection);
    if (!refreshed.ok) {
      return {
        ok: false,
        hold: {
          id: "token",
          connectionId: connection.id,
          userId: connection.userId,
          kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
          status: refreshed.code === "REVOKED" ? "CANCELLED" : "QUEUED",
          attempt: 0,
          runAfter: runtime.now(),
          leaseOwner: null,
          leaseUntil: null,
          lastError: refreshed.message,
          dedupeKey: "",
          payload: {},
          createdAt: runtime.now(),
          updatedAt: runtime.now(),
        },
        token,
      };
    }
    token = refreshed.accessToken;
    const again = await runtime.graph.request({ method: "GET", path: safe, token });
    return parseDeltaResponse(runtime, connection, listId, again, token);
  }
  return parseDeltaResponse(runtime, connection, listId, result, token);
}

function parseDeltaResponse(
  runtime: InboundRuntime,
  connection: InboundConnection,
  listId: string,
  result: InboundGraphResult,
  token: string,
):
  | { ok: true; items: MicrosoftTodoInboundFields[]; nextLink: string | null; deltaLink: string | null; token: string }
  | { ok: false; hold: InboundJob; token: string } {
  const now = runtime.now();
  if (result.networkError || result.status >= 500) {
    return {
      ok: false,
      hold: {
        id: "tmp",
        connectionId: connection.id,
        userId: connection.userId,
        kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
        status: "QUEUED",
        attempt: 0,
        runAfter: now,
        leaseOwner: null,
        leaseUntil: null,
        lastError: "Microsoft To Do delta request did not finish",
        dedupeKey: "",
        payload: {},
        createdAt: now,
        updatedAt: now,
      },
      token,
    };
  }
  if (result.status === 429) {
    return {
      ok: false,
      hold: {
        id: "tmp",
        connectionId: connection.id,
        userId: connection.userId,
        kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
        status: "QUEUED",
        attempt: 0,
        runAfter: now,
        leaseOwner: null,
        leaseUntil: null,
        lastError: "Microsoft rate limited To Do inbound sync",
        dedupeKey: "",
        payload: {},
        createdAt: now,
        updatedAt: now,
      },
      token,
    };
  }
  if (result.status === 410 || result.status === 404) {
    return {
      ok: false,
      hold: {
        id: "tmp",
        connectionId: connection.id,
        userId: connection.userId,
        kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
        status: "QUEUED",
        attempt: 0,
        runAfter: now,
        leaseOwner: null,
        leaseUntil: null,
        lastError: result.status === 410 ? "Microsoft To Do delta cursor expired" : "Microsoft To Do list was not found",
        dedupeKey: "",
        payload: { resetCursor: true } as InboundJobPayload,
        createdAt: now,
        updatedAt: now,
      },
      token,
    };
  }
  if (result.status === 403) {
    return {
      ok: false,
      hold: {
        id: "tmp",
        connectionId: connection.id,
        userId: connection.userId,
        kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
        status: "FAILED",
        attempt: 0,
        runAfter: now,
        leaseOwner: null,
        leaseUntil: null,
        lastError: "Microsoft To Do permission is missing",
        dedupeKey: "",
        payload: {},
        createdAt: now,
        updatedAt: now,
      },
      token,
    };
  }
  if (result.status !== 200) {
    return {
      ok: false,
      hold: {
        id: "tmp",
        connectionId: connection.id,
        userId: connection.userId,
        kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
        status: "QUEUED",
        attempt: 0,
        runAfter: now,
        leaseOwner: null,
        leaseUntil: null,
        lastError: "Microsoft To Do delta response was rejected",
        dedupeKey: "",
        payload: {},
        createdAt: now,
        updatedAt: now,
      },
      token,
    };
  }
  const body = asRecord(result.json);
  const value = Array.isArray(body?.["value"]) ? body["value"] : [];
  const items = value.map(parseMicrosoftTodoDeltaItem).filter((item): item is MicrosoftTodoInboundFields => Boolean(item));
  const nextLink = typeof body?.["@odata.nextLink"] === "string" ? body["@odata.nextLink"] : null;
  const deltaLink = typeof body?.["@odata.deltaLink"] === "string" ? body["@odata.deltaLink"] : null;
  if (nextLink) {
    try {
      assertTodoDeltaGraphUrl(nextLink, listId);
    } catch {
      return {
        ok: false,
        hold: {
          id: "tmp",
          connectionId: connection.id,
          userId: connection.userId,
          kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
          status: "FAILED",
          attempt: 0,
          runAfter: now,
          leaseOwner: null,
          leaseUntil: null,
          lastError: "Microsoft To Do nextLink was rejected",
          dedupeKey: "",
          payload: {},
          createdAt: now,
          updatedAt: now,
        },
        token,
      };
    }
  }
  if (deltaLink) {
    try {
      assertTodoDeltaGraphUrl(deltaLink, listId);
    } catch {
      return {
        ok: false,
        hold: {
          id: "tmp",
          connectionId: connection.id,
          userId: connection.userId,
          kind: MICROSOFT_TODO_INBOUND_JOB_KIND,
          status: "FAILED",
          attempt: 0,
          runAfter: now,
          leaseOwner: null,
          leaseUntil: null,
          lastError: "Microsoft To Do deltaLink was rejected",
          dedupeKey: "",
          payload: {},
          createdAt: now,
          updatedAt: now,
        },
        token,
      };
    }
  }
  return { ok: true, items, nextLink, deltaLink, token };
}

async function applyMappedChange(
  runtime: InboundRuntime,
  connection: InboundConnection,
  item: MicrosoftTodoInboundFields,
  baseline: boolean,
): Promise<"applied" | "ignored" | "conflict" | "deferred" | "removed"> {
  const mapping = await runtime.store.findMappingByMicrosoftTaskId(connection.id, item.id);
  if (!mapping || mapping.deletedAt || mapping.syncStatus === "TOMBSTONED") {
    if (!mapping) {
      await runtime.store.appendEvent({
        userId: connection.userId,
        connectionId: connection.id,
        kind: "TODO_INBOUND_UNKNOWN",
        message: "Ignored Microsoft To Do task without a CRM mapping",
        metadata: { microsoftTaskId: item.id },
        createdAt: runtime.now(),
      });
    }
    return "ignored";
  }
  if (mapping.connectionId !== connection.id || mapping.userId !== connection.userId || mapping.listId !== connection.todoListId) {
    await runtime.store.appendEvent({
      userId: connection.userId,
      connectionId: connection.id,
      kind: "TODO_INBOUND_REJECTED",
      message: "Rejected Microsoft task that did not belong to this connection or list",
      metadata: { microsoftTaskId: item.id, mappingId: mapping.id },
      createdAt: runtime.now(),
    });
    return "ignored";
  }
  if (!mapping.taskId) {
    return "ignored";
  }

  if (item.removed) {
    await runtime.store.saveMapping({
      ...mapping,
      syncStatus: "REMOVED",
      deletedAt: runtime.now(),
      lastError: "Microsoft To Do task was deleted or moved out of the dedicated list",
      remoteEtag: item.etag,
    });
    await runtime.store.appendEvent({
      userId: connection.userId,
      connectionId: connection.id,
      kind: "TODO_INBOUND_REMOVED",
      message: "Mapped Microsoft To Do task is missing from the dedicated list",
      metadata: { taskId: mapping.taskId, microsoftTaskId: item.id },
      createdAt: runtime.now(),
    });
    return "removed";
  }

  const task = await runtime.store.findTask(mapping.taskId);
  if (!task) {
    await runtime.store.saveMapping({
      ...mapping,
      syncStatus: "CONFLICT",
      lastError: "CRM task no longer exists for this Microsoft mapping",
    });
    return "conflict";
  }
  if (task.assigneeId !== connection.userId) {
    await runtime.store.saveMapping({
      ...mapping,
      syncStatus: "CONFLICT",
      lastError: "CRM task was reassigned; inbound sync stopped for the previous assignee",
    });
    return "conflict";
  }

  if (await runtime.store.hasRunningOutboundForTask(connection.userId, task.id)) {
    return "deferred";
  }

  const crmSnapshot = snapshotFromCrmTask(task);
  const microsoftSnapshot = microsoftFieldsToSnapshot(item, crmSnapshot);

  if (baseline) {
    const differs = !snapshotsEqual(crmSnapshot, microsoftSnapshot);
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      lastCrmRevision: task.updatedAt.toISOString(),
      syncedSnapshot: crmSnapshot,
      syncStatus: differs ? "CONFLICT" : "SYNCED",
      lastError: differs ? "Baseline difference between CRM and Microsoft; CRM was not changed" : null,
      lastSyncedAt: runtime.now(),
      deletedAt: null,
    });
    if (differs) {
      await runtime.store.appendEvent({
        userId: connection.userId,
        connectionId: connection.id,
        kind: "TODO_INBOUND_BASELINE_DIFF",
        message: "Baseline found a difference; CRM data was left unchanged",
        metadata: { taskId: task.id, microsoftTaskId: item.id },
        createdAt: runtime.now(),
      });
      return "conflict";
    }
    return "ignored";
  }

  if (mapping.remoteEtag && item.etag && mapping.remoteEtag === item.etag && snapshotsEqual(mapping.syncedSnapshot, microsoftSnapshot)) {
    return "ignored";
  }
  if (mapping.syncedSnapshot && snapshotsEqual(mapping.syncedSnapshot, microsoftSnapshot)) {
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      lastSyncedAt: runtime.now(),
      syncStatus: "SYNCED",
      lastError: null,
      deletedAt: null,
    });
    return "ignored";
  }

  const statusDecision = mapMicrosoftStatusToCrm({
    microsoftStatus: item.status,
    crmStatus: task.status,
    priorCrmStatus: mapping.priorCrmStatus,
  });
  if ("skip" in statusDecision) {
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      syncStatus: "CONFLICT",
      lastError: statusDecision.conflict,
    });
    return "conflict";
  }

  const plannedMicrosoft: InboundSyncedSnapshot = {
    ...microsoftSnapshot,
    status: statusDecision.status,
    completedAt:
      statusDecision.status === "DONE"
        ? microsoftSnapshot.completedAt ?? new Date().toISOString()
        : null,
  };

  const plan = planInboundFieldUpdates({
    crm: crmSnapshot,
    microsoft: plannedMicrosoft,
    lastSynced: mapping.syncedSnapshot,
    crmRevisionChanged: Boolean(mapping.lastCrmRevision && mapping.lastCrmRevision !== task.updatedAt.toISOString()),
  });

  if (plan.skipAll) {
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      syncStatus: "CONFLICT",
      lastError: plan.conflicts.join("; ") || "CRM policy blocked the Microsoft change",
    });
    return "conflict";
  }

  if (Object.keys(plan.apply).length === 0) {
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      lastCrmRevision: task.updatedAt.toISOString(),
      syncedSnapshot: crmSnapshot,
      syncStatus: plan.conflicts.length ? "CONFLICT" : "SYNCED",
      lastError: plan.conflicts[0] ?? null,
      lastSyncedAt: runtime.now(),
      deletedAt: null,
    });
    return plan.conflicts.length ? "conflict" : "ignored";
  }

  return runtime.store.withTaskLock(task.id, async () => {
    if (await runtime.store.hasRunningOutboundForTask(connection.userId, task.id)) {
      return "deferred";
    }
    const priorStatus = task.status;
    const data = {
      expectedUpdatedAt: task.updatedAt,
      ...(plan.apply.title !== undefined ? { title: plan.apply.title } : {}),
      ...(plan.apply.description !== undefined ? { description: plan.apply.description } : {}),
      ...(plan.apply.status !== undefined ? { status: plan.apply.status } : {}),
      ...(plan.apply.priority !== undefined ? { priority: plan.apply.priority } : {}),
      ...(plan.apply.dueAt !== undefined
        ? { dueAt: plan.apply.dueAt ? new Date(plan.apply.dueAt) : null }
        : {}),
      ...(plan.apply.completedAt !== undefined
        ? { completedAt: plan.apply.completedAt ? new Date(plan.apply.completedAt) : null }
        : {}),
    };
    const updated = await withOutboundSuppressed(() => runtime.store.updateTaskFields(task.id, data));
    if (!updated.ok) {
      await runtime.store.saveMapping({
        ...mapping,
        syncStatus: "CONFLICT",
        lastError:
          updated.reason === "revision"
            ? "CRM task changed during inbound apply; Microsoft change was not written"
            : "CRM task was missing during inbound apply",
      });
      return "conflict";
    }
    const nextSnapshot = snapshotFromCrmTask(updated.task);
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      lastCrmRevision: updated.task.updatedAt.toISOString(),
      syncedSnapshot: nextSnapshot,
      priorCrmStatus: plan.apply.status === "DONE" ? priorStatus : mapping.priorCrmStatus,
      syncStatus: plan.conflicts.length ? "CONFLICT" : "SYNCED",
      lastError: plan.conflicts[0] ?? null,
      lastSyncedAt: runtime.now(),
      deletedAt: null,
    });
    await runtime.store.appendEvent({
      userId: connection.userId,
      connectionId: connection.id,
      kind: "TODO_INBOUND_APPLIED",
      message: plan.conflicts.length
        ? "Applied safe Microsoft fields and recorded field conflicts"
        : "Applied Microsoft To Do changes to CRM",
      metadata: {
        taskId: task.id,
        microsoftTaskId: item.id,
        fields: Object.keys(plan.apply),
        conflicts: plan.conflicts,
      },
      createdAt: runtime.now(),
    });
    return plan.conflicts.length ? "conflict" : "applied";
  });
}

function connectionStillEligible(
  expected: InboundConnection,
  live: InboundConnection | null,
): live is InboundConnection {
  return Boolean(
    live &&
      live.id === expected.id &&
      live.status === "CONNECTED" &&
      live.taskSyncEnabled &&
      live.todoListId === expected.todoListId &&
      hasTasksReadWrite(live.scopes),
  );
}

async function resetExpiredDelta(
  runtime: InboundRuntime,
  connection: InboundConnection,
  resource: string,
  clearList: boolean,
): Promise<void> {
  await runtime.store.clearCursor(connection.id, resource);
  const live = (await runtime.store.findConnection(connection.userId)) ?? connection;
  await runtime.store.saveConnection({
    ...live,
    inboundBaselineAt: null,
    todoListId: clearList ? null : live.todoListId,
  });
}

export async function processInboundJob(job: InboundJob, runtime: InboundRuntime): Promise<void> {
  const now = runtime.now();
  const leaseOwner = job.leaseOwner;
  const finish = async (next: InboundJob) => {
    await runtime.store.saveJob(next, leaseOwner ? { requireLeaseOwner: leaseOwner } : undefined);
  };
  if (!runtime.graphAllowed()) {
    await finish({ ...job, status: "QUEUED", leaseOwner: null, leaseUntil: null, updatedAt: now });
    return;
  }
  let connection = await runtime.store.findConnection(job.userId);
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
    return;
  }
  const listId = connection.todoListId;
  if (!listId) {
    await finish(requeue(job, now, "Microsoft To Do list is not ready", null, "QUEUED"));
    return;
  }
  if (job.payload.listId && job.payload.listId !== listId) {
    await finish(
      requeue(job, now, "Microsoft To Do list changed during inbound sync", null, "CANCELLED"),
    );
    return;
  }

  const tokenResult = await runtime.tokenFor(connection);
  if (!tokenResult.ok) {
    await finish(requeue(job, now, tokenResult.message, tokenResult.retryAfter, tokenResult.code === "REVOKED" ? "CANCELLED" : null));
    return;
  }

  const resource = inboundCursorResource(listId);
  const baseline = !connection.inboundBaselineAt || job.payload.baseline === true;
  let token = tokenResult.accessToken;
  let staged = coalesceDeltaItems(job.payload.staged ?? []);
  let appliedIds = [...(job.payload.appliedIds ?? [])];
  let nextLink = job.payload.nextLink ?? null;
  let pendingDeltaLink = job.payload.pendingDeltaLink ?? null;

  const persistProgress = async (extra?: Partial<InboundJob>) => {
    await finish({
      ...job,
      status: "RUNNING",
      leaseOwner,
      updatedAt: runtime.now(),
      ...extra,
      payload: {
        listId,
        staged,
        appliedIds,
        nextLink,
        pendingDeltaLink,
        baseline,
      },
    });
  };

  const handleDeltaFailure = async (hold: InboundJob) => {
    const expired = hold.lastError?.includes("delta cursor expired") || hold.lastError?.includes("list was not found");
    if (expired) {
      await resetExpiredDelta(runtime, connection!, resource, Boolean(hold.lastError?.includes("list was not found")));
      await finish({
        ...requeue(job, runtime.now(), hold.lastError ?? "Microsoft To Do delta failed", null, "QUEUED"),
        payload: { listId, baseline: true },
      });
      return;
    }
    await finish({
      ...requeue(job, runtime.now(), hold.lastError ?? "Microsoft To Do delta failed", null, hold.status === "FAILED" ? "FAILED" : "QUEUED"),
      payload: { listId, staged, appliedIds, nextLink, pendingDeltaLink, baseline },
    });
  };

  if (staged.length === 0 && !nextLink && !pendingDeltaLink) {
    const existing = await runtime.store.getCursor(connection.id, resource);
    const start =
      existing && !baseline
        ? existing
        : `/me/todo/lists/${encodeURIComponent(listId)}/tasks/delta?$top=${MICROSOFT_TODO_INBOUND_PAGE_SIZE}`;
    const page = await fetchDeltaPage(runtime, connection, listId, start, token);
    if (!page.ok) {
      await handleDeltaFailure(page.hold);
      return;
    }
    token = page.token;
    staged = absorbDeltaPage(staged, page.items);
    nextLink = page.nextLink;
    pendingDeltaLink = page.deltaLink;
    await persistProgress();
  }

  while (nextLink) {
    const live = await runtime.store.findConnection(job.userId);
    if (!connectionStillEligible(connection, live)) {
      await finish(requeue(job, runtime.now(), "Microsoft connection changed during inbound sync", null, "CANCELLED"));
      return;
    }
    connection = live;
    const page = await fetchDeltaPage(runtime, connection, listId, nextLink, token);
    if (!page.ok) {
      await handleDeltaFailure(page.hold);
      return;
    }
    token = page.token;
    staged = absorbDeltaPage(staged, page.items);
    nextLink = page.nextLink;
    if (page.deltaLink) pendingDeltaLink = page.deltaLink;
    await persistProgress();
  }

  staged = coalesceDeltaItems(staged);
  const appliedSet = new Set(appliedIds);
  let deferred = false;
  let applied = 0;
  let conflicts = 0;
  for (const item of staged) {
    if (appliedSet.has(item.id)) continue;
    const live = await runtime.store.findConnection(job.userId);
    if (!connectionStillEligible(connection, live)) {
      await finish({
        ...requeue(job, runtime.now(), "Microsoft connection changed during inbound sync", null, "CANCELLED"),
        payload: { listId, staged, appliedIds, nextLink: null, pendingDeltaLink, baseline },
      });
      return;
    }
    connection = live;
    if (!runtime.graphAllowed()) {
      await finish({
        ...job,
        status: "QUEUED",
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: runtime.now(),
        payload: { listId, staged, appliedIds, nextLink: null, pendingDeltaLink, baseline },
      });
      return;
    }
    const result = await applyMappedChange(runtime, connection, item, baseline);
    if (result === "deferred") {
      deferred = true;
      continue;
    }
    appliedIds = [...appliedIds, item.id];
    appliedSet.add(item.id);
    if (result === "applied") applied += 1;
    if (result === "conflict" || result === "removed") conflicts += 1;
    await persistProgress();
  }

  if (deferred) {
    await finish({
      ...job,
      status: "QUEUED",
      attempt: job.attempt,
      runAfter: new Date(runtime.now().getTime() + 15_000),
      leaseOwner: null,
      leaseUntil: null,
      lastError: "Waiting for outbound Microsoft sync on the same task to finish",
      updatedAt: runtime.now(),
      payload: {
        listId,
        // Keep the full coalesced stage; appliedIds makes resume idempotent.
        staged,
        appliedIds,
        nextLink: null,
        pendingDeltaLink,
        baseline,
      },
    });
    return;
  }

  if (!pendingDeltaLink) {
    await finish(requeue(job, now, "Microsoft To Do delta round finished without a deltaLink", null, "NEEDS_REVIEW"));
    return;
  }

  const latest = await runtime.store.findConnection(job.userId);
  if (!connectionStillEligible(connection, latest)) {
    await finish({
      ...requeue(job, runtime.now(), "Microsoft connection changed before inbound cursor commit", null, "CANCELLED"),
      payload: { listId, staged, appliedIds, nextLink: null, pendingDeltaLink, baseline },
    });
    return;
  }

  if (!leaseOwner) {
    await finish(requeue(job, runtime.now(), "Inbound lease was missing at cursor commit", null, "QUEUED"));
    return;
  }

  const finalized = await runtime.store.finalizeInboundRound({
    job: {
      ...job,
      status: "SUCCEEDED",
      attempt: job.attempt,
      runAfter: runtime.now(),
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      updatedAt: runtime.now(),
      payload: { listId, baseline: false },
    },
    requireLeaseOwner: leaseOwner,
    connection: {
      ...latest,
      lastInboundSyncAt: runtime.now(),
      inboundBaselineAt: latest.inboundBaselineAt ?? runtime.now(),
      taskInboundEnabledAt: latest.taskInboundEnabledAt ?? runtime.now(),
      lastError: null,
    },
    resource,
    deltaLink: pendingDeltaLink,
    now: runtime.now(),
  });
  if (!finalized) {
    // Lease lost — another worker owns the job. Do not advance cursor from this worker.
    return;
  }
  await runtime.store.appendEvent({
    userId: latest.userId,
    connectionId: latest.id,
    kind: baseline ? "TODO_INBOUND_BASELINE" : "TODO_INBOUND_SYNCED",
    message: baseline
      ? `Inbound baseline stored ${staged.length} Microsoft changes without applying historical CRM edits`
      : `Inbound sync applied ${applied} change(s) with ${conflicts} conflict(s)`,
    metadata: { applied, conflicts, staged: staged.length, baseline },
    createdAt: runtime.now(),
  });
}

export async function runInboundBatch(
  runtime: InboundRuntime,
  options?: { limit?: number; owner?: string },
): Promise<{ processed: number; graphCalls: boolean }> {
  if (!runtime.graphAllowed()) return { processed: 0, graphCalls: false };
  const owner = options?.owner ?? `inbound-${Math.random().toString(36).slice(2, 10)}`;
  const jobs = await runtime.store.claimInboundJobs(options?.limit ?? 5, owner, runtime.now());
  let processed = 0;
  for (const job of jobs) {
    try {
      await processInboundJob(job, runtime);
    } catch (error) {
      await runtime.store.saveJob(
        requeue(job, runtime.now(), error instanceof Error ? error.message : "Inbound sync failed", null, null),
        { requireLeaseOwner: owner },
      );
    }
    processed += 1;
  }
  return { processed, graphCalls: processed > 0 };
}

export function inboundDedupeKey(connectionId: string): string {
  return `todo-inbound:${connectionId}`;
}

export function inboundGraphAllowedFromEnv(): boolean {
  return inboundGraphAllowed({
    crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
    inboundFlag: process.env["MICROSOFT_365_TASK_INBOUND_ENABLED"],
  });
}

/** Helpers exported for tests. */
export const inboundTestHooks = {
  absorbDeltaPage,
  coalesceDeltaItems,
  planInboundFieldUpdates,
  snapshotsEqual,
};
