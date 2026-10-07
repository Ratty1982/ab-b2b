import { describe, expect, it } from "vitest";
import {
  AUTOPART_504C_SCHEDULE_HOURS,
  due504cWindow,
  isLondonWorkingDay,
  next504cWindow,
} from "@/domain/autopart-504c-schedule";

describe("autopart 504C schedule", () => {
  it("uses 13:15 and 16:15 Europe/London", () => {
    expect([...AUTOPART_504C_SCHEDULE_HOURS]).toEqual([13, 16]);
  });

  it("returns null before 13:15 on a working day", () => {
    // Wednesday 25 Sep 2026 11:30 London = 10:30 UTC (BST)
    const before = new Date("2026-09-25T10:30:00.000Z");
    expect(isLondonWorkingDay(before)).toBe(true);
    expect(due504cWindow(before)).toBeNull();
    const at1300 = new Date("2026-09-25T12:00:00.000Z"); // 13:00 London BST
    expect(due504cWindow(at1300)).toBeNull();
    expect(next504cWindow(at1300).label).toBe("13:15");
  });

  it("selects 13:15 window after 13:15 BST", () => {
    const after13 = new Date("2026-09-25T12:15:00.000Z"); // 13:15 London BST
    const due = due504cWindow(after13);
    expect(due?.hour).toBe(13);
    expect(due?.label).toBe("13:15");
    expect(due?.key).toContain("T13:15");
  });

  it("selects 16:15 window after 16:15 BST", () => {
    const before16 = new Date("2026-09-25T15:14:00.000Z"); // 16:14 London BST
    expect(due504cWindow(before16)?.label).toBe("13:15");
    const after16 = new Date("2026-09-25T15:15:00.000Z"); // 16:15 London BST
    const due = due504cWindow(after16);
    expect(due?.hour).toBe(16);
    expect(due?.label).toBe("16:15");
  });

  it("skips weekends when workingDaysOnly", () => {
    // Saturday 26 Sep 2026 14:00 London
    const saturday = new Date("2026-09-26T13:00:00.000Z");
    expect(isLondonWorkingDay(saturday)).toBe(false);
    expect(due504cWindow(saturday, true)).toBeNull();
  });

  it("handles GMT winter time for 13:15", () => {
    // Monday 12 Jan 2026
    expect(due504cWindow(new Date("2026-01-12T13:14:00.000Z"))).toBeNull();
    const winter = new Date("2026-01-12T13:15:00.000Z");
    expect(isLondonWorkingDay(winter)).toBe(true);
    const due = due504cWindow(winter);
    expect(due).toMatchObject({ hour: 13, label: "13:15", businessDate: "2026-01-12" });
  });

  it("next window after Friday 16:15 is Monday 13:15", () => {
    const fridayEvening = new Date("2026-09-25T16:00:00.000Z"); // 17:00 BST Friday
    const next = next504cWindow(fridayEvening, true);
    expect(next.hour).toBe(13);
    expect(next.label).toBe("13:15");
    expect(next.businessDate).toBe("2026-09-28");
  });
});
