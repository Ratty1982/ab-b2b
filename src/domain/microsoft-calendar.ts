/**
 * Microsoft Outlook Calendar sync policy.
 * CRM appointments stay authoritative. This module does not call Microsoft or read the database.
 * Graph event creation has no supported idempotency header. Ambiguous creates are reconciled
 * by the stable `ab-crm-appointment:{appointmentId}` reference before another event is created.
 *
 * calendarView / calendarView/delta covers only a bounded sliding window (lookback + lookahead).
 * Appointments whose start/end fall outside that window must be reconciled with
 * GET /me/events/{id} using MicrosoftCalendarMapping.microsoftEventId. One delta cursor does
 * not cover the lifetime calendar.
 */
import { attendeesFingerprint, type AppointmentAttendee, type AppointmentStatus } from "@/domain/crm-appointments";
import { grantedScopeSet, isMicrosoft365CrmEnabled, MICROSOFT_365_CALENDAR_SCOPE } from "@/domain/microsoft-365-crm";
import { resolveMicrosoftGraphUrl } from "@/domain/microsoft-graph-security";
import { ordinaryRetryIncludesJob as todoOrdinaryRetryIncludesJob } from "@/domain/microsoft-todo-outbound";
import { BUSINESS_TIME_ZONE, londonWallTimeToUtc } from "@/lib/datetime";

/** Documentation constant for the env flag name. Not read from process.env here. */
export const MICROSOFT_CALENDAR_SYNC_FLAG = "MICROSOFT_365_CALENDAR_SYNC_ENABLED";
export const MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND = "CALENDAR_OUTBOUND";
export const MICROSOFT_CALENDAR_INBOUND_JOB_KIND = "CALENDAR_INBOUND";
export const MICROSOFT_CALENDAR_CURSOR_PREFIX = "calendar-inbound:";
export const MICROSOFT_CALENDAR_REFERENCE_PREFIX = "ab-crm-appointment:";
export const MICROSOFT_CALENDAR_MAX_ATTEMPTS = 5;
export const MICROSOFT_CALENDAR_DEFAULT_TIMEZONE = "Europe/London";
/** Sliding calendarView window: lookback days / lookahead days */
export const MICROSOFT_CALENDAR_DELTA_LOOKBACK_DAYS = 30;
export const MICROSOFT_CALENDAR_DELTA_LOOKAHEAD_DAYS = 365;

const ON = new Set(["1", "true", "on", "yes"]);

export function isMicrosoftCalendarSyncEnabled(flag: string | undefined): boolean {
  if (flag == null) return false;
  return ON.has(flag.trim().toLowerCase());
}

/**
 * Both flags are required. Independent of MICROSOFT_365_TASK_* flags.
 * The main Microsoft CRM flag alone does not turn calendar sync on.
 */
export function calendarGraphAllowed(env: {
  crmFlag?: string | undefined;
  calendarFlag?: string | undefined;
}): boolean {
  return isMicrosoft365CrmEnabled(env.crmFlag) && isMicrosoftCalendarSyncEnabled(env.calendarFlag);
}

export function hasCalendarsReadWrite(scopes: string | undefined): boolean {
  return grantedScopeSet(scopes).has(MICROSOFT_365_CALENDAR_SCOPE);
}

export function crmAppointmentReference(appointmentId: string): string {
  return `${MICROSOFT_CALENDAR_REFERENCE_PREFIX}${appointmentId}`;
}

/**
 * Graph event POST is not idempotent. After a timeout, interruption, or HTTP 5xx the remote
 * event may already exist even when a later lookup finds nothing. Those jobs keep
 * `createUncertain` until an operator explicitly authorises one create for that job.
 * Ordinary "Retry failed sync" must never set that authorisation. A known remote id is
 * never created again. Recheck-only runs look up and adopt, but never POST.
 */
export function mayPostMicrosoftCalendarCreate(payload: {
  createUncertain?: boolean | undefined;
  reviewed?: boolean | undefined;
  authorizeCreateOnce?: boolean | undefined;
  recheckOnly?: boolean | undefined;
  knownMicrosoftEventId?: string | undefined;
}): boolean {
  if (payload.knownMicrosoftEventId) return false;
  if (payload.recheckOnly) return false;
  if (payload.createUncertain) return payload.authorizeCreateOnce === true;
  return true;
}

/** Same ordinary-retry gate as To Do outbound. Uncertain creates stay on the review workflow. */
export const ordinaryRetryIncludesJob = todoOrdinaryRetryIncludesJob;

export function calendarOutboundDedupeKey(
  userId: string,
  appointmentId: string,
  release: boolean,
): string {
  return `calendar:${userId}:${appointmentId}:${release ? "release" : "upsert"}`;
}

export function calendarInboundDedupeKey(connectionId: string): string {
  return `calendar-inbound:${connectionId}`;
}

/** calendarView is per-user default calendar, not a list — cursor resource is connection-scoped. */
export function inboundCursorResource(connectionId: string): string {
  return `${MICROSOFT_CALENDAR_CURSOR_PREFIX}${connectionId}`;
}

export type CalendarAppointmentSnapshot = {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  location: string | null;
  status: AppointmentStatus;
  timeZone?: string | undefined;
  attendees?: readonly AppointmentAttendee[] | undefined;
  /** External invites are only attached when the caller confirms after an explicit prompt. */
  attendeesConfirmed?: boolean | undefined;
  updatedAt: Date;
};

export type CalendarOutboundEligibility = "sync" | "skip" | "release";

/**
 * Opt-in only. Never sync merely because a related CRM Task exists.
 * Requires ownerId === connectionUserId and (explicit || syncToOutlook || hasActiveMapping).
 */
export function classifyCalendarOutbound(input: {
  appointment: Pick<CalendarAppointmentSnapshot, "ownerId">;
  connectionUserId: string;
  syncToOutlook: boolean;
  hasActiveMapping: boolean;
  release: boolean;
  explicit: boolean;
}): CalendarOutboundEligibility {
  if (input.release) {
    return input.appointment.ownerId === input.connectionUserId ? "skip" : "release";
  }
  if (input.appointment.ownerId !== input.connectionUserId) return "skip";
  if (input.explicit || input.syncToOutlook || input.hasActiveMapping) return "sync";
  return "skip";
}

export function appointmentRevisionOf(appt: Pick<{ updatedAt: Date }, "updatedAt">): string {
  return appt.updatedAt.toISOString();
}

export function calendarRetryDelayMs(attempt: number, retryAfter: string | null, now: Date): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
    const parsed = Date.parse(retryAfter);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(parsed - now.getTime(), 24 * 60 * 60 * 1000));
  }
  const steps = [30_000, 120_000, 480_000, 1_800_000];
  return steps[Math.min(Math.max(attempt, 0), steps.length - 1)] ?? 1_800_000;
}

const CALENDAR_ID_RE = /^[A-Za-z0-9!@._\-{}()+=]+$/;

/** Opaque Graph event ids. Slash and traversal stay refused. Similar to To Do resource ids. */
export function isSafeCalendarResourceId(value: string | null | undefined): boolean {
  if (value == null) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) return false;
  if (
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed.includes("%")
  ) {
    return false;
  }
  return CALENDAR_ID_RE.test(trimmed);
}

const CALENDAR_PATHS = [
  /^\/v1\.0\/me\/events$/,
  /^\/v1\.0\/me\/events\/[^/]+$/,
  /^\/v1\.0\/me\/calendarView$/,
  /^\/v1\.0\/me\/calendarView\/delta$/,
];

const CALENDAR_QUERY_ALLOWLIST = new Set([
  "startdatetime",
  "enddatetime",
  "$select",
  "$top",
  "$skiptoken",
  "$deltatoken",
  "$filter",
  "$orderby",
]);

/**
 * Only default-calendar event and calendarView endpoints.
 * Refuses todo, mail, drives, and other Graph areas.
 */
export function assertCalendarGraphUrl(pathOrUrl: string): string {
  const url = new URL(resolveMicrosoftGraphUrl(pathOrUrl));
  if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com") {
    throw new Error("Microsoft Calendar path is not allowed");
  }
  if (!CALENDAR_PATHS.some((pattern) => pattern.test(url.pathname))) {
    throw new Error("Microsoft Calendar path is not allowed");
  }
  const ids = url.pathname
    .split("/")
    .filter(
      (part) =>
        part &&
        part !== "v1.0" &&
        part !== "me" &&
        part !== "events" &&
        part !== "calendarView" &&
        part !== "delta",
    );
  for (const id of ids) {
    if (!isSafeCalendarResourceId(decodeURIComponent(id))) {
      throw new Error("Microsoft Calendar path is not allowed");
    }
  }
  const isCalendarView =
    url.pathname === "/v1.0/me/calendarView" || url.pathname === "/v1.0/me/calendarView/delta";
  for (const key of url.searchParams.keys()) {
    if (isCalendarView) {
      if (!CALENDAR_QUERY_ALLOWLIST.has(key.toLowerCase())) {
        throw new Error("Microsoft Calendar query parameter is not allowed");
      }
    } else if (!CALENDAR_QUERY_ALLOWLIST.has(key.toLowerCase())) {
      throw new Error("Microsoft Calendar query parameter is not allowed");
    }
  }
  return url.toString();
}

export function validateAppointmentRange(startAt: Date, endAt: Date): { ok: true } | { ok: false; reason: string } {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { ok: false, reason: "Appointment start or end is invalid" };
  }
  if (!(startAt.getTime() < endAt.getTime())) {
    return { ok: false, reason: "Appointment start must be before end" };
  }
  return { ok: true };
}

function zoneParts(instant: Date, timeZone: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
}

function pickPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "00";
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zoneParts(instant, timeZone);
  const asUtc = Date.UTC(
    Number(pickPart(parts, "year")),
    Number(pickPart(parts, "month")) - 1,
    Number(pickPart(parts, "day")),
    Number(pickPart(parts, "hour")),
    Number(pickPart(parts, "minute")),
    Number(pickPart(parts, "second")),
  );
  return asUtc - instant.getTime();
}

function wallMatches(instant: Date, timeZone: string, target: string): boolean {
  const parts = zoneParts(instant, timeZone);
  const wall = `${pickPart(parts, "year")}-${pickPart(parts, "month")}-${pickPart(parts, "day")}T${pickPart(parts, "hour")}:${pickPart(parts, "minute")}:${pickPart(parts, "second")}`;
  return wall === target;
}

/**
 * Convert an IANA zone wall-clock civil time to a UTC Date.
 *
 * DST rules:
 * - Ambiguous local times (autumn fall-back): prefer the later absolute instant
 *   (post-transition / standard offset).
 * - Non-existent local times (spring forward gap): shift forward to the next valid instant.
 *
 * Europe/London uses londonWallTimeToUtc; other zones use the same Intl offset technique.
 */
export function wallTimeInZoneToUtc(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const timeZone = zone.trim() || MICROSOFT_CALENDAR_DEFAULT_TIMEZONE;
  if (timeZone === BUSINESS_TIME_ZONE || timeZone === MICROSOFT_CALENDAR_DEFAULT_TIMEZONE) {
    return londonWallTimeToUtc(year, month, day, hour, minute, second);
  }

  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const target = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;

  let instant = new Date(wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), timeZone));
  const adjusted = new Date(wallAsUtc - zoneOffsetMs(instant, timeZone));
  if (adjusted.getTime() !== instant.getTime()) instant = adjusted;

  if (wallMatches(instant, timeZone, target)) {
    // Ambiguity: also try +1h (earlier DST occurrence). Prefer the later absolute instant.
    const earlier = new Date(instant.getTime() - 3_600_000);
    if (wallMatches(earlier, timeZone, target) && earlier.getTime() < instant.getTime()) {
      return instant;
    }
    return instant;
  }

  // Spring-forward gap: walk forward in 15-minute steps until the wall clock is valid, then
  // land on the first valid instant at or after the requested civil time.
  for (let step = 1; step <= 8; step += 1) {
    const candidate = new Date(instant.getTime() + step * 15 * 60_000);
    const parts = zoneParts(candidate, timeZone);
    const wallHour = Number(pickPart(parts, "hour"));
    const wallMinute = Number(pickPart(parts, "minute"));
    const wallSecond = Number(pickPart(parts, "second"));
    const wallDay = `${pickPart(parts, "year")}-${pickPart(parts, "month")}-${pickPart(parts, "day")}`;
    const dayKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (wallDay !== dayKey) continue;
    const requestedMinutes = hour * 60 + minute;
    const wallMinutes = wallHour * 60 + wallMinute;
    if (wallMinutes >= requestedMinutes && wallSecond === second) {
      return candidate;
    }
  }
  return instant;
}

/** Format a UTC instant as a Graph dateTimeTimeZone wall clock in `timeZone`. */
export function instantToGraphDateTime(
  instant: Date,
  timeZone: string = MICROSOFT_CALENDAR_DEFAULT_TIMEZONE,
): { dateTime: string; timeZone: string } {
  const zone = timeZone.trim() || MICROSOFT_CALENDAR_DEFAULT_TIMEZONE;
  const parts = zoneParts(instant, zone);
  return {
    dateTime: `${pickPart(parts, "year")}-${pickPart(parts, "month")}-${pickPart(parts, "day")}T${pickPart(parts, "hour")}:${pickPart(parts, "minute")}:${pickPart(parts, "second")}`,
    timeZone: zone,
  };
}

/** Reverse of instantToGraphDateTime. Applies the DST rules documented on wallTimeInZoneToUtc. */
export function graphDateTimeToUtc(
  dateTime: string,
  timeZone: string = MICROSOFT_CALENDAR_DEFAULT_TIMEZONE,
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(dateTime.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  return wallTimeInZoneToUtc(timeZone, year, month, day, hour, minute, second);
}

const PRIVATE_LINE =
  /(account\s*(code|number)|autopart|credit\s*limit|sort\s*code|\bvat\b|bank\b|password|secret|net\s*spend|revenue|margin|gross\b)/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scrubDescriptionLines(description: string | null | undefined): string[] {
  const kept: string[] = [];
  for (const line of (description ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (PRIVATE_LINE.test(trimmed)) continue;
    if (/^(source|reason|customer|period|comparison):/i.test(trimmed)) continue;
    if (/^[A-Za-z][A-Za-z0-9 ._-]*:\s*\d+(\.\d+)?$/.test(trimmed)) continue;
    kept.push(trimmed);
  }
  return kept;
}

export type OutlookEventBody = {
  subject: string;
  body: { contentType: "html"; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  attendees?: Array<{
    emailAddress: { address: string; name?: string };
    type: "required" | "optional";
  }>;
  isCancelled?: boolean;
};

function outlookSubject(title: string, mode: "sync" | "cancel" | "release"): string {
  if (mode === "release") return "CRM appointment reassigned";
  if (mode === "cancel") return "Cancelled CRM appointment";
  const trimmed = title.replace(/[\r\n]+/g, " ").trim();
  return (trimmed || "CRM appointment").slice(0, 255);
}

function outlookHtmlBody(
  appointment: Pick<CalendarAppointmentSnapshot, "id" | "description">,
  mode: "sync" | "cancel" | "release",
): string {
  const reference = `CRM reference: ${crmAppointmentReference(appointment.id)}`;
  if (mode === "release") {
    return `<p>This CRM appointment was reassigned. It is no longer managed in this Microsoft account.</p><p>${escapeHtml(reference)}</p>`;
  }
  if (mode === "cancel") {
    return `<p>Cancelled in Automotive Brands CRM.</p><p>${escapeHtml(reference)}</p>`;
  }
  const notes = scrubDescriptionLines(appointment.description).join("\n").slice(0, 3500);
  if (!notes) return `<p>${escapeHtml(reference)}</p>`;
  const paragraphs = notes
    .split("\n")
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  return `${paragraphs}<p>${escapeHtml(reference)}</p>`;
}

/**
 * Build a Graph event body for create/patch.
 * Does not set isOnlineMeeting / Teams meeting flags.
 * Attendees are included only when explicitly provided and confirmed.
 */
export function buildOutlookEventBody(
  appointment: CalendarAppointmentSnapshot,
  mode: "sync" | "cancel" | "release",
): OutlookEventBody {
  const contentMode = mode === "sync" && appointment.status === "CANCELLED" ? "cancel" : mode;
  const zone =
    (appointment.timeZone?.trim() || MICROSOFT_CALENDAR_DEFAULT_TIMEZONE) ||
    MICROSOFT_CALENDAR_DEFAULT_TIMEZONE;
  const body: OutlookEventBody = {
    subject: outlookSubject(appointment.title, contentMode),
    body: { contentType: "html", content: outlookHtmlBody(appointment, contentMode) },
    start: instantToGraphDateTime(appointment.startAt, zone),
    end: instantToGraphDateTime(appointment.endAt, zone),
  };
  if (contentMode === "sync" && appointment.location?.trim()) {
    body.location = { displayName: appointment.location.replace(/[\r\n]+/g, " ").trim().slice(0, 500) };
  }
  if (contentMode === "cancel") {
    body.isCancelled = true;
  }
  if (
    contentMode === "sync" &&
    appointment.attendeesConfirmed === true &&
    appointment.attendees &&
    appointment.attendees.length > 0
  ) {
    body.attendees = appointment.attendees.map((attendee) => ({
      emailAddress: {
        address: attendee.email,
        ...(attendee.name ? { name: attendee.name } : {}),
      },
      type: attendee.type,
    }));
  }
  return body;
}

export type CalendarSyncedSnapshot = {
  title: string;
  description: string | null;
  startAt: string; // ISO
  endAt: string;
  location: string | null;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  attendeesFingerprint: string; // sorted emails join
};

export function snapshotFromAppointment(appointment: {
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  location: string | null;
  status: AppointmentStatus;
  attendees?: readonly AppointmentAttendee[] | undefined;
}): CalendarSyncedSnapshot {
  return {
    title: appointment.title,
    description: appointment.description,
    startAt: appointment.startAt.toISOString(),
    endAt: appointment.endAt.toISOString(),
    location: appointment.location,
    status: appointment.status,
    attendeesFingerprint: attendeesFingerprint(appointment.attendees ?? []),
  };
}

/**
 * Field-level conflict detection. Not last-write-wins.
 * CRM owns status CANCELLED — remote cannot silently undelete a CRM cancellation.
 * Microsoft may update subject/start/end/location/description when the CRM side
 * is unchanged since the last synced snapshot.
 */
export function diffCalendarFields(
  crm: CalendarSyncedSnapshot,
  remote: CalendarSyncedSnapshot,
  lastSynced: CalendarSyncedSnapshot | null,
): {
  conflicts: string[];
  safeRemoteUpdates: Partial<CalendarSyncedSnapshot>;
} {
  const conflicts: string[] = [];
  if (crm.status === "CANCELLED") {
    if (remote.status !== "CANCELLED") {
      conflicts.push("CRM cancellation takes precedence over Outlook reopen or completion");
    }
    return { conflicts, safeRemoteUpdates: {} };
  }

  const safeRemoteUpdates: Partial<CalendarSyncedSnapshot> = {};
  const last = lastSynced;

  const consider = <K extends keyof CalendarSyncedSnapshot>(field: K, label: string) => {
    const ms = remote[field];
    const crmValue = crm[field];
    const prev = last?.[field];
    if (ms === crmValue) return;
    const microsoftChanged = prev === undefined || ms !== prev;
    const crmChanged = prev === undefined ? false : crmValue !== prev;
    if (microsoftChanged && crmChanged && ms !== crmValue) {
      conflicts.push(`${label} changed in both CRM and Outlook; CRM value kept`);
      return;
    }
    if (microsoftChanged && !crmChanged) {
      safeRemoteUpdates[field] = ms as CalendarSyncedSnapshot[K];
    }
  };

  consider("title", "Title");
  consider("description", "Description");
  consider("startAt", "Start");
  consider("endAt", "End");
  consider("location", "Location");
  consider("attendeesFingerprint", "Attendees");

  if (remote.status !== crm.status) {
    const microsoftChanged = last === null || remote.status !== last.status;
    const crmChanged = last !== null && crm.status !== last.status;
    if (microsoftChanged && crmChanged) {
      conflicts.push("Status changed in both CRM and Outlook; CRM value kept");
    } else if (microsoftChanged && !crmChanged) {
      safeRemoteUpdates.status = remote.status;
    }
  }

  return { conflicts, safeRemoteUpdates };
}

export type MicrosoftCalendarInboundFields = {
  id: string;
  etag: string | null;
  changeKey: string | null;
  subject: string | null;
  bodyContent: string | null;
  start: { dateTime: string; timeZone: string } | null;
  end: { dateTime: string; timeZone: string } | null;
  location: string | null;
  isCancelled: boolean | null;
  lastModifiedDateTime: string | null;
  removed: boolean;
};

function parseModifiedAt(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Merge one Graph calendarView delta occurrence into the accumulated state for that event id.
 * Microsoft may return the same entity multiple times and may omit unchanged fields.
 * Removals (`@removed`) replace prior updates. A later non-removed item after @removed is a restore.
 */
export function mergeCalendarDeltaOccurrence(
  previous: MicrosoftCalendarInboundFields | undefined,
  incoming: MicrosoftCalendarInboundFields,
): MicrosoftCalendarInboundFields {
  if (incoming.removed) return { ...incoming };
  if (!previous || previous.removed) return { ...incoming };

  const prevMs = parseModifiedAt(previous.lastModifiedDateTime);
  const nextMs = parseModifiedAt(incoming.lastModifiedDateTime);
  const incomingIsOlder = prevMs != null && nextMs != null && nextMs < prevMs;
  const base = incomingIsOlder ? incoming : previous;
  const overlay = incomingIsOlder ? previous : incoming;
  return {
    id: overlay.id,
    removed: false,
    etag: overlay.etag ?? base.etag,
    changeKey: overlay.changeKey ?? base.changeKey,
    subject: overlay.subject ?? base.subject,
    bodyContent: overlay.bodyContent ?? base.bodyContent,
    start: overlay.start ?? base.start,
    end: overlay.end ?? base.end,
    location: overlay.location ?? base.location,
    isCancelled: overlay.isCancelled ?? base.isCancelled,
    lastModifiedDateTime: overlay.lastModifiedDateTime ?? base.lastModifiedDateTime,
  };
}

export function coalesceCalendarDeltaItems(
  items: readonly MicrosoftCalendarInboundFields[],
): MicrosoftCalendarInboundFields[] {
  const byId = new Map<string, MicrosoftCalendarInboundFields>();
  for (const item of items) {
    byId.set(item.id, mergeCalendarDeltaOccurrence(byId.get(item.id), item));
  }
  return [...byId.values()];
}

/**
 * Sliding calendarView window as ISO UTC strings for Graph startDateTime / endDateTime.
 * Lookback MICROSOFT_CALENDAR_DELTA_LOOKBACK_DAYS, lookahead MICROSOFT_CALENDAR_DELTA_LOOKAHEAD_DAYS.
 */
export function calendarViewWindow(now: Date = new Date()): {
  startDateTime: string;
  endDateTime: string;
} {
  const start = new Date(now.getTime() - MICROSOFT_CALENDAR_DELTA_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + MICROSOFT_CALENDAR_DELTA_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  return {
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
  };
}
