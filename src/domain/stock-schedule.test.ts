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

  it("does not open 09:15 at 08:59 in GMT or BST", () => {
    const gmt = new Date("2026-01-15T08:59:00.000Z");
    expect(londonCivilTime(gmt)).toMatchObject({ hour: 8, minute: 59 });
    expect(dueStockWindow(gmt).key).toBe("2026-01-14T18:15");
    expect(isDueStockWindow(gmt, 9)).toBe(false);

    const bst = new Date("2026-07-15T07:59:00.000Z");
    expect(londonCivilTime(bst)).toMatchObject({ hour: 8, minute: 59 });
    expect(dueStockWindow(bst).hour).toBe(18);
    expect(isDueStockWindow(bst, 9)).toBe(false);
  });

  it("opens 09:15 in GMT and BST using London civil time, not fixed UTC", () => {
    const gmtBefore = new Date("2026-01-15T09:14:00.000Z");
    expect(dueStockWindow(gmtBefore).key).toBe("2026-01-14T18:15");
    const gmtNine = new Date("2026-01-15T09:15:00.000Z");
    expect(londonCivilTime(gmtNine)).toMatchObject({ hour: 9, minute: 15 });
    expect(dueStockWindow(gmtNine)).toMatchObject({ hour: 9, key: "2026-01-15T09:15", label: "09:15" });

    const bstNineUtc = new Date("2026-07-15T09:00:00.000Z");
    expect(londonCivilTime(bstNineUtc).hour).toBe(10);
    expect(dueStockWindow(bstNineUtc).hour).toBe(9);

    const bstBefore = new Date("2026-07-15T08:14:00.000Z");
    expect(londonCivilTime(bstBefore)).toMatchObject({ hour: 9, minute: 14 });
    expect(dueStockWindow(bstBefore).hour).toBe(18);
    const bstNine = new Date("2026-07-15T08:15:00.000Z");
    expect(londonCivilTime(bstNine)).toMatchObject({ hour: 9, minute: 15 });
    expect(dueStockWindow(bstNine)).toMatchObject({ hour: 9, key: "2026-07-15T09:15" });
  });

  it("keeps 09:15 due until 12:15, then does not reopen it after that", () => {
    const gmt917 = new Date("2026-01-15T09:17:00.000Z");
    expect(dueStockWindow(gmt917).key).toBe("2026-01-15T09:15");
    const gmt1107 = new Date("2026-01-15T11:07:00.000Z");
    expect(dueStockWindow(gmt1107).hour).toBe(9);
    const gmt1214 = new Date("2026-01-15T12:14:00.000Z");
    expect(dueStockWindow(gmt1214).hour).toBe(9);
    const gmt1215 = new Date("2026-01-15T12:15:00.000Z");
    expect(dueStockWindow(gmt1215).hour).toBe(12);
    expect(isDueStockWindow(gmt1215, 9)).toBe(false);
  });

  it("opens 12:15, 15:15 and 18:15 in both GMT and BST", () => {
    expect(dueStockWindow(new Date("2026-01-15T12:00:00.000Z")).hour).toBe(9);
    expect(dueStockWindow(new Date("2026-01-15T12:15:00.000Z")).hour).toBe(12);
    expect(dueStockWindow(new Date("2026-01-15T15:15:00.000Z")).hour).toBe(15);
    expect(dueStockWindow(new Date("2026-01-15T18:15:00.000Z")).hour).toBe(18);
    expect(scheduledWindowKey(new Date("2026-07-15T11:15:00.000Z"))).toBe("2026-07-15T12:15");
    expect(scheduledWindowKey(new Date("2026-07-15T14:15:00.000Z"))).toBe("2026-07-15T15:15");
    expect(scheduledWindowKey(new Date("2026-07-15T17:15:00.000Z"))).toBe("2026-07-15T18:15");
  });

  it("does not start a later window between slots", () => {
    expect(dueStockWindow(new Date("2026-01-15T10:07:00.000Z")).hour).toBe(9);
    expect(dueStockWindow(new Date("2026-01-15T13:40:00.000Z")).hour).toBe(12);
    expect(dueStockWindow(new Date("2026-07-15T08:30:00.000Z")).hour).toBe(9);
  });

  it("labels the next sync in London civil time", () => {
    expect(nextSyncDisplay(new Date("2026-01-15T08:59:00.000Z"), true).label).toBe("Today · 09:15");
    expect(nextSyncDisplay(new Date("2026-01-15T09:16:00.000Z"), true).label).toBe("Today · 12:15");
    expect(nextSyncDisplay(new Date("2026-01-15T18:16:00.000Z"), true).label).toBe("Tomorrow · 09:15");
    expect(nextSyncDisplay(new Date("2026-07-15T07:10:00.000Z"), false).label).toContain("18:15");
    expect(nextStockWindow(new Date("2026-01-15T09:00:00.000Z")).label).toBe("09:15");
    expect(nextStockWindow(new Date("2026-01-15T09:15:00.000Z")).hour).toBe(12);
  });

  it("throttles genuine failure retries without blocking waiting-for-email", () => {
    const now = new Date("2026-01-15T09:10:00.000Z");
    expect(shouldThrottleFailedAttempt(new Date("2026-01-15T09:05:00.000Z"), now)).toBe(true);
    expect(shouldThrottleFailedAttempt(new Date("2026-01-15T08:50:00.000Z"), now)).toBe(false);
    expect(shouldThrottleFailedAttempt(null, now)).toBe(false);
  });
});
