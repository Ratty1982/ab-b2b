import { describe, expect, it } from "vitest";
import {
  documentDatePrismaHalfOpenBounds,
  formatUkDateRangeLabel,
  isDocumentDateInRange,
  parseUkOrIsoDateOnly,
  resolveBusinessPeriod,
  todayLondonDateOnly,
} from "@/domain/sales-history-period";
const FIXED_NOW = new Date("2026-10-01T12:00:00.000Z"); // 1 Oct 2026 afternoon UTC ≈ London BST still Oct 1

describe("resolveBusinessPeriod", () => {
  it("defaults to This Month when defaultPeriod is THIS_MONTH", () => {
    const r = resolveBusinessPeriod({ now: FIXED_NOW, defaultPeriod: "THIS_MONTH" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.period).toBe("THIS_MONTH");
    expect(r.value.displayFrom).toBe("2026-10-01");
    expect(r.value.displayTo).toBe("2026-10-01");
    expect(r.value.label).toBe("This Month");
    expect(r.value.displayRangeLabel).toContain("Oct");
  });

  it("resolves calendar periods for 01/10/2026 London", () => {
    const today = todayLondonDateOnly(FIXED_NOW);
    expect(today).toBe("2026-10-01");

    const cases: Array<[string, string, string]> = [
      ["THIS_MONTH", "2026-10-01", "2026-10-01"],
      ["LAST_MONTH", "2026-09-01", "2026-09-30"],
      ["THIS_QUARTER", "2026-10-01", "2026-10-01"],
      ["LAST_QUARTER", "2026-07-01", "2026-09-30"],
      ["THIS_YEAR", "2026-01-01", "2026-10-01"],
      ["LAST_YEAR", "2025-01-01", "2025-12-31"],
      ["LAST_7", "2026-09-25", "2026-10-01"],
      ["LAST_30", "2026-09-02", "2026-10-01"],
      ["LAST_90", "2026-07-04", "2026-10-01"],
      ["LAST_365", "2025-10-02", "2026-10-01"],
    ];
    for (const [period, from, to] of cases) {
      const r = resolveBusinessPeriod({ period, now: FIXED_NOW });
      expect(r.ok, period).toBe(true);
      if (!r.ok) continue;
      expect(r.value.displayFrom, period).toBe(from);
      expect(r.value.displayTo, period).toBe(to);
    }
  });

  it("All Time uses sentinel dated-history window", () => {
    const r = resolveBusinessPeriod({ period: "ALL", now: FIXED_NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.displayFrom).toBe("0001-01-01");
    expect(r.value.displayTo).toBe("9999-12-31");
    expect(r.value.label).toBe("All Time");
  });

  it("Custom requires both dates and To >= From (ISO or UK)", () => {
    expect(resolveBusinessPeriod({ period: "CUSTOM", now: FIXED_NOW }).ok).toBe(false);
    expect(
      resolveBusinessPeriod({
        period: "CUSTOM",
        from: "01/09/2026",
        to: null,
        now: FIXED_NOW,
      }).ok,
    ).toBe(false);
    expect(
      resolveBusinessPeriod({
        period: "CUSTOM",
        from: "30/09/2026",
        to: "01/09/2026",
        now: FIXED_NOW,
      }),
    ).toMatchObject({ ok: false, code: "CUSTOM_ORDER" });

    const ok = resolveBusinessPeriod({
      period: "CUSTOM",
      from: "01/09/2026",
      to: "30/09/2026",
      now: FIXED_NOW,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.displayFrom).toBe("2026-09-01");
    expect(ok.value.displayTo).toBe("2026-09-30");
  });

  it("handles month/quarter/year/leap boundaries", () => {
    // First day of month
    const jan1 = resolveBusinessPeriod({
      period: "THIS_MONTH",
      now: new Date("2026-01-01T12:00:00.000Z"),
    });
    expect(jan1.ok && jan1.value.range).toEqual({ from: "2026-01-01", to: "2026-01-01" });

    // Last day of month → Last Month from Feb 1 is Jan
    const feb1 = resolveBusinessPeriod({
      period: "LAST_MONTH",
      now: new Date("2026-02-01T12:00:00.000Z"),
    });
    expect(feb1.ok && feb1.value.range).toEqual({ from: "2026-01-01", to: "2026-01-31" });

    // Leap year Feb
    const mar1Leap = resolveBusinessPeriod({
      period: "LAST_MONTH",
      now: new Date("2024-03-01T12:00:00.000Z"),
    });
    expect(mar1Leap.ok && mar1Leap.value.range).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });

    // Q1 → last quarter is prior year Q4
    const q1 = resolveBusinessPeriod({
      period: "LAST_QUARTER",
      now: new Date("2026-02-15T12:00:00.000Z"),
    });
    expect(q1.ok && q1.value.range).toEqual({ from: "2025-10-01", to: "2025-12-31" });

    // Year boundary This Year
    const nye = resolveBusinessPeriod({
      period: "THIS_YEAR",
      now: new Date("2026-12-31T12:00:00.000Z"),
    });
    expect(nye.ok && nye.value.range).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("uses Europe/London civil day around BST transitions", () => {
    // 2026-03-29 00:30 UTC is still 29 Mar in London (BST starts 29 Mar 2026 01:00 GMT → 02:00 BST)
    const beforeBst = todayLondonDateOnly(new Date("2026-03-29T00:30:00.000Z"));
    expect(beforeBst).toBe("2026-03-29");
    // After spring forward: 2026-03-29 01:30 UTC = 02:30 BST same calendar day
    const afterBst = todayLondonDateOnly(new Date("2026-03-29T01:30:00.000Z"));
    expect(afterBst).toBe("2026-03-29");

    // Autumn: 2026-10-25 clocks go back. 00:30 UTC = 01:30 BST still 25 Oct
    const bstEnd = todayLondonDateOnly(new Date("2026-10-25T00:30:00.000Z"));
    expect(bstEnd).toBe("2026-10-25");
  });

  it("half-open bounds include start day and exclude endExclusive day", () => {
    const r = resolveBusinessPeriod({
      period: "LAST_MONTH",
      now: FIXED_NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const half = documentDatePrismaHalfOpenBounds(r.value.range);
    expect(half.gte.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(half.lt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(r.value.start.toISOString()).toBe(half.gte.toISOString());
    expect(r.value.endExclusive.toISOString()).toBe(half.lt.toISOString());

    // UTC-noon storage on boundary days
    const startNoon = new Date("2026-09-01T12:00:00.000Z");
    const endNoon = new Date("2026-09-30T12:00:00.000Z");
    const nextNoon = new Date("2026-10-01T12:00:00.000Z");
    expect(startNoon >= r.value.start && startNoon < r.value.endExclusive).toBe(true);
    expect(endNoon >= r.value.start && endNoon < r.value.endExclusive).toBe(true);
    expect(nextNoon >= r.value.start && nextNoon < r.value.endExclusive).toBe(false);

    expect(isDocumentDateInRange(startNoon, r.value.range)).toBe(true);
    expect(isDocumentDateInRange(endNoon, r.value.range)).toBe(true);
    expect(isDocumentDateInRange(nextNoon, r.value.range)).toBe(false);
  });

  it("formats UK display ranges and parses UK dates", () => {
    expect(formatUkDateRangeLabel("2026-09-01", "2026-09-30")).toMatch(
      /^1 Sept? – 30 Sept? 2026$/,
    );
    expect(formatUkDateRangeLabel("2026-10-01", "2026-10-01")).toMatch(/^1 Oct 2026$/);
    expect(parseUkOrIsoDateOnly("01/10/2026")).toBe("2026-10-01");
    expect(parseUkOrIsoDateOnly("2026-10-01")).toBe("2026-10-01");
    expect(parseUkOrIsoDateOnly("31/02/2026")).toBeNull();
  });

  it("accepts rebate PREVIOUS_QUARTER and YTD aliases", () => {
    const q = resolveBusinessPeriod({ period: "PREVIOUS_QUARTER", now: FIXED_NOW });
    expect(q.ok && q.value.period).toBe("LAST_QUARTER");
    const y = resolveBusinessPeriod({ period: "YTD", now: FIXED_NOW });
    expect(y.ok && y.value.period).toBe("THIS_YEAR");
  });
});
