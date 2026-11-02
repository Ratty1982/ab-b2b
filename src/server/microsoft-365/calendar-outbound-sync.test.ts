import { describe, expect, it } from "vitest";

import { crmAppointmentReference } from "@/domain/microsoft-calendar";
import {
  processCalendarOutboundJob,
  runCalendarOutboundBatch,
  type CalendarOutboundAppointment,
  type CalendarOutboundConnection,
  type CalendarOutboundGraph,
  type CalendarOutboundJob,
  type CalendarOutboundMapping,
  type CalendarOutboundRuntime,
  type CalendarOutboundStore,
} from "@/server/microsoft-365/calendar-outbound-sync";

const NOW = new Date("2026-11-01T12:00:00.000Z");

function appointment(partial: Partial<CalendarOutboundAppointment> = {}): CalendarOutboundAppointment {
  return {
    id: "appt-1",
    ownerId: "user-a",
    title: "Site visit",
    description: "Bring samples\nAccount code: ABC123",
    startAt: new Date("2026-11-05T10:00:00.000Z"),
    endAt: new Date("2026-11-05T11:00:00.000Z"),
    location: "Depot",
    status: "SCHEDULED",
    timeZone: "Europe/London",
    attendees: [],
    updatedAt: new Date("2026-10-15T00:00:00.000Z"),
    syncToOutlook: true,
    ...partial,
  };
}

function connection(partial: Partial<CalendarOutboundConnection> = {}): CalendarOutboundConnection {
  return {
    id: "conn-a",
    userId: "user-a",
    status: "CONNECTED",
    tenantId: "11111111-1111-4111-8111-111111111111",
    microsoftUserId: "oid-a",
    scopes: "openid profile offline_access User.Read Calendars.ReadWrite",
    calendarSyncEnabled: true,
    calendarOutboundEnabledAt: new Date("2026-10-01T00:00:00.000Z"),
    accessTokenEncrypted: "v2:token",
    refreshTokenEncrypted: "v2:refresh",
    accessTokenExpiresAt: new Date("2026-11-01T13:00:00.000Z"),
    lastCalendarSyncAt: null,
    lastError: null,
    ...partial,
  };
}

function job(partial: Partial<CalendarOutboundJob> = {}): CalendarOutboundJob {
  return {
    id: "job-1",
    connectionId: "conn-a",
    userId: "user-a",
    kind: "CALENDAR_OUTBOUND",
    status: "RUNNING",
    attempt: 1,
    runAfter: NOW,
    leaseOwner: "worker-1",
    leaseUntil: new Date(NOW.getTime() + 60_000),
    lastError: null,
    dedupeKey: "calendar:user-a:appt-1:upsert",
    payload: { appointmentId: "appt-1" },
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function mapping(partial: Partial<CalendarOutboundMapping> = {}): CalendarOutboundMapping {
  return {
    id: "map-1",
    appointmentId: "appt-1",
    userId: "user-a",
    connectionId: "conn-a",
    microsoftEventId: "ms-1",
    immutableEventId: "ms-1",
    iCalUId: null,
    changeKey: "ck-1",
    remoteEtag: '"etag-1"',
    lastCrmRevision: null,
    syncedSnapshot: null,
    transactionId: null,
    outlookWebLink: null,
    syncStatus: "SYNCED",
    externalAttendees: false,
    lastError: null,
    lastSyncedAt: NOW,
    deletedAt: null,
    ...partial,
  };
}

function memory(options?: {
  appointment?: CalendarOutboundAppointment | null;
  connection?: CalendarOutboundConnection | null;
  mapping?: CalendarOutboundMapping | null;
}) {
  const state = {
    appointment: options && "appointment" in options ? options.appointment ?? null : appointment(),
    connection: options && "connection" in options ? options.connection ?? null : connection(),
    mapping: options?.mapping ?? null,
    jobs: [] as CalendarOutboundJob[],
    events: [] as string[],
    failMappingSave: false,
  };
  const store: CalendarOutboundStore = {
    async findConnection() {
      return state.connection;
    },
    async saveConnection(row) {
      state.connection = row;
    },
    async withConnectionLock(_id, fn) {
      return fn();
    },
    async findAppointment(appointmentId) {
      return state.appointment?.id === appointmentId ? state.appointment : null;
    },
    async findMapping() {
      return state.mapping;
    },
    async saveMapping(row) {
      if (state.failMappingSave) {
        state.failMappingSave = false;
        throw new Error("mapping write failed after Microsoft accepted the event");
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
      const row =
        state.jobs.find((item) => item.status === "QUEUED" && item.runAfter <= now) ??
        state.jobs.find((item) => item.status === "RUNNING" && item.leaseUntil && item.leaseUntil < now);
      if (!row) return [];
      row.status = "RUNNING";
      row.leaseOwner = owner;
      row.attempt += 1;
      return [{ ...row, payload: { ...row.payload } }];
    },
  };
  return { state, store };
}

function graphOf(
  handler: (
    method: string,
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ) => { status: number; json: unknown; retryAfter?: string; networkError?: boolean; etag?: string },
) {
  const calls: Array<{ method: string; path: string; body: unknown; headers?: Record<string, string> }> = [];
  const graph: CalendarOutboundGraph = {
    async request({ method, path, body, headers }) {
      calls.push({ method, path, body: body ?? null, headers });
      const result = handler(method, path, body ?? null, headers);
      return {
        status: result.status,
        json: result.json,
        retryAfter: result.retryAfter ?? null,
        etag: result.etag ?? null,
        ...(result.networkError ? { networkError: true } : {}),
      };
    },
  };
  return { graph, calls };
}

function runtime(store: CalendarOutboundStore, graph: CalendarOutboundGraph, allowed = true): CalendarOutboundRuntime {
  return {
    store,
    graph,
    tokenFor: async () => ({ ok: true, accessToken: "access-token" }),
    now: () => NOW,
    graphAllowed: () => allowed,
    newId: () => "map-1",
    newTransactionId: () => "txn-1",
  };
}

function happyGraph(extra?: {
  postStatus?: number;
  postJson?: unknown;
  lookup?: unknown;
  network?: boolean;
  retryAfter?: string;
}) {
  return graphOf((method, path) => {
    if (method === "GET" && path.includes("/calendarView")) {
      return { status: 200, json: extra?.lookup ?? { value: [] } };
    }
    if (method === "GET" && path.includes("/events/")) {
      return { status: 404, json: {} };
    }
    if (method === "POST" && path === "/me/events") {
      if (extra?.network) return { status: 0, json: null, networkError: true };
      return {
        status: extra?.postStatus ?? 201,
        json: extra?.postJson ?? { id: "ms-1", changeKey: "ck-new" },
        ...(extra?.retryAfter ? { retryAfter: extra.retryAfter } : {}),
      };
    }
    if (method === "PATCH") return { status: 200, json: { id: "ms-1", changeKey: "ck-2" } };
    return { status: 200, json: {} };
  });
}

describe("outbound Microsoft Calendar sync", () => {
  it("does not claim or call Graph when the feature is disabled", async () => {
    const { state, store } = memory();
    state.jobs = [job({ status: "QUEUED", attempt: 0 })];
    const { graph, calls } = happyGraph();
    const result = await runCalendarOutboundBatch(runtime(store, graph, false), "worker-1");
    expect(result).toEqual({ processed: 0, graphCalls: false });
    expect(calls).toHaveLength(0);
    expect(state.jobs[0]?.status).toBe("QUEUED");
  });

  it("does not call Graph without a connection, preference, or Calendars.ReadWrite", async () => {
    for (const partial of [
      { connection: null as CalendarOutboundConnection | null },
      { connection: connection({ calendarSyncEnabled: false }) },
      { connection: connection({ scopes: "openid profile offline_access User.Read" }) },
      { connection: connection({ status: "REVOKED" as const }) },
    ]) {
      const { state, store } = memory(partial);
      state.jobs = [job()];
      const { graph, calls } = happyGraph();
      await processCalendarOutboundJob(job(), runtime(store, graph));
      expect(calls).toHaveLength(0);
      expect(state.jobs[0]?.status === "CANCELLED" || state.jobs[0]?.status === "FAILED").toBe(true);
    }
  });

  it("skips CRM-only appointments that are not opted into Outlook", async () => {
    const { state, store } = memory({ appointment: appointment({ syncToOutlook: false }) });
    state.jobs = [job()];
    const { graph, calls } = happyGraph();
    await processCalendarOutboundJob(job(), runtime(store, graph));
    expect(calls).toHaveLength(0);
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
    expect(state.mapping).toBeNull();
  });

  it("creates an event on explicit opt-in even when syncToOutlook is false", async () => {
    const { state, store } = memory({ appointment: appointment({ syncToOutlook: false }) });
    state.jobs = [job({ payload: { appointmentId: "appt-1", explicit: true } })];
    const { graph, calls } = happyGraph();
    await processCalendarOutboundJob(
      job({ payload: { appointmentId: "appt-1", explicit: true } }),
      runtime(store, graph),
    );
    const created = calls.find((call) => call.method === "POST" && call.path === "/me/events");
    expect(created).toBeTruthy();
    const body = created?.body as { subject: string; body: { content: string }; transactionId: string };
    expect(body.subject).toBe("Site visit");
    expect(body.body.content).toContain("Bring samples");
    expect(body.body.content).not.toContain("ABC123");
    expect(body.body.content).toContain(crmAppointmentReference("appt-1"));
    expect(body.transactionId).toBe("txn-1");
    expect(created?.headers?.Prefer).toContain("ImmutableId");
    expect(state.mapping?.microsoftEventId).toBe("ms-1");
    expect(state.mapping?.transactionId).toBe("txn-1");
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
  });

  it("adopts an existing event after an ambiguous create instead of posting another", async () => {
    const { state, store } = memory();
    state.jobs = [job()];
    let posts = 0;
    const { graph } = graphOf((method, path) => {
      if (method === "GET" && path.includes("/calendarView")) {
        return posts === 0
          ? { status: 200, json: { value: [] } }
          : {
              status: 200,
              json: {
                value: [
                  {
                    id: "ms-existing",
                    body: { content: `CRM reference: ${crmAppointmentReference("appt-1")}` },
                  },
                ],
              },
            };
      }
      if (method === "POST" && path === "/me/events") {
        posts += 1;
        return { status: 0, json: null, networkError: true };
      }
      if (method === "PATCH") return { status: 200, json: { id: "ms-existing" } };
      return { status: 200, json: {} };
    });
    await processCalendarOutboundJob(job(), runtime(store, graph));
    expect(posts).toBe(1);
    expect(state.mapping?.microsoftEventId).toBe("ms-existing");
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
  });

  it("marks an uncertain create as needs review and does not POST again", async () => {
    const first = memory();
    first.state.jobs = [job()];
    const firstGraph = happyGraph({ network: true });
    await processCalendarOutboundJob(job(), runtime(first.store, firstGraph.graph));
    expect(first.state.jobs[0]?.status).toBe("NEEDS_REVIEW");
    expect(first.state.jobs[0]?.payload.createUncertain).toBe(true);

    const second = memory();
    second.state.jobs = [job({ payload: { appointmentId: "appt-1", createUncertain: true } })];
    let posts = 0;
    const secondGraph = graphOf((method, path) => {
      if (method === "GET") return { status: 200, json: { value: [] } };
      if (method === "POST" && path === "/me/events") {
        posts += 1;
        return { status: 201, json: { id: "ms-dup" } };
      }
      return { status: 200, json: {} };
    });
    await processCalendarOutboundJob(
      job({ payload: { appointmentId: "appt-1", createUncertain: true } }),
      runtime(second.store, secondGraph.graph),
    );
    expect(posts).toBe(0);
    expect(second.state.jobs[0]?.status).toBe("NEEDS_REVIEW");
    expect(second.state.mapping).toBeNull();
  });

  it("waits for Retry-After without marking create uncertain", async () => {
    const limited = memory();
    limited.state.jobs = [job()];
    const limitedGraph = happyGraph({ postStatus: 429, retryAfter: "12" });
    await processCalendarOutboundJob(job(), runtime(limited.store, limitedGraph.graph));
    expect(limited.state.jobs[0]?.status).toBe("QUEUED");
    expect(limited.state.jobs[0]?.payload.createUncertain).toBeUndefined();
    expect(limited.state.jobs[0]?.runAfter.toISOString()).toBe("2026-11-01T12:00:12.000Z");
  });

  it("requeues on timeout/network after create without claiming success", async () => {
    const { state, store } = memory();
    state.jobs = [job()];
    const { graph, calls } = happyGraph({ network: true });
    await processCalendarOutboundJob(job(), runtime(store, graph));
    expect(calls.some((call) => call.method === "POST")).toBe(true);
    expect(state.jobs[0]?.status).toBe("NEEDS_REVIEW");
    expect(state.mapping).toBeNull();
  });

  it("stops when the token cannot be refreshed", async () => {
    const { state, store } = memory();
    state.jobs = [job()];
    const { graph, calls } = happyGraph();
    const rt = runtime(store, graph);
    rt.tokenFor = async () => ({
      ok: false,
      code: "REVOKED",
      retryAfter: null,
      message: "Microsoft 365 needs to be connected again",
    });
    await processCalendarOutboundJob(job(), rt);
    expect(calls).toHaveLength(0);
    expect(state.jobs[0]?.status).toBe("CANCELLED");
  });

  it("soft-cancels Outlook and tombstones the mapping", async () => {
    const { state, store } = memory({
      mapping: mapping(),
      appointment: appointment({ status: "CANCELLED" }),
    });
    state.jobs = [job()];
    const { graph, calls } = happyGraph();
    await processCalendarOutboundJob(job(), runtime(store, graph));
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch).toBeTruthy();
    const body = patch?.body as { subject: string; isCancelled: boolean; showAs: string };
    expect(body.subject).toBe("Cancelled CRM appointment");
    expect(body.isCancelled).toBe(true);
    expect(body.showAs).toBe("free");
    expect(patch?.headers?.["If-Match"]).toBe("ck-1");
    expect(state.mapping?.syncStatus).toBe("TOMBSTONED");
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
  });

  it("requires attendeesConfirmed before attaching attendees", async () => {
    const withAttendees = appointment({
      attendees: [{ email: "buyer@example.com", name: "Buyer", type: "required" }],
    });
    const denied = memory({ appointment: withAttendees });
    denied.state.jobs = [job()];
    const deniedGraph = happyGraph();
    await processCalendarOutboundJob(job(), runtime(denied.store, deniedGraph.graph));
    const deniedBody = deniedGraph.calls.find((call) => call.method === "POST")?.body as {
      attendees?: unknown;
    };
    expect(deniedBody.attendees).toBeUndefined();

    const allowed = memory({ appointment: withAttendees });
    allowed.state.jobs = [job({ payload: { appointmentId: "appt-1", attendeesConfirmed: true } })];
    const allowedGraph = happyGraph();
    await processCalendarOutboundJob(
      job({ payload: { appointmentId: "appt-1", attendeesConfirmed: true } }),
      runtime(allowed.store, allowedGraph.graph),
    );
    const allowedBody = allowedGraph.calls.find((call) => call.method === "POST")?.body as {
      attendees: Array<{ emailAddress: { address: string } }>;
    };
    expect(allowedBody.attendees?.[0]?.emailAddress.address).toBe("buyer@example.com");
    expect(allowed.state.mapping?.externalAttendees).toBe(true);
  });

  it("patches an existing mapped event and does not create a duplicate", async () => {
    const { state, store } = memory({
      mapping: mapping(),
      appointment: appointment({ title: "Updated visit" }),
    });
    state.jobs = [job()];
    const { graph, calls } = happyGraph();
    await processCalendarOutboundJob(job(), runtime(store, graph));
    expect(calls.some((call) => call.method === "PATCH")).toBe(true);
    expect(calls.some((call) => call.method === "POST" && call.path === "/me/events")).toBe(false);
    expect(state.jobs[0]?.status).toBe("SUCCEEDED");
  });
});
