/**
 * RETAILA planning coverage from successful Autopart 504 / TRM21QC import runs.
 *
 * Invoice document dates alone do not prove the daily feed ran. Coverage uses
 * COMMITTED ONGOING_504 and ONGOING_TRM21QC import timestamps (Europe/London
 * civil days). Weekend days are not required — Autopart day-end schedules are
 * Monday–Friday.
 */

import { isLondonWorkingDayOngoing } from "@/domain/autopart-ongoing-sales-schedule";
import { addDaysIso, todayLondonDateOnly } from "@/domain/sales-history-period";

export const RETAILA_REPORTING_WINDOW_DAYS = 30;
/** After this many London calendar days without a successful 504+TRM pair, treat the feed as stale. */
export const RETAILA_REPORTING_STALE_AFTER_DAYS = 3;

export type RetailaImportDayMark = {
  /** Europe/London YYYY-MM-DD of the successful import completion/create time. */
  londonDay: string;
  type: "ONGOING_504" | "ONGOING_TRM21QC";
};

export type RetailaReportingCoverage = {
  complete: boolean;
  stale: boolean;
  /** True only when every required weekday has both feeds and the feed is not stale. */
  planningAllowed: boolean;
  requiredWeekdays: string[];
  missingWeekdays: string[];
  coveredWeekdays: string[];
  last504Day: string | null;
  lastTrmDay: string | null;
  windowFrom: string;
  windowTo: string;
  reason: string;
};

function isoWeekdayUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  // Date.UTC noon avoids DST edge cases for weekday of a civil YYYY-MM-DD.
  const day = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isRetailaReportingWeekday(iso: string): boolean {
  const weekday = isoWeekdayUtc(iso);
  return weekday >= 1 && weekday <= 5;
}

/** Weekdays in an inclusive London date window that must have both feeds. */
export function retailaReportingRequiredWeekdays(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    if (isRetailaReportingWeekday(cursor)) out.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return out;
}

function daysWithType(
  marks: RetailaImportDayMark[],
  type: RetailaImportDayMark["type"],
): Set<string> {
  return new Set(marks.filter((mark) => mark.type === type).map((mark) => mark.londonDay));
}

/**
 * Assess whether Autopart 504 + TRM processing covers the planning window.
 * Does not look at invoice dates or SKU sales totals.
 */
export function assessRetailaReportingCoverage(input: {
  marks: RetailaImportDayMark[];
  today?: string;
  windowDays?: number;
  staleAfterDays?: number;
  /** When true, today's weekday is required only if it is a working day. Default excludes today. */
  includeToday?: boolean;
}): RetailaReportingCoverage {
  const today = input.today ?? todayLondonDateOnly();
  const windowDays = input.windowDays ?? RETAILA_REPORTING_WINDOW_DAYS;
  const staleAfterDays = input.staleAfterDays ?? RETAILA_REPORTING_STALE_AFTER_DAYS;
  const windowFrom = addDaysIso(today, -(windowDays - 1));
  const windowTo = input.includeToday ? today : addDaysIso(today, -1);
  const requiredWeekdays =
    windowTo < windowFrom ? [] : retailaReportingRequiredWeekdays(windowFrom, windowTo);

  const days504 = daysWithType(input.marks, "ONGOING_504");
  const daysTrm = daysWithType(input.marks, "ONGOING_TRM21QC");
  const coveredWeekdays = requiredWeekdays.filter(
    (day) => days504.has(day) && daysTrm.has(day),
  );
  const missingWeekdays = requiredWeekdays.filter(
    (day) => !days504.has(day) || !daysTrm.has(day),
  );
  const last504Day = [...days504].sort().at(-1) ?? null;
  const lastTrmDay = [...daysTrm].sort().at(-1) ?? null;
  const lastPairDay = [...coveredWeekdays].sort().at(-1) ?? null;

  const staleCutoff = addDaysIso(today, -staleAfterDays);
  const stale =
    last504Day == null ||
    lastTrmDay == null ||
    last504Day < staleCutoff ||
    lastTrmDay < staleCutoff;

  const complete = missingWeekdays.length === 0 && requiredWeekdays.length > 0;
  const planningAllowed = complete && !stale;

  let reason: string;
  if (requiredWeekdays.length === 0) {
    reason =
      "No Autopart working days fall in the reporting window yet, so RETAILA planning coverage cannot be verified.";
  } else if (stale) {
    reason = `RETAILA planning is blocked because the latest successful 504/TRM feed is older than ${staleAfterDays} days. Sales history stays visible.`;
  } else if (!complete) {
    reason = `RETAILA planning is blocked because successful 504 and TRM21QC imports are missing for ${missingWeekdays.length} Autopart working day(s) in ${windowFrom}–${windowTo}. Invoice dates alone do not prove feed coverage.`;
  } else {
    reason = `Successful Autopart 504 and TRM21QC imports cover every required working day in ${windowFrom}–${windowTo}.`;
  }

  return {
    complete,
    stale,
    planningAllowed,
    requiredWeekdays,
    missingWeekdays,
    coveredWeekdays,
    last504Day,
    lastTrmDay,
    windowFrom,
    windowTo,
    reason,
  };
}

/** Helper for tests: build marks for consecutive working days. */
export function retailaCoverageMarksForWeekdays(
  days: string[],
  types: Array<RetailaImportDayMark["type"]> = ["ONGOING_504", "ONGOING_TRM21QC"],
): RetailaImportDayMark[] {
  return days.flatMap((londonDay) =>
    types.map((type) => ({ londonDay, type })),
  );
}

export function assertLondonWorkingDayHelper(date: Date): boolean {
  return isLondonWorkingDayOngoing(date);
}
