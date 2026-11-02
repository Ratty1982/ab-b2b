import { describe, expect, it } from "vitest";

import { MICROSOFT_CALENDAR_INBOUND_JOB_KIND, crmAppointmentReference } from "@/domain/microsoft-calendar";
import {
  parseMicrosoftCalendarDeltaItem,
  processCalendarInboundJob,
  runCalendarInboundBatch,
  type CalendarInboundConnection,
  type CalendarInboundCrmAppointment,
  type CalendarInboundGraph,
  type CalendarInboundJob,
  type CalendarInboundMapping,
  type CalendarInboundRuntime,
  type CalendarInboundStore,
} from "@/server/microsoft-365/calendar-inbound-sync";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const DELTA_LINK =
  "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=abc";
const DELTA_LINK_NEXT =
  "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=def";

function connection(partial: Partial<CalendarInboundConnection> = {}): CalendarInboundConnection {
  return {
    id: "conn-a",
    userId: "user-a",
    status: "CONNECTED",
    tenantId: "11111111-1111-4111-8111-111111111111",
    microsoftUserId: "oid-a",
    scopes: "openid profile offline_access User.Read Calendars.ReadWrite",
    calendarSyncEnabled: true,
    calendarInboundEnabledAt: new Date("2026-10-01T00:00:00.000Z"),
    calendarInboundBaselineAt: null,
    lastCalendarInboundSyncAt: null,
    accessTokenEncrypted: "v2:token",
    refreshTokenEncrypted: "v2:refresh",
    accessTokenExpiresAt: new Date("2026-11-01T13:00:00.000Z"),
    lastError: null,
    ...partial,
  };
}

function appointment(partial: Partial<CalendarInboundCrmAppointment> = {}): CalendarInboundCrmAppointment {
  return {
    id: "appt-1",
    ownerId: "user-a",
    title: "Site visit",
    description: "Bring samples",
    startAt: new Date("2026-11-05T10:00:00.000Z"),
    endAt: new Date("2026-11-05T11:00:00.000Z"),
    location: "Depot",
    status: "SCHEDULED",
    timeZone: "Europe/London",
    attendees: [],
    syncToOutlook: true,
    cancelledAt: null,
    updatedAt: new Date("2026-10-15T00:00:00.000Z"),
    ...partial,
  };
}

function mapping(partial: Partial<CalendarInboundMapping> = {}): CalendarInboundMapping {
  return {
    id: "map-1",
    appointmentId: "appt-1",
    userId: "user-a",
    connectionId: "conn-a",
    microsoftEventId: "ms-1",
    immutableEventId: "ms-1",
    iCalUId: null,
    changeKey: "ck-1",
    remoteEtag: null,
    lastCrmRevision: "2026-10-15T00:00:00.000Z",
    syncedSnapshot: {
      title: "Site visit",
      description: "Bring samples",
      startAt: "2026-11-05T10:00:00.000Z",
      endAt: "2026-11-05T11:00:00.000Z",
      location: "Depot",
      status: "SCHEDULED",
      attendeesFingerprint: "",
    },
    transactionId: null,
    outlookWebLink: null,
    syncStatus: "SYNCED",
    externalAttendees: false,
    lastError: null,
    lastSyncedAt: null,
    deletedAt: null,
    ...partial,
  };
}

function job(partial: Partial<CalendarInboundJob> = {}): CalendarInboundJob {
  return {
    id: "job-in-1",
    connectionId: "conn-a",
    userId: "user-a",
    kind: MICROSOFT_CALENDAR_INBOUND_JOB_KIND,
    status: "RUNNING",
    attempt: 1,
    runAfter: NOW,
    leaseOwner: "worker-1",
    leaseUntil: new Date(NOW.getTime() + 60_000),
    lastError: null,
    dedupeKey: "calendar-inbound:conn-a",
    payload: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function memory(options?: {
  connection?: CalendarInboundConnection | null;
  appointment?: CalendarInboundCrmAppointment | null;
  mapping?: CalendarInboundMapping | null;
  mappings?: CalendarInboundMapping[];
  cursor?: string | null;
  outboundRunning?: boolean;
}) {
  const state = {
    connection: options && "connection" in options ? options.connection ?? null : connection(),
    appointment: options && "appointment" in options ? options.appointment ?? null : appointment(),
    mapping: options && "mapping" in options ? options.mapping ?? null : mapping(),
    mappings: options?.mappings,
    jobs: [] as CalendarInboundJob[],
    cursor: options && "cursor" in options ? options.cursor ?? null : null,
    events: [] as string[],
    outboundRunning: options?.outboundRunning ?? false,
    updates: 0,
  };
  const store: CalendarInboundStore = {
    async findConnection() {
      return state.connection;
    },
    async saveConnection(row) {
      state.connection = row;
    },
    async claimInboundJobs() {
      return state.jobs
        .filter((item) => item.status === "QUEUED")
        .slice(0, 5)
        .map((item) => ({
          ...item,
          status: "RUNNING" as const,
          leaseOwner: "worker-1",
        }));
    },
    async saveJob(next, opts) {
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
    async findMappingByMicrosoftEventId(_connectionId, microsoftEventId) {
      if (state.mappings) {
        return state.mappings.find((item) => item.microsoftEventId === microsoftEventId) ?? null;
      }
      return state.mapping?.microsoftEventId === microsoftEventId ? state.mapping : null;
    },
    async findActiveMappings() {
      if (state.mappings) return state.mappings.filter((item) => !item.deletedAt);
      return state.mapping && !state.mapping.deletedAt ? [state.mapping] : [];
    },
    async saveMapping(row) {
      state.mapping = row;
      if (state.mappings) {
        const idx = state.mappings.findIndex((item) => item.id === row.id);
        if (idx >= 0) state.mappings[idx] = row;
        else state.mappings.push(row);
      }
    },
    async findAppointment(appointmentId) {
      return state.appointment?.id === appointmentId ? state.appointment : null;
    },
    async updateAppointmentFields(appointmentId, data) {
      if (!state.appointment || state.appointment.id !== appointmentId) {
        return { ok: false as const, reason: "missing" as const };
      }
      if (state.appointment.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
        return { ok: false as const, reason: "revision" as const };
      }
      state.updates += 1;
      state.appointment = {
        ...state.appointment,
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.startAt !== undefined ? { startAt: data.startAt } : {}),
        ...(data.endAt !== undefined ? { endAt: data.endAt } : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.cancelledAt !== undefined ? { cancelledAt: data.cancelledAt } : {}),
        updatedAt: new Date(state.appointment.updatedAt.getTime() + 1000),
      };
      return { ok: true as const, appointment: state.appointment };
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
    async hasRunningOutboundForAppointment() {
      return state.outboundRunning;
    },
    async withAppointmentLock(_id, fn) {
      return fn();
    },
  };
  return { state, store };
}

function graphOf(
  handler: (path: string) => { status: number; json: unknown; retryAfter?: string; networkError?: boolean },
) {
  const calls: string[] = [];
  const graph: CalendarInboundGraph = {
    async request({ path }) {
      calls.push(path);
      const result = handler(path);
      return {
        status: result.status,
        json: result.json,
        retryAfter: result.retryAfter ?? null,
        ...(result.networkError ? { networkError: true } : {}),
      };
    },
  };
  return { graph, calls };
}

function runtime(store: CalendarInboundStore, graph: CalendarInboundGraph, allowed = true): CalendarInboundRuntime {
  return {
    now: () => NOW,
    graphAllowed: () => allowed,
    store,
    graph,
    tokenFor: async () => ({ ok: true, accessToken: "access-token" }),
  };
}

function eventPayload(partial: Record<string, unknown> = {}) {
  return {
    id: "ms-1",
    subject: "Site visit",
    body: { content: `<p>Bring samples</p><p>CRM reference: ${crmAppointmentReference("appt-1")}</p>` },
    start: { dateTime: "2026-11-05T10:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-11-05T11:00:00.0000000", timeZone: "UTC" },
    location: { displayName: "Depot" },
    isCancelled: false,
    changeKey: "ck-2",
    "@odata.etag": '"etag-2"',
    lastModifiedDateTime: "2026-11-01T11:00:00Z",
    ...partial,
  };
}

describe("inbound Microsoft Calendar sync", () => {
  it("does not claim or call Graph when the feature is disabled", async () => {
    const { state, store } = memory();
    state.jobs = [job({ status: "QUEUED" })];
    const { graph, calls } = graphOf(() => ({ status: 200, json: { value: [], "@odata.deltaLink": DELTA_LINK } }));
    const result = await runCalendarInboundBatch(runtime(store, graph, false));
    expect(result).toEqual({ processed: 0, graphCalls: false });
    expect(calls).toHaveLength(0);
  });

  it("ignores unmapped Outlook events and never imports them into CRM", async () => {
    const { state, store } = memory({ mapping: null });
    state.jobs = [job()];
    const { graph } = graphOf(() => ({
      status: 200,
      json: {
        value: [eventPayload({ id: "personal-1", subject: "Dentist" })],
        "@odata.deltaLink": DELTA_LINK,
      },
    }));
    // baseline already done so apply path runs
    state.connection = connection({ calendarInboundBaselineAt: new Date("2026-10-01T00:00:00.000Z") });
    state.cursor = DELTA_LINK;
    await processCalendarInboundJob(job(), runtime(store, graph));
    expect(state.updates).toBe(0);
    expect(state.events).toContain("CALENDAR_INBOUND_UNKNOWN");
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
  });

  it("stores a baseline cursor without applying historical Outlook edits", async () => {
    const { state, store } = memory({
      connection: connection({ calendarInboundBaselineAt: null }),
      appointment: appointment({ title: "CRM title" }),
      mapping: mapping({
        syncedSnapshot: null,
        lastCrmRevision: null,
      }),
    });
    state.jobs = [job()];
    const { graph } = graphOf(() => ({
      status: 200,
      json: {
        value: [eventPayload({ subject: "Outlook changed title" })],
        "@odata.deltaLink": DELTA_LINK,
      },
    }));
    await processCalendarInboundJob(job(), runtime(store, graph));
    expect(state.updates).toBe(0);
    expect(state.appointment?.title).toBe("CRM title");
    expect(state.cursor).toBe(DELTA_LINK);
    expect(state.connection?.calendarInboundBaselineAt).toEqual(NOW);
    expect(state.mapping?.syncStatus).toBe("CONFLICT");
    expect(state.events).toContain("CALENDAR_INBOUND_BASELINE");
  });

  it("applies a safe Outlook title change after baseline", async () => {
    const { state, store } = memory({
      connection: connection({ calendarInboundBaselineAt: new Date("2026-10-01T00:00:00.000Z") }),
      cursor: DELTA_LINK,
    });
    state.jobs = [job()];
    const { graph, calls } = graphOf(() => ({
      status: 200,
      json: {
        value: [eventPayload({ subject: "Outlook retitled" })],
        "@odata.deltaLink": `${DELTA_LINK_NEXT}`,
      },
    }));
    await processCalendarInboundJob(job(), runtime(store, graph));
    expect(calls.length).toBeGreaterThan(0);
    expect(state.updates).toBe(1);
    expect(state.appointment?.title).toBe("Outlook retitled");
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
    expect(state.events).toContain("CALENDAR_INBOUND_APPLIED");
  });

  it("records a conflict when both CRM and Outlook changed the same field", async () => {
    const { state, store } = memory({
      connection: connection({ calendarInboundBaselineAt: new Date("2026-10-01T00:00:00.000Z") }),
      cursor: DELTA_LINK,
      appointment: appointment({ title: "CRM retitled" }),
      mapping: mapping({
        syncedSnapshot: {
          title: "Site visit",
          description: "Bring samples",
          startAt: "2026-11-05T10:00:00.000Z",
          endAt: "2026-11-05T11:00:00.000Z",
          location: "Depot",
          status: "SCHEDULED",
          attendeesFingerprint: "",
        },
        lastCrmRevision: "2026-10-14T00:00:00.000Z",
      }),
    });
    state.jobs = [job()];
    const { graph } = graphOf(() => ({
      status: 200,
      json: {
        value: [eventPayload({ subject: "Outlook retitled" })],
        "@odata.deltaLink": `${DELTA_LINK_NEXT}`,
      },
    }));
    await processCalendarInboundJob(job(), runtime(store, graph));
    expect(state.updates).toBe(0);
    expect(state.appointment?.title).toBe("CRM retitled");
    expect(state.mapping?.syncStatus).toBe("CONFLICT");
  });

  it("soft-cancels CRM on external Outlook deletion and keeps history", async () => {
    const { state, store } = memory({
      connection: connection({ calendarInboundBaselineAt: new Date("2026-10-01T00:00:00.000Z") }),
      cursor: DELTA_LINK,
    });
    state.jobs = [job()];
    const { graph } = graphOf(() => ({
      status: 200,
      json: {
        value: [{ id: "ms-1", "@removed": { reason: "deleted" } }],
        "@odata.deltaLink": `${DELTA_LINK_NEXT}`,
      },
    }));
    await processCalendarInboundJob(job(), runtime(store, graph));
    expect(state.updates).toBe(1);
    expect(state.appointment?.status).toBe("CANCELLED");
    expect(state.appointment?.cancelledAt).toEqual(NOW);
    expect(state.appointment?.title).toBe("Site visit");
    expect(state.mapping?.syncStatus).toBe("REMOVED");
    expect(state.events).toContain("CALENDAR_INBOUND_REMOVED");
  });

  it("preserves CRM cancellation when Outlook tries to reopen", async () => {
    const { state, store } = memory({
      connection: connection({ calendarInboundBaselineAt: new Date("2026-10-01T00:00:00.000Z") }),
      cursor: DELTA_LINK,
      appointment: appointment({ status: "CANCELLED", cancelledAt: new Date("2026-10-20T00:00:00.000Z") }),
      mapping: mapping({
        syncedSnapshot: {
          title: "Site visit",
          description: "Bring samples",
          startAt: "2026-11-05T10:00:00.000Z",
          endAt: "2026-11-05T11:00:00.000Z",
          location: "Depot",
          status: "CANCELLED",
          attendeesFingerprint: "",
        },
      }),
    });
    state.jobs = [job()];
    const { graph } = graphOf(() => ({
      status: 200,
      json: {
        value: [eventPayload({ subject: "Reopened in Outlook", isCancelled: false })],
        "@odata.deltaLink": `${DELTA_LINK_NEXT}`,
      },
    }));
    await processCalendarInboundJob(job(), runtime(store, graph));
    expect(state.updates).toBe(0);
    expect(state.appointment?.status).toBe("CANCELLED");
    expect(state.mapping?.syncStatus).toBe("CONFLICT");
  });

  it("coalesces duplicate delta occurrences before apply", async () => {
    const { state, store } = memory({
      connection: connection({ calendarInboundBaselineAt: new Date("2026-10-01T00:00:00.000Z") }),
      cursor: DELTA_LINK,
    });
    state.jobs = [job()];
    const { graph } = graphOf(() => ({
      status: 200,
      json: {
        value: [
          eventPayload({ subject: "First", lastModifiedDateTime: "2026-11-01T10:00:00Z" }),
          eventPayload({ subject: "Second", lastModifiedDateTime: "2026-11-01T11:00:00Z" }),
        ],
        "@odata.deltaLink": `${DELTA_LINK_NEXT}`,
      },
    }));
    await processCalendarInboundJob(job(), runtime(store, graph));
    expect(state.updates).toBe(1);
    expect(state.appointment?.title).toBe("Second");
  });

  it("resets a stale delta cursor and requeues a baseline", async () => {
    const { state, store } = memory({
      connection: connection({ calendarInboundBaselineAt: new Date("2026-10-01T00:00:00.000Z") }),
      cursor: DELTA_LINK,
    });
    state.jobs = [job()];
    const { graph } = graphOf(() => ({ status: 410, json: { error: { code: "syncStateNotFound" } } }));
    await processCalendarInboundJob(job(), runtime(store, graph));
    expect(state.cursor).toBeNull();
    expect(state.connection?.calendarInboundBaselineAt).toBeNull();
    expect(state.jobs[0]?.status).toBe("QUEUED");
    expect(state.jobs[0]?.payload.baseline).toBe(true);
  });

  it("uses a bounded calendarView window for the initial delta URL", async () => {
    const { state, store } = memory({
      connection: connection({ calendarInboundBaselineAt: null }),
      cursor: null,
    });
    state.jobs = [job()];
    const { graph, calls } = graphOf((path) => {
      expect(path).toContain("/me/calendarView/delta?");
      expect(path).toContain("startDateTime=");
      expect(path).toContain("endDateTime=");
      return { status: 200, json: { value: [], "@odata.deltaLink": DELTA_LINK } };
    });
    await processCalendarInboundJob(job(), runtime(store, graph));
    expect(calls[0]).toContain("calendarView/delta");
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
  });

  it("reconciles outside-window mapped appointments via GET /me/events/{id}", async () => {
    const far = appointment({
      startAt: new Date("2028-06-01T10:00:00.000Z"),
      endAt: new Date("2028-06-01T11:00:00.000Z"),
    });
    const { state, store } = memory({
      connection: connection({ calendarInboundBaselineAt: new Date("2026-10-01T00:00:00.000Z") }),
      cursor: DELTA_LINK,
      appointment: far,
      mapping: mapping({
        syncedSnapshot: {
          title: "Site visit",
          description: "Bring samples",
          startAt: far.startAt.toISOString(),
          endAt: far.endAt.toISOString(),
          location: "Depot",
          status: "SCHEDULED",
          attendeesFingerprint: "",
        },
      }),
    });
    state.jobs = [job()];
    const { graph, calls } = graphOf((path) => {
      if (path.includes("/events/")) {
        return {
          status: 200,
          json: eventPayload({
            subject: "Far event updated",
            start: { dateTime: "2028-06-01T10:00:00.0000000", timeZone: "UTC" },
            end: { dateTime: "2028-06-01T11:00:00.0000000", timeZone: "UTC" },
          }),
        };
      }
      return { status: 200, json: { value: [], "@odata.deltaLink": `${DELTA_LINK_NEXT}` } };
    });
    await processCalendarInboundJob(job(), runtime(store, graph));
    expect(calls.some((path) => path.includes("/me/events/ms-1"))).toBe(true);
    expect(state.updates).toBe(1);
    expect(state.appointment?.title).toBe("Far event updated");
  });

  it("parses Graph calendar delta items", () => {
    const item = parseMicrosoftCalendarDeltaItem(eventPayload({ isCancelled: true }));
    expect(item?.id).toBe("ms-1");
    expect(item?.isCancelled).toBe(true);
    expect(item?.subject).toBe("Site visit");
  });
});
