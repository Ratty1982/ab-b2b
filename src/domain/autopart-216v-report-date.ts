/**
 * 216V report date is the report's own business day, not the moment it was imported.
 * Filename `216V_YYYYMMDD` wins, then the email received day, then a previously
 * stored business date, then the import clock.
 *
 * Autopart sends scheduled 216V reports Monday to Friday at about 18:15 Europe/London.
 * A Saturday or Sunday calendar date is stored as observed and flagged for review.
 * It is not a verified reporting day. Nothing here rewrites that date onto Friday.
 *
 * `216V_20261010.csv`: 10 October 2026 is a Saturday. The 216V body has no date
 * column, and this app keeps the mailbox attachment name unchanged. The recorded
 * receipt instant for that name is 2026-10-10T17:01:37Z (18:01 Europe/London);
 * the import instant is Monday 2026-10-12T17:16:07Z. The Saturday stamp therefore
 * matches the attachment name and the receipt day, not the import day. Filename
 * and receipt agree, which fits a file generated and emailed on Saturday. That
 * is not evidence of the scheduled reporting business day.
 */

import { dateOnlyIsoFromDate, todayLondonDateOnly } from "@/domain/sales-history-period";

export type Autopart216vReportDateSource = "FILENAME" | "RECEIVED_AT" | "BUSINESS_DATE" | "IMPORT_TIME";

export type Autopart216vReportDateReview = "WEEKEND_DATE_UNVERIFIED";

export type Autopart216vResolvedReportDate = {
  /** Observed calendar date. Weekend dates stay on that weekend day. */
  iso: string;
  source: Autopart216vReportDateSource;
  /** True only for a Monday–Friday date. Weekend dates never qualify. */
  verifiedWorkingDay: boolean;
  review: Autopart216vReportDateReview | null;
  filenameDate: string | null;
};

export type Autopart216vSnapshotChronology = {
  id: string;
  filename?: string | null;
  businessDate?: Date | string | null;
  receivedAt?: Date | null;
  importedAt?: Date | null;
};

const FILENAME_REPORT_DATE = /216V[_\-. ]?(20\d{2})[_\-.]?(\d{2})[_\-.]?(\d{2})(?!\d)/i;

export function isRealIsoDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** Report day encoded in names such as `216V_20261012.csv`. Undated names return null. */
export function reportDateFrom216vFilename(filename: string | null | undefined): string | null {
  const match = FILENAME_REPORT_DATE.exec(String(filename ?? ""));
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  return isRealIsoDate(iso) ? iso : null;
}

const CIVIL_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function shiftCivilDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Saturday or Sunday for a civil YYYY-MM-DD. Invalid dates are not weekend report days. */
export function is216vWeekendCivilDate(iso: string | null | undefined): boolean {
  if (!iso || !isRealIsoDate(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function civilWeekdayName(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return CIVIL_WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()] ?? "weekend";
}

/** Previous Monday–Friday civil date. The input date itself is not returned. */
export function previous216vWorkingDate(iso: string): string {
  let cursor = iso;
  for (let i = 0; i < 10; i++) {
    cursor = shiftCivilDate(cursor, -1);
    if (!is216vWeekendCivilDate(cursor)) return cursor;
  }
  return shiftCivilDate(iso, -3);
}

export function verified216vReportDate(iso: string | null | undefined): string | null {
  if (!iso || !isRealIsoDate(iso) || is216vWeekendCivilDate(iso)) return null;
  return iso;
}

function finishReportDate(
  iso: string,
  source: Autopart216vReportDateSource,
  filenameDate: string | null,
): Autopart216vResolvedReportDate {
  const weekend = is216vWeekendCivilDate(iso);
  return {
    iso,
    source,
    verifiedWorkingDay: !weekend,
    review: weekend ? "WEEKEND_DATE_UNVERIFIED" : null,
    filenameDate,
  };
}

export type Weekend216vDateReviewDetail = {
  filename: string | null;
  observedDate: string;
  weekday: string;
  becameCurrent: boolean;
  detail: string;
};

/**
 * One date-review sentence. Recorded dates are not rewritten.
 * Filename and schedule notes belong in `weekend216vImportDetail`.
 */
export function concise216vWeekendDateWarning(input: {
  count: number;
  weekdaySnapshotRemains: boolean;
  observedDate?: string | null;
}): string {
  if (input.count <= 0) return "";
  const dated =
    input.count === 1 && input.observedDate && isRealIsoDate(input.observedDate)
      ? ` (${civilWeekdayName(input.observedDate)} ${input.observedDate})`
      : "";
  if (!input.weekdaySnapshotRemains) {
    return `Review the report date${dated}. The only snapshot is dated on a weekend. Outstanding lines are kept.`;
  }
  const files = input.count === 1 ? "A weekend-dated file is on file." : "Weekend-dated files are on file.";
  return `Review the report date${dated}. ${files} The weekday snapshot stays current.`;
}

/**
 * Detail line for a weekend-dated file. The observed date is left unchanged.
 */
export function describe216vWeekendReportReview(input: {
  filename?: string | null;
  observedDate: string;
}): string {
  const name = input.filename?.trim() || "This file";
  const weekday = civilWeekdayName(input.observedDate);
  return `${name} is dated ${weekday} ${input.observedDate}. Scheduled reports arrive Monday to Friday. This file has no reporting date, so the calendar date is stored as received.`;
}

export function weekend216vImportNotice(input: {
  filename?: string | null;
  observedDate: string;
  becameCurrent: boolean;
}): string {
  return concise216vWeekendDateWarning({
    count: 1,
    weekdaySnapshotRemains: !input.becameCurrent,
    observedDate: input.observedDate,
  });
}

export function weekend216vImportDetail(input: {
  filename?: string | null;
  observedDate: string;
  becameCurrent: boolean;
}): string {
  const review = describe216vWeekendReportReview(input);
  const position = input.becameCurrent
    ? "No Monday–Friday snapshot is on file."
    : "The latest Monday–Friday snapshot stays in place.";
  return `${review} ${position}`;
}

export function weekend216vReviewDetail(input: {
  filename?: string | null;
  observedDate: string;
  becameCurrent: boolean;
}): Weekend216vDateReviewDetail {
  return {
    filename: input.filename?.trim() || null,
    observedDate: input.observedDate,
    weekday: civilWeekdayName(input.observedDate),
    becameCurrent: input.becameCurrent,
    detail: weekend216vImportDetail(input),
  };
}

function isoFromBusinessDate(value: Date | string): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const iso = dateOnlyIsoFromDate(value);
    return isRealIsoDate(iso) ? iso : null;
  }
  const iso = value.slice(0, 10);
  return isRealIsoDate(iso) ? iso : null;
}

export function resolveAutopart216vReportDate(input: {
  filename?: string | null;
  receivedAt?: Date | null;
  businessDate?: Date | string | null;
  importedAt?: Date | null;
  now?: Date;
}): Autopart216vResolvedReportDate {
  const filenameDate = reportDateFrom216vFilename(input.filename);
  if (filenameDate) return finishReportDate(filenameDate, "FILENAME", filenameDate);
  if (input.receivedAt && !Number.isNaN(input.receivedAt.getTime())) {
    return finishReportDate(todayLondonDateOnly(input.receivedAt), "RECEIVED_AT", null);
  }
  if (input.businessDate) {
    const stored = isoFromBusinessDate(input.businessDate);
    if (stored) return finishReportDate(stored, "BUSINESS_DATE", null);
  }
  return finishReportDate(todayLondonDateOnly(input.importedAt ?? input.now ?? new Date()), "IMPORT_TIME", null);
}

function receivedMillis(value: Date | null | undefined): number {
  if (!value || Number.isNaN(value.getTime())) return Number.NEGATIVE_INFINITY;
  return value.getTime();
}

function importedMillis(value: Date | null | undefined): number {
  if (!value || Number.isNaN(value.getTime())) return Number.NEGATIVE_INFINITY;
  return value.getTime();
}

/**
 * Positive when `a` is the later outstanding position.
 * Report date, then received time, then import time, then id.
 */
export function compare216vSnapshotChronology(
  a: Autopart216vSnapshotChronology,
  b: Autopart216vSnapshotChronology,
): number {
  const aDate = resolveAutopart216vReportDate(a).iso;
  const bDate = resolveAutopart216vReportDate(b).iso;
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  const received = receivedMillis(a.receivedAt) - receivedMillis(b.receivedAt);
  if (received !== 0) return received < 0 ? -1 : 1;
  const imported = importedMillis(a.importedAt) - importedMillis(b.importedAt);
  if (imported !== 0) return imported < 0 ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Current outstanding position is the latest verified Monday–Friday snapshot.
 * A weekend-dated file is shown only when no verified working-day snapshot exists.
 */
export function pickCurrent216vSnapshot<T extends Autopart216vSnapshotChronology>(rows: readonly T[]): T | null {
  const verified = rows.filter((row) => resolveAutopart216vReportDate(row).verifiedWorkingDay);
  const pool = verified.length > 0 ? verified : rows;
  let best: T | null = null;
  for (const row of pool) {
    if (!best || compare216vSnapshotChronology(row, best) > 0) best = row;
  }
  return best;
}

/**
 * Baseline for movement. A verified report compares with the previous verified
 * working day. A weekend file compares with the latest verified day on or
 * before the previous working day, so a later Monday snapshot is left untouched.
 */
export function previous216vSnapshot<T extends Autopart216vSnapshotChronology>(
  rows: readonly T[],
  current: T,
): T | null {
  const currentReport = resolveAutopart216vReportDate(current);
  const priorWorking = previous216vWorkingDate(currentReport.iso);
  let best: T | null = null;
  for (const row of rows) {
    if (row.id === current.id) continue;
    const rowReport = resolveAutopart216vReportDate(row);
    if (currentReport.verifiedWorkingDay) {
      if (!rowReport.verifiedWorkingDay) continue;
      if (compare216vSnapshotChronology(row, current) >= 0) continue;
    } else if (rowReport.verifiedWorkingDay) {
      if (rowReport.iso > priorWorking) continue;
    } else if (compare216vSnapshotChronology(row, current) >= 0) {
      continue;
    }
    if (!best || compare216vSnapshotChronology(row, best) > 0) best = row;
  }
  return best;
}

/**
 * Movement baseline. A stored previousSnapshotId is kept when it is a verified
 * working day. An unverified weekend link is ignored so it cannot stand in for
 * the previous Monday–Friday report.
 */
export function previous216vBaseline<T extends Autopart216vSnapshotChronology>(
  rows: readonly T[],
  current: T,
  linked: T | null,
): T | null {
  const chronological = previous216vSnapshot(rows, current);
  if (!linked || linked.id === current.id) return chronological;
  const currentVerified = resolveAutopart216vReportDate(current).verifiedWorkingDay;
  const linkedVerified = resolveAutopart216vReportDate(linked).verifiedWorkingDay;
  if (currentVerified && !linkedVerified) return chronological;
  return linked;
}
