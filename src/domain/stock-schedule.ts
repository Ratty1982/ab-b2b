export const STOCK_SCHEDULE_TIMEZONE = "Europe/London";
export const STOCK_SCHEDULE_HOURS = [9, 12, 15, 18] as const;
export const STOCK_SCHEDULE_LABEL = "09:00 · 12:00 · 15:00 · 18:00";
export const STOCK_SCHEDULE_OVERNIGHT_HOUR = 18;
export const STOCK_FAILED_RETRY_MS = 10 * 60 * 1000;

export type LondonCivilTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type DueStockWindow = {
  key: string;
  hour: number;
  businessDate: string;
  label: string;
};

export type ScheduledWindowDecision =
  | { active: false; key: null; hour: null; reason: string }
  | { active: true; key: string; hour: number; reason: string };

function partNumber(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Unable to read ${type} in ${STOCK_SCHEDULE_TIMEZONE}`);
  return n;
}

export function londonCivilTime(date: Date): LondonCivilTime {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: STOCK_SCHEDULE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    year: partNumber(parts, "year"),
    month: partNumber(parts, "month"),
    day: partNumber(parts, "day"),
    hour: partNumber(parts, "hour"),
    minute: partNumber(parts, "minute"),
  };
}

export function londonBusinessDate(civil: Pick<LondonCivilTime, "year" | "month" | "day">): string {
  return `${civil.year}-${String(civil.month).padStart(2, "0")}-${String(civil.day).padStart(2, "0")}`;
}

export function stockWindowKey(businessDate: string, hour: number): string {
  return `${businessDate}T${String(hour).padStart(2, "0")}:00`;
}

export function stockWindowLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function shiftCivilDate(civil: Pick<LondonCivilTime, "year" | "month" | "day">, days: number) {
  const utc = Date.UTC(civil.year, civil.month - 1, civil.day + days);
  const shifted = new Date(utc);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Catch-up policy: a window stays due until the next window starts.
 * 09:00 until 12:00, 12:00 until 15:00, 15:00 until 18:00,
 * 18:00 until the next day's 09:00 Europe/London.
 * At most one window is due. Missed days are not replayed.
 */
export function dueStockWindow(date: Date): DueStockWindow {
  const local = londonCivilTime(date);
  if (local.hour < STOCK_SCHEDULE_HOURS[0]) {
    const previous = shiftCivilDate(local, -1);
    const businessDate = londonBusinessDate(previous);
    return {
      key: stockWindowKey(businessDate, STOCK_SCHEDULE_OVERNIGHT_HOUR),
      hour: STOCK_SCHEDULE_OVERNIGHT_HOUR,
      businessDate,
      label: stockWindowLabel(STOCK_SCHEDULE_OVERNIGHT_HOUR),
    };
  }
  let hour: number = STOCK_SCHEDULE_HOURS[0];
  for (const candidate of STOCK_SCHEDULE_HOURS) {
    if (local.hour >= candidate) hour = candidate;
  }
  const businessDate = londonBusinessDate(local);
  return {
    key: stockWindowKey(businessDate, hour),
    hour,
    businessDate,
    label: stockWindowLabel(hour),
  };
}

export function nextStockWindow(date: Date): DueStockWindow {
  const local = londonCivilTime(date);
  const upcomingToday = STOCK_SCHEDULE_HOURS.find((hour) => hour > local.hour);
  if (upcomingToday != null) {
    const businessDate = londonBusinessDate(local);
    return {
      key: stockWindowKey(businessDate, upcomingToday),
      hour: upcomingToday,
      businessDate,
      label: stockWindowLabel(upcomingToday),
    };
  }
  const tomorrow = shiftCivilDate(local, 1);
  const businessDate = londonBusinessDate(tomorrow);
  const hour = STOCK_SCHEDULE_HOURS[0];
  return {
    key: stockWindowKey(businessDate, hour),
    hour,
    businessDate,
    label: stockWindowLabel(hour),
  };
}

export function nextSyncDisplay(now: Date, dueComplete: boolean): { key: string; hour: number; label: string; when: string } {
  const local = londonCivilTime(now);
  const today = londonBusinessDate(local);
  const target = dueComplete ? nextStockWindow(now) : dueStockWindow(now);
  const when = target.businessDate === today ? "Today" : target.businessDate > today ? "Tomorrow" : target.businessDate;
  return {
    key: target.key,
    hour: target.hour,
    label: `${when} · ${target.label}`,
    when,
  };
}

/** True when this instant is the named window and it has started (including catch-up). */
export function isDueStockWindow(date: Date, hour: number): boolean {
  return dueStockWindow(date).hour === hour;
}

export function scheduledWindowKey(date: Date): string {
  return dueStockWindow(date).key;
}

/** @deprecated Use dueStockWindow — kept for callers that expect active/inactive. */
export function evaluateScheduledStockWindow(date: Date): ScheduledWindowDecision {
  const due = dueStockWindow(date);
  return {
    active: true,
    key: due.key,
    hour: due.hour,
    reason: `Scheduled Autopart window ${due.key} ${STOCK_SCHEDULE_TIMEZONE}`,
  };
}

export function isWithinScheduledStockWindow(date: Date): boolean {
  return evaluateScheduledStockWindow(date).active;
}

export function publicStockSchedule() {
  return {
    timezone: STOCK_SCHEDULE_TIMEZONE,
    hours: [...STOCK_SCHEDULE_HOURS],
    label: STOCK_SCHEDULE_LABEL,
    everyDay: true,
  };
}

export function shouldThrottleFailedAttempt(lastAttemptAt: Date | null | undefined, now: Date): boolean {
  if (!lastAttemptAt) return false;
  return now.getTime() - lastAttemptAt.getTime() < STOCK_FAILED_RETRY_MS;
}
