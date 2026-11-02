/**
 * Microsoft Outlook Calendar → CRM inbound worker.
 * Applies only mapped appointments. Never imports personal unrelated events.
 * Baseline rounds store the delta cursor without mutating CRM appointment data.
 * Outside-window mapped events are reconciled with GET /me/events/{id}.
 */
import {
  MICROSOFT_CALENDAR_INBOUND_JOB_KIND,
  MICROSOFT_CALENDAR_MAX_ATTEMPTS,
  assertCalendarGraphUrl,
  calendarGraphAllowed,
  calendarInboundDedupeKey,
  calendarRetryDelayMs,
  calendarViewWindow,
  coalesceCalendarDeltaItems,
  diffCalendarFields,
  graphDateTimeToUtc,
  hasCalendarsReadWrite,
  inboundCursorResource,
  isSafeCalendarResourceId,
  snapshotFromAppointment,
  type CalendarSyncedSnapshot,
  type MicrosoftCalendarInboundFields,
} from "@/domain/microsoft-calendar";
import { attendeesFingerprint, type AppointmentAttendee, type AppointmentStatus } from "@/domain/crm-appointments";
import { withOutboundSuppressed } from "@/server/microsoft-365/outbound-suppress";

export type CalendarInboundJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "NEEDS_REVIEW";

export type CalendarInboundJobPayload = {
  /** Coalesced delta items awaiting apply before the delta cursor advances. */
  staged?: MicrosoftCalendarInboundFields[];
  /** Microsoft event ids already applied in this round; skipped on resume for idempotency. */
  appliedIds?: string[];
  nextLink?: string | null;
  pendingDeltaLink?: string | null;
  baseline?: boolean;
  forceCheck?: boolean;
  /** Outside-window mapping ids still needing GET reconciliation this round. */
  pendingOutsideIds?: string[];
};

export type CalendarInboundJob = {
  id: string;
  connectionId: string;
  userId: string;
  kind: typeof MICROSOFT_CALENDAR_INBOUND_JOB_KIND;
  status: CalendarInboundJobStatus;
  attempt: number;
  runAfter: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  lastError: string | null;
  dedupeKey: string;
  payload: CalendarInboundJobPayload;
  createdAt: Date;
  updatedAt: Date;
};

export type CalendarInboundConnection = {
  id: string;
  userId: string;
  status: "CONNECTED" | "REVOKED" | "ERROR";
  tenantId: string;
  microsoftUserId: string;
  scopes: string;
  calendarSyncEnabled: boolean;
  calendarInboundEnabledAt: Date | null;
  calendarInboundBaselineAt: Date | null;
  lastCalendarInboundSyncAt: Date | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  lastError: string | null;
};

export type CalendarInboundMapping = {
  id: string;
  appointmentId: string | null;
  userId: string;
  connectionId: string;
  microsoftEventId: string;
  immutableEventId: string | null;
  iCalUId: string | null;
  changeKey: string | null;
  remoteEtag: string | null;
  lastCrmRevision: string | null;
  syncedSnapshot: CalendarSyncedSnapshot | null;
  transactionId: string | null;
  outlookWebLink: string | null;
  syncStatus: "PENDING" | "SYNCED" | "FAILED" | "CONFLICT" | "SKIPPED" | "TOMBSTONED" | "REMOVED";
  externalAttendees: boolean;
  lastError: string | null;
  lastSyncedAt: Date | null;
  deletedAt: Date | null;
};

export type CalendarInboundCrmAppointment = {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  location: string | null;
  status: AppointmentStatus;
  timeZone: string;
  attendees: AppointmentAttendee[];
  syncToOutlook: boolean;
  cancelledAt: Date | null;
  updatedAt: Date;
};

export type CalendarInboundGraphResult = {
  status: number;
  json: unknown;
  retryAfter: string | null;
  networkError?: boolean;
};

export type CalendarInboundGraph = {
  request: (input: {
    method: "GET";
    path: string;
    token: string;
  }) => Promise<CalendarInboundGraphResult>;
};

export type CalendarInboundToken =
  | { ok: true; accessToken: string }
  | { ok: false; code: "TOKEN" | "REVOKED" | "RATE_LIMITED"; retryAfter: string | null; message: string };

export type CalendarInboundStore = {
  findConnection: (userId: string) => Promise<CalendarInboundConnection | null>;
  saveConnection: (row: CalendarInboundConnection) => Promise<void>;
  claimInboundJobs: (limit: number, owner: string, now: Date) => Promise<CalendarInboundJob[]>;
  saveJob: (job: CalendarInboundJob, opts?: { requireLeaseOwner?: string }) => Promise<boolean>;
  findMappingByMicrosoftEventId: (
    connectionId: string,
    microsoftEventId: string,
  ) => Promise<CalendarInboundMapping | null>;
  findActiveMappings: (connectionId: string) => Promise<CalendarInboundMapping[]>;
  saveMapping: (row: CalendarInboundMapping) => Promise<void>;
  findAppointment: (appointmentId: string) => Promise<CalendarInboundCrmAppointment | null>;
  updateAppointmentFields: (
    appointmentId: string,
    data: {
      title?: string;
      description?: string | null;
      startAt?: Date;
      endAt?: Date;
      location?: string | null;
      status?: AppointmentStatus;
      cancelledAt?: Date | null;
      expectedUpdatedAt: Date;
    },
  ) => Promise<
    { ok: true; appointment: CalendarInboundCrmAppointment } | { ok: false; reason: "revision" | "missing" }
  >;
  getCursor: (connectionId: string, resource: string) => Promise<string | null>;
  saveCursor: (connectionId: string, resource: string, deltaLink: string | null) => Promise<void>;
  clearCursor: (connectionId: string, resource: string) => Promise<void>;
  finalizeInboundRound: (input: {
    job: CalendarInboundJob;
    requireLeaseOwner: string;
    connection: CalendarInboundConnection;
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
  hasRunningOutboundForAppointment: (userId: string, appointmentId: string) => Promise<boolean>;
  withAppointmentLock: <T>(appointmentId: string, fn: () => Promise<T>) => Promise<T>;
};

export type CalendarInboundRuntime = {
  now: () => Date;
  graphAllowed: () => boolean;
  store: CalendarInboundStore;
  graph: CalendarInboundGraph;
  tokenFor: (connection: CalendarInboundConnection) => Promise<CalendarInboundToken>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function absorbCalendarDeltaPage(
  staged: readonly MicrosoftCalendarInboundFields[],
  pageItems: readonly MicrosoftCalendarInboundFields[],
): MicrosoftCalendarInboundFields[] {
  return coalesceCalendarDeltaItems([...staged, ...pageItems]);
}

function htmlToPlainDescription(html: string | null): string | null {
  if (html == null) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.includes("ab-crm-appointment:") &&
        !/^CRM reference:/i.test(line),
    );
  const joined = lines.join("\n").trim();
  return joined || null;
}

export function parseMicrosoftCalendarDeltaItem(raw: unknown): MicrosoftCalendarInboundFields | null {
  const row = asRecord(raw);
  if (!row) return null;
  const removed = row["@removed"] != null;
  const id = typeof row["id"] === "string" ? row["id"] : null;
  if (!id) return null;
  const body = asRecord(row["body"]);
  const start = asRecord(row["start"]);
  const end = asRecord(row["end"]);
  const location = asRecord(row["location"]);
  return {
    id,
    etag:
      typeof row["@odata.etag"] === "string"
        ? row["@odata.etag"]
        : typeof row["etag"] === "string"
          ? row["etag"]
          : null,
    changeKey: typeof row["changeKey"] === "string" ? row["changeKey"] : null,
    subject: typeof row["subject"] === "string" ? row["subject"] : null,
    bodyContent: typeof body?.["content"] === "string" ? body["content"] : null,
    start:
      start && typeof start["dateTime"] === "string" && typeof start["timeZone"] === "string"
        ? { dateTime: start["dateTime"], timeZone: start["timeZone"] }
        : null,
    end:
      end && typeof end["dateTime"] === "string" && typeof end["timeZone"] === "string"
        ? { dateTime: end["dateTime"], timeZone: end["timeZone"] }
        : null,
    location:
      typeof location?.["displayName"] === "string"
        ? location["displayName"]
        : typeof row["location"] === "string"
          ? row["location"]
          : null,
    isCancelled: typeof row["isCancelled"] === "boolean" ? row["isCancelled"] : null,
    lastModifiedDateTime: typeof row["lastModifiedDateTime"] === "string" ? row["lastModifiedDateTime"] : null,
    removed,
  };
}

function snapshotFromCrmAppointment(appointment: CalendarInboundCrmAppointment): CalendarSyncedSnapshot {
  return snapshotFromAppointment({
    title: appointment.title,
    description: appointment.description,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    location: appointment.location,
    status: appointment.status,
    attendees: appointment.attendees,
  });
}

function microsoftFieldsToSnapshot(
  item: MicrosoftCalendarInboundFields,
  fallback: CalendarSyncedSnapshot,
): CalendarSyncedSnapshot {
  const start = item.start ? graphDateTimeToUtc(item.start.dateTime, item.start.timeZone) : null;
  const end = item.end ? graphDateTimeToUtc(item.end.dateTime, item.end.timeZone) : null;
  const remoteStatus: AppointmentStatus = item.isCancelled ? "CANCELLED" : fallback.status === "CANCELLED" ? "SCHEDULED" : fallback.status;
  return {
    title: item.subject ?? fallback.title,
    description: item.bodyContent != null ? htmlToPlainDescription(item.bodyContent) : fallback.description,
    startAt: start?.toISOString() ?? fallback.startAt,
    endAt: end?.toISOString() ?? fallback.endAt,
    location: item.location ?? fallback.location,
    status: item.isCancelled === true ? "CANCELLED" : item.isCancelled === false ? remoteStatus : fallback.status,
    attendeesFingerprint: fallback.attendeesFingerprint,
  };
}

function snapshotsEqual(a: CalendarSyncedSnapshot | null, b: CalendarSyncedSnapshot | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.startAt === b.startAt &&
    a.endAt === b.endAt &&
    a.location === b.location &&
    a.status === b.status &&
    a.attendeesFingerprint === b.attendeesFingerprint
  );
}

function appointmentInWindow(
  appointment: CalendarInboundCrmAppointment,
  now: Date,
): boolean {
  const window = calendarViewWindow(now);
  const startBound = Date.parse(window.startDateTime);
  const endBound = Date.parse(window.endDateTime);
  return appointment.endAt.getTime() >= startBound && appointment.startAt.getTime() <= endBound;
}

function requeue(
  job: CalendarInboundJob,
  now: Date,
  message: string,
  retryAfter: string | null,
  status: CalendarInboundJobStatus | null,
): CalendarInboundJob {
  const attempt = job.attempt + (status === "QUEUED" || status == null ? 1 : 0);
  const failed = attempt >= MICROSOFT_CALENDAR_MAX_ATTEMPTS && (status === "QUEUED" || status == null);
  return {
    ...job,
    status: failed ? "FAILED" : status ?? "QUEUED",
    attempt: failed ? attempt : status === "QUEUED" || status == null ? attempt : job.attempt,
    runAfter: new Date(now.getTime() + calendarRetryDelayMs(job.attempt, retryAfter, now)),
    leaseOwner: null,
    leaseUntil: null,
    lastError: message,
    updatedAt: now,
  };
}

async function fetchDeltaPage(
  runtime: CalendarInboundRuntime,
  connection: CalendarInboundConnection,
  pathOrUrl: string,
  token: string,
): Promise<
  | {
      ok: true;
      items: MicrosoftCalendarInboundFields[];
      nextLink: string | null;
      deltaLink: string | null;
      token: string;
    }
  | { ok: false; hold: CalendarInboundJob; token: string }
> {
  let safe: string;
  try {
    safe = assertCalendarGraphUrl(pathOrUrl);
  } catch {
    return {
      ok: false,
      hold: holdJob(connection, runtime.now(), "FAILED", "Microsoft Calendar delta URL was rejected"),
      token,
    };
  }
  const result = await runtime.graph.request({ method: "GET", path: safe, token });
  if (result.status === 401) {
    const refreshed = await runtime.tokenFor(connection);
    if (!refreshed.ok) {
      return {
        ok: false,
        hold: holdJob(
          connection,
          runtime.now(),
          refreshed.code === "REVOKED" ? "CANCELLED" : "QUEUED",
          refreshed.message,
        ),
        token,
      };
    }
    token = refreshed.accessToken;
    const again = await runtime.graph.request({ method: "GET", path: safe, token });
    return parseDeltaResponse(runtime, connection, again, token);
  }
  return parseDeltaResponse(runtime, connection, result, token);
}

function holdJob(
  connection: CalendarInboundConnection,
  now: Date,
  status: CalendarInboundJobStatus,
  message: string,
  payload: CalendarInboundJobPayload = {},
): CalendarInboundJob {
  return {
    id: "tmp",
    connectionId: connection.id,
    userId: connection.userId,
    kind: MICROSOFT_CALENDAR_INBOUND_JOB_KIND,
    status,
    attempt: 0,
    runAfter: now,
    leaseOwner: null,
    leaseUntil: null,
    lastError: message,
    dedupeKey: "",
    payload,
    createdAt: now,
    updatedAt: now,
  };
}

function parseDeltaResponse(
  runtime: CalendarInboundRuntime,
  connection: CalendarInboundConnection,
  result: CalendarInboundGraphResult,
  token: string,
):
  | {
      ok: true;
      items: MicrosoftCalendarInboundFields[];
      nextLink: string | null;
      deltaLink: string | null;
      token: string;
    }
  | { ok: false; hold: CalendarInboundJob; token: string } {
  const now = runtime.now();
  if (result.networkError || result.status >= 500) {
    return {
      ok: false,
      hold: holdJob(connection, now, "QUEUED", "Microsoft Calendar delta request did not finish"),
      token,
    };
  }
  if (result.status === 429) {
    return {
      ok: false,
      hold: holdJob(connection, now, "QUEUED", "Microsoft rate limited Calendar inbound sync"),
      token,
    };
  }
  if (result.status === 410 || result.status === 404) {
    return {
      ok: false,
      hold: holdJob(
        connection,
        now,
        "QUEUED",
        result.status === 410
          ? "Microsoft Calendar delta cursor expired"
          : "Microsoft Calendar view was not found",
        { forceCheck: true },
      ),
      token,
    };
  }
  if (result.status === 403) {
    return {
      ok: false,
      hold: holdJob(connection, now, "FAILED", "Microsoft Calendar permission is missing"),
      token,
    };
  }
  if (result.status !== 200) {
    return {
      ok: false,
      hold: holdJob(connection, now, "QUEUED", "Microsoft Calendar delta response was rejected"),
      token,
    };
  }
  const body = asRecord(result.json);
  const value = Array.isArray(body?.["value"]) ? body["value"] : [];
  const items = value
    .map(parseMicrosoftCalendarDeltaItem)
    .filter((item): item is MicrosoftCalendarInboundFields => Boolean(item));
  const nextLink = typeof body?.["@odata.nextLink"] === "string" ? body["@odata.nextLink"] : null;
  const deltaLink = typeof body?.["@odata.deltaLink"] === "string" ? body["@odata.deltaLink"] : null;
  if (nextLink) {
    try {
      assertCalendarGraphUrl(nextLink);
    } catch {
      return {
        ok: false,
        hold: holdJob(connection, now, "FAILED", "Microsoft Calendar nextLink was rejected"),
        token,
      };
    }
  }
  if (deltaLink) {
    try {
      assertCalendarGraphUrl(deltaLink);
    } catch {
      return {
        ok: false,
        hold: holdJob(connection, now, "FAILED", "Microsoft Calendar deltaLink was rejected"),
        token,
      };
    }
  }
  return { ok: true, items, nextLink, deltaLink, token };
}

async function fetchSingleEvent(
  runtime: CalendarInboundRuntime,
  connection: CalendarInboundConnection,
  eventId: string,
  token: string,
): Promise<
  | { ok: true; item: MicrosoftCalendarInboundFields | null; removed: boolean; token: string }
  | { ok: false; hold: CalendarInboundJob; token: string }
> {
  if (!isSafeCalendarResourceId(eventId)) {
    return { ok: true, item: null, removed: true, token };
  }
  const path = `/me/events/${encodeURIComponent(eventId)}?$select=id,subject,body,start,end,location,isCancelled,changeKey,lastModifiedDateTime`;
  let safe: string;
  try {
    safe = assertCalendarGraphUrl(path);
  } catch {
    return {
      ok: false,
      hold: holdJob(connection, runtime.now(), "FAILED", "Microsoft Calendar event URL was rejected"),
      token,
    };
  }
  let result = await runtime.graph.request({ method: "GET", path: safe, token });
  if (result.status === 401) {
    const refreshed = await runtime.tokenFor(connection);
    if (!refreshed.ok) {
      return {
        ok: false,
        hold: holdJob(
          connection,
          runtime.now(),
          refreshed.code === "REVOKED" ? "CANCELLED" : "QUEUED",
          refreshed.message,
        ),
        token,
      };
    }
    token = refreshed.accessToken;
    result = await runtime.graph.request({ method: "GET", path: safe, token });
  }
  if (result.status === 404) return { ok: true, item: null, removed: true, token };
  if (result.networkError || result.status === 429 || result.status >= 500) {
    return {
      ok: false,
      hold: holdJob(connection, runtime.now(), "QUEUED", "Microsoft Calendar event lookup did not finish"),
      token,
    };
  }
  if (result.status !== 200) {
    return {
      ok: false,
      hold: holdJob(connection, runtime.now(), "QUEUED", "Microsoft Calendar event lookup was rejected"),
      token,
    };
  }
  const item = parseMicrosoftCalendarDeltaItem(result.json);
  return { ok: true, item, removed: false, token };
}

async function softCancelAppointment(
  runtime: CalendarInboundRuntime,
  connection: CalendarInboundConnection,
  mapping: CalendarInboundMapping,
  appointment: CalendarInboundCrmAppointment,
  item: MicrosoftCalendarInboundFields | null,
): Promise<"applied" | "conflict" | "ignored"> {
  if (appointment.status === "CANCELLED") {
    await runtime.store.saveMapping({
      ...mapping,
      syncStatus: "REMOVED",
      deletedAt: runtime.now(),
      remoteEtag: item?.etag ?? mapping.remoteEtag,
      changeKey: item?.changeKey ?? mapping.changeKey,
      lastError: "Outlook event was deleted or cancelled; CRM appointment was already cancelled",
    });
    return "ignored";
  }
  return runtime.store.withAppointmentLock(appointment.id, async () => {
    if (await runtime.store.hasRunningOutboundForAppointment(connection.userId, appointment.id)) {
      return "conflict";
    }
    const updated = await withOutboundSuppressed(() =>
      runtime.store.updateAppointmentFields(appointment.id, {
        status: "CANCELLED",
        cancelledAt: runtime.now(),
        expectedUpdatedAt: appointment.updatedAt,
      }),
    );
    if (!updated.ok) {
      await runtime.store.saveMapping({
        ...mapping,
        syncStatus: "CONFLICT",
        lastError:
          updated.reason === "revision"
            ? "CRM appointment changed during inbound cancel; Outlook deletion was not written"
            : "CRM appointment was missing during inbound cancel",
      });
      return "conflict";
    }
    await runtime.store.saveMapping({
      ...mapping,
      syncStatus: "REMOVED",
      deletedAt: runtime.now(),
      remoteEtag: item?.etag ?? mapping.remoteEtag,
      changeKey: item?.changeKey ?? mapping.changeKey,
      lastCrmRevision: updated.appointment.updatedAt.toISOString(),
      syncedSnapshot: snapshotFromCrmAppointment(updated.appointment),
      lastError: "Outlook event was deleted or cancelled; CRM appointment was soft-cancelled",
      lastSyncedAt: runtime.now(),
    });
    await runtime.store.appendEvent({
      userId: connection.userId,
      connectionId: connection.id,
      kind: "CALENDAR_INBOUND_REMOVED",
      message: "Mapped Outlook event was deleted or cancelled; CRM appointment was soft-cancelled",
      metadata: { appointmentId: appointment.id, microsoftEventId: mapping.microsoftEventId },
      createdAt: runtime.now(),
    });
    return "applied";
  });
}

async function applyMappedChange(
  runtime: CalendarInboundRuntime,
  connection: CalendarInboundConnection,
  item: MicrosoftCalendarInboundFields,
  baseline: boolean,
): Promise<"applied" | "ignored" | "conflict" | "deferred" | "removed"> {
  const mapping = await runtime.store.findMappingByMicrosoftEventId(connection.id, item.id);
  if (!mapping || mapping.deletedAt || mapping.syncStatus === "TOMBSTONED") {
    if (!mapping) {
      await runtime.store.appendEvent({
        userId: connection.userId,
        connectionId: connection.id,
        kind: "CALENDAR_INBOUND_UNKNOWN",
        message: "Ignored Outlook event without a CRM mapping",
        metadata: { microsoftEventId: item.id },
        createdAt: runtime.now(),
      });
    }
    return "ignored";
  }
  if (mapping.connectionId !== connection.id || mapping.userId !== connection.userId) {
    await runtime.store.appendEvent({
      userId: connection.userId,
      connectionId: connection.id,
      kind: "CALENDAR_INBOUND_REJECTED",
      message: "Rejected Outlook event that did not belong to this connection",
      metadata: { microsoftEventId: item.id, mappingId: mapping.id },
      createdAt: runtime.now(),
    });
    return "ignored";
  }
  if (!mapping.appointmentId) return "ignored";

  if (item.removed || item.isCancelled === true) {
    const appointment = await runtime.store.findAppointment(mapping.appointmentId);
    if (!appointment) {
      await runtime.store.saveMapping({
        ...mapping,
        syncStatus: "REMOVED",
        deletedAt: runtime.now(),
        lastError: "Outlook event removed and CRM appointment no longer exists",
        remoteEtag: item.etag,
        changeKey: item.changeKey,
      });
      return "removed";
    }
    if (appointment.ownerId !== connection.userId) {
      await runtime.store.saveMapping({
        ...mapping,
        syncStatus: "CONFLICT",
        lastError: "CRM appointment was reassigned; inbound cancel stopped for the previous owner",
      });
      return "conflict";
    }
    if (baseline) {
      await runtime.store.saveMapping({
        ...mapping,
        remoteEtag: item.etag,
        changeKey: item.changeKey,
        lastCrmRevision: appointment.updatedAt.toISOString(),
        syncedSnapshot: snapshotFromCrmAppointment(appointment),
        syncStatus: appointment.status === "CANCELLED" ? "REMOVED" : "CONFLICT",
        lastError:
          appointment.status === "CANCELLED"
            ? null
            : "Baseline found Outlook cancellation; CRM appointment was not changed",
        lastSyncedAt: runtime.now(),
        deletedAt: appointment.status === "CANCELLED" ? runtime.now() : null,
      });
      return appointment.status === "CANCELLED" ? "removed" : "conflict";
    }
    const result = await softCancelAppointment(runtime, connection, mapping, appointment, item);
    return result === "applied" ? "removed" : result === "ignored" ? "removed" : result;
  }

  const appointment = await runtime.store.findAppointment(mapping.appointmentId);
  if (!appointment) {
    await runtime.store.saveMapping({
      ...mapping,
      syncStatus: "CONFLICT",
      lastError: "CRM appointment no longer exists for this Microsoft mapping",
    });
    return "conflict";
  }
  if (appointment.ownerId !== connection.userId) {
    await runtime.store.saveMapping({
      ...mapping,
      syncStatus: "CONFLICT",
      lastError: "CRM appointment was reassigned; inbound sync stopped for the previous owner",
    });
    return "conflict";
  }

  if (await runtime.store.hasRunningOutboundForAppointment(connection.userId, appointment.id)) {
    return "deferred";
  }

  const crmSnapshot = snapshotFromCrmAppointment(appointment);
  const microsoftSnapshot = microsoftFieldsToSnapshot(item, crmSnapshot);

  if (baseline) {
    const differs = !snapshotsEqual(crmSnapshot, microsoftSnapshot);
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      changeKey: item.changeKey,
      lastCrmRevision: appointment.updatedAt.toISOString(),
      syncedSnapshot: crmSnapshot,
      syncStatus: differs ? "CONFLICT" : "SYNCED",
      lastError: differs ? "Baseline difference between CRM and Outlook; CRM was not changed" : null,
      lastSyncedAt: runtime.now(),
      deletedAt: null,
    });
    if (differs) {
      await runtime.store.appendEvent({
        userId: connection.userId,
        connectionId: connection.id,
        kind: "CALENDAR_INBOUND_BASELINE_DIFF",
        message: "Baseline found a difference; CRM data was left unchanged",
        metadata: { appointmentId: appointment.id, microsoftEventId: item.id },
        createdAt: runtime.now(),
      });
      return "conflict";
    }
    return "ignored";
  }

  if (
    mapping.remoteEtag &&
    item.etag &&
    mapping.remoteEtag === item.etag &&
    snapshotsEqual(mapping.syncedSnapshot, microsoftSnapshot)
  ) {
    return "ignored";
  }
  if (mapping.syncedSnapshot && snapshotsEqual(mapping.syncedSnapshot, microsoftSnapshot)) {
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      changeKey: item.changeKey,
      lastSyncedAt: runtime.now(),
      syncStatus: "SYNCED",
      lastError: null,
      deletedAt: null,
    });
    return "ignored";
  }

  if (appointment.status === "CANCELLED") {
    const plan = diffCalendarFields(crmSnapshot, microsoftSnapshot, mapping.syncedSnapshot);
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      changeKey: item.changeKey,
      syncStatus: "CONFLICT",
      lastError: plan.conflicts[0] ?? "CRM cancellation takes precedence over Outlook reopen",
    });
    return "conflict";
  }

  const plan = diffCalendarFields(crmSnapshot, microsoftSnapshot, mapping.syncedSnapshot);
  if (plan.conflicts.length && Object.keys(plan.safeRemoteUpdates).length === 0) {
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      changeKey: item.changeKey,
      syncStatus: "CONFLICT",
      lastError: plan.conflicts.join("; "),
    });
    return "conflict";
  }

  if (Object.keys(plan.safeRemoteUpdates).length === 0) {
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      changeKey: item.changeKey,
      lastCrmRevision: appointment.updatedAt.toISOString(),
      syncedSnapshot: crmSnapshot,
      syncStatus: plan.conflicts.length ? "CONFLICT" : "SYNCED",
      lastError: plan.conflicts[0] ?? null,
      lastSyncedAt: runtime.now(),
      deletedAt: null,
    });
    return plan.conflicts.length ? "conflict" : "ignored";
  }

  return runtime.store.withAppointmentLock(appointment.id, async () => {
    if (await runtime.store.hasRunningOutboundForAppointment(connection.userId, appointment.id)) {
      return "deferred";
    }
    const apply = plan.safeRemoteUpdates;
    const data = {
      expectedUpdatedAt: appointment.updatedAt,
      ...(apply.title !== undefined ? { title: apply.title } : {}),
      ...(apply.description !== undefined ? { description: apply.description } : {}),
      ...(apply.startAt !== undefined ? { startAt: new Date(apply.startAt) } : {}),
      ...(apply.endAt !== undefined ? { endAt: new Date(apply.endAt) } : {}),
      ...(apply.location !== undefined ? { location: apply.location } : {}),
      ...(apply.status !== undefined
        ? {
            status: apply.status,
            cancelledAt: apply.status === "CANCELLED" ? runtime.now() : null,
          }
        : {}),
    };
    const updated = await withOutboundSuppressed(() =>
      runtime.store.updateAppointmentFields(appointment.id, data),
    );
    if (!updated.ok) {
      await runtime.store.saveMapping({
        ...mapping,
        syncStatus: "CONFLICT",
        lastError:
          updated.reason === "revision"
            ? "CRM appointment changed during inbound apply; Microsoft change was not written"
            : "CRM appointment was missing during inbound apply",
      });
      return "conflict";
    }
    const nextSnapshot = snapshotFromCrmAppointment(updated.appointment);
    await runtime.store.saveMapping({
      ...mapping,
      remoteEtag: item.etag,
      changeKey: item.changeKey,
      lastCrmRevision: updated.appointment.updatedAt.toISOString(),
      syncedSnapshot: nextSnapshot,
      syncStatus: plan.conflicts.length ? "CONFLICT" : "SYNCED",
      lastError: plan.conflicts[0] ?? null,
      lastSyncedAt: runtime.now(),
      deletedAt: null,
    });
    await runtime.store.appendEvent({
      userId: connection.userId,
      connectionId: connection.id,
      kind: "CALENDAR_INBOUND_APPLIED",
      message: plan.conflicts.length
        ? "Applied safe Outlook fields and recorded field conflicts"
        : "Applied Outlook Calendar changes to CRM",
      metadata: {
        appointmentId: appointment.id,
        microsoftEventId: item.id,
        fields: Object.keys(apply),
        conflicts: plan.conflicts,
      },
      createdAt: runtime.now(),
    });
    return plan.conflicts.length ? "conflict" : "applied";
  });
}

function connectionStillEligible(
  expected: CalendarInboundConnection,
  live: CalendarInboundConnection | null,
): live is CalendarInboundConnection {
  return Boolean(
    live &&
      live.id === expected.id &&
      live.status === "CONNECTED" &&
      live.calendarSyncEnabled &&
      hasCalendarsReadWrite(live.scopes),
  );
}

async function resetExpiredDelta(
  runtime: CalendarInboundRuntime,
  connection: CalendarInboundConnection,
  resource: string,
): Promise<void> {
  await runtime.store.clearCursor(connection.id, resource);
  const live = (await runtime.store.findConnection(connection.userId)) ?? connection;
  await runtime.store.saveConnection({
    ...live,
    calendarInboundBaselineAt: null,
  });
}

function initialDeltaPath(now: Date): string {
  const window = calendarViewWindow(now);
  return (
    `/me/calendarView/delta?startDateTime=${encodeURIComponent(window.startDateTime)}` +
    `&endDateTime=${encodeURIComponent(window.endDateTime)}`
  );
}

export async function processCalendarInboundJob(
  job: CalendarInboundJob,
  runtime: CalendarInboundRuntime,
): Promise<void> {
  const now = runtime.now();
  const leaseOwner = job.leaseOwner;
  const finish = async (next: CalendarInboundJob) => {
    await runtime.store.saveJob(next, leaseOwner ? { requireLeaseOwner: leaseOwner } : undefined);
  };
  if (!runtime.graphAllowed()) {
    await finish({ ...job, status: "QUEUED", leaseOwner: null, leaseUntil: null, updatedAt: now });
    return;
  }
  let connection = await runtime.store.findConnection(job.userId);
  if (!connection || connection.status !== "CONNECTED" || !connection.calendarSyncEnabled) {
    await finish(requeue(job, now, "Microsoft 365 calendar sync is not connected", null, "CANCELLED"));
    return;
  }
  if (connection.id !== job.connectionId) {
    await finish(requeue(job, now, "Microsoft connection changed", null, "CANCELLED"));
    return;
  }
  if (!hasCalendarsReadWrite(connection.scopes)) {
    await finish(requeue(job, now, "Microsoft Calendar permission is missing", null, "FAILED"));
    return;
  }

  const tokenResult = await runtime.tokenFor(connection);
  if (!tokenResult.ok) {
    await finish(
      requeue(
        job,
        now,
        tokenResult.message,
        tokenResult.retryAfter,
        tokenResult.code === "REVOKED" ? "CANCELLED" : null,
      ),
    );
    return;
  }

  const resource = inboundCursorResource(connection.id);
  const baseline = !connection.calendarInboundBaselineAt || job.payload.baseline === true;
  let token = tokenResult.accessToken;
  let staged = coalesceCalendarDeltaItems(job.payload.staged ?? []);
  let appliedIds = [...(job.payload.appliedIds ?? [])];
  let nextLink = job.payload.nextLink ?? null;
  let pendingDeltaLink = job.payload.pendingDeltaLink ?? null;
  let pendingOutsideIds = [...(job.payload.pendingOutsideIds ?? [])];

  const persistProgress = async (extra?: Partial<CalendarInboundJob>) => {
    await finish({
      ...job,
      status: "RUNNING",
      leaseOwner,
      updatedAt: runtime.now(),
      ...extra,
      payload: {
        staged,
        appliedIds,
        nextLink,
        pendingDeltaLink,
        pendingOutsideIds,
        baseline,
      },
    });
  };

  const handleDeltaFailure = async (hold: CalendarInboundJob) => {
    const expired =
      hold.lastError?.includes("delta cursor expired") || hold.lastError?.includes("view was not found");
    if (expired) {
      await resetExpiredDelta(runtime, connection!, resource);
      await finish({
        ...requeue(job, runtime.now(), hold.lastError ?? "Microsoft Calendar delta failed", null, "QUEUED"),
        payload: { baseline: true },
      });
      return;
    }
    await finish({
      ...requeue(
        job,
        runtime.now(),
        hold.lastError ?? "Microsoft Calendar delta failed",
        null,
        hold.status === "FAILED" ? "FAILED" : "QUEUED",
      ),
      payload: { staged, appliedIds, nextLink, pendingDeltaLink, pendingOutsideIds, baseline },
    });
  };

  if (staged.length === 0 && !nextLink && !pendingDeltaLink) {
    const existing = await runtime.store.getCursor(connection.id, resource);
    const start = existing && !baseline ? existing : initialDeltaPath(runtime.now());
    const page = await fetchDeltaPage(runtime, connection, start, token);
    if (!page.ok) {
      await handleDeltaFailure(page.hold);
      return;
    }
    token = page.token;
    staged = absorbCalendarDeltaPage(staged, page.items);
    nextLink = page.nextLink;
    pendingDeltaLink = page.deltaLink;
    const mappings = await runtime.store.findActiveMappings(connection.id);
    pendingOutsideIds = [];
    for (const mapping of mappings) {
      if (!mapping.appointmentId || !mapping.microsoftEventId) continue;
      const appointment = await runtime.store.findAppointment(mapping.appointmentId);
      if (!appointment) continue;
      if (!appointmentInWindow(appointment, runtime.now())) {
        pendingOutsideIds.push(mapping.microsoftEventId);
      }
    }
    await persistProgress();
  }

  while (nextLink) {
    const live = await runtime.store.findConnection(job.userId);
    if (!connectionStillEligible(connection, live)) {
      await finish(requeue(job, runtime.now(), "Microsoft connection changed during inbound sync", null, "CANCELLED"));
      return;
    }
    connection = live;
    const page = await fetchDeltaPage(runtime, connection, nextLink, token);
    if (!page.ok) {
      await handleDeltaFailure(page.hold);
      return;
    }
    token = page.token;
    staged = absorbCalendarDeltaPage(staged, page.items);
    nextLink = page.nextLink;
    if (page.deltaLink) pendingDeltaLink = page.deltaLink;
    await persistProgress();
  }

  // Outside-window mapped events: GET reconciliation each round.
  while (pendingOutsideIds.length > 0) {
    const eventId = pendingOutsideIds[0]!;
    if (appliedIds.includes(eventId) || staged.some((item) => item.id === eventId)) {
      pendingOutsideIds = pendingOutsideIds.slice(1);
      await persistProgress();
      continue;
    }
    const live = await runtime.store.findConnection(job.userId);
    if (!connectionStillEligible(connection, live)) {
      await finish({
        ...requeue(job, runtime.now(), "Microsoft connection changed during inbound sync", null, "CANCELLED"),
        payload: { staged, appliedIds, nextLink: null, pendingDeltaLink, pendingOutsideIds, baseline },
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
        payload: { staged, appliedIds, nextLink: null, pendingDeltaLink, pendingOutsideIds, baseline },
      });
      return;
    }
    const fetched = await fetchSingleEvent(runtime, connection, eventId, token);
    if (!fetched.ok) {
      await finish({
        ...requeue(job, runtime.now(), fetched.hold.lastError ?? "Outside-window lookup failed", null, "QUEUED"),
        payload: { staged, appliedIds, nextLink: null, pendingDeltaLink, pendingOutsideIds, baseline },
      });
      return;
    }
    token = fetched.token;
    if (fetched.removed) {
      staged = absorbCalendarDeltaPage(staged, [
        {
          id: eventId,
          etag: null,
          changeKey: null,
          subject: null,
          bodyContent: null,
          start: null,
          end: null,
          location: null,
          isCancelled: true,
          lastModifiedDateTime: null,
          removed: true,
        },
      ]);
    } else if (fetched.item) {
      staged = absorbCalendarDeltaPage(staged, [fetched.item]);
    }
    pendingOutsideIds = pendingOutsideIds.slice(1);
    await persistProgress();
  }

  staged = coalesceCalendarDeltaItems(staged);
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
        payload: { staged, appliedIds, nextLink: null, pendingDeltaLink, pendingOutsideIds, baseline },
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
        payload: { staged, appliedIds, nextLink: null, pendingDeltaLink, pendingOutsideIds, baseline },
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
      lastError: "Waiting for outbound Microsoft Calendar sync on the same appointment to finish",
      updatedAt: runtime.now(),
      payload: {
        staged,
        appliedIds,
        nextLink: null,
        pendingDeltaLink,
        pendingOutsideIds,
        baseline,
      },
    });
    return;
  }

  if (!pendingDeltaLink) {
    await finish(
      requeue(job, now, "Microsoft Calendar delta round finished without a deltaLink", null, "NEEDS_REVIEW"),
    );
    return;
  }

  const latest = await runtime.store.findConnection(job.userId);
  if (!connectionStillEligible(connection, latest)) {
    await finish({
      ...requeue(job, runtime.now(), "Microsoft connection changed before inbound cursor commit", null, "CANCELLED"),
      payload: { staged, appliedIds, nextLink: null, pendingDeltaLink, pendingOutsideIds, baseline },
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
      payload: { baseline: false },
    },
    requireLeaseOwner: leaseOwner,
    connection: {
      ...latest,
      lastCalendarInboundSyncAt: runtime.now(),
      calendarInboundBaselineAt: latest.calendarInboundBaselineAt ?? runtime.now(),
      calendarInboundEnabledAt: latest.calendarInboundEnabledAt ?? runtime.now(),
      lastError: null,
    },
    resource,
    deltaLink: pendingDeltaLink,
    now: runtime.now(),
  });
  if (!finalized) return;

  await runtime.store.appendEvent({
    userId: latest.userId,
    connectionId: latest.id,
    kind: baseline ? "CALENDAR_INBOUND_BASELINE" : "CALENDAR_INBOUND_SYNCED",
    message: baseline
      ? `Calendar inbound baseline stored ${staged.length} Outlook changes without applying historical CRM edits`
      : `Calendar inbound sync applied ${applied} change(s) with ${conflicts} conflict(s)`,
    metadata: { applied, conflicts, staged: staged.length, baseline },
    createdAt: runtime.now(),
  });
}

export async function runCalendarInboundBatch(
  runtime: CalendarInboundRuntime,
  options?: { limit?: number; owner?: string },
): Promise<{ processed: number; graphCalls: boolean }> {
  if (!runtime.graphAllowed()) return { processed: 0, graphCalls: false };
  const owner = options?.owner ?? `calendar-inbound-${Math.random().toString(36).slice(2, 10)}`;
  const jobs = await runtime.store.claimInboundJobs(options?.limit ?? 5, owner, runtime.now());
  let processed = 0;
  for (const job of jobs) {
    try {
      await processCalendarInboundJob(job, runtime);
    } catch (error) {
      await runtime.store.saveJob(
        requeue(
          job,
          runtime.now(),
          error instanceof Error ? error.message : "Calendar inbound sync failed",
          null,
          null,
        ),
        { requireLeaseOwner: owner },
      );
    }
    processed += 1;
  }
  return { processed, graphCalls: processed > 0 };
}

export function calendarInboundDedupeKeyExport(connectionId: string): string {
  return calendarInboundDedupeKey(connectionId);
}

export { calendarInboundDedupeKey };

export function calendarInboundGraphAllowedFromEnv(): boolean {
  return calendarGraphAllowed({
    crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
    calendarFlag: process.env["MICROSOFT_365_CALENDAR_SYNC_ENABLED"],
  });
}

/** Helpers exported for tests. */
export const calendarInboundTestHooks = {
  absorbCalendarDeltaPage,
  coalesceCalendarDeltaItems,
  snapshotsEqual,
  attendeesFingerprint,
};
