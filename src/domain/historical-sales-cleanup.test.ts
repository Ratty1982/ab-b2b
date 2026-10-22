import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HISTORICAL_CLEANUP_CONFIRMATION,
  evaluateHistoricalCleanupGates,
} from "@/domain/historical-sales-cleanup";
import { isOngoingSalesDocument } from "@/domain/ongoing-sales-scope";

describe("historical sales cleanup gates", () => {
  const now = new Date("2026-10-22T09:00:00.000Z");

  it("stays a dry-run when apply is not requested", () => {
    const result = evaluateHistoricalCleanupGates({
      apply: false,
      confirmation: null,
      attestation: null,
      now,
    });
    expect(result).toEqual({ mode: "dry-run", errors: [] });
  });

  it("refuses apply without the confirmation phrase and a recent restore test", () => {
    const result = evaluateHistoricalCleanupGates({
      apply: true,
      confirmation: "DELETE",
      attestation: null,
      now,
    });
    expect(result.mode).toBe("dry-run");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("allows apply only with the phrase and a restore test from the last 7 days", () => {
    const result = evaluateHistoricalCleanupGates({
      apply: true,
      confirmation: HISTORICAL_CLEANUP_CONFIRMATION,
      attestation: {
        postgresRestoreTestedAt: "2026-10-21T12:00:00.000Z",
        storageBackupPath: "/secure/autopart-history-archive",
      },
      now,
    });
    expect(result).toEqual({ mode: "apply", errors: [] });
  });

  it("ships an executable SQL procedure that refuses to run without the confirmation", () => {
    const sql = readFileSync("scripts/historical-sales-cleanup.apply.sql", "utf8");
    const command = readFileSync("scripts/historical-sales-cleanup.ts", "utf8");
    expect(sql).toContain(HISTORICAL_CLEANUP_CONFIRMATION);
    expect(sql).toContain("current_setting('ab.historical_cleanup_confirm', true)");
    expect(sql).toContain("RAISE EXCEPTION");
    expect(sql).not.toContain('DELETE FROM "Company"');
    expect(sql).not.toContain('DELETE FROM "AutopartAccount"');
    expect(sql).not.toContain('DELETE FROM "AutopartCustomerAccountAlias"');
    expect(sql).not.toContain('DELETE FROM "Order"');
    expect(sql).toContain('DELETE FROM "AutopartInvoiceLine"');
    expect(sql).toContain("valueMismatchMinor");
    expect(sql).toContain("ONGOING_TRM21QC");
    expect(command).toContain("scripts/historical-sales-cleanup.apply.sql");
    expect(command).not.toContain("$executeRaw");
    expect(command).not.toContain("readFileSync");
    expect(command).toContain("this command does not delete");
  });

  it("does not class a discrepant ongoing 504 document as historical", () => {
    expect(
      isOngoingSalesDocument({
        source: "ONGOING_504",
        has504: true,
        hasTrm21qc: false,
      }),
    ).toBe(true);
    expect(
      isOngoingSalesDocument({
        source: "561L",
        has504: true,
        hasTrm21qc: true,
      }),
    ).toBe(true);
  });
});
