/**
 * 216V report date is the report's own business day, not the moment it was imported.
 * Filename `216V_YYYYMMDD` wins, then the email received day, then a previously
 * stored business date, then the import clock.
 */

import { dateOnlyIsoFromDate, todayLondonDateOnly } from "@/domain/sales-history-period";

export type Autopart216vReportDateSource = "FILENAME" | "RECEIVED_AT" | "BUSINESS_DATE" | "IMPORT_TIME";

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
}): { iso: string; source: Autopart216vReportDateSource } {
  const fromFilename = reportDateFrom216vFilename(input.filename);
  if (fromFilename) return { iso: fromFilename, source: "FILENAME" };
  if (input.receivedAt && !Number.isNaN(input.receivedAt.getTime())) {
    return { iso: todayLondonDateOnly(input.receivedAt), source: "RECEIVED_AT" };
  }
  if (input.businessDate) {
    const stored = isoFromBusinessDate(input.businessDate);
    if (stored) return { iso: stored, source: "BUSINESS_DATE" };
  }
  return { iso: todayLondonDateOnly(input.importedAt ?? input.now ?? new Date()), source: "IMPORT_TIME" };
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

export function pickCurrent216vSnapshot<T extends Autopart216vSnapshotChronology>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!best || compare216vSnapshotChronology(row, best) > 0) best = row;
  }
  return best;
}

/** Latest committed snapshot that is strictly older than `current`. */
export function previous216vSnapshot<T extends Autopart216vSnapshotChronology>(
  rows: readonly T[],
  current: T,
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.id === current.id) continue;
    if (compare216vSnapshotChronology(row, current) >= 0) continue;
    if (!best || compare216vSnapshotChronology(row, best) > 0) best = row;
  }
  return best;
}
