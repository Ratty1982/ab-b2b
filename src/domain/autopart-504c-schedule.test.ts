import { describe, expect, it } from "vitest";
import {
  AUTOPART_504C_SCHEDULE_HOURS,
  due504cWindow,
  isLondonWorkingDay,
  next504cWindow,
} from "@/domain/autopart-504c-schedule";

describe("autopart 504C schedule", () => {
  it("uses 13:00 and 16:00 Europe/London", () => {
    expect([...AUTOPART_504C_SCHEDULE_HOURS]).toEqual([13, 16]);
  });

  it("returns null before 13:00 on a working day", () => {
    // Wednesday 25 Sep 2026 11:30 London = 10:30 UTC (BST)
    const before = new Date("2026-09-25T10:30:00.000Z");
    expect(isLondonWorkingDay(before)).toBe(true);
    expect(due504cWindow(before)).toBeNull();
  });

  it("selects 13:00 window after 13:00 BST", () => {
    const after13 = new Date("2026-09-25T12:15:00.000Z"); // 13:15 London BST
    const due = due504cWindow(after13);
    expect(due?.hour).toBe(13);
    expect(due?.label).toBe("13:00");
    expect(due?.key).toContain("T13:00");
  });

  it("selects 16:00 window after 16:00 BST", () => {
    const after16 = new Date("2026-09-25T15:30:00.000Z"); // 16:30 London BST
    const due = due504cWindow(after16);
    expect(due?.hour).toBe(16);
    expect(due?.label).toBe("16:00");
  });

  it("skips weekends when workingDaysOnly", () => {
    // Saturday 26 Sep 2026 14:00 London
    const saturday = new Date("2026-09-26T13:00:00.000Z");
    expect(isLondonWorkingDay(saturday)).toBe(false);
    expect(due504cWindow(saturday, true)).toBeNull();
  });

  it("handles GMT winter time for 13:00", () => {
    // Monday 12 Jan 2026 13:05 London GMT = 13:05 UTC
    const winter = new Date("2026-01-12T13:05:00.000Z");
    expect(isLondonWorkingDay(winter)).toBe(true);
    const due = due504cWindow(winter);
    expect(due?.hour).toBe(13);
  });

  it("next window after Friday 16:00 is Monday 13:00", () => {
    const fridayEvening = new Date("2026-09-25T16:00:00.000Z"); // 17:00 BST Friday
    const next = next504cWindow(fridayEvening, true);
    expect(next.hour).toBe(13);
    expect(next.businessDate).toBe("2026-09-28");
  });
});
