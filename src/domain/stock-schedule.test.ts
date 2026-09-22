import { describe, expect, it } from "vitest";
import {
  STOCK_SCHEDULE_HOURS,
  STOCK_SCHEDULE_TIMEZONE,
  dueStockWindow,
  isDueStockWindow,
  londonCivilTime,
  nextStockWindow,
  nextSyncDisplay,
  scheduledWindowKey,
  shouldThrottleFailedAttempt,
} from "@/domain/stock-schedule";

describe("Autopart stock windows (Europe/London)", () => {
  it("uses the four business hours every day", () => {
    expect(STOCK_SCHEDULE_HOURS).toEqual([9, 12, 15, 18]);
    expect(STOCK_SCHEDULE_TIMEZONE).toBe("Europe/London");
  });

  it("does not open 09:00 at 08:59 in GMT or BST", () => {
    const gmt = new Date("2026-01-15T08:59:00.000Z");
    expect(londonCivilTime(gmt)).toMatchObject({ hour: 8, minute: 59 });
    expect(dueStockWindow(gmt).key).toBe("2026-01-14T18:00");
    expect(isDueStockWindow(gmt, 9)).toBe(false);

    const bst = new Date("2026-07-15T07:59:00.000Z");
    expect(londonCivilTime(bst)).toMatchObject({ hour: 8, minute: 59 });
    expect(dueStockWindow(bst).hour).toBe(18);
    expect(isDueStockWindow(bst, 9)).toBe(false);
  });

  it("opens 09:00 in GMT and BST using London civil time, not fixed UTC", () => {
    const gmtNine = new Date("2026-01-15T09:00:00.000Z");
    expect(londonCivilTime(gmtNine)).toMatchObject({ hour: 9, minute: 0 });
    expect(dueStockWindow(gmtNine)).toMatchObject({ hour: 9, key: "2026-01-15T09:00" });

    const bstNineUtc = new Date("2026-07-15T09:00:00.000Z");
    expect(londonCivilTime(bstNineUtc).hour).toBe(10);
    expect(dueStockWindow(bstNineUtc).hour).toBe(9);

    const bstNine = new Date("2026-07-15T08:00:00.000Z");
    expect(londonCivilTime(bstNine).hour).toBe(9);
    expect(dueStockWindow(bstNine)).toMatchObject({ hour: 9, key: "2026-07-15T09:00" });
  });

  it("keeps 09:00 due at 09:02 until 12:00, then does not reopen it after that", () => {
    const gmt902 = new Date("2026-01-15T09:02:00.000Z");
    expect(dueStockWindow(gmt902).key).toBe("2026-01-15T09:00");
    const gmt1107 = new Date("2026-01-15T11:07:00.000Z");
    expect(dueStockWindow(gmt1107).hour).toBe(9);
    const gmt1200 = new Date("2026-01-15T12:00:00.000Z");
    expect(dueStockWindow(gmt1200).hour).toBe(12);
    expect(isDueStockWindow(gmt1200, 9)).toBe(false);
  });

  it("opens 12:00, 15:00 and 18:00 in both GMT and BST", () => {
    expect(dueStockWindow(new Date("2026-01-15T12:00:00.000Z")).hour).toBe(12);
    expect(dueStockWindow(new Date("2026-01-15T15:00:00.000Z")).hour).toBe(15);
    expect(dueStockWindow(new Date("2026-01-15T18:00:00.000Z")).hour).toBe(18);
    expect(scheduledWindowKey(new Date("2026-07-15T11:00:00.000Z"))).toBe("2026-07-15T12:00");
    expect(scheduledWindowKey(new Date("2026-07-15T14:00:00.000Z"))).toBe("2026-07-15T15:00");
    expect(scheduledWindowKey(new Date("2026-07-15T17:00:00.000Z"))).toBe("2026-07-15T18:00");
  });

  it("does not start a later window between slots", () => {
    expect(dueStockWindow(new Date("2026-01-15T10:07:00.000Z")).hour).toBe(9);
    expect(dueStockWindow(new Date("2026-01-15T13:40:00.000Z")).hour).toBe(12);
    expect(dueStockWindow(new Date("2026-07-15T08:30:00.000Z")).hour).toBe(9);
  });

  it("labels the next sync in London civil time", () => {
    expect(nextSyncDisplay(new Date("2026-01-15T08:59:00.000Z"), true).label).toBe("Today · 09:00");
    expect(nextSyncDisplay(new Date("2026-01-15T09:03:00.000Z"), true).label).toBe("Today · 12:00");
    expect(nextSyncDisplay(new Date("2026-01-15T18:10:00.000Z"), true).label).toBe("Tomorrow · 09:00");
    expect(nextSyncDisplay(new Date("2026-07-15T07:10:00.000Z"), false).label).toContain("18:00");
    expect(nextStockWindow(new Date("2026-01-15T09:00:00.000Z")).hour).toBe(12);
  });

  it("throttles genuine failure retries without blocking waiting-for-email", () => {
    const now = new Date("2026-01-15T09:10:00.000Z");
    expect(shouldThrottleFailedAttempt(new Date("2026-01-15T09:05:00.000Z"), now)).toBe(true);
    expect(shouldThrottleFailedAttempt(new Date("2026-01-15T08:50:00.000Z"), now)).toBe(false);
    expect(shouldThrottleFailedAttempt(null, now)).toBe(false);
  });
});
