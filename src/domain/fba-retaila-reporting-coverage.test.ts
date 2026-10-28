import { describe, expect, it } from "vitest";
import {
  assessRetailaReportingCoverage,
  retailaCompletedDaysWindow,
  retailaCoverageMarksForWeekdays,
  retailaReportingRequiredWeekdays,
} from "@/domain/fba-retaila-reporting-coverage";
import { addDaysIso, daysInclusive } from "@/domain/sales-history-period";

describe("RETAILA completed planning window", () => {
  it("uses 30 completed calendar days ending yesterday", () => {
    const window = retailaCompletedDaysWindow("2026-10-28", 30);
    expect(window).toEqual({ from: "2026-09-28", to: "2026-10-27", days: 30 });
    expect(daysInclusive({ from: window.from, to: window.to })).toBe(30);
    expect(window.to).toBe(addDaysIso("2026-10-28", -1));
  });

  it("keeps weekends inside the calendar span but not as required feed days", () => {
    // 2026-10-05 Mon … 2026-10-11 Sun
    expect(retailaReportingRequiredWeekdays("2026-10-05", "2026-10-11")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
  });
});

describe("RETAILA reporting coverage", () => {
  it("blocks planning when a weekday is missing either 504 or TRM", () => {
    const { from, to } = retailaCompletedDaysWindow("2026-10-28", 30);
    const weekdays = retailaReportingRequiredWeekdays(from, to);
    // 2026-10-09 is Friday — leave it without imports while keeping recent days so the feed is not stale.
    const marks = retailaCoverageMarksForWeekdays(weekdays.filter((day) => day !== "2026-10-09"));
    const assessed = assessRetailaReportingCoverage({
      marks,
      today: "2026-10-28",
      staleAfterDays: 3,
    });
    expect(assessed.windowFrom).toBe(from);
    expect(assessed.windowTo).toBe(to);
    expect(assessed.complete).toBe(false);
    expect(assessed.stale).toBe(false);
    expect(assessed.planningAllowed).toBe(false);
    expect(assessed.missingWeekdays).toContain("2026-10-09");
    expect(assessed.reason).toMatch(/missing/i);
  });

  it("blocks planning when the latest successful feed is stale", () => {
    const marks = retailaCoverageMarksForWeekdays(["2026-10-01", "2026-10-02"]);
    const assessed = assessRetailaReportingCoverage({
      marks,
      today: "2026-10-28",
      staleAfterDays: 3,
    });
    expect(assessed.stale).toBe(true);
    expect(assessed.planningAllowed).toBe(false);
    expect(assessed.reason).toMatch(/older than/i);
  });

  it("allows planning for a verified complete working-day window ending yesterday", () => {
    const { from, to } = retailaCompletedDaysWindow("2026-10-28", 30);
    const weekdays = retailaReportingRequiredWeekdays(from, to);
    const marks = retailaCoverageMarksForWeekdays(weekdays);
    const assessed = assessRetailaReportingCoverage({
      marks,
      today: "2026-10-28",
      staleAfterDays: 3,
    });
    expect(assessed.complete).toBe(true);
    expect(assessed.stale).toBe(false);
    expect(assessed.planningAllowed).toBe(true);
    expect(assessed.missingWeekdays).toEqual([]);
    expect(assessed.reason).toMatch(/ending yesterday/i);
  });

  it("does not require today's feed on a weekday", () => {
    // Tuesday 2026-10-27 — today is in the middle of the week but excluded from the window.
    const assessedEmptyToday = assessRetailaReportingCoverage({
      marks: retailaCoverageMarksForWeekdays(
        retailaReportingRequiredWeekdays("2026-09-27", "2026-10-26"),
      ),
      today: "2026-10-27",
      staleAfterDays: 3,
    });
    expect(assessedEmptyToday.windowTo).toBe("2026-10-26");
    expect(assessedEmptyToday.requiredWeekdays).not.toContain("2026-10-27");
    expect(assessedEmptyToday.planningAllowed).toBe(true);
  });

  it("excludes weekends from required feeds while keeping them in the calendar window", () => {
    // Window spanning Fri–Mon includes Sat/Sun in from…to but not as required weekdays.
    const assessed = assessRetailaReportingCoverage({
      marks: retailaCoverageMarksForWeekdays(["2026-10-23", "2026-10-26"]),
      today: "2026-10-27",
      windowDays: 4, // 2026-10-23 … 2026-10-26
      staleAfterDays: 3,
    });
    expect(assessed.windowFrom).toBe("2026-10-23");
    expect(assessed.windowTo).toBe("2026-10-26");
    expect(assessed.requiredWeekdays).toEqual(["2026-10-23", "2026-10-26"]);
    expect(assessed.requiredWeekdays).not.toContain("2026-10-24");
    expect(assessed.requiredWeekdays).not.toContain("2026-10-25");
    expect(assessed.planningAllowed).toBe(true);
  });

  it("does not treat incomplete coverage as verified zero sales", () => {
    const { from, to } = retailaCompletedDaysWindow("2026-10-28", 30);
    const assessed = assessRetailaReportingCoverage({
      marks: [],
      today: "2026-10-28",
    });
    expect(assessed.windowFrom).toBe(from);
    expect(assessed.windowTo).toBe(to);
    expect(assessed.complete).toBe(false);
    expect(assessed.planningAllowed).toBe(false);
    expect(assessed.missingWeekdays.length).toBeGreaterThan(0);
  });
});
