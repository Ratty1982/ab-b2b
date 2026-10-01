import { describe, expect, it } from "vitest";
import {
  calendarQuarterRange,
  daysInclusive,
  lastNDaysRange,
  previousCalendarQuarterRange,
  previousComparableBusinessPeriod,
  previousEquivalentPeriod,
  resolveBusinessPeriod,
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

  describe("previousComparableBusinessPeriod (calendar)", () => {
    it("This Month on 1 Oct → compare 1 Sep (not 30 Sep)", () => {
      const primary = { from: "2026-10-01", to: "2026-10-01" };
      expect(previousComparableBusinessPeriod(primary, "THIS_MONTH")).toEqual({
        from: "2026-09-01",
        to: "2026-09-01",
      });
      // Rolling-equivalent would incorrectly land on 30 Sep
      expect(previousEquivalentPeriod(primary)).toEqual({
        from: "2026-09-30",
        to: "2026-09-30",
      });
    });

    it("This Month on 10 Oct → 1–10 Oct vs 1–10 Sep", () => {
      expect(
        previousComparableBusinessPeriod(
          { from: "2026-10-01", to: "2026-10-10" },
          "THIS_MONTH",
        ),
      ).toEqual({ from: "2026-09-01", to: "2026-09-10" });
    });

    it("clamps day when previous month is shorter (31 Oct → 30 Sep)", () => {
      expect(
        previousComparableBusinessPeriod(
          { from: "2026-10-01", to: "2026-10-31" },
          "THIS_MONTH",
        ),
      ).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    });

    it("This Year YTD uses same dates previous year", () => {
      expect(
        previousComparableBusinessPeriod(
          { from: "2026-01-01", to: "2026-10-01" },
          "THIS_YEAR",
        ),
      ).toEqual({ from: "2025-01-01", to: "2025-10-01" });
    });

    it("Last Month compares prior complete month", () => {
      expect(
        previousComparableBusinessPeriod(
          { from: "2026-09-01", to: "2026-09-30" },
          "LAST_MONTH",
        ),
      ).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    });

    it("Last Quarter compares prior complete quarter", () => {
      expect(
        previousComparableBusinessPeriod(
          { from: "2026-07-01", to: "2026-09-30" },
          "LAST_QUARTER",
        ),
      ).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    });

    it("This Quarter uses elapsed portion of previous quarter", () => {
      // 1 Oct – 20 Nov = 51 days into Q4 → previous Q3 from 1 Jul for 51 days → 20 Aug
      expect(
        previousComparableBusinessPeriod(
          { from: "2026-10-01", to: "2026-11-20" },
          "THIS_QUARTER",
        ),
      ).toEqual({ from: "2026-07-01", to: "2026-08-20" });
    });

    it("rolling Last 30 retains equal-length preceding window", () => {
      const primary = { from: "2026-09-01", to: "2026-09-30" };
      expect(previousComparableBusinessPeriod(primary, "LAST_30")).toEqual(
        previousEquivalentPeriod(primary),
      );
      expect(previousComparableBusinessPeriod(primary, "LAST_30")).toEqual({
        from: "2026-08-02",
        to: "2026-08-31",
      });
    });

    it("resolveBusinessPeriod + comparable matches This Month day-1 case", () => {
      const resolved = resolveBusinessPeriod({
        period: "THIS_MONTH",
        now: new Date("2026-10-01T12:00:00.000Z"),
      });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.value.range).toEqual({ from: "2026-10-01", to: "2026-10-01" });
      expect(
        previousComparableBusinessPeriod(resolved.value.range, resolved.value.period),
      ).toEqual({ from: "2026-09-01", to: "2026-09-01" });
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
