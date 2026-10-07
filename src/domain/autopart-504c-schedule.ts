/**
 * Autopart 504C schedule — 13:15 and 16:15 Europe/London, working days.
 * Automatic execution remains gated by Autopart504cFeedSettings.enabled (default false).
 * Poll Now does not use this schedule.
 */

import {
  londonBusinessDate,
  londonCivilTime,
  type DueStockWindow,
  type LondonCivilTime,
} from "@/domain/stock-schedule";

export const AUTOPART_504C_TIMEZONE = "Europe/London";
export const AUTOPART_504C_SCHEDULE_HOURS = [13, 16] as const;
export const AUTOPART_504C_SCHEDULE_MINUTE = 15;
export const AUTOPART_504C_SCHEDULE_LABEL = "13:15 · 16:15 Europe/London (working days)";

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
export function londonIsoWeekday(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: AUTOPART_504C_TIMEZONE,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[weekday] ?? 0;
}

export function isLondonWorkingDay(date: Date): boolean {
  const d = londonIsoWeekday(date);
  return d >= 1 && d <= 5;
}

function slotHasStarted(local: LondonCivilTime, hour: number): boolean {
  return local.hour > hour || (local.hour === hour && local.minute >= AUTOPART_504C_SCHEDULE_MINUTE);
}

function windowFor(local: Pick<LondonCivilTime, "year" | "month" | "day">, hour: number): DueStockWindow {
  const businessDate = londonBusinessDate(local);
  const label = `${String(hour).padStart(2, "0")}:${String(AUTOPART_504C_SCHEDULE_MINUTE).padStart(2, "0")}`;
  return {
    key: `${businessDate}T${label}`,
    hour,
    businessDate,
    label,
  };
}

export function due504cWindow(date: Date, workingDaysOnly = true): DueStockWindow | null {
  if (workingDaysOnly && !isLondonWorkingDay(date)) return null;
  const local = londonCivilTime(date);
  const hours = AUTOPART_504C_SCHEDULE_HOURS;
  if (!slotHasStarted(local, hours[0])) return null;
  let hour: number = hours[0];
  for (const candidate of hours) {
    if (slotHasStarted(local, candidate)) hour = candidate;
  }
  return windowFor(local, hour);
}

export function next504cWindow(date: Date, workingDaysOnly = true): DueStockWindow {
  let cursor = new Date(date.getTime());
  for (let i = 0; i < 10; i++) {
    const local = londonCivilTime(cursor);
    const hours = AUTOPART_504C_SCHEDULE_HOURS;
    const upcomingToday =
      (!workingDaysOnly || isLondonWorkingDay(cursor))
        ? hours.find((hour) => !slotHasStarted(local, hour))
        : undefined;
    if (upcomingToday != null) {
      return windowFor(local, upcomingToday);
    }
    const next = shiftCivilDate(local, 1);
    cursor = new Date(Date.UTC(next.year, next.month - 1, next.day, 8, 0, 0));
    // Jump to next working day morning
    while (workingDaysOnly && !isLondonWorkingDay(cursor)) {
      const c = londonCivilTime(cursor);
      const n = shiftCivilDate(c, 1);
      cursor = new Date(Date.UTC(n.year, n.month - 1, n.day, 8, 0, 0));
    }
    const morning = londonCivilTime(cursor);
    return windowFor(morning, hours[0]);
  }
  return windowFor(londonCivilTime(date), AUTOPART_504C_SCHEDULE_HOURS[0]);
}
