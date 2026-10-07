/**
 * Ongoing Autopart 504 + TRM21QC schedule — 13:15 and 18:15 Europe/London, Mon–Fri.
 * The 15-minute offset lets reports that leave Autopart around 13:02 / 18:02 arrive first.
 * Automatic execution remains gated by AutopartOngoingSalesFeedSettings.enabled (default false).
 * Poll Now does not use this schedule.
 */

import {
  londonBusinessDate,
  londonCivilTime,
  type DueStockWindow,
  type LondonCivilTime,
} from "@/domain/stock-schedule";

export const AUTOPART_ONGOING_SALES_TIMEZONE = "Europe/London";
export const AUTOPART_ONGOING_SALES_SCHEDULE_HOURS = [13, 18] as const;
/** Minutes past the hour. Windows open at 13:15 and 18:15, not on the hour. */
export const AUTOPART_ONGOING_SALES_SCHEDULE_MINUTE = 15;
export const AUTOPART_ONGOING_SALES_SCHEDULE_LABEL =
  "13:15 · 18:15 Europe/London (Monday–Friday)";

function shiftCivilDate(civil: Pick<LondonCivilTime, "year" | "month" | "day">, days: number) {
  const utc = Date.UTC(civil.year, civil.month - 1, civil.day + days);
  const shifted = new Date(utc);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Monday=1 … Sunday=7 in Europe/London. */
export function londonIsoWeekdayOngoing(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: AUTOPART_ONGOING_SALES_TIMEZONE,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[weekday] ?? 0;
}

export function isLondonWorkingDayOngoing(date: Date): boolean {
  const d = londonIsoWeekdayOngoing(date);
  return d >= 1 && d <= 5;
}

function slotLabel(hour: number, minute = AUTOPART_ONGOING_SALES_SCHEDULE_MINUTE): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function slotHasStarted(local: LondonCivilTime, hour: number, minute: number): boolean {
  return local.hour > hour || (local.hour === hour && local.minute >= minute);
}

function windowFor(
  local: Pick<LondonCivilTime, "year" | "month" | "day">,
  hour: number,
  minute: number,
): DueStockWindow {
  const businessDate = londonBusinessDate(local);
  const label = slotLabel(hour, minute);
  return {
    key: `${businessDate}T${label}`,
    hour,
    businessDate,
    label,
  };
}

export function dueOngoingSalesWindow(
  date: Date,
  workingDaysOnly = true,
  hours: readonly number[] = AUTOPART_ONGOING_SALES_SCHEDULE_HOURS,
): DueStockWindow | null {
  if (workingDaysOnly && !isLondonWorkingDayOngoing(date)) return null;
  const local = londonCivilTime(date);
  const minute = AUTOPART_ONGOING_SALES_SCHEDULE_MINUTE;
  if (!hours.length || !slotHasStarted(local, hours[0]!, minute)) return null;
  let hour = hours[0]!;
  for (const candidate of hours) {
    if (slotHasStarted(local, candidate, minute)) hour = candidate;
  }
  return windowFor(local, hour, minute);
}

/**
 * Next automatic poll. Weekends and times after the evening slot roll forward
 * to the next Monday–Friday 13:15. Manual Poll Now is not limited by this.
 */
export function nextOngoingSalesWindow(
  date: Date,
  workingDaysOnly = true,
  hours: readonly number[] = AUTOPART_ONGOING_SALES_SCHEDULE_HOURS,
): DueStockWindow {
  const minute = AUTOPART_ONGOING_SALES_SCHEDULE_MINUTE;
  const local = londonCivilTime(date);
  if (hours.length && (!workingDaysOnly || isLondonWorkingDayOngoing(date))) {
    const upcoming = hours.find((hour) => !slotHasStarted(local, hour, minute));
    if (upcoming != null) return windowFor(local, upcoming, minute);
  }
  let cursor: Pick<LondonCivilTime, "year" | "month" | "day"> = local;
  for (let i = 0; i < 8; i += 1) {
    cursor = shiftCivilDate(cursor, 1);
    const probe = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day, 12, 0, 0));
    if (workingDaysOnly && !isLondonWorkingDayOngoing(probe)) continue;
    const hour = hours[0] ?? AUTOPART_ONGOING_SALES_SCHEDULE_HOURS[0];
    return windowFor(cursor, hour, minute);
  }
  return windowFor(local, hours[0] ?? 13, minute);
}

/** After the final expected daily window (18:15 London on a working day). */
export function isAfterFinalOngoingSalesWindow(date: Date, workingDaysOnly = true): boolean {
  if (workingDaysOnly && !isLondonWorkingDayOngoing(date)) return false;
  const local = londonCivilTime(date);
  const finalHour = AUTOPART_ONGOING_SALES_SCHEDULE_HOURS[AUTOPART_ONGOING_SALES_SCHEDULE_HOURS.length - 1]!;
  return slotHasStarted(local, finalHour, AUTOPART_ONGOING_SALES_SCHEDULE_MINUTE);
}
