import { describe, expect, it } from "vitest";
import {
  allocateMonthlyNet,
  last12CalendarMonths,
  netAfterCredits,
  periodMovement,
  resolveSalesEnquiryDashboardPeriod,
  salesEnquiryDashboardKey,
  salesEnquirySectionLoads,
} from "@/domain/sales-enquiry-dashboard";

const NOW = new Date("2026-10-14T12:00:00.000Z");

describe("sales enquiry dashboard periods", () => {
  it("defaults to this month in Europe/London and compares the same days last month", () => {
    const period = resolveSalesEnquiryDashboardPeriod({ now: NOW });
    expect(period.preset).toBe("THIS_MONTH");
    expect(period.label).toBe("This Month");
    expect(period.from).toBe("2026-10-01");
    expect(period.to).toBe("2026-10-14");
    expect(period.rangeLabel).toContain("Oct");
    expect(period.comparison).toEqual({
      from: "2026-09-01",
      to: "2026-09-14",
      label: expect.stringContaining("Sep"),
    });
    expect(period.includesUndatedHistory).toBe(false);
    expect(period.scan?.from).toBe("2025-11-01");
    expect(period.scan?.to).toBe("2026-10-14");
  });

  it("resolves last month, this quarter, year to date, last 12 months and all time", () => {
    expect(resolveSalesEnquiryDashboardPeriod({ period: "LAST_MONTH", now: NOW })).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
      comparison: { from: "2026-08-01", to: "2026-08-31" },
    });
    expect(resolveSalesEnquiryDashboardPeriod({ period: "THIS_QUARTER", now: NOW })).toMatchObject({
      label: "This Quarter",
      from: "2026-10-01",
      to: "2026-10-14",
    });
    expect(resolveSalesEnquiryDashboardPeriod({ period: "THIS_YEAR", now: NOW })).toMatchObject({
      label: "Year to Date",
      from: "2026-01-01",
      to: "2026-10-14",
      comparison: { from: "2025-01-01", to: "2025-10-14" },
    });
    const rolling = resolveSalesEnquiryDashboardPeriod({ period: "LAST_365", now: NOW });
    expect(rolling.label).toBe("Last 12 Months");
    expect(rolling.from).toBe("2025-10-15");
    expect(rolling.to).toBe("2026-10-14");
    expect(rolling.comparison?.to).toBe("2025-10-14");
    const allTime = resolveSalesEnquiryDashboardPeriod({ period: "ALL", now: NOW });
    expect(allTime.from).toBeNull();
    expect(allTime.to).toBeNull();
    expect(allTime.comparison).toBeNull();
    expect(allTime.scan).toBeNull();
    expect(allTime.includesUndatedHistory).toBe(true);
    expect(allTime.chart.months).toHaveLength(12);
  });

  it("keeps a custom range and the preceding window of the same length", () => {
    const period = resolveSalesEnquiryDashboardPeriod({
      period: "CUSTOM",
      from: "01/09/2026",
      to: "10/09/2026",
      now: NOW,
    });
    expect(period.from).toBe("2026-09-01");
    expect(period.to).toBe("2026-09-10");
    expect(period.comparison).toEqual({
      from: "2026-08-22",
      to: "2026-08-31",
      label: expect.any(String),
    });
  });

  it("builds twelve calendar months and does not put undated sales into them", () => {
    const chart = last12CalendarMonths("2026-10-14");
    expect(chart.months[0]).toBe("2025-11");
    expect(chart.months.at(-1)).toBe("2026-10");
    const allocated = allocateMonthlyNet(
      [
        { date: "2026-10-02", net: "40.00" },
        { date: "2026-09-20", net: "10.50" },
        { date: "2026-10-03", net: "-15.00" },
        { date: null, net: "38.00" },
        { date: "2020-01-01", net: "99.00" },
      ],
      chart.months,
    );
    expect(allocated.months.find((month) => month.month === "2026-10")?.net).toBe("25.00");
    expect(allocated.months.find((month) => month.month === "2026-09")?.net).toBe("10.50");
    expect(allocated.undatedNet).toBe("38.00");
    expect(allocated.months.some((month) => month.net === "38.00" || month.net === "99.00")).toBe(false);
    const yearly = allocated.months
      .filter((month) => month.month.startsWith("2026"))
      .reduce((sum, month) => sum + Number(month.net), 0);
    expect(yearly).toBe(35.5);
  });

  it("nets credits against invoices without moving them to another period", () => {
    expect(netAfterCredits("40.00", "-15.00")).toBe("25.00");
    expect(netAfterCredits("12.00", "-12.00")).toBe("0.00");
    const movement = periodMovement("25.00", "10.00");
    expect(movement.change).toBe("15.00");
    expect(movement.percent).toBe(150);
    expect(periodMovement("25.00", "0.00").percent).toBeNull();
    expect(periodMovement("25.00", null).percent).toBeNull();
  });

  it("loads overview without transactions, products or historical reconciliation", () => {
    expect(salesEnquirySectionLoads("overview")).toEqual({
      transactions: false,
      products: false,
      history: false,
    });
    expect(salesEnquirySectionLoads("transactions").transactions).toBe(true);
    expect(salesEnquirySectionLoads("products").products).toBe(true);
    expect(salesEnquirySectionLoads("history").history).toBe(true);
    expect(salesEnquiryDashboardKey("co_1", "THIS_MONTH", "2026-10-01", "2026-10-14")).not.toBe(
      salesEnquiryDashboardKey("co_1", "ALL", null, null),
    );
  });
});
