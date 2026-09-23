import { describe, expect, it } from "vitest";
import {
  BUSINESS_TIME_ZONE,
  canonicalUtc,
  formatDate,
  formatDateTime,
  formatOperationalDateTime,
  formatTime,
  formatTimeZoneName,
  isCalendarDateOnly,
  parseInstant,
} from "./datetime";

describe("Europe/London date/time formatter", () => {
  it("uses UK DD/MM/YYYY and 24-hour time in Europe/London", () => {
    const summer = "2026-09-23T11:03:14.000Z";
    expect(formatDate(summer)).toBe("23/09/2026");
    expect(formatTime(summer, { seconds: true })).toBe("12:03:14");
    expect(formatDateTime(summer, { seconds: false })).toBe("23/09/2026, 12:03");
    expect(formatTime("2026-09-23T22:15:00.000Z")).toBe("23:15");
  });

  it("converts summer UTC to BST using IANA Europe/London", () => {
    const utc = "2026-09-23T11:03:14.000Z";
    expect(BUSINESS_TIME_ZONE).toBe("Europe/London");
    expect(formatTimeZoneName(utc)).toBe("BST");
    expect(formatOperationalDateTime(utc)).toBe("23/09/2026, 12:03:14 BST");
    expect(canonicalUtc(utc)).toBe("2026-09-23T11:03:14.000Z");
  });

  it("converts winter UTC to GMT using IANA Europe/London", () => {
    const utc = "2027-01-23T12:03:14.000Z";
    expect(formatTimeZoneName(utc)).toBe("GMT");
    expect(formatOperationalDateTime(utc)).toBe("23/01/2027, 12:03:14 GMT");
  });

  it("handles the UK spring-forward DST transition without a fixed +1 offset", () => {
    expect(formatOperationalDateTime("2026-03-29T00:59:00.000Z")).toBe("29/03/2026, 00:59:00 GMT");
    expect(formatOperationalDateTime("2026-03-29T01:00:00.000Z")).toBe("29/03/2026, 02:00:00 BST");
  });

  it("handles the UK autumn fallback DST transition without a fixed offset", () => {
    expect(formatOperationalDateTime("2026-10-25T00:59:00.000Z")).toBe("25/10/2026, 01:59:00 BST");
    expect(formatOperationalDateTime("2026-10-25T01:00:00.000Z")).toBe("25/10/2026, 01:00:00 GMT");
  });

  it("does not timezone-shift date-only calendar values", () => {
    expect(isCalendarDateOnly("2026-09-23")).toBe(true);
    expect(parseInstant("2026-09-23")).toBeNull();
    expect(formatDate("2026-09-23")).toBe("23/09/2026");
    expect(formatDateTime("2026-09-23", { seconds: true, timeZoneName: true })).toBe("23/09/2026");
    expect(formatTime("2026-09-23")).toBeNull();
    expect(canonicalUtc("2026-09-23")).toBeNull();
  });

  it("formats the same instant identically for SSR and client hydration", () => {
    const utc = "2026-09-23T11:03:14.000Z";
    const first = formatOperationalDateTime(utc);
    const second = formatOperationalDateTime(new Date(utc));
    expect(first).toBe(second);
    expect(first).toBe("23/09/2026, 12:03:14 BST");
  });

  it("returns null for invalid instants", () => {
    expect(formatDate("not-a-date")).toBeNull();
    expect(formatOperationalDateTime("")).toBeNull();
    expect(formatOperationalDateTime(null)).toBeNull();
  });
});
