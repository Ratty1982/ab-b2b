import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTOPART_ONGOING_SALES_SCHEDULE_LABEL,
  AUTOPART_ONGOING_SALES_TIMEZONE,
  dueOngoingSalesWindow,
  isAfterFinalOngoingSalesWindow,
  isLondonWorkingDayOngoing,
  nextOngoingSalesWindow,
} from "@/domain/autopart-ongoing-sales-schedule";

describe("ongoing 504/TRM21QC schedule", () => {
  it("polls Monday–Friday at 13:15 and 18:15 Europe/London", () => {
    expect(AUTOPART_ONGOING_SALES_TIMEZONE).toBe("Europe/London");
    expect(AUTOPART_ONGOING_SALES_SCHEDULE_LABEL).toBe(
      "13:15 · 18:15 Europe/London (Monday–Friday)",
    );
  });

  it("has no due window on Saturday/Sunday and the next poll is Monday 13:15", () => {
    const sat = new Date("2026-09-26T13:00:00.000Z");
    expect(isLondonWorkingDayOngoing(sat)).toBe(false);
    expect(dueOngoingSalesWindow(sat, true)).toBeNull();
    const next = nextOngoingSalesWindow(sat, true);
    expect(next.businessDate).toBe("2026-09-28");
    expect(next.label).toBe("13:15");

    const sun = new Date("2026-01-11T12:00:00.000Z");
    expect(dueOngoingSalesWindow(sun, true)).toBeNull();
    expect(nextOngoingSalesWindow(sun, true)).toMatchObject({
      businessDate: "2026-01-12",
      label: "13:15",
    });
  });

  it("keeps the daytime window closed until 13:15 and the evening window closed until 18:15 in BST", () => {
    // Wednesday 30 Sep 2026, BST (UTC+1)
    const before = new Date("2026-09-30T12:00:00.000Z"); // 13:00 London
    expect(dueOngoingSalesWindow(before, true)).toBeNull();
    expect(nextOngoingSalesWindow(before, true).label).toBe("13:15");

    const at1315 = new Date("2026-09-30T12:15:00.000Z"); // 13:15 London
    const day = dueOngoingSalesWindow(at1315, true);
    expect(day).toMatchObject({ hour: 13, label: "13:15", key: "2026-09-30T13:15" });

    const beforeEvening = new Date("2026-09-30T17:14:00.000Z"); // 18:14 London
    expect(dueOngoingSalesWindow(beforeEvening, true)?.label).toBe("13:15");
    expect(nextOngoingSalesWindow(beforeEvening, true).label).toBe("18:15");
    expect(isAfterFinalOngoingSalesWindow(beforeEvening, true)).toBe(false);

    const at1815 = new Date("2026-09-30T17:15:00.000Z"); // 18:15 London
    expect(dueOngoingSalesWindow(at1815, true)).toMatchObject({
      hour: 18,
      label: "18:15",
      key: "2026-09-30T18:15",
    });
    expect(isAfterFinalOngoingSalesWindow(at1815, true)).toBe(true);
  });

  it("uses Europe/London wall time in GMT, not a fixed UTC offset", () => {
    // Wednesday 14 Jan 2026, GMT
    const before = new Date("2026-01-14T13:14:00.000Z");
    expect(dueOngoingSalesWindow(before, true)).toBeNull();
    const day = dueOngoingSalesWindow(new Date("2026-01-14T13:15:00.000Z"), true);
    expect(day).toMatchObject({ label: "13:15", businessDate: "2026-01-14" });
    const evening = dueOngoingSalesWindow(new Date("2026-01-14T18:15:00.000Z"), true);
    expect(evening).toMatchObject({ label: "18:15", businessDate: "2026-01-14" });
    expect(dueOngoingSalesWindow(new Date("2026-01-14T18:14:00.000Z"), true)?.label).toBe("13:15");
  });

  it("after 13:15 and before 18:15 the next poll is 18:15 the same weekday", () => {
    const mid = new Date("2026-09-30T14:00:00.000Z"); // 15:00 BST
    expect(nextOngoingSalesWindow(mid, true)).toMatchObject({
      businessDate: "2026-09-30",
      label: "18:15",
    });
  });

  it("after 18:15 on a weekday the next poll is the next working day at 13:15", () => {
    const after = new Date("2026-09-30T17:16:00.000Z"); // Wed 18:16 BST
    expect(nextOngoingSalesWindow(after, true)).toMatchObject({
      businessDate: "2026-10-01",
      label: "13:15",
    });
  });

  it("after Friday 18:15 the next poll is Monday 13:15", () => {
    const bst = new Date("2026-09-25T17:16:00.000Z"); // Fri 18:16 BST
    expect(nextOngoingSalesWindow(bst, true)).toMatchObject({
      businessDate: "2026-09-28",
      label: "13:15",
    });
    const gmt = new Date("2026-01-16T18:16:00.000Z"); // Fri 18:16 GMT
    expect(nextOngoingSalesWindow(gmt, true)).toMatchObject({
      businessDate: "2026-01-19",
      label: "13:15",
    });
  });

  it("leaves Poll Now independent of the automatic windows", () => {
    const poll = readFileSync(
      join(process.cwd(), "src/server/companies/autopart-ongoing-sales-poll.ts"),
      "utf8",
    );
    const start = poll.indexOf("export async function pollOngoingSalesMailboxNow");
    const end = poll.indexOf("export async function runOngoingSalesScheduledPollIfEnabled");
    const manual = poll.slice(start, end);
    expect(manual).not.toContain("dueOngoingSalesWindow");
    expect(manual).toContain('runOngoingSalesMailboxPoll(actorUserId, "EMAIL")');
    expect(poll.slice(end)).toContain('runOngoingSalesMailboxPoll(null, "SCHEDULE")');
  });
});
