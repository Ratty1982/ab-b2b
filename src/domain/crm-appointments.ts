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
