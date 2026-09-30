/**
 * Ongoing Autopart 504 + TRM21QC schedule — 13:00 and 18:00 Europe/London, Mon–Fri.
 * Automatic execution remains gated by AutopartOngoingSalesFeedSettings.enabled (default false).
 */

import {
  londonBusinessDate,
  londonCivilTime,
  type DueStockWindow,
  type LondonCivilTime,
} from "@/domain/stock-schedule";

export const AUTOPART_ONGOING_SALES_TIMEZONE = "Europe/London";
export const AUTOPART_ONGOING_SALES_SCHEDULE_HOURS = [13, 18] as const;
export const AUTOPART_ONGOING_SALES_SCHEDULE_LABEL =
  "13:00 · 18:00 Europe/London (Monday–Friday)";

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

export function dueOngoingSalesWindow(
  date: Date,
  workingDaysOnly = true,
  hours: readonly number[] = AUTOPART_ONGOING_SALES_SCHEDULE_HOURS,
): DueStockWindow | null {
  if (workingDaysOnly && !isLondonWorkingDayOngoing(date)) return null;
  const local = londonCivilTime(date);
  if (!hours.length || local.hour < hours[0]!) return null;
  let hour = hours[0]!;
  for (const candidate of hours) {
    if (local.hour >= candidate) hour = candidate;
  }
  const businessDate = londonBusinessDate(local);
  return {
    key: `${businessDate}T${String(hour).padStart(2, "0")}:00`,
    hour,
    businessDate,
    label: `${String(hour).padStart(2, "0")}:00`,
  };
}

/** After the final expected daily window (18:00 London on a working day). */
export function isAfterFinalOngoingSalesWindow(date: Date, workingDaysOnly = true): boolean {
  if (workingDaysOnly && !isLondonWorkingDayOngoing(date)) return false;
  const local = londonCivilTime(date);
  const finalHour = AUTOPART_ONGOING_SALES_SCHEDULE_HOURS[AUTOPART_ONGOING_SALES_SCHEDULE_HOURS.length - 1]!;
  return local.hour > finalHour || (local.hour === finalHour && local.minute >= 0);
}
