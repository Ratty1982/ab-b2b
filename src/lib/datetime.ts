/**
 * Human-facing date/time display for Automotive Brands.
 *
 * Storage / APIs remain UTC instants.
 * Presentation always uses IANA `Europe/London` (GMT in winter, BST in summer).
 * Never rely on the host or browser default timezone.
 */

export const BUSINESS_TIME_ZONE = "Europe/London";
export const BUSINESS_LOCALE = "en-GB";

export type InstantInput = Date | string | number | null | undefined;

const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDateOnly(value: unknown): value is string {
  return typeof value === "string" && ISO_CALENDAR_DATE.test(value.trim());
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((entry) => entry.type === type)?.value ?? "";
}

function londonParts(date: Date, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat(BUSINESS_LOCALE, {
    timeZone: BUSINESS_TIME_ZONE,
    hourCycle: "h23",
    ...options,
  }).formatToParts(date);
}

export function parseInstant(value: InstantInput): Date | null {
  if (value == null || value === "") return null;
  if (isCalendarDateOnly(value)) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function canonicalUtc(value: InstantInput): string | null {
  const date = parseInstant(value);
  return date ? date.toISOString() : null;
}

export function formatTimeZoneName(value: InstantInput): string | null {
  const date = parseInstant(value);
  if (!date) return null;
  const name = part(londonParts(date, { timeZoneName: "short", hour: "2-digit" }), "timeZoneName");
  return name || null;
}

export function formatDate(value: InstantInput): string | null {
  if (isCalendarDateOnly(value)) {
    const match = value.trim().match(ISO_CALENDAR_DATE);
    if (!match) return null;
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const date = parseInstant(value);
  if (!date) return null;
  const parts = londonParts(date, { day: "2-digit", month: "2-digit", year: "numeric" });
  const day = part(parts, "day");
  const month = part(parts, "month");
  const year = part(parts, "year");
  if (!day || !month || !year) return null;
  return `${day}/${month}/${year}`;
}

export function formatTime(
  value: InstantInput,
  options: { seconds?: boolean } = {},
): string | null {
  const date = parseInstant(value);
  if (!date) return null;
  const parts = londonParts(date, {
    hour: "2-digit",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" as const } : {}),
  });
  const hour = part(parts, "hour").padStart(2, "0");
  const minute = part(parts, "minute").padStart(2, "0");
  if (!hour || !minute) return null;
  if (options.seconds) {
    const second = part(parts, "second").padStart(2, "0");
    return `${hour}:${minute}:${second}`;
  }
  return `${hour}:${minute}`;
}

export function formatDateTime(
  value: InstantInput,
  options: { seconds?: boolean; timeZoneName?: boolean } = {},
): string | null {
  if (isCalendarDateOnly(value)) return formatDate(value);
  const datePart = formatDate(value);
  const timePart = formatTime(value, options.seconds ? { seconds: true } : {});
  if (!datePart || !timePart) return datePart;
  const zone = options.timeZoneName ? formatTimeZoneName(value) : null;
  return zone ? `${datePart}, ${timePart} ${zone}` : `${datePart}, ${timePart}`;
}

/** Operational / admin timestamps: UK date, 24-hour clock, seconds, GMT/BST. */
export function formatOperationalDateTime(value: InstantInput): string | null {
  return formatDateTime(value, { seconds: true, timeZoneName: true });
}

/** Audit / activity lines: UK date, 24-hour clock, zone, no seconds. */
export function formatAuditDateTime(value: InstantInput): string | null {
  return formatDateTime(value, { seconds: false, timeZoneName: true });
}

export function formatOrDash(
  formatted: string | null | undefined,
  empty = "—",
): string {
  return formatted?.trim() ? formatted : empty;
}

export function formatLondonScheduleLabel(label: string, at: InstantInput): string {
  const zone = formatTimeZoneName(at);
  return zone ? `${label} ${zone}` : label;
}
