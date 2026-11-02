import { describe, expect, it } from "vitest";

import {
  attendeesFingerprint,
  defaultSyncToOutlook,
  normalizeAttendees,
  requiresExternalInviteConfirmation,
} from "@/domain/crm-appointments";
import {
  MICROSOFT_CALENDAR_CURSOR_PREFIX,
  MICROSOFT_CALENDAR_DEFAULT_TIMEZONE,
  MICROSOFT_CALENDAR_DELTA_LOOKAHEAD_DAYS,
  MICROSOFT_CALENDAR_DELTA_LOOKBACK_DAYS,
  MICROSOFT_CALENDAR_INBOUND_JOB_KIND,
  MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND,
  MICROSOFT_CALENDAR_REFERENCE_PREFIX,
  MICROSOFT_CALENDAR_SYNC_FLAG,
  appointmentRevisionOf,
  assertCalendarGraphUrl,
  buildOutlookEventBody,
  calendarGraphAllowed,
  calendarInboundDedupeKey,
  calendarOutboundDedupeKey,
  calendarRetryDelayMs,
  calendarViewWindow,
  classifyCalendarOutbound,
  coalesceCalendarDeltaItems,
  crmAppointmentReference,
  diffCalendarFields,
  graphDateTimeToUtc,
  hasCalendarsReadWrite,
  inboundCursorResource,
  instantToGraphDateTime,
  isMicrosoftCalendarSyncEnabled,
  mayPostMicrosoftCalendarCreate,
  mergeCalendarDeltaOccurrence,
  ordinaryRetryIncludesJob,
  snapshotFromAppointment,
  validateAppointmentRange,
  wallTimeInZoneToUtc,
  type MicrosoftCalendarInboundFields,
} from "@/domain/microsoft-calendar";

function deltaItem(
  partial: Partial<MicrosoftCalendarInboundFields> & Pick<MicrosoftCalendarInboundFields, "id">,
): MicrosoftCalendarInboundFields {
  return {
    etag: null,
    changeKey: null,
    subject: null,
    bodyContent: null,
    start: null,
    end: null,
    location: null,
    isCancelled: null,
    lastModifiedDateTime: null,
    removed: false,
    ...partial,
  };
}

describe("Microsoft Calendar flags", () => {
  it("exports documentation constants", () => {
    expect(MICROSOFT_CALENDAR_SYNC_FLAG).toBe("MICROSOFT_365_CALENDAR_SYNC_ENABLED");
    expect(MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND).toBe("CALENDAR_OUTBOUND");
    expect(MICROSOFT_CALENDAR_INBOUND_JOB_KIND).toBe("CALENDAR_INBOUND");
    expect(MICROSOFT_CALENDAR_CURSOR_PREFIX).toBe("calendar-inbound:");
    expect(MICROSOFT_CALENDAR_REFERENCE_PREFIX).toBe("ab-crm-appointment:");
    expect(MICROSOFT_CALENDAR_DEFAULT_TIMEZONE).toBe("Europe/London");
    expect(MICROSOFT_CALENDAR_DELTA_LOOKBACK_DAYS).toBe(30);
    expect(MICROSOFT_CALENDAR_DELTA_LOOKAHEAD_DAYS).toBe(365);
  });

  it("stays off unless both CRM and calendar flags are explicitly enabled", () => {
    expect(isMicrosoftCalendarSyncEnabled(undefined)).toBe(false);
    expect(isMicrosoftCalendarSyncEnabled("false")).toBe(false);
    expect(isMicrosoftCalendarSyncEnabled("true")).toBe(true);
    expect(isMicrosoftCalendarSyncEnabled("ON")).toBe(true);
    expect(calendarGraphAllowed({ crmFlag: "true", calendarFlag: "false" })).toBe(false);
    expect(calendarGraphAllowed({ crmFlag: "false", calendarFlag: "true" })).toBe(false);
    expect(calendarGraphAllowed({ crmFlag: undefined, calendarFlag: "true" })).toBe(false);
    expect(calendarGraphAllowed({ crmFlag: "true", calendarFlag: undefined })).toBe(false);
    expect(calendarGraphAllowed({ crmFlag: "true", calendarFlag: "on" })).toBe(true);
  });

  it("does not depend on Tasks.ReadWrite for calendar consent checks", () => {
    expect(hasCalendarsReadWrite("Calendars.ReadWrite")).toBe(true);
    expect(hasCalendarsReadWrite("Tasks.ReadWrite")).toBe(false);
    expect(hasCalendarsReadWrite("https://graph.microsoft.com/Calendars.ReadWrite")).toBe(true);
  });
});

describe("Microsoft Calendar Graph URL allowlist", () => {
  it("allows events and calendarView paths", () => {
    expect(assertCalendarGraphUrl("/me/events")).toContain("https://graph.microsoft.com/v1.0/me/events");
    const graphId = "AAMkAGI2TG93AAA=";
    expect(assertCalendarGraphUrl(`/me/events/${encodeURIComponent(graphId)}`)).toContain(
      encodeURIComponent(graphId),
    );
    expect(
      assertCalendarGraphUrl(
        "/me/calendarView?startDateTime=2024-01-01T00:00:00Z&endDateTime=2025-01-01T00:00:00Z",
      ),
    ).toContain("/me/calendarView");
    expect(assertCalendarGraphUrl("/me/calendarView/delta?$deltatoken=abc")).toContain(
      "/me/calendarView/delta",
    );
  });

  it("refuses todo, mail, and unsafe ids", () => {
    expect(() => assertCalendarGraphUrl("/me/todo/lists")).toThrow(/not allowed/);
    expect(() => assertCalendarGraphUrl("/me/messages")).toThrow(/not allowed/);
    expect(() => assertCalendarGraphUrl("/me/mailFolders")).toThrow(/not allowed/);
    expect(() => assertCalendarGraphUrl("/me/drive/root")).toThrow(/not allowed/);
    expect(() => assertCalendarGraphUrl("/me/events/ab/cd")).toThrow(/not allowed/);
    expect(() => assertCalendarGraphUrl("/me/calendarView?$expand=attachments")).toThrow(
      /not allowed/,
    );
  });
});

describe("Microsoft Calendar create uncertainty", () => {
  it("blocks automatic Graph create after an uncertain outcome", () => {
    expect(mayPostMicrosoftCalendarCreate({ createUncertain: true })).toBe(false);
    expect(mayPostMicrosoftCalendarCreate({ createUncertain: true, reviewed: true })).toBe(false);
    expect(mayPostMicrosoftCalendarCreate({ createUncertain: true, authorizeCreateOnce: true })).toBe(
      true,
    );
    expect(
      mayPostMicrosoftCalendarCreate({
        createUncertain: true,
        recheckOnly: true,
        authorizeCreateOnce: true,
      }),
    ).toBe(false);
    expect(
      mayPostMicrosoftCalendarCreate({
        knownMicrosoftEventId: "evt-1",
        authorizeCreateOnce: true,
      }),
    ).toBe(false);
    expect(ordinaryRetryIncludesJob({ status: "NEEDS_REVIEW", createUncertain: true })).toBe(false);
    expect(ordinaryRetryIncludesJob({ status: "FAILED" })).toBe(true);
    expect(appointmentRevisionOf({ updatedAt: new Date("2026-10-15T00:00:00.000Z") })).toBe(
      "2026-10-15T00:00:00.000Z",
    );
  });
});

describe("Microsoft Calendar outbound eligibility", () => {
  it("never syncs without opt-in, explicit export, or an active mapping", () => {
    const appointment = { ownerId: "user-a" };
    expect(
      classifyCalendarOutbound({
        appointment,
        connectionUserId: "user-a",
        syncToOutlook: false,
        hasActiveMapping: false,
        release: false,
        explicit: false,
      }),
    ).toBe("skip");
    expect(
      classifyCalendarOutbound({
        appointment,
        connectionUserId: "user-a",
        syncToOutlook: true,
        hasActiveMapping: false,
        release: false,
        explicit: false,
      }),
    ).toBe("sync");
    expect(
      classifyCalendarOutbound({
        appointment,
        connectionUserId: "user-a",
        syncToOutlook: false,
        hasActiveMapping: true,
        release: false,
        explicit: false,
      }),
    ).toBe("sync");
    expect(
      classifyCalendarOutbound({
        appointment,
        connectionUserId: "user-a",
        syncToOutlook: false,
        hasActiveMapping: false,
        release: false,
        explicit: true,
      }),
    ).toBe("sync");
  });

  it("skips when the connection user is not the appointment owner", () => {
    expect(
      classifyCalendarOutbound({
        appointment: { ownerId: "user-a" },
        connectionUserId: "user-b",
        syncToOutlook: true,
        hasActiveMapping: true,
        release: false,
        explicit: true,
      }),
    ).toBe("skip");
  });

  it("releases previous owner copies and never syncs merely because a task exists", () => {
    expect(
      classifyCalendarOutbound({
        appointment: { ownerId: "user-b" },
        connectionUserId: "user-a",
        syncToOutlook: false,
        hasActiveMapping: true,
        release: true,
        explicit: false,
      }),
    ).toBe("release");
    expect(
      classifyCalendarOutbound({
        appointment: { ownerId: "user-a" },
        connectionUserId: "user-a",
        syncToOutlook: false,
        hasActiveMapping: false,
        release: true,
        explicit: false,
      }),
    ).toBe("skip");
    // No task-based path: syncToOutlook false + no mapping + no explicit => skip
    expect(
      classifyCalendarOutbound({
        appointment: { ownerId: "user-a" },
        connectionUserId: "user-a",
        syncToOutlook: false,
        hasActiveMapping: false,
        release: false,
        explicit: false,
      }),
    ).toBe("skip");
  });

  it("builds stable dedupe and cursor keys", () => {
    expect(calendarOutboundDedupeKey("u1", "a1", false)).toBe("calendar:u1:a1:upsert");
    expect(calendarOutboundDedupeKey("u1", "a1", true)).toBe("calendar:u1:a1:release");
    expect(calendarInboundDedupeKey("conn-1")).toBe("calendar-inbound:conn-1");
    expect(inboundCursorResource("conn-1")).toBe("calendar-inbound:conn-1");
    expect(crmAppointmentReference("appt-1")).toBe("ab-crm-appointment:appt-1");
  });
});

describe("Microsoft Calendar Europe/London DST", () => {
  it("shifts spring-forward non-existent local times forward", () => {
    // 2024-03-31 01:00 GMT → 02:00 BST; 01:30 does not exist.
    const shifted = wallTimeInZoneToUtc("Europe/London", 2024, 3, 31, 1, 30, 0);
    expect(shifted.toISOString()).toBe("2024-03-31T01:30:00.000Z"); // 02:30 BST
    const valid = wallTimeInZoneToUtc("Europe/London", 2024, 3, 31, 2, 30, 0);
    expect(valid.toISOString()).toBe("2024-03-31T01:30:00.000Z");
    expect(graphDateTimeToUtc("2024-03-31T01:30:00", "Europe/London")?.toISOString()).toBe(
      "2024-03-31T01:30:00.000Z",
    );
  });

  it("prefers the later absolute instant for autumn ambiguous local times", () => {
    // 2024-10-27 02:00 BST → 01:00 GMT; 01:30 occurs twice.
    // Later occurrence is GMT = 01:30 UTC (earlier would be 00:30 UTC / 01:30 BST).
    const ambiguous = wallTimeInZoneToUtc("Europe/London", 2024, 10, 27, 1, 30, 0);
    expect(ambiguous.toISOString()).toBe("2024-10-27T01:30:00.000Z");
    expect(graphDateTimeToUtc("2024-10-27T01:30:00", "Europe/London")?.toISOString()).toBe(
      "2024-10-27T01:30:00.000Z",
    );
  });

  it("round-trips wall clocks through Graph dateTime helpers", () => {
    const summer = new Date("2024-06-15T11:30:00.000Z");
    expect(instantToGraphDateTime(summer, "Europe/London")).toEqual({
      dateTime: "2024-06-15T12:30:00",
      timeZone: "Europe/London",
    });
    expect(graphDateTimeToUtc("2024-06-15T12:30:00", "Europe/London")?.toISOString()).toBe(
      summer.toISOString(),
    );
    const winter = new Date("2024-01-15T12:30:00.000Z");
    expect(instantToGraphDateTime(winter, "Europe/London")).toEqual({
      dateTime: "2024-01-15T12:30:00",
      timeZone: "Europe/London",
    });
  });
});

describe("Microsoft Calendar ranges and windows", () => {
  it("requires start before end", () => {
    const start = new Date("2026-11-02T10:00:00.000Z");
    const end = new Date("2026-11-02T11:00:00.000Z");
    expect(validateAppointmentRange(start, end)).toEqual({ ok: true });
    expect(validateAppointmentRange(end, start).ok).toBe(false);
    expect(validateAppointmentRange(start, start).ok).toBe(false);
  });

  it("builds a sliding calendarView window from lookback and lookahead constants", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    const window = calendarViewWindow(now);
    const startMs = Date.parse(window.startDateTime);
    const endMs = Date.parse(window.endDateTime);
    expect(now.getTime() - startMs).toBe(MICROSOFT_CALENDAR_DELTA_LOOKBACK_DAYS * 86_400_000);
    expect(endMs - now.getTime()).toBe(MICROSOFT_CALENDAR_DELTA_LOOKAHEAD_DAYS * 86_400_000);
    expect(window.startDateTime).toBe("2026-05-16T12:00:00.000Z");
    expect(window.endDateTime).toBe("2027-06-15T12:00:00.000Z");
  });

  it("honours Retry-After seconds with the same backoff as To Do", () => {
    expect(calendarRetryDelayMs(1, "12", new Date("2026-11-01T00:00:00.000Z"))).toBe(12_000);
    expect(calendarRetryDelayMs(0, null, new Date())).toBe(30_000);
    expect(calendarRetryDelayMs(3, null, new Date())).toBe(1_800_000);
  });
});

describe("Microsoft Calendar conflict and coalesce", () => {
  it("does not let Outlook overwrite a CRM cancellation", () => {
    const crm = snapshotFromAppointment({
      title: "Visit",
      description: "Notes",
      startAt: new Date("2026-11-02T10:00:00.000Z"),
      endAt: new Date("2026-11-02T11:00:00.000Z"),
      location: "Factory",
      status: "CANCELLED",
    });
    const lastSynced = { ...crm, status: "SCHEDULED" as const };
    const remote = {
      ...crm,
      status: "SCHEDULED" as const,
      title: "Outlook reopen",
    };
    const diff = diffCalendarFields(crm, remote, lastSynced);
    expect(diff.safeRemoteUpdates).toEqual({});
    expect(diff.conflicts.some((item) => /cancellation/i.test(item))).toBe(true);
  });

  it("applies Outlook field changes when CRM is unchanged since the snapshot", () => {
    const crm = snapshotFromAppointment({
      title: "Visit",
      description: "Notes",
      startAt: new Date("2026-11-02T10:00:00.000Z"),
      endAt: new Date("2026-11-02T11:00:00.000Z"),
      location: "Factory",
      status: "SCHEDULED",
    });
    const lastSynced = { ...crm };
    const remote = {
      ...crm,
      title: "Visit (moved)",
      location: "Office",
      startAt: "2026-11-02T14:00:00.000Z",
      endAt: "2026-11-02T15:00:00.000Z",
    };
    const diff = diffCalendarFields(crm, remote, lastSynced);
    expect(diff.conflicts).toEqual([]);
    expect(diff.safeRemoteUpdates).toMatchObject({
      title: "Visit (moved)",
      location: "Office",
      startAt: "2026-11-02T14:00:00.000Z",
      endAt: "2026-11-02T15:00:00.000Z",
    });
  });

  it("coalesces @removed and later restores for the same event id", () => {
    const updatedThenDeleted = coalesceCalendarDeltaItems([
      deltaItem({ id: "evt-1", subject: "Live", isCancelled: false }),
      deltaItem({ id: "evt-1", removed: true }),
    ]);
    expect(updatedThenDeleted[0]?.removed).toBe(true);

    const deletedThenReturned = coalesceCalendarDeltaItems([
      deltaItem({ id: "evt-1", removed: true }),
      deltaItem({ id: "evt-1", subject: "Restored", isCancelled: false }),
    ]);
    expect(deletedThenReturned[0]).toMatchObject({ removed: false, subject: "Restored" });

    const merged = mergeCalendarDeltaOccurrence(
      deltaItem({
        id: "evt-1",
        subject: "Newer",
        etag: "e2",
        lastModifiedDateTime: "2026-11-01T12:00:00Z",
      }),
      deltaItem({
        id: "evt-1",
        subject: "Older",
        changeKey: "ck1",
        lastModifiedDateTime: "2026-11-01T11:00:00Z",
      }),
    );
    expect(merged).toMatchObject({ subject: "Newer", etag: "e2", changeKey: "ck1" });
  });
});

describe("Microsoft Calendar event body", () => {
  const base = {
    id: "appt-1",
    ownerId: "user-a",
    title: "Dealer visit",
    description: ["Customer: Acme", "Account code: ABC123", "Bring catalogues"].join("\n"),
    startAt: new Date("2026-06-15T11:00:00.000Z"),
    endAt: new Date("2026-06-15T12:00:00.000Z"),
    location: "Showroom",
    status: "SCHEDULED" as const,
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  };

  it("scrubs private lines and keeps the CRM reference without Teams meetings", () => {
    const body = buildOutlookEventBody(base, "sync");
    expect(body.subject).toBe("Dealer visit");
    expect(body.body.contentType).toBe("html");
    expect(body.body.content).toContain("Bring catalogues");
    expect(body.body.content).toContain(crmAppointmentReference("appt-1"));
    expect(body.body.content).not.toContain("ABC123");
    expect(body.location).toEqual({ displayName: "Showroom" });
    expect(body.start).toEqual({ dateTime: "2026-06-15T12:00:00", timeZone: "Europe/London" });
    expect(body).not.toHaveProperty("isOnlineMeeting");
    expect(body.attendees).toBeUndefined();
  });

  it("attaches attendees only when explicitly confirmed", () => {
    const withoutConfirm = buildOutlookEventBody(
      {
        ...base,
        attendees: [{ email: "buyer@example.com", type: "required" }],
        attendeesConfirmed: false,
      },
      "sync",
    );
    expect(withoutConfirm.attendees).toBeUndefined();
    const confirmed = buildOutlookEventBody(
      {
        ...base,
        attendees: [{ email: "buyer@example.com", name: "Buyer", type: "required" }],
        attendeesConfirmed: true,
      },
      "sync",
    );
    expect(confirmed.attendees).toEqual([
      { emailAddress: { address: "buyer@example.com", name: "Buyer" }, type: "required" },
    ]);
  });
});

describe("CRM appointment helpers", () => {
  it("normalises attendees and detects external invite confirmation needs", () => {
    expect(defaultSyncToOutlook()).toBe(false);
    const attendees = normalizeAttendees([
      { email: "Alice@Example.com", name: "Alice", type: "required" },
      { email: "alice@example.com", type: "optional" },
      { email: "not-an-email", type: "required" },
      { email: "bob@example.com;carol@example.com", type: "required" },
      { email: "bob@example.com", type: "optional" },
    ]);
    expect(attendees).toEqual([
      { email: "alice@example.com", name: "Alice", type: "required" },
      { email: "bob@example.com", name: null, type: "optional" },
    ]);
    expect(attendeesFingerprint(attendees)).toBe("alice@example.com,bob@example.com");
    expect(requiresExternalInviteConfirmation(attendees, "alice@example.com")).toBe(true);
    expect(
      requiresExternalInviteConfirmation(
        [{ email: "alice@example.com", type: "required" }],
        "Alice@Example.com",
      ),
    ).toBe(false);
  });
});
