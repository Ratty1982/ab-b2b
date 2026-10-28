import { describe, expect, it } from "vitest";
import { addDaysIso, daysInclusive } from "@/domain/sales-history-period";
import {
  retailaOinCompletedRange,
  retailaOinRange,
  retailaPlanningDemandBounds,
  salesWindowCutoff,
} from "@/server/purchasing/fba-retaila-oin";

describe("RETAILA planning demand bounds", () => {
  it("aligns with 30 completed calendar days ending yesterday", () => {
    const display = retailaOinRange("2026-10-28", 365);
    const bounds = retailaPlanningDemandBounds(display, "2026-10-28", 30);
    expect(bounds).not.toBeNull();
    expect(bounds!.from.toISOString().slice(0, 10)).toBe("2026-09-28");
    expect(bounds!.toExclusive.toISOString().slice(0, 10)).toBe("2026-10-28");
    // Inclusive end is yesterday — today is excluded.
    expect(daysInclusive({ from: "2026-09-28", to: "2026-10-27" })).toBe(30);
  });

  it("matches retailaOinCompletedRange for a 30-day planning scan", () => {
    const completed = retailaOinCompletedRange("2026-10-28", 30);
    expect(completed.from.toISOString().slice(0, 10)).toBe("2026-09-28");
    expect(completed.toExclusive.toISOString().slice(0, 10)).toBe("2026-10-28");
    const bounds = retailaPlanningDemandBounds(completed, "2026-10-28", 30);
    expect(bounds).toEqual({ from: completed.from, toExclusive: completed.toExclusive });
  });

  it("returns null when the planning window is wider than the scanned range", () => {
    // 7-day display scan cannot support a 30-day planning window.
    const short = retailaOinRange("2026-10-28", 30);
    // Force a shorter scan by building a completed 30-day range then asking for bounds after shrinking.
    const tiny = {
      ...short,
      from: new Date("2026-10-20T00:00:00.000Z"),
    };
    expect(retailaPlanningDemandBounds(tiny, "2026-10-28", 30)).toBeNull();
  });

  it("keeps today-inclusive display cutoffs distinct from planning bounds", () => {
    const display = retailaOinRange("2026-10-28", 365);
    const d30 = salesWindowCutoff(display, 30);
    expect(d30!.toISOString().slice(0, 10)).toBe("2026-09-29"); // today-inclusive last 30
    const bounds = retailaPlanningDemandBounds(display, "2026-10-28", 30)!;
    expect(bounds.from.toISOString().slice(0, 10)).toBe("2026-09-28");
    expect(bounds.toExclusive.toISOString().slice(0, 10)).toBe("2026-10-28");
    // Display includes 2026-10-28; planning excludes it.
    expect(d30!.getTime()).toBeGreaterThan(bounds.from.getTime());
    expect(addDaysIso("2026-10-28", -1)).toBe("2026-10-27");
  });

  it("handles weekend and Monday boundaries the same way", () => {
    // Sunday → yesterday is Saturday; window still 30 completed days.
    const sunday = retailaPlanningDemandBounds(retailaOinRange("2026-10-25", 365), "2026-10-25", 30)!;
    expect(sunday.from.toISOString().slice(0, 10)).toBe("2026-09-25");
    expect(sunday.toExclusive.toISOString().slice(0, 10)).toBe("2026-10-25");
    // Monday after a weekend — still ends yesterday (Sunday).
    const monday = retailaPlanningDemandBounds(retailaOinRange("2026-10-26", 365), "2026-10-26", 30)!;
    expect(monday.from.toISOString().slice(0, 10)).toBe("2026-09-26");
    expect(monday.toExclusive.toISOString().slice(0, 10)).toBe("2026-10-26");
  });
});
