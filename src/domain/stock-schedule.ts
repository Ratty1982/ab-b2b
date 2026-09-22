export const STOCK_SCHEDULE_TIMEZONE = "Europe/London";
export const STOCK_SCHEDULE_HOURS = [9, 12, 15, 18] as const;
export const STOCK_WINDOW_SLACK_MINUTES = 25;
export const STOCK_SCHEDULE_LABEL = "09:00 · 12:00 · 15:00 · 18:00";

export type LondonCivilTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
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

export function scheduledWindowKey(date: Date): string | null {
  const decision = evaluateScheduledStockWindow(date);
  return decision.key;
}

export function isWithinScheduledStockWindow(date: Date): boolean {
  return evaluateScheduledStockWindow(date).active;
}

export function evaluateScheduledStockWindow(date: Date): ScheduledWindowDecision {
  const local = londonCivilTime(date);
  const hour = STOCK_SCHEDULE_HOURS.find((candidate) => candidate === local.hour);
  if (hour == null) {
    return {
      active: false,
      key: null,
      hour: null,
      reason: `Outside Autopart stock windows (${STOCK_SCHEDULE_LABEL} ${STOCK_SCHEDULE_TIMEZONE})`,
    };
  }
  if (local.minute >= STOCK_WINDOW_SLACK_MINUTES) {
    return {
      active: false,
      key: null,
      hour: null,
      reason: `Outside the ${String(hour).padStart(2, "0")}:00 ${STOCK_SCHEDULE_TIMEZONE} import window`,
    };
  }
  const key = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00`;
  return {
    active: true,
    key,
    hour,
    reason: `Scheduled Autopart window ${key} ${STOCK_SCHEDULE_TIMEZONE}`,
  };
}

export function publicStockSchedule() {
  return {
    timezone: STOCK_SCHEDULE_TIMEZONE,
    hours: [...STOCK_SCHEDULE_HOURS],
    label: STOCK_SCHEDULE_LABEL,
    everyDay: true,
  };
}
