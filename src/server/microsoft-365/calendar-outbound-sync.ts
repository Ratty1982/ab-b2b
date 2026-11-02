/**
 * Outbound CRM → Microsoft Outlook Calendar worker step.
 * Graph event POST has no supported idempotency header. Ambiguous creates are reconciled
 * by `ab-crm-appointment:{appointmentId}` before another event is posted. When that lookup
 * cannot prove the first POST failed, the job becomes NEEDS_REVIEW with createUncertain.
 */
import { sanitizeMicrosoftMessage } from "@/domain/microsoft-365-crm";
import {
  MICROSOFT_CALENDAR_DEFAULT_TIMEZONE,
  MICROSOFT_CALENDAR_MAX_ATTEMPTS,
  MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND,
  appointmentRevisionOf,
  assertCalendarGraphUrl,
  buildOutlookEventBody,
  calendarOutboundDedupeKey,
  calendarRetryDelayMs,
  calendarViewWindow,
  classifyCalendarOutbound,
  crmAppointmentReference,
  hasCalendarsReadWrite,
  isSafeCalendarResourceId,
  mayPostMicrosoftCalendarCreate,
  snapshotFromAppointment,
  type CalendarAppointmentSnapshot,
  type CalendarSyncedSnapshot,
} from "@/domain/microsoft-calendar";
import { normalizeAttendees, type AppointmentAttendee } from "@/domain/crm-appointments";

export type CalendarOutboundJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "NEEDS_REVIEW";

export type CalendarOutboundCreateApproval = {
  approvedByUserId: string;
  approvedAt: string;
  jobId: string;
  appointmentId: string;
  connectionId: string;
  /** CrmAppointment.updatedAt at approval time. A newer revision invalidates the one-time create. */
  appointmentRevision: string;
  acknowledgedDuplicateRisk: true;
};

export type CalendarOutboundJobPayload = {
  appointmentId: string;
  explicit?: boolean;
  release?: boolean;
  reviewed?: boolean;
  createUncertain?: boolean;
  authorizeCreateOnce?: boolean;
  recheckOnly?: boolean;
  createApproval?: CalendarOutboundCreateApproval;
  knownMicrosoftEventId?: string;
  appointmentRevision?: string;
  revisionDirty?: boolean;
  attendeesConfirmed?: boolean;
};

export type CalendarOutboundJob = {
  id: string;
  connectionId: string;
  userId: string;
  kind: typeof MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND;
  status: CalendarOutboundJobStatus;
  attempt: number;
  runAfter: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  lastError: string | null;
  dedupeKey: string;
  payload: CalendarOutboundJobPayload;
  createdAt: Date;
  updatedAt: Date;
};

export type CalendarOutboundConnection = {
  id: string;
  userId: string;
  status: "CONNECTED" | "REVOKED" | "ERROR";
  tenantId: string;
  microsoftUserId: string;
  scopes: string;
  calendarSyncEnabled: boolean;
  calendarOutboundEnabledAt: Date | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  lastCalendarSyncAt: Date | null;
  lastError: string | null;
};

export type CalendarOutboundMapping = {
  id: string;
  appointmentId: string;
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

export type CalendarGraphResult = {
  status: number;
  json: unknown;
  retryAfter: string | null;
  etag?: string | null;
  networkError?: boolean;
};

export type CalendarOutboundGraph = {
  request(input: {
    method: "GET" | "POST" | "PATCH";
    path: string;
    token: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<CalendarGraphResult>;
};

export type CalendarOutboundToken =
  | { ok: true; accessToken: string }
  | { ok: false; code: "REVOKED" | "RATE_LIMITED" | "TOKEN"; retryAfter: string | null; message: string };

/** Appointment row used by the outbound worker, including the Outlook opt-in flag. */
export type CalendarOutboundAppointment = CalendarAppointmentSnapshot & {
  syncToOutlook: boolean;
};

export type CalendarOutboundStore = {
  findConnection(userId: string): Promise<CalendarOutboundConnection | null>;
  saveConnection(row: CalendarOutboundConnection): Promise<void>;
  withConnectionLock<T>(connectionId: string, fn: () => Promise<T>): Promise<T>;
  findAppointment(appointmentId: string): Promise<CalendarOutboundAppointment | null>;
  findMapping(userId: string, appointmentId: string): Promise<CalendarOutboundMapping | null>;
  saveMapping(row: CalendarOutboundMapping): Promise<void>;
  findJob(jobId: string): Promise<CalendarOutboundJob | null>;
  saveJob(job: CalendarOutboundJob, opts?: { requireLeaseOwner?: string | null }): Promise<boolean>;
  holdsJobLease(jobId: string, owner: string): Promise<boolean>;
  appendEvent(event: {
    userId: string | null;
    connectionId: string | null;
    kind: string;
    message: string;
    createdAt: Date;
  }): Promise<void>;
  claimJobs(now: Date, owner: string, limit: number, leaseMs: number): Promise<CalendarOutboundJob[]>;
};

export type CalendarOutboundRuntime = {
  store: CalendarOutboundStore;
  graph: CalendarOutboundGraph;
  tokenFor: (connection: CalendarOutboundConnection) => Promise<CalendarOutboundToken>;
  now: () => Date;
  graphAllowed: () => boolean;
  newId: () => string;
  newTransactionId?: () => string;
};

const LOOKUP_PAGE_SIZE = 50;
const LOOKUP_MAX_PAGES = 10;

function safe(error: unknown): string {
  return sanitizeMicrosoftMessage(error instanceof Error ? error.message : String(error));
}

function requeue(
  job: CalendarOutboundJob,
  now: Date,
  message: string,
  retryAfter: string | null,
  terminal: CalendarOutboundJobStatus | null,
): CalendarOutboundJob {
  if (terminal) {
    return { ...job, status: terminal, leaseOwner: null, leaseUntil: null, lastError: message, updatedAt: now };
  }
  if (job.attempt >= MICROSOFT_CALENDAR_MAX_ATTEMPTS) {
    return { ...job, status: "FAILED", leaseOwner: null, leaseUntil: null, lastError: message, updatedAt: now };
  }
  return {
    ...job,
    status: "QUEUED",
    leaseOwner: null,
    leaseUntil: null,
    lastError: message,
    runAfter: new Date(now.getTime() + calendarRetryDelayMs(job.attempt, retryAfter, now)),
    updatedAt: now,
  };
}

function withPayload(job: CalendarOutboundJob, patch: Partial<CalendarOutboundJobPayload>): CalendarOutboundJob {
  return { ...job, payload: { ...job.payload, ...patch } };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function eventBodyContainsReference(body: unknown, appointmentId: string): boolean {
  const reference = crmAppointmentReference(appointmentId);
  if (typeof body === "string") return body.includes(reference);
  const record = asRecord(body);
  if (!record) return false;
  const content = record["content"];
  return typeof content === "string" && content.includes(reference);
}

function isSameAppointmentRevision(
  appointment: Pick<CalendarAppointmentSnapshot, "updatedAt">,
  revision: string | undefined,
): boolean {
  if (!revision) return true;
  return appointmentRevisionOf(appointment) === revision;
}

async function callGraph(
  runtime: CalendarOutboundRuntime,
  connection: CalendarOutboundConnection,
  input: {
    method: "GET" | "POST" | "PATCH";
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
  token: string,
  refreshed: boolean,
): Promise<
  | { result: CalendarGraphResult; token: string; connection: CalendarOutboundConnection }
  | { stop: CalendarOutboundJob }
> {
  assertCalendarGraphUrl(input.path);
  let result: CalendarGraphResult;
  try {
    result = await runtime.graph.request({ ...input, token });
  } catch {
    result = { status: 0, json: null, retryAfter: null, networkError: true };
  }
  if (result.status === 401 && !refreshed) {
    const next = await runtime.tokenFor(connection);
    if (!next.ok) {
      const now = runtime.now();
      return {
        stop: requeue(
          {
            id: "",
            connectionId: connection.id,
            userId: connection.userId,
            kind: MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND,
            status: "RUNNING",
            attempt: 1,
            runAfter: now,
            leaseOwner: null,
            leaseUntil: null,
            lastError: null,
            dedupeKey: "",
            payload: { appointmentId: "" },
            createdAt: now,
            updatedAt: now,
          },
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

function preferCreateHeaders(): Record<string, string> {
  return {
    Prefer: `IdType="ImmutableId", outlook.timezone="${MICROSOFT_CALENDAR_DEFAULT_TIMEZONE}"`,
  };
}

function ifMatchHeaders(mapping: CalendarOutboundMapping | null): Record<string, string> | undefined {
  const tag = mapping?.changeKey || mapping?.remoteEtag;
  if (!tag) return undefined;
  return { "If-Match": tag };
}

async function lookupEvent(
  runtime: CalendarOutboundRuntime,
  connection: CalendarOutboundConnection,
  appointmentId: string,
  token: string,
  knownId: string | null,
): Promise<{
  id: string | null;
  ambiguous: boolean;
  token: string;
  rate: CalendarGraphResult | null;
  fatal: number | null;
  changeKey: string | null;
  etag: string | null;
  iCalUId: string | null;
  webLink: string | null;
  immutableEventId: string | null;
}> {
  if (knownId && isSafeCalendarResourceId(knownId)) {
    const called = await callGraph(
      runtime,
      connection,
      {
        method: "GET",
        path: `/me/events/${encodeURIComponent(knownId)}?$select=id,body,changeKey,iCalUId,webLink`,
      },
      token,
      false,
    );
    if ("stop" in called) {
      return {
        id: null,
        ambiguous: true,
        token,
        rate: null,
        fatal: 401,
        changeKey: null,
        etag: null,
        iCalUId: null,
        webLink: null,
        immutableEventId: null,
      };
    }
    token = called.token;
    if (called.result.status === 200) {
      const row = asRecord(called.result.json);
      const id = typeof row?.["id"] === "string" ? row["id"] : knownId;
      return {
        id,
        ambiguous: false,
        token,
        rate: null,
        fatal: null,
        changeKey: typeof row?.["changeKey"] === "string" ? row["changeKey"] : null,
        etag: called.result.etag ?? (typeof row?.["@odata.etag"] === "string" ? row["@odata.etag"] : null),
        iCalUId: typeof row?.["iCalUId"] === "string" ? row["iCalUId"] : null,
        webLink: typeof row?.["webLink"] === "string" ? row["webLink"] : null,
        immutableEventId: id,
      };
    }
    if (called.result.status !== 404) {
      if (called.result.networkError || called.result.status === 429 || called.result.status >= 500) {
        return {
          id: null,
          ambiguous: true,
          token,
          rate: called.result,
          fatal: null,
          changeKey: null,
          etag: null,
          iCalUId: null,
          webLink: null,
          immutableEventId: null,
        };
      }
    }
  }

  const window = calendarViewWindow(runtime.now());
  let path =
    `/me/calendarView?startDateTime=${encodeURIComponent(window.startDateTime)}` +
    `&endDateTime=${encodeURIComponent(window.endDateTime)}` +
    `&$select=id,body,changeKey,iCalUId,webLink&$top=${LOOKUP_PAGE_SIZE}`;

  for (let page = 0; page < LOOKUP_MAX_PAGES; page += 1) {
    const called = await callGraph(runtime, connection, { method: "GET", path }, token, false);
    if ("stop" in called) {
      return {
        id: null,
        ambiguous: true,
        token,
        rate: null,
        fatal: 401,
        changeKey: null,
        etag: null,
        iCalUId: null,
        webLink: null,
        immutableEventId: null,
      };
    }
    token = called.token;
    const result = called.result;
    if (result.networkError || result.status === 429 || result.status >= 500) {
      return {
        id: null,
        ambiguous: true,
        token,
        rate: result,
        fatal: null,
        changeKey: null,
        etag: null,
        iCalUId: null,
        webLink: null,
        immutableEventId: null,
      };
    }
    if (result.status === 400 || result.status === 403 || result.status === 404) {
      return {
        id: null,
        ambiguous: true,
        token,
        rate: null,
        fatal: result.status,
        changeKey: null,
        etag: null,
        iCalUId: null,
        webLink: null,
        immutableEventId: null,
      };
    }
    if (result.status !== 200) {
      return {
        id: null,
        ambiguous: true,
        token,
        rate: null,
        fatal: result.status,
        changeKey: null,
        etag: null,
        iCalUId: null,
        webLink: null,
        immutableEventId: null,
      };
    }
    const record = asRecord(result.json);
    const value = record && Array.isArray(record["value"]) ? record["value"] : [];
    const hits = value.filter((item) => eventBodyContainsReference(asRecord(item)?.["body"], appointmentId));
    if (hits.length > 1) {
      return {
        id: null,
        ambiguous: true,
        token,
        rate: null,
        fatal: 409,
        changeKey: null,
        etag: null,
        iCalUId: null,
        webLink: null,
        immutableEventId: null,
      };
    }
    const first = asRecord(hits[0]);
    const id = first?.["id"];
    if (typeof id === "string") {
      return {
        id,
        ambiguous: false,
        token,
        rate: null,
        fatal: null,
        changeKey: typeof first?.["changeKey"] === "string" ? first["changeKey"] : null,
        etag: typeof first?.["@odata.etag"] === "string" ? first["@odata.etag"] : null,
        iCalUId: typeof first?.["iCalUId"] === "string" ? first["iCalUId"] : null,
        webLink: typeof first?.["webLink"] === "string" ? first["webLink"] : null,
        immutableEventId: id,
      };
    }
    const next = record?.["@odata.nextLink"];
    if (typeof next !== "string" || !next) {
      return {
        id: null,
        ambiguous: false,
        token,
        rate: null,
        fatal: null,
        changeKey: null,
        etag: null,
        iCalUId: null,
        webLink: null,
        immutableEventId: null,
      };
    }
    try {
      path = assertCalendarGraphUrl(next);
    } catch {
      return {
        id: null,
        ambiguous: true,
        token,
        rate: null,
        fatal: null,
        changeKey: null,
        etag: null,
        iCalUId: null,
        webLink: null,
        immutableEventId: null,
      };
    }
  }
  return {
    id: null,
    ambiguous: true,
    token,
    rate: null,
    fatal: null,
    changeKey: null,
    etag: null,
    iCalUId: null,
    webLink: null,
    immutableEventId: null,
  };
}

function mappingFrom(
  connection: CalendarOutboundConnection,
  appointment: CalendarAppointmentSnapshot,
  microsoftEventId: string,
  now: Date,
  id: string,
  extras: {
    changeKey: string | null;
    remoteEtag: string | null;
    iCalUId: string | null;
    outlookWebLink: string | null;
    immutableEventId: string | null;
    transactionId: string | null;
    externalAttendees: boolean;
  },
): CalendarOutboundMapping {
  return {
    id,
    appointmentId: appointment.id,
    userId: connection.userId,
    connectionId: connection.id,
    microsoftEventId,
    immutableEventId: extras.immutableEventId,
    iCalUId: extras.iCalUId,
    changeKey: extras.changeKey,
    remoteEtag: extras.remoteEtag,
    lastCrmRevision: appointmentRevisionOf(appointment),
    syncedSnapshot: snapshotFromAppointment(appointment),
    transactionId: extras.transactionId,
    outlookWebLink: extras.outlookWebLink,
    syncStatus: "SYNCED",
    externalAttendees: extras.externalAttendees,
    lastError: null,
    lastSyncedAt: now,
    deletedAt: null,
  };
}

function uncertainCreate(
  job: CalendarOutboundJob,
  now: Date,
  message: string,
  knownMicrosoftEventId?: string,
): CalendarOutboundJob {
  return withPayload(requeue(job, now, message, null, "NEEDS_REVIEW"), {
    createUncertain: true,
    authorizeCreateOnce: false,
    recheckOnly: false,
    reviewed: false,
    ...(knownMicrosoftEventId ? { knownMicrosoftEventId } : {}),
  });
}

function clearOneTimeCreateAuth(payload: CalendarOutboundJobPayload): CalendarOutboundJobPayload {
  const next = { ...payload };
  delete next.authorizeCreateOnce;
  delete next.createApproval;
  delete next.recheckOnly;
  return next;
}

function approvalAllowsCreate(job: CalendarOutboundJob, liveRevision: string): boolean {
  const approval = job.payload.createApproval;
  if (!job.payload.authorizeCreateOnce || !approval) return false;
  if (job.payload.revisionDirty) return false;
  if (approval.jobId !== job.id) return false;
  if (approval.appointmentId !== job.payload.appointmentId) return false;
  if (approval.connectionId !== job.connectionId) return false;
  if (approval.acknowledgedDuplicateRisk !== true) return false;
  if (approval.appointmentRevision !== liveRevision) return false;
  return true;
}

function patchedStop(stop: CalendarOutboundJob, job: CalendarOutboundJob): CalendarOutboundJob {
  return {
    ...stop,
    id: job.id,
    payload: job.payload,
    dedupeKey: job.dedupeKey,
    attempt: job.attempt,
    connectionId: job.connectionId,
    userId: job.userId,
    kind: job.kind,
    createdAt: job.createdAt,
  };
}

function readRemoteMeta(json: unknown, result: CalendarGraphResult): {
  changeKey: string | null;
  remoteEtag: string | null;
  iCalUId: string | null;
  outlookWebLink: string | null;
  immutableEventId: string | null;
} {
  const row = asRecord(json);
  const id = typeof row?.["id"] === "string" ? row["id"] : null;
  return {
    changeKey: typeof row?.["changeKey"] === "string" ? row["changeKey"] : null,
    remoteEtag: result.etag ?? (typeof row?.["@odata.etag"] === "string" ? row["@odata.etag"] : null),
    iCalUId: typeof row?.["iCalUId"] === "string" ? row["iCalUId"] : null,
    outlookWebLink: typeof row?.["webLink"] === "string" ? row["webLink"] : null,
    immutableEventId: id,
  };
}

export async function processCalendarOutboundJob(
  job: CalendarOutboundJob,
  runtime: CalendarOutboundRuntime,
): Promise<void> {
  const now = runtime.now();
  const leaseOwner = job.leaseOwner;
  const finish = async (next: CalendarOutboundJob) => {
    await runtime.store.saveJob(next, leaseOwner ? { requireLeaseOwner: leaseOwner } : undefined);
  };
  if (!runtime.graphAllowed()) {
    await finish({ ...job, status: "QUEUED", leaseOwner: null, leaseUntil: null, updatedAt: now });
    return;
  }
  const connection = await runtime.store.findConnection(job.userId);
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
    await runtime.store.saveConnection({ ...connection, lastError: "Microsoft Calendar permission is missing" });
    return;
  }
  const appointment = await runtime.store.findAppointment(job.payload.appointmentId);
  if (!appointment) {
    await finish(requeue(job, now, "CRM appointment no longer exists", null, "CANCELLED"));
    return;
  }
  const processedRevision = appointmentRevisionOf(appointment);
  const mapping = await runtime.store.findMapping(job.userId, appointment.id);
  const active = Boolean(mapping && mapping.deletedAt == null && mapping.syncStatus !== "TOMBSTONED");
  const kind = classifyCalendarOutbound({
    appointment,
    connectionUserId: connection.userId,
    syncToOutlook: appointment.syncToOutlook,
    hasActiveMapping: active,
    release: Boolean(job.payload.release),
    explicit: Boolean(job.payload.explicit),
  });
  if (kind === "skip") {
    await finish({
      ...job,
      status: "SUCCEEDED",
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      updatedAt: now,
      payload: { ...job.payload, revisionDirty: false, appointmentRevision: processedRevision },
    });
    return;
  }

  const tokenResult = await runtime.tokenFor(connection);
  if (!tokenResult.ok) {
    await finish(
      requeue(job, now, tokenResult.message, tokenResult.retryAfter, tokenResult.code === "REVOKED" ? "CANCELLED" : null),
    );
    return;
  }

  const mode = kind === "release" ? "release" : appointment.status === "CANCELLED" ? "cancel" : "sync";
  let token = tokenResult.accessToken;
  const latest = (await runtime.store.findConnection(connection.userId)) ?? connection;
  if (latest.status !== "CONNECTED" || !latest.calendarSyncEnabled || latest.id !== connection.id) {
    await finish(requeue(job, now, "Microsoft connection changed", null, "CANCELLED"));
    return;
  }

  const attendeesConfirmed = job.payload.attendeesConfirmed === true;
  const appointmentForBody: CalendarAppointmentSnapshot = {
    ...appointment,
    attendeesConfirmed,
  };
  let body = buildOutlookEventBody(appointmentForBody, mode);
  if (mode === "cancel" || mode === "release") {
    body = { ...body, isCancelled: true };
  }

  const knownId =
    job.payload.knownMicrosoftEventId && isSafeCalendarResourceId(job.payload.knownMicrosoftEventId)
      ? job.payload.knownMicrosoftEventId
      : null;
  const existingId = (mapping?.microsoftEventId ? mapping.microsoftEventId : null) ?? knownId;
  const createAuthorised = !job.payload.createUncertain || approvalAllowsCreate(job, processedRevision);
  const allowCreate = mode === "sync" && createAuthorised && mayPostMicrosoftCalendarCreate(job.payload);

  let usedTransactionId: string | null = mapping?.transactionId ?? null;
  let lastMeta = {
    changeKey: mapping?.changeKey ?? null,
    remoteEtag: mapping?.remoteEtag ?? null,
    iCalUId: mapping?.iCalUId ?? null,
    outlookWebLink: mapping?.outlookWebLink ?? null,
    immutableEventId: mapping?.immutableEventId ?? null,
  };

  const write = async (
    microsoftEventId: string | null,
    canCreate: boolean,
  ): Promise<{ id: string } | { held: CalendarOutboundJob } | { absent: true }> => {
    if (!microsoftEventId) {
      const found = await lookupEvent(runtime, latest, appointment.id, token, knownId);
      token = found.token;
      if (found.rate) {
        const review =
          found.ambiguous && !found.rate.networkError && found.rate.status !== 429 && found.rate.status < 500;
        return {
          held: review
            ? uncertainCreate(job, now, "Microsoft Calendar lookup did not finish")
            : requeue(job, now, "Microsoft Calendar lookup did not finish", found.rate.retryAfter, null),
        };
      }
      if (found.ambiguous && !found.id) {
        return { held: uncertainCreate(job, now, "Microsoft Calendar create needs review before retrying") };
      }
      if (found.id) {
        microsoftEventId = found.id;
        lastMeta = {
          changeKey: found.changeKey,
          remoteEtag: found.etag,
          iCalUId: found.iCalUId,
          outlookWebLink: found.webLink,
          immutableEventId: found.immutableEventId,
        };
      } else if (!canCreate) {
        if (job.payload.createUncertain) {
          return {
            held: withPayload(
              requeue(
                job,
                now,
                job.payload.recheckOnly
                  ? "Microsoft Calendar recheck found no matching event"
                  : "Microsoft Calendar create remains uncertain until an explicit review authorises another create",
                null,
                "NEEDS_REVIEW",
              ),
              {
                createUncertain: true,
                authorizeCreateOnce: false,
                recheckOnly: false,
                reviewed: false,
                ...(job.payload.knownMicrosoftEventId
                  ? { knownMicrosoftEventId: job.payload.knownMicrosoftEventId }
                  : {}),
              },
            ),
          };
        }
        return { absent: true };
      }
    }

    if (microsoftEventId) {
      const patchBody =
        mode === "cancel" || mode === "release"
          ? { ...body, showAs: "free", isCancelled: true }
          : body;
      const patched = await callGraph(
        runtime,
        latest,
        {
          method: "PATCH",
          path: `/me/events/${encodeURIComponent(microsoftEventId)}`,
          body: patchBody,
          headers: ifMatchHeaders(mapping),
        },
        token,
        false,
      );
      if ("stop" in patched) {
        return { held: patchedStop(patched.stop, job) };
      }
      token = patched.token;
      if (patched.result.status === 404) {
        if (!job.payload.reviewed || !canCreate) {
          return { held: uncertainCreate(job, now, "Mapped Microsoft Calendar event was not found") };
        }
        return write(null, true);
      }
      if (patched.result.status === 412) {
        return { held: requeue(job, now, "Microsoft Calendar event changed remotely", null, "NEEDS_REVIEW") };
      }
      if (patched.result.status === 429 || patched.result.networkError || patched.result.status >= 500) {
        return {
          held: requeue(job, now, "Microsoft Calendar update did not finish", patched.result.retryAfter, null),
        };
      }
      if (patched.result.status === 403) {
        return { held: requeue(job, now, "Microsoft Calendar permission is missing", null, "FAILED") };
      }
      if (patched.result.status !== 200) {
        return {
          held: requeue(
            job,
            now,
            "Microsoft Calendar update was rejected",
            null,
            patched.result.status === 409 ? "NEEDS_REVIEW" : null,
          ),
        };
      }
      lastMeta = { ...lastMeta, ...readRemoteMeta(patched.result.json, patched.result) };
      return { id: microsoftEventId };
    }

    const transactionId =
      usedTransactionId ??
      (runtime.newTransactionId ? runtime.newTransactionId() : globalThis.crypto.randomUUID());
    usedTransactionId = transactionId;
    const created = await callGraph(
      runtime,
      latest,
      {
        method: "POST",
        path: "/me/events",
        body: { ...body, transactionId },
        headers: preferCreateHeaders(),
      },
      token,
      false,
    );
    if ("stop" in created) return { held: patchedStop(created.stop, job) };
    token = created.token;
    if (created.result.status === 429) {
      return {
        held: requeue(job, now, "Microsoft rate limited Calendar sync", created.result.retryAfter, null),
      };
    }
    if (created.result.networkError || created.result.status >= 500 || created.result.status === 409) {
      const again = await lookupEvent(runtime, latest, appointment.id, token, null);
      token = again.token;
      if (again.id) {
        lastMeta = {
          changeKey: again.changeKey,
          remoteEtag: again.etag,
          iCalUId: again.iCalUId,
          outlookWebLink: again.webLink,
          immutableEventId: again.immutableEventId,
        };
        return { id: again.id };
      }
      return {
        held: uncertainCreate(
          job,
          now,
          created.result.status === 409
            ? "Microsoft Calendar create conflict needs review before retrying"
            : "Microsoft Calendar create outcome is uncertain and needs review before retrying",
        ),
      };
    }
    if (created.result.status === 403) {
      return { held: requeue(job, now, "Microsoft Calendar permission is missing", null, "FAILED") };
    }
    const id = asRecord(created.result.json)?.["id"];
    if ((created.result.status !== 201 && created.result.status !== 200) || typeof id !== "string") {
      return { held: uncertainCreate(job, now, "Microsoft Calendar create was rejected without a confirmed id") };
    }
    lastMeta = { ...lastMeta, ...readRemoteMeta(created.result.json, created.result) };
    return { id };
  };

  const written = await write(mode === "sync" && !active && !knownId ? null : existingId, allowCreate);
  if ("absent" in written) {
    await finish({
      ...job,
      status: "SUCCEEDED",
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      updatedAt: now,
      payload: clearOneTimeCreateAuth(job.payload),
    });
    return;
  }
  if ("held" in written) {
    const held: CalendarOutboundJob =
      job.payload.authorizeCreateOnce || job.payload.recheckOnly || written.held.payload.createUncertain
        ? {
            ...written.held,
            payload: {
              ...clearOneTimeCreateAuth(written.held.payload),
              ...(written.held.payload.createUncertain || job.payload.createUncertain
                ? { createUncertain: true }
                : {}),
            },
          }
        : written.held;
    await finish(held);
    if (held.status === "NEEDS_REVIEW" || held.status === "FAILED") {
      await runtime.store.appendEvent({
        userId: connection.userId,
        connectionId: connection.id,
        kind: held.status === "NEEDS_REVIEW" ? "CALENDAR_NEEDS_REVIEW" : "CALENDAR_FAILED",
        message: held.lastError ?? "Microsoft Calendar sync needs attention",
        createdAt: now,
      });
      if (mapping) {
        await runtime.store.saveMapping({
          ...mapping,
          syncStatus: held.status === "NEEDS_REVIEW" ? "CONFLICT" : "FAILED",
          lastError: held.lastError,
        });
      }
    }
    return;
  }

  const externalAttendees = Boolean(
    attendeesConfirmed && appointment.attendees && appointment.attendees.length > 0,
  );
  const saved = mappingFrom(latest, appointmentForBody, written.id, now, mapping?.id ?? runtime.newId(), {
    ...lastMeta,
    transactionId: usedTransactionId,
    externalAttendees,
  });
  if (mode !== "sync") {
    saved.syncStatus = "TOMBSTONED";
    saved.deletedAt = now;
  }
  if (leaseOwner && !(await runtime.store.holdsJobLease(job.id, leaseOwner))) {
    return;
  }
  try {
    await runtime.store.saveMapping(saved);
  } catch {
    await finish(
      uncertainCreate(
        job,
        now,
        "Microsoft Calendar event was saved remotely but the CRM mapping could not be stored",
        written.id,
      ),
    );
    return;
  }

  if (leaseOwner && !(await runtime.store.holdsJobLease(job.id, leaseOwner))) {
    return;
  }

  const latestAppointment = await runtime.store.findAppointment(appointment.id);
  if (!latestAppointment) {
    await finish({
      ...job,
      status: "SUCCEEDED",
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      updatedAt: now,
      payload: {
        appointmentId: job.payload.appointmentId,
        knownMicrosoftEventId: written.id,
        createUncertain: false,
        revisionDirty: false,
      },
    });
    return;
  }

  const liveJob = (await runtime.store.findJob(job.id)) ?? job;
  const dirty = Boolean(liveJob.payload.revisionDirty);
  const reassignedAway = mode === "sync" && latestAppointment.ownerId !== connection.userId;
  const revisionMoved = !isSameAppointmentRevision(latestAppointment, processedRevision) || dirty;

  if (reassignedAway) {
    await finish({
      ...job,
      status: "QUEUED",
      attempt: 0,
      runAfter: now,
      leaseOwner: null,
      leaseUntil: null,
      lastError: "CRM appointment was reassigned during Microsoft sync",
      updatedAt: now,
      payload: {
        appointmentId: job.payload.appointmentId,
        release: true,
        knownMicrosoftEventId: written.id,
        createUncertain: false,
        revisionDirty: false,
        appointmentRevision: appointmentRevisionOf(latestAppointment),
      },
    });
    return;
  }

  if (revisionMoved) {
    await runtime.store.saveConnection({ ...latest, lastCalendarSyncAt: now, lastError: null });
    await finish({
      ...job,
      status: "QUEUED",
      attempt: 0,
      runAfter: now,
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      updatedAt: now,
      payload: {
        appointmentId: job.payload.appointmentId,
        ...(job.payload.explicit ? { explicit: true } : {}),
        ...(job.payload.release ? { release: true } : {}),
        ...(job.payload.attendeesConfirmed ? { attendeesConfirmed: true } : {}),
        knownMicrosoftEventId: written.id,
        createUncertain: false,
        revisionDirty: false,
        appointmentRevision: appointmentRevisionOf(latestAppointment),
      },
    });
    return;
  }

  await runtime.store.saveConnection({ ...latest, lastCalendarSyncAt: now, lastError: null });
  await finish({
    ...job,
    status: "SUCCEEDED",
    leaseOwner: null,
    leaseUntil: null,
    lastError: null,
    updatedAt: now,
    payload: clearOneTimeCreateAuth({
      appointmentId: job.payload.appointmentId,
      knownMicrosoftEventId: written.id,
      createUncertain: false,
      revisionDirty: false,
      appointmentRevision: processedRevision,
      ...(job.payload.attendeesConfirmed ? { attendeesConfirmed: true } : {}),
    }),
  });
}

export async function runCalendarOutboundBatch(
  runtime: CalendarOutboundRuntime,
  owner: string,
  limit = 5,
): Promise<{ processed: number; graphCalls: boolean }> {
  if (!runtime.graphAllowed()) return { processed: 0, graphCalls: false };
  const jobs = await runtime.store.claimJobs(runtime.now(), owner, limit, 120_000);
  let processed = 0;
  for (const job of jobs) {
    if (!runtime.graphAllowed()) {
      await runtime.store.saveJob(
        { ...job, status: "QUEUED", leaseOwner: null, leaseUntil: null, updatedAt: runtime.now() },
        { requireLeaseOwner: owner },
      );
      break;
    }
    try {
      await processCalendarOutboundJob(job, runtime);
    } catch (error) {
      await runtime.store.saveJob(requeue(job, runtime.now(), safe(error), null, null), {
        requireLeaseOwner: owner,
      });
    }
    processed += 1;
  }
  return { processed, graphCalls: processed > 0 };
}

export { calendarOutboundDedupeKey };

function keepOneTimeCreateApproval(
  existing: CalendarOutboundJobPayload,
  next: CalendarOutboundJobPayload,
  options?: { markDirty?: boolean },
): boolean {
  if (!existing.createApproval || existing.authorizeCreateOnce !== true) return false;
  if (options?.markDirty || existing.revisionDirty || next.revisionDirty) return false;
  if (
    existing.createApproval.appointmentRevision &&
    next.appointmentRevision &&
    existing.createApproval.appointmentRevision !== next.appointmentRevision
  ) {
    return false;
  }
  return true;
}

export function mergeCalendarOutboundPayload(
  existing: CalendarOutboundJobPayload,
  next: CalendarOutboundJobPayload,
  options?: { markDirty?: boolean },
): CalendarOutboundJobPayload {
  return {
    appointmentId: next.appointmentId || existing.appointmentId,
    ...(existing.explicit || next.explicit ? { explicit: true } : {}),
    ...(next.release || existing.release ? { release: Boolean(next.release || existing.release) } : {}),
    ...(existing.createUncertain ? { createUncertain: true } : {}),
    ...(existing.knownMicrosoftEventId ? { knownMicrosoftEventId: existing.knownMicrosoftEventId } : {}),
    ...(next.knownMicrosoftEventId ? { knownMicrosoftEventId: next.knownMicrosoftEventId } : {}),
    ...(next.appointmentRevision || existing.appointmentRevision
      ? { appointmentRevision: next.appointmentRevision ?? existing.appointmentRevision }
      : {}),
    ...(options?.markDirty || existing.revisionDirty || next.revisionDirty ? { revisionDirty: true } : {}),
    ...(existing.reviewed && !options?.markDirty ? { reviewed: true } : {}),
    ...(existing.attendeesConfirmed || next.attendeesConfirmed ? { attendeesConfirmed: true } : {}),
    ...(keepOneTimeCreateApproval(existing, next, options)
      ? { createApproval: existing.createApproval, authorizeCreateOnce: true as const }
      : {}),
  };
}

export function parseAppointmentAttendees(raw: unknown): AppointmentAttendee[] {
  return normalizeAttendees(raw);
}
