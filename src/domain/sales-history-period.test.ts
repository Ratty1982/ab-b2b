import { describe, expect, it } from "vitest";
import {
  calendarQuarterRange,
  daysInclusive,
  lastNDaysRange,
  previousCalendarQuarterRange,
  previousEquivalentPeriod,
  resolveRebatePeriod,
  resolveSalesEnquiryPeriod,
  todayLondonDateOnly,
} from "@/domain/sales-history-period";

describe("sales-history-period", () => {
  it("LAST_30 is inclusive of today", () => {
    expect(lastNDaysRange("2026-09-29", 30)).toEqual({
      from: "2026-08-31",
      to: "2026-09-29",
    });
  });

  it("previousEquivalentPeriod mirrors length ending day before primary.from", () => {
    const primary = { from: "2026-01-01", to: "2026-06-30" };
    expect(daysInclusive(primary)).toBe(181);
    expect(previousEquivalentPeriod(primary)).toEqual({
      from: "2025-07-04",
      to: "2025-12-31",
    });
  });

  it("resolves Sales Enquiry presets on a fixed London today", () => {
    const today = "2026-09-29";
    expect(resolveSalesEnquiryPeriod("THIS_MONTH", null, null, today)).toEqual({
      from: "2026-09-01",
      to: "2026-09-29",
    });
    expect(resolveSalesEnquiryPeriod("LAST_MONTH", null, null, today)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(resolveSalesEnquiryPeriod("YTD", null, null, today)).toEqual({
      from: "2026-01-01",
      to: "2026-09-29",
    });
    expect(resolveSalesEnquiryPeriod("LAST_YEAR", null, null, today)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(
      resolveSalesEnquiryPeriod("CUSTOM", "2026-03-01", "2026-03-31", today),
    ).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("todayLondonDateOnly returns YYYY-MM-DD", () => {
    expect(todayLondonDateOnly(new Date("2026-09-29T12:00:00.000Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("calendar quarters are Jan–Mar / Apr–Jun / Jul–Sep / Oct–Dec", () => {
    expect(calendarQuarterRange("2026-02-15")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
    expect(calendarQuarterRange("2026-09-29")).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    });
    expect(previousCalendarQuarterRange("2026-09-29")).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
    expect(previousCalendarQuarterRange("2026-02-01")).toEqual({
      from: "2025-10-01",
      to: "2025-12-31",
    });
  });

  it("resolves rebate period presets including quarters and last 12 months", () => {
    const today = "2026-09-29";
    expect(resolveRebatePeriod("THIS_QUARTER", null, null, today)).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    });
    expect(resolveRebatePeriod("PREVIOUS_QUARTER", null, null, today)).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
    expect(resolveRebatePeriod("LAST_365", null, null, today)).toEqual({
      from: "2025-09-30",
      to: "2026-09-29",
    });
    expect(resolveRebatePeriod("CUSTOM", "2026-01-01", "2026-06-30", today)).toEqual({
      from: "2026-01-01",
      to: "2026-06-30",
    });
    expect(resolveRebatePeriod("ALL", null, null, today)).toBeNull();
    expect(resolveRebatePeriod("CUSTOM", null, null, today)).toBeNull();
    expect(resolveRebatePeriod("CUSTOM", "2026-01-01", null, today)).toBeNull();
  });
});
