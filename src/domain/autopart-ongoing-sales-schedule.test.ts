import { describe, expect, it } from "vitest";
import {
  dueOngoingSalesWindow,
  isAfterFinalOngoingSalesWindow,
  isLondonWorkingDayOngoing,
} from "@/domain/autopart-ongoing-sales-schedule";

describe("ongoing 504/TRM21QC schedule", () => {
  it("has no due window on Saturday/Sunday", () => {
    // 2026-10-03 is a Saturday
    const sat = new Date("2026-10-03T14:00:00.000Z");
    expect(isLondonWorkingDayOngoing(sat)).toBe(false);
    expect(dueOngoingSalesWindow(sat, true)).toBeNull();
  });

  it("selects 13:00 then 18:00 windows on a weekday", () => {
    // 2026-09-30 Wednesday — 12:30 London = 11:30 UTC (BST)
    const before = new Date("2026-09-30T11:30:00.000Z");
    expect(dueOngoingSalesWindow(before, true)).toBeNull();

    const at13 = new Date("2026-09-30T12:05:00.000Z"); // 13:05 BST
    const w13 = dueOngoingSalesWindow(at13, true);
    expect(w13?.hour).toBe(13);

    const at18 = new Date("2026-09-30T17:10:00.000Z"); // 18:10 BST
    const w18 = dueOngoingSalesWindow(at18, true);
    expect(w18?.hour).toBe(18);
    expect(isAfterFinalOngoingSalesWindow(at18, true)).toBe(true);
  });
});
