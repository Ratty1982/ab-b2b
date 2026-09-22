import { describe, expect, it } from "vitest";
import {
  STOCK_SCHEDULE_HOURS,
  STOCK_SCHEDULE_TIMEZONE,
  evaluateScheduledStockWindow,
  isWithinScheduledStockWindow,
  londonCivilTime,
  scheduledWindowKey,
} from "@/domain/stock-schedule";

describe("Autopart stock windows (Europe/London)", () => {
  it("uses the four AlphaOps business hours every day", () => {
    expect(STOCK_SCHEDULE_HOURS).toEqual([9, 12, 15, 18]);
    expect(STOCK_SCHEDULE_TIMEZONE).toBe("Europe/London");
  });

  it("treats 09:00 GMT as a window and not 09:00 UTC during BST", () => {
    const gmtNine = new Date("2026-01-15T09:00:00.000Z");
    expect(londonCivilTime(gmtNine)).toMatchObject({ hour: 9, minute: 0 });
    expect(isWithinScheduledStockWindow(gmtNine)).toBe(true);
    expect(scheduledWindowKey(gmtNine)).toBe("2026-01-15T09:00");

    const bstNineUtc = new Date("2026-07-15T09:00:00.000Z");
    expect(londonCivilTime(bstNineUtc)).toMatchObject({ hour: 10, minute: 0 });
    expect(isWithinScheduledStockWindow(bstNineUtc)).toBe(false);
  });

  it("opens 09:00 BST at 08:00 UTC", () => {
    const bstNine = new Date("2026-07-15T08:00:00.000Z");
    expect(londonCivilTime(bstNine).hour).toBe(9);
    expect(evaluateScheduledStockWindow(bstNine)).toMatchObject({ active: true, hour: 9, key: "2026-07-15T09:00" });
  });

  it("opens 12:00, 15:00 and 18:00 in both GMT and BST", () => {
    expect(isWithinScheduledStockWindow(new Date("2026-01-15T12:00:00.000Z"))).toBe(true);
    expect(isWithinScheduledStockWindow(new Date("2026-01-15T15:00:00.000Z"))).toBe(true);
    expect(isWithinScheduledStockWindow(new Date("2026-01-15T18:00:00.000Z"))).toBe(true);
    expect(scheduledWindowKey(new Date("2026-07-15T11:00:00.000Z"))).toBe("2026-07-15T12:00");
    expect(scheduledWindowKey(new Date("2026-07-15T14:00:00.000Z"))).toBe("2026-07-15T15:00");
    expect(scheduledWindowKey(new Date("2026-07-15T17:00:00.000Z"))).toBe("2026-07-15T18:00");
  });

  it("does not treat a 15-minute UTC tick outside the window as an import time", () => {
    expect(isWithinScheduledStockWindow(new Date("2026-01-15T09:30:00.000Z"))).toBe(false);
    expect(isWithinScheduledStockWindow(new Date("2026-01-15T10:00:00.000Z"))).toBe(false);
    expect(isWithinScheduledStockWindow(new Date("2026-07-15T08:30:00.000Z"))).toBe(false);
    expect(evaluateScheduledStockWindow(new Date("2026-01-15T09:14:00.000Z")).active).toBe(true);
  });

  it("leaves manual polling unconstrained by the window helper", () => {
    const outside = new Date("2026-01-15T10:07:00.000Z");
    expect(isWithinScheduledStockWindow(outside)).toBe(false);
  });
});
