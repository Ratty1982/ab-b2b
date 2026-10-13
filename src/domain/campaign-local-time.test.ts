import { describe, expect, it } from "vitest";
import { inValidityWindow } from "@/domain/trade-price-resolution";
import {
  campaignInstantForSave,
  datetimeLocalToUtcIso,
  utcIsoToDatetimeLocal,
} from "@/domain/campaign-local-time";

const LONDON = "Europe/London";

describe("campaign local times", () => {
  it("keeps a GMT instant on the same clock time", () => {
    const iso = "2026-01-15T10:30:00.000Z";
    expect(utcIsoToDatetimeLocal(iso, LONDON)).toBe("2026-01-15T10:30");
    expect(datetimeLocalToUtcIso("2026-01-15T10:30", LONDON)).toBe(iso);
    expect(iso.slice(0, 16)).toBe("2026-01-15T10:30");
  });

  it("shows British Summer Time an hour ahead of the UTC timestamp", () => {
    const iso = "2026-07-15T09:00:45.123Z";
    const local = utcIsoToDatetimeLocal(iso, LONDON);
    expect(local).toBe("2026-07-15T10:00");
    expect(local).not.toBe(iso.slice(0, 16));
    expect(datetimeLocalToUtcIso(local, LONDON)).toBe("2026-07-15T09:00:00.000Z");
    expect(campaignInstantForSave({ localValue: local, originalIso: iso, timeZone: LONDON })).toBe(iso);
  });

  it("crosses the spring-forward gap without inventing the missing hour", () => {
    expect(utcIsoToDatetimeLocal("2026-03-29T00:30:00.000Z", LONDON)).toBe("2026-03-29T00:30");
    expect(utcIsoToDatetimeLocal("2026-03-29T01:00:00.000Z", LONDON)).toBe("2026-03-29T02:00");
    expect(() => datetimeLocalToUtcIso("2026-03-29T01:30", LONDON)).toThrow(/clocks change/);
  });

  it("keeps both autumn clock-change instants when the local field is unchanged", () => {
    const bst = "2026-10-25T00:30:00.000Z";
    const gmt = "2026-10-25T01:30:00.000Z";
    expect(utcIsoToDatetimeLocal(bst, LONDON)).toBe("2026-10-25T01:30");
    expect(utcIsoToDatetimeLocal(gmt, LONDON)).toBe("2026-10-25T01:30");
    expect(campaignInstantForSave({ localValue: "2026-10-25T01:30", originalIso: bst, timeZone: LONDON })).toBe(bst);
    expect(campaignInstantForSave({ localValue: "2026-10-25T01:30", originalIso: gmt, timeZone: LONDON })).toBe(gmt);
  });

  it("uses the converted UTC instant for pricing windows", () => {
    const startsAt = new Date(datetimeLocalToUtcIso("2026-07-15T10:00", LONDON));
    const endsAt = new Date(datetimeLocalToUtcIso("2026-07-15T18:00", LONDON));
    expect(startsAt.toISOString()).toBe("2026-07-15T09:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-07-15T17:00:00.000Z");
    expect(inValidityWindow(new Date("2026-07-15T08:59:00.000Z"), startsAt, endsAt)).toBe(false);
    expect(inValidityWindow(startsAt, startsAt, endsAt)).toBe(true);
    expect(inValidityWindow(endsAt, startsAt, endsAt)).toBe(true);
    expect(inValidityWindow(new Date("2026-07-15T17:00:00.001Z"), startsAt, endsAt)).toBe(false);
  });
});
