import { describe, expect, it } from "vitest";
import {
  compare216vSnapshotChronology,
  pickCurrent216vSnapshot,
  previous216vSnapshot,
  reportDateFrom216vFilename,
  resolveAutopart216vReportDate,
} from "@/domain/autopart-216v-report-date";

describe("216V report date", () => {
  it("reads the report day from the filename and ignores import time", () => {
    expect(reportDateFrom216vFilename("216V_20261010.csv")).toBe("2026-10-10");
    expect(reportDateFrom216vFilename("216V_20261012.CSV")).toBe("2026-10-12");
    expect(reportDateFrom216vFilename("216V-2026-10-12.csv")).toBe("2026-10-12");
    expect(reportDateFrom216vFilename("216V.CSV")).toBeNull();
    expect(reportDateFrom216vFilename("216V-1791326887226.csv")).toBeNull();
    expect(reportDateFrom216vFilename("216V_20261340.csv")).toBeNull();
    expect(reportDateFrom216vFilename("216V_20260231.csv")).toBeNull();

    const saturday = resolveAutopart216vReportDate({
      filename: "216V_20261010.csv",
      receivedAt: new Date("2026-10-10T17:01:37.000Z"),
      importedAt: new Date("2026-10-12T17:16:07.000Z"),
    });
    expect(saturday).toEqual({ iso: "2026-10-10", source: "FILENAME" });
  });

  it("uses the email received day when the filename has no date", () => {
    const resolved = resolveAutopart216vReportDate({
      filename: "216V.CSV",
      receivedAt: new Date("2026-10-10T17:01:37.000Z"),
      businessDate: new Date("2026-10-12T00:00:00.000Z"),
      importedAt: new Date("2026-10-12T17:16:07.000Z"),
    });
    expect(resolved).toEqual({ iso: "2026-10-10", source: "RECEIVED_AT" });
  });

  it("falls back to import time only when no report metadata exists", () => {
    const resolved = resolveAutopart216vReportDate({
      filename: "216V.CSV",
      importedAt: new Date("2026-10-12T17:16:07.000Z"),
    });
    expect(resolved).toEqual({ iso: "2026-10-12", source: "IMPORT_TIME" });
  });

  it("ranks a later report above an older file that was imported afterwards", () => {
    const saturday = {
      id: "sat",
      filename: "216V_20261010.csv",
      receivedAt: new Date("2026-10-10T17:01:37.000Z"),
      importedAt: new Date("2026-10-12T17:16:07.000Z"),
      businessDate: new Date("2026-10-12T00:00:00.000Z"),
    };
    const monday = {
      id: "mon",
      filename: "216V_20261012.csv",
      receivedAt: new Date("2026-10-12T16:50:00.000Z"),
      importedAt: new Date("2026-10-12T16:55:00.000Z"),
      businessDate: new Date("2026-10-12T00:00:00.000Z"),
    };
    expect(compare216vSnapshotChronology(saturday, monday)).toBeLessThan(0);
    expect(pickCurrent216vSnapshot([saturday, monday])?.id).toBe("mon");
    expect(previous216vSnapshot([saturday, monday], monday)?.id).toBe("sat");
    expect(pickCurrent216vSnapshot([monday, saturday])?.filename).toBe("216V_20261012.csv");
  });

  it("breaks equal report dates by received time, then import time, then id", () => {
    const earlierMail = {
      id: "b",
      filename: "216V_20261012.csv",
      receivedAt: new Date("2026-10-12T16:00:00.000Z"),
      importedAt: new Date("2026-10-12T18:00:00.000Z"),
    };
    const laterMail = {
      id: "a",
      filename: "216V_20261012.csv",
      receivedAt: new Date("2026-10-12T17:00:00.000Z"),
      importedAt: new Date("2026-10-12T17:05:00.000Z"),
    };
    expect(pickCurrent216vSnapshot([earlierMail, laterMail])?.id).toBe("a");
    const sameInstantA = { ...earlierMail, id: "a", receivedAt: laterMail.receivedAt, importedAt: laterMail.importedAt };
    const sameInstantB = { ...laterMail, id: "b" };
    expect(pickCurrent216vSnapshot([sameInstantA, sameInstantB])?.id).toBe("b");
  });
});
