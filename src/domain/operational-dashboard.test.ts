import { describe, expect, it } from "vitest";
import {
  DASHBOARD_DUE_SOON_MINUTES,
  OPERATIONAL_LINKS,
  buildOperationalAttention,
  classifyManualImport,
  classifyPairedFeed,
  classifyScheduledImport,
  fillSalesTrendDays,
  minutesUntilStockWindow,
  salesVersusYesterday,
} from "@/domain/operational-dashboard";

describe("operational attention", () => {
  it("aggregates backordered products with no supplier into one item", () => {
    const items = buildOperationalAttention({ backordersNoSupplier: 16 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "backorders-no-supplier",
      severity: "warning",
      count: 16,
      href: OPERATIONAL_LINKS.plannerMissingSupplierBackorders,
    });
    expect(items[0]?.label).toBe("16 backordered products have no supplier");
  });

  it("orders critical ahead of warning and info", () => {
    const items = buildOperationalAttention({
      tradeApplications: 6,
      backordersNoSupplier: 2,
      noStockNoIncoming: 4,
      warehouseImportFailed: true,
    });
    expect(items.map((item) => item.severity)).toEqual(["critical", "critical", "warning", "info"]);
    expect(items.find((item) => item.id === "backorders-no-incoming")?.count).toBe(4);
    expect(items.find((item) => item.id === "backorders-no-incoming")?.href).toBe(
      OPERATIONAL_LINKS.backordersNoStock,
    );
    expect(items.find((item) => item.id === "applications")?.href).toBe(OPERATIONAL_LINKS.tradeApplications);
  });

  it("omits purchasing alerts when those facts are not supplied", () => {
    const items = buildOperationalAttention({ tradeApplications: 1, overdueTasks: 2 });
    expect(items.map((item) => item.id).sort()).toEqual(["applications", "crm-overdue"]);
    expect(JSON.stringify(items)).not.toContain("supplier");
    expect(JSON.stringify(items)).not.toContain("cost");
    expect(JSON.stringify(items)).not.toContain("FBA");
  });
});

describe("sales trend days", () => {
  it("fills missing days inside the range and drops days before it", () => {
    const filled = fillSalesTrendDays("2026-10-07", 3, [
      { day: "2026-09-01", orders: 9, value: "99.00" },
      { day: "2026-10-06", orders: 2, value: "10.00" },
    ]);
    expect(filled.map((point) => point.day)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(filled[0]).toEqual({ day: "2026-10-05", orders: 0, value: "0.00" });
    expect(filled[1]?.orders).toBe(2);
    expect(filled[2]).toEqual({ day: "2026-10-07", orders: 0, value: "0.00" });
  });

  it("compares today with yesterday only when both days are in the series", () => {
    const series = fillSalesTrendDays("2026-10-07", 2, [{ day: "2026-10-07", orders: 1, value: "20.00" }]);
    expect(salesVersusYesterday(series, "2026-10-07")).toEqual({
      todayValue: "20.00",
      yesterdayValue: "0.00",
      delta: "20.00",
    });
    expect(salesVersusYesterday([{ day: "2026-10-07", orders: 1, value: "20.00" }], "2026-10-07")).toBeNull();
  });
});

describe("data freshness", () => {
  it("treats a latest failed import as failed even when an older success exists", () => {
    expect(
      classifyScheduledImport({ latestStatus: "FAILED", stale: false, minutesUntilNext: 120 }),
    ).toBe("failed");
    expect(
      classifyScheduledImport({ latestStatus: "PARTIAL", stale: false, minutesUntilNext: 120 }),
    ).toBe("partial");
    expect(
      classifyScheduledImport({ latestStatus: "SUCCESS", stale: true, minutesUntilNext: 120 }),
    ).toBe("late");
    expect(
      classifyScheduledImport({ latestStatus: "SUCCESS", stale: false, minutesUntilNext: 25 }),
    ).toBe("due_soon");
    expect(
      classifyScheduledImport({ latestStatus: null, stale: true, minutesUntilNext: 10 }),
    ).toBe("no_data");
  });

  it("does not mark a manual import as a failed scheduled job", () => {
    expect(classifyManualImport({ updatedAt: "2026-10-01T12:00:00.000Z", stale: true })).toBe("late");
    expect(classifyManualImport({ updatedAt: "2026-10-06T12:00:00.000Z", stale: false })).toBe("current");
    expect(classifyManualImport({ updatedAt: null, stale: false })).toBe("no_data");
    expect(classifyManualImport({ updatedAt: null, stale: true })).not.toBe("failed");
  });

  it("marks a paired feed failed when the latest run recorded an error", () => {
    expect(
      classifyPairedFeed({
        lastError: true,
        hasFirst: true,
        hasSecond: true,
        missedCurrentWindow: false,
        minutesSinceWindowOpened: null,
        minutesUntilNext: 400,
      }),
    ).toBe("failed");
    expect(
      classifyPairedFeed({
        lastError: false,
        hasFirst: true,
        hasSecond: false,
        missedCurrentWindow: false,
        minutesSinceWindowOpened: null,
        minutesUntilNext: 400,
      }),
    ).toBe("partial");
    expect(
      classifyPairedFeed({
        lastError: false,
        hasFirst: true,
        hasSecond: true,
        missedCurrentWindow: true,
        minutesSinceWindowOpened: 90,
        minutesUntilNext: 200,
      }),
    ).toBe("late");
  });

  it("measures the next warehouse window in Europe/London", () => {
    const minutes = minutesUntilStockWindow(new Date("2026-07-15T07:50:00.000Z"));
    expect(minutes).toBe(25);
    expect(minutes).toBeLessThanOrEqual(DASHBOARD_DUE_SOON_MINUTES);
  });
});
