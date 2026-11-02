/**
 * CRM appointment types and pure helpers.
 * No database access. Outlook sync policy lives in microsoft-calendar.ts.
 */

export const APPOINTMENT_TYPES = [
  "MEETING",
  "CALL",
  "CUSTOMER_VISIT",
  "FOLLOW_UP",
  "OTHER",
] as const;

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED"] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export type AppointmentAttendee = {
  email: string;
  name?: string | null;
  type: "required" | "optional";
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTENDEES = 20;

/** Appointments never sync to Outlook unless the caller explicitly opts in. */
export function defaultSyncToOutlook(): false {
  return false;
}

export function isAppointmentType(value: unknown): value is AppointmentType {
  return typeof value === "string" && (APPOINTMENT_TYPES as readonly string[]).includes(value);
}

export function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return typeof value === "string" && (APPOINTMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Validate, lowercase, and dedupe attendee emails. Cap at 20.
 * Bulk placeholders and clearly invalid addresses are dropped.
 */
export function normalizeAttendees(raw: unknown): AppointmentAttendee[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AppointmentAttendee[] = [];
  for (const item of raw) {
    if (out.length >= MAX_ATTENDEES) break;
    if (!item || typeof item !== "object") continue;
    const emailRaw = (item as { email?: unknown }).email;
    if (typeof emailRaw !== "string") continue;
    const email = emailRaw.trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) continue;
    if (email.includes(";") || email.includes(",") || email.includes(" ")) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    const nameRaw = (item as { name?: unknown }).name;
    const name =
      typeof nameRaw === "string" && nameRaw.trim()
        ? nameRaw.replace(/[\r\n]+/g, " ").trim().slice(0, 200)
        : null;
    const typeRaw = (item as { type?: unknown }).type;
    const type: "required" | "optional" = typeRaw === "optional" ? "optional" : "required";
    out.push({ email, name, type });
  }
  return out;
}

/** Sorted lowercase emails joined for conflict fingerprints. */
export function attendeesFingerprint(attendees: readonly AppointmentAttendee[]): string {
  return [...attendees]
    .map((item) => item.email.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

/**
 * True when any attendee email differs from the owner (case-insensitive).
 * External invites must not be sent without an explicit confirmation step.
 */
export function requiresExternalInviteConfirmation(
  attendees: readonly AppointmentAttendee[],
  ownerEmail: string | null | undefined,
): boolean {
  const owner = (ownerEmail ?? "").trim().toLowerCase();
  for (const attendee of attendees) {
    const email = attendee.email.trim().toLowerCase();
    if (!email) continue;
    if (!owner || email !== owner) return true;
  }
  return false;
}

/** Durable invite consent stored on CrmAppointment. Fingerprint-scoped to the attendee list. */
export type AppointmentInviteConsent = {
  fingerprint: string | null;
  revision: string | null;
  consentedAt: Date | null;
  consentedById: string | null;
};

/**
 * Durable consent is valid only when it matches the live attendee fingerprint.
 * An earlier confirmation must not authorise a later attendee-list change.
 */
export function hasValidInviteConsent(input: {
  attendees: readonly AppointmentAttendee[];
  consentFingerprint: string | null | undefined;
}): boolean {
  if (!input.attendees.length) return true;
  const live = attendeesFingerprint(input.attendees);
  if (!live) return true;
  return Boolean(input.consentFingerprint && input.consentFingerprint === live);
}

/**
 * Job-scoped invite flags are never enough alone. They must name the live attendee
 * fingerprint (and optionally the live appointment revision) at approval time.
 */
export function jobAttendeesConsentAllowsInvites(input: {
  attendees: readonly AppointmentAttendee[];
  appointmentRevision: string;
  attendeesConfirmed?: boolean | undefined;
  attendeesConsentFingerprint?: string | null | undefined;
  attendeesConsentRevision?: string | null | undefined;
}): boolean {
  if (!input.attendees.length) return true;
  if (input.attendeesConfirmed !== true) return false;
  const live = attendeesFingerprint(input.attendees);
  if (!live || input.attendeesConsentFingerprint !== live) return false;
  if (
    input.attendeesConsentRevision &&
    input.attendeesConsentRevision !== input.appointmentRevision
  ) {
    return false;
  }
  return true;
}

/** Resolve whether Outlook invites may be attached for this appointment revision. */
export function resolveAttendeesInviteAuthorisation(input: {
  attendees: readonly AppointmentAttendee[];
  appointmentRevision: string;
  consentFingerprint?: string | null | undefined;
  attendeesConfirmed?: boolean | undefined;
  attendeesConsentFingerprint?: string | null | undefined;
  attendeesConsentRevision?: string | null | undefined;
}): boolean {
  if (!input.attendees.length) return true;
  if (hasValidInviteConsent({ attendees: input.attendees, consentFingerprint: input.consentFingerprint })) {
    return true;
  }
  return jobAttendeesConsentAllowsInvites(input);
}

/** True when Outlook may include the current attendee list (no external invite, or durable consent). */
export function outlookInvitesAuthorised(input: {
  attendees: readonly AppointmentAttendee[];
  ownerEmail: string | null | undefined;
  consentFingerprint?: string | null | undefined;
}): boolean {
  if (!input.attendees.length) return true;
  if (!requiresExternalInviteConfirmation(input.attendees, input.ownerEmail)) return true;
  return hasValidInviteConsent({
    attendees: input.attendees,
    consentFingerprint: input.consentFingerprint,
  });
}

/**
 * API gate for create/update/retry. Enabling Outlook on a CRM-only appointment that already
 * has attendees requires the same explicit confirmation as changing the attendee list.
 */
export function mustConfirmOutlookInvites(input: {
  syncToOutlook: boolean;
  enablingOutlook?: boolean;
  attendeesChanged?: boolean;
  attendees: readonly AppointmentAttendee[];
  ownerEmail: string | null | undefined;
  existingConsentFingerprint?: string | null | undefined;
  confirmExternalInvites?: boolean | undefined;
}): { required: boolean; blocked: boolean; emails: string[] } {
  const emails = input.attendees.map((item) => item.email);
  const needs =
    input.syncToOutlook &&
    input.attendees.length > 0 &&
    requiresExternalInviteConfirmation(input.attendees, input.ownerEmail);
  if (!needs) return { required: false, blocked: false, emails };
  const consentValid = hasValidInviteConsent({
    attendees: input.attendees,
    consentFingerprint: input.existingConsentFingerprint,
  });
  // Enabling Outlook with existing attendees, or changing the attendee list, always
  // re-prompts. Retry only prompts when durable consent is missing or stale.
  const required =
    Boolean(input.attendeesChanged) || Boolean(input.enablingOutlook) || !consentValid;
  const blocked = required && input.confirmExternalInvites !== true;
  return { required, blocked, emails };
}
