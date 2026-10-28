import { describe, expect, it } from "vitest";
import {
  assessRetailaReportingCoverage,
  retailaCoverageMarksForWeekdays,
  retailaReportingRequiredWeekdays,
} from "@/domain/fba-retaila-reporting-coverage";

describe("RETAILA reporting coverage", () => {
  it("requires Autopart working days only and ignores weekends", () => {
    // 2026-10-05 Mon … 2026-10-11 Sun
    expect(retailaReportingRequiredWeekdays("2026-10-05", "2026-10-11")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
  });

  it("blocks planning when a weekday is missing either 504 or TRM", () => {
    const weekdays = retailaReportingRequiredWeekdays("2026-09-29", "2026-10-27");
    // 2026-10-09 is Friday — leave it without imports while keeping recent days so the feed is not stale.
    const marks = retailaCoverageMarksForWeekdays(weekdays.filter((day) => day !== "2026-10-09"));
    const assessed = assessRetailaReportingCoverage({
      marks,
      today: "2026-10-28",
      includeToday: false,
      staleAfterDays: 3,
    });
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
      includeToday: false,
      staleAfterDays: 3,
    });
    expect(assessed.stale).toBe(true);
    expect(assessed.planningAllowed).toBe(false);
    expect(assessed.reason).toMatch(/older than/i);
  });

  it("allows planning for a verified complete working-day window", () => {
    const weekdays = retailaReportingRequiredWeekdays("2026-09-29", "2026-10-27");
    const marks = retailaCoverageMarksForWeekdays(weekdays);
    const assessed = assessRetailaReportingCoverage({
      marks,
      today: "2026-10-28",
      includeToday: false,
      staleAfterDays: 3,
    });
    expect(assessed.complete).toBe(true);
    expect(assessed.stale).toBe(false);
    expect(assessed.planningAllowed).toBe(true);
    expect(assessed.missingWeekdays).toEqual([]);
    expect(assessed.reason).toMatch(/cover every required working day/i);
  });
});
