/**
 * Campaign start and end are stored as UTC instants.
 * datetime-local fields are the staff member's wall clock, so they must not be
 * sliced from a UTC timestamp.
 */

const LOCAL_MINUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

export class CampaignLocalTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignLocalTimeError";
  }
}

export function utcIsoToDatetimeLocal(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new CampaignLocalTimeError("Invalid campaign time");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = pick("hour").padStart(2, "0");
  if (hour === "24") hour = "00";
  return `${pick("year")}-${pick("month").padStart(2, "0")}-${pick("day").padStart(2, "0")}T${hour}:${pick("minute").padStart(2, "0")}`;
}

function wallClockUtc(local: string): number {
  const match = LOCAL_MINUTE.exec(local);
  if (!match) throw new CampaignLocalTimeError("Enter a valid date and time");
  const [, year, month, day, hour, minute] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

function offsetMs(instant: Date, timeZone: string): number {
  return wallClockUtc(utcIsoToDatetimeLocal(instant.toISOString(), timeZone)) - instant.getTime();
}

/** Convert a datetime-local value in `timeZone` to a UTC ISO instant. */
export function datetimeLocalToUtcIso(local: string, timeZone: string): string {
  const wall = wallClockUtc(local);
  const firstOffset = offsetMs(new Date(wall), timeZone);
  let utcMs = wall - firstOffset;
  const secondOffset = offsetMs(new Date(utcMs), timeZone);
  if (secondOffset !== firstOffset) utcMs = wall - secondOffset;
  const formatted = utcIsoToDatetimeLocal(new Date(utcMs).toISOString(), timeZone);
  const wanted = local.slice(0, 16);
  if (formatted === wanted) return new Date(utcMs).toISOString();
  const alternate = new Date(wall - firstOffset);
  if (utcIsoToDatetimeLocal(alternate.toISOString(), timeZone) === wanted) return alternate.toISOString();
  throw new CampaignLocalTimeError("That local time does not exist because the clocks change. Choose a time after the change.");
}

/**
 * Keep the stored instant, including seconds, when the local field is unchanged.
 * An edited field is converted from the staff member's timezone back to UTC.
 */
export function campaignInstantForSave(input: {
  localValue: string;
  originalIso: string | null;
  timeZone: string;
}): string | null {
  if (!input.localValue.trim()) return null;
  if (input.originalIso) {
    const displayed = utcIsoToDatetimeLocal(input.originalIso, input.timeZone);
    if (displayed === input.localValue.slice(0, 16)) return input.originalIso;
  }
  return datetimeLocalToUtcIso(input.localValue, input.timeZone);
}
