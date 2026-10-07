import { describe, expect, it } from "vitest";
import {
  classifySalesHistoryVerification,
  mergeCoverageIntervals,
  monthsWithNoRecordedSales,
  requiredForecastCoverageWindow,
  validateCoverageDates,
} from "@/domain/sales-history-coverage";

describe("sales history coverage", () => {
  it("merges overlaps and contiguous months and keeps a gap", () => {
    expect(
      mergeCoverageIntervals([
        { from: "2025-01-01", to: "2025-06-30" },
        { from: "2025-08-01", to: "2025-12-31" },
        { from: "2025-06-15", to: "2025-07-01" },
      ]),
    ).toEqual([
      { from: "2025-01-01", to: "2025-07-01" },
      { from: "2025-08-01", to: "2025-12-31" },
    ]);
  });

  it("treats the day after coverage end as contiguous", () => {
    expect(
      mergeCoverageIntervals([
        { from: "2025-01-01", to: "2026-09-30" },
        { from: "2026-10-01", to: "2026-10-07" },
      ]),
    ).toEqual([{ from: "2025-01-01", to: "2026-10-07" }]);
  });

  it("classifies verified, partial, and unverified against the 365-day window", () => {
    const required = requiredForecastCoverageWindow("2026-10-07");
    expect(required).toEqual({ from: "2025-10-08", to: "2026-10-07" });
    expect(classifySalesHistoryVerification([{ from: "2025-01-01", to: "2026-10-07" }], required).status).toBe(
      "VERIFIED",
    );
    expect(classifySalesHistoryVerification([{ from: "2026-09-01", to: "2026-10-07" }], required).status).toBe(
      "PARTIAL",
    );
    expect(classifySalesHistoryVerification([], required).status).toBe("UNVERIFIED");
    expect(
      classifySalesHistoryVerification(
        [
          { from: "2025-01-01", to: "2025-06-30" },
          { from: "2025-08-01", to: "2026-10-07" },
        ],
        required,
      ).status,
    ).toBe("VERIFIED");
  });

  it("keeps a gap inside the required window as partially verified", () => {
    const required = requiredForecastCoverageWindow("2026-10-07");
    const classified = classifySalesHistoryVerification(
      [
        { from: "2025-10-08", to: "2026-06-30" },
        { from: "2026-08-01", to: "2026-10-07" },
      ],
      required,
    );
    expect(classified.status).toBe("PARTIAL");
    expect(classified.coveredFrom).toBe("2025-10-08");
    expect(classified.coveredTo).toBe("2026-10-07");
    expect(classified.coveredDays).toBeLessThan(classified.requiredDays);
  });

  it("rejects an end before the start and coverage beyond imported sales", () => {
    expect(
      validateCoverageDates({
        from: "2026-10-08",
        to: "2026-10-01",
        earliestSale: "2024-01-04",
        latestSale: "2026-10-07",
      }).ok,
    ).toBe(false);
    expect(
      validateCoverageDates({
        from: "2024-01-04",
        to: "2026-10-08",
        earliestSale: "2024-01-04",
        latestSale: "2026-10-07",
      }),
    ).toEqual({
      ok: false,
      message: "Coverage cannot extend beyond the imported sales dates for this scope.",
    });
    expect(
      validateCoverageDates({
        from: "2025-01-01",
        to: "2026-10-07",
        earliestSale: "2024-01-04",
        latestSale: "2026-10-07",
      }).ok,
    ).toBe(true);
  });

  it("lists calendar months with no recorded sales without treating them as proof of a missing file", () => {
    expect(monthsWithNoRecordedSales(["2026-01", "2026-03"], "2026-01-02", "2026-03-15")).toEqual(["2026-02"]);
    expect(monthsWithNoRecordedSales(["2026-01", "2026-02"], "2026-01-01", "2026-02-28")).toEqual([]);
  });
});
