import { describe, expect, it } from "vitest";
import {
  emptyDiagnosticCounts,
  historicSkipAggregateMessage,
  makeDiagnostic,
  sourceLabel,
  tallyDiagnostic,
} from "@/domain/autopart-import-diagnostics";

describe("autopart import diagnostics domain", () => {
  it("explains historic TRM21QC skip aggregate without inventing row detail", () => {
    const msg = historicSkipAggregateMessage({
      type: "ONGOING_TRM21QC",
      rowsSkipped: 67,
      rowsUnmatched: 12,
      hasRowDiagnostics: false,
    });
    expect(msg).toContain("Detailed row diagnostics were not recorded");
    expect(msg).toContain("67");
    expect(msg).toContain("could not be mapped");
  });

  it("does not fabricate historic note when row diagnostics exist", () => {
    expect(
      historicSkipAggregateMessage({
        type: "ONGOING_TRM21QC",
        rowsSkipped: 67,
        rowsUnmatched: 12,
        hasRowDiagnostics: true,
      }),
    ).toBeNull();
  });

  it("tallies statuses and catalogue warnings", () => {
    const counts = emptyDiagnosticCounts();
    for (const d of [
      makeDiagnostic({ status: "INSERTED", reasonCode: "INSERTED" }),
      makeDiagnostic({
        status: "INSERTED",
        reasonCode: "NOT_IN_AB_CATALOGUE",
        isWarning: true,
      }),
      makeDiagnostic({ status: "SKIPPED", reasonCode: "UNMAPPED_CUSTOMER" }),
      makeDiagnostic({ status: "UNCHANGED", reasonCode: "ALREADY_IMPORTED" }),
    ]) {
      tallyDiagnostic(counts, d);
    }
    expect(counts.inserted).toBe(2);
    expect(counts.skipped).toBe(1);
    expect(counts.unchanged).toBe(1);
    expect(counts.warnings).toBeGreaterThanOrEqual(1);
  });

  it("normalises import source labels", () => {
    expect(sourceLabel("MANUAL")).toBe("MANUAL_UPLOAD");
    expect(sourceLabel("EMAIL")).toBe("EMAIL_POLL");
    expect(sourceLabel("SCHEDULE")).toBe("SCHEDULED_POLL");
  });
});
