/**
 * 216V arrives once per working day at approximately 18:15 Europe/London.
 * Do not reuse the 36-hour stock freshness rule.
 * Weekends must not alert merely because no Saturday/Sunday report exists.
 */

import { londonBusinessDate, londonCivilTime } from "@/domain/stock-schedule";
import { isLondonWorkingDayOngoing, londonIsoWeekdayOngoing } from "@/domain/autopart-ongoing-sales-schedule";
import { is216vWeekendCivilDate, previous216vWorkingDate, verified216vReportDate } from "@/domain/autopart-216v-report-date";

export const AUTOPART_216V_SCHEDULE_HOUR = 18;
export const AUTOPART_216V_SCHEDULE_MINUTE = 15;
/** Grace after 18:15 before "expected report not received". */
export const AUTOPART_216V_GRACE_MINUTES = 90;
export const AUTOPART_216V_SCHEDULE_LABEL = "Once per working day at 18:15 Europe/London";

export type Autopart216vFeedHealth =
  | "CURRENT"
  | "EXPECTED_REPORT_NOT_RECEIVED"
  | "WEEKEND_USING_LAST_WORKING_DAY"
  | "NO_SNAPSHOT";

export type Autopart216vFreshness = {
  status: Autopart216vFeedHealth;
  stale: boolean;
  expectedHour: number;
  lastBusinessDate: string | null;
  expectedBusinessDate: string;
  nextExpectedLabel: string;
  warning: string | null;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function shiftBusinessDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function previousLondonWorkingDate(iso: string): string {
  return previous216vWorkingDate(iso);
}

/**
 * Next report the feed still needs.
 * A working day whose report is not the current snapshot stays "today", even after 18:15.
 * Tomorrow is only next once today's report date is already current.
 */
export function next216vExpectedLabel(now = new Date(), lastReportDate: string | null = null): string {
  const local = londonCivilTime(now);
  const today = londonBusinessDate(local);
  const time = `approximately ${pad(AUTOPART_216V_SCHEDULE_HOUR)}:${pad(AUTOPART_216V_SCHEDULE_MINUTE)} Europe/London`;
  const reportCoversToday = Boolean(lastReportDate && lastReportDate >= today);
  if (isLondonWorkingDayOngoing(now) && !reportCoversToday) {
    return `${time} today`;
  }
  let cursor = today;
  for (let i = 1; i <= 7; i++) {
    cursor = shiftBusinessDate(cursor, 1);
    const [y, m, d] = cursor.split("-").map(Number);
    const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const [yy, mm, dd] = cursor.split("-");
      return `${time} ${dd}/${mm}/${yy}`;
    }
  }
  return `${time} next working day`;
}

export function resolveAutopart216vFreshness(input: {
  lastSuccessAt: Date | null;
  lastBusinessDate: string | null;
  now?: Date;
  scheduleHour?: number;
  graceMinutes?: number;
}): Autopart216vFreshness {
  const now = input.now ?? new Date();
  const hour = input.scheduleHour ?? AUTOPART_216V_SCHEDULE_HOUR;
  const grace = input.graceMinutes ?? AUTOPART_216V_GRACE_MINUTES;
  const local = londonCivilTime(now);
  const today = londonBusinessDate(local);
  const working = isLondonWorkingDayOngoing(now);
  const observedBusinessDate = input.lastBusinessDate;
  // A Saturday/Sunday stamp does not satisfy a Monday–Friday report.
  const lastBusinessDate = verified216vReportDate(observedBusinessDate);
  const nextExpectedLabel = next216vExpectedLabel(now, lastBusinessDate);
  const weekendObserved = is216vWeekendCivilDate(observedBusinessDate);

  if (!input.lastSuccessAt && !observedBusinessDate) {
    return {
      status: "NO_SNAPSHOT",
      stale: true,
      expectedHour: hour,
      lastBusinessDate: null,
      expectedBusinessDate: working ? today : previousLondonWorkingDate(today),
      nextExpectedLabel,
      warning: "No 216V snapshot has been imported yet.",
    };
  }

  if (!working) {
    const lastWorking = previousLondonWorkingDate(today);
    const stale = Boolean(lastBusinessDate && lastBusinessDate < lastWorking);
    return {
      status: stale ? "EXPECTED_REPORT_NOT_RECEIVED" : "WEEKEND_USING_LAST_WORKING_DAY",
      stale,
      expectedHour: hour,
      lastBusinessDate,
      expectedBusinessDate: lastWorking,
      nextExpectedLabel,
      warning: stale
        ? "Latest 216V is older than the last working day. Showing last available snapshot — backorders were not cleared."
        : weekendObserved
          ? "A weekend-dated 216V file is kept for review. No Saturday or Sunday report is expected."
          : null,
    };
  }

  const minutes = local.hour * 60 + local.minute;
  const dueMinutes = hour * 60 + AUTOPART_216V_SCHEDULE_MINUTE + grace;
  const todayDue = minutes >= dueMinutes;
  const expectedBusinessDate = todayDue ? today : previousLondonWorkingDate(today);

  if (lastBusinessDate && lastBusinessDate >= expectedBusinessDate) {
    return {
      status: "CURRENT",
      stale: false,
      expectedHour: hour,
      lastBusinessDate,
      expectedBusinessDate,
      nextExpectedLabel,
      warning: null,
    };
  }

  if (todayDue) {
    return {
      status: "EXPECTED_REPORT_NOT_RECEIVED",
      stale: true,
      expectedHour: hour,
      lastBusinessDate,
      expectedBusinessDate,
      nextExpectedLabel,
      warning: `Expected working-day 216V after ${pad(hour)}:${pad(AUTOPART_216V_SCHEDULE_MINUTE)} Europe/London has not arrived. Showing last available snapshot — backorders were not cleared.`,
    };
  }

  return {
    status: "CURRENT",
    stale: false,
    expectedHour: hour,
    lastBusinessDate,
    expectedBusinessDate,
    nextExpectedLabel,
    warning: null,
  };
}

export const AUTOPART_216V_SOURCE_LABEL: Record<string, string> = {
  MANUAL: "Manual upload",
  EMAIL: "Mailbox poll",
  SCHEDULE: "Autopart email",
};

export function label216vSnapshotSource(source: string | null | undefined): string | null {
  const raw = String(source ?? "").trim();
  if (!raw) return null;
  return AUTOPART_216V_SOURCE_LABEL[raw.toUpperCase()] ?? raw;
}

export type Autopart216vFeedHeadline =
  | "CURRENT"
  | "WAITING_FOR_TODAYS_REPORT"
  | "REPORT_OVERDUE"
  | "IMPORT_FAILED"
  | "NO_SNAPSHOT";

export const AUTOPART_216V_FEED_HEADLINE_LABEL: Record<Autopart216vFeedHeadline, string> = {
  CURRENT: "CURRENT",
  WAITING_FOR_TODAYS_REPORT: "WAITING FOR TODAY'S REPORT",
  REPORT_OVERDUE: "REPORT OVERDUE",
  IMPORT_FAILED: "IMPORT FAILED",
  NO_SNAPSHOT: "WAITING FOR TODAY'S REPORT",
};

/**
 * Compact operational headline. Does not change stale/CURRENT freshness rules.
 * Waiting for today's 18:15 file is not overdue.
 */
export function headline216vFeedHealth(input: {
  status: Autopart216vFeedHealth;
  stale: boolean;
  lastError?: string | null;
  lastBusinessDate: string | null;
  now?: Date;
}): { key: Autopart216vFeedHeadline; label: string; tone: "good" | "warn" | "bad" } {
  const now = input.now ?? new Date();
  if (input.lastError && (input.stale || input.status === "NO_SNAPSHOT")) {
    return { key: "IMPORT_FAILED", label: AUTOPART_216V_FEED_HEADLINE_LABEL.IMPORT_FAILED, tone: "bad" };
  }
  if (input.status === "EXPECTED_REPORT_NOT_RECEIVED") {
    return { key: "REPORT_OVERDUE", label: AUTOPART_216V_FEED_HEADLINE_LABEL.REPORT_OVERDUE, tone: "bad" };
  }
  if (input.status === "NO_SNAPSHOT") {
    return { key: "NO_SNAPSHOT", label: AUTOPART_216V_FEED_HEADLINE_LABEL.NO_SNAPSHOT, tone: "warn" };
  }
  const local = londonCivilTime(now);
  const today = londonBusinessDate(local);
  const working = isLondonWorkingDayOngoing(now);
  const minutes = local.hour * 60 + local.minute;
  const beforeTodayDue = minutes < AUTOPART_216V_SCHEDULE_HOUR * 60 + AUTOPART_216V_SCHEDULE_MINUTE;
  const verifiedToday = Boolean(input.lastBusinessDate && !is216vWeekendCivilDate(input.lastBusinessDate) && input.lastBusinessDate >= today);
  if (working && beforeTodayDue && input.status === "CURRENT" && !verifiedToday) {
    return {
      key: "WAITING_FOR_TODAYS_REPORT",
      label: AUTOPART_216V_FEED_HEADLINE_LABEL.WAITING_FOR_TODAYS_REPORT,
      tone: "warn",
    };
  }
  return { key: "CURRENT", label: AUTOPART_216V_FEED_HEADLINE_LABEL.CURRENT, tone: "good" };
}

export function due216vPollWindow(now = new Date(), scheduleHour = AUTOPART_216V_SCHEDULE_HOUR): boolean {
  if (!isLondonWorkingDayOngoing(now)) return false;
  const local = londonCivilTime(now);
  const minutes = local.hour * 60 + local.minute;
  return minutes >= scheduleHour * 60 + AUTOPART_216V_SCHEDULE_MINUTE;
}

export { londonIsoWeekdayOngoing };
