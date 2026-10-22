import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { historicalProductLineIdentity, ongoingImportAllowsCatchUp, signedHistoricalMeasure } from "@/domain/customer-sales-history";
import { classifyCustomerSalesReport } from "@/domain/customer-sales-import";
import { redactIneligibleSalesDiagnostic } from "@/domain/autopart-import-diagnostics";
import {
  IMPORTED_SALES_NO_BACKUP_ACKNOWLEDGEMENT,
  IMPORTED_SALES_RESET_CONFIRMATION,
  IMPORTED_SALES_RESET_TRANSACTION_TIMEOUT_MS,
  archivedBytesMatch,
  evaluateImportedSalesResetGates,
  importedSalesResetVerificationProblem,
  isProductionSalesDatabase,
  persistentSalesArchiveProblem,
} from "@/domain/imported-sales-reset";
import type { BackupProof } from "@/domain/customer-data-reset";

const now = new Date("2026-10-22T12:00:00.000Z");

function proof(overrides: Partial<BackupProof> = {}): BackupProof {
  return {
    backupPath: "/backups/ab.dump",
    backupBytes: 10,
    backupSha256: "a".repeat(64),
    sourceDatabase: "automotive_brands_sales_reset_test",
    restoredDatabase: "automotive_brands_sales_reset_restore",
    restoredAt: "2026-10-22T11:00:00.000Z",
    ...overrides,
  };
}

describe("historical sales measures", () => {
  it("stores credits as negative and leaves payments out of sales", () => {
    expect(signedHistoricalMeasure("CREDIT", "51.90", 2)).toBe("-51.90");
    expect(signedHistoricalMeasure("CREDIT", "-51.90", 2)).toBe("-51.90");
    expect(signedHistoricalMeasure("INVOICE", "622.80", 2)).toBe("622.80");
    expect(signedHistoricalMeasure("PAYMENT", "400.00", 2)).toBeNull();
    const first = historicalProductLineIdentity({
      documentType: "INVOICE",
      documentReference: "SS1",
      sku: "SS",
      sourceLineNumber: 1,
      rawInvAndLn: "I/SS1/1",
      skuOrdinal: 1,
    });
    const second = historicalProductLineIdentity({
      documentType: "INVOICE",
      documentReference: "SS1",
      sku: "SS",
      sourceLineNumber: 2,
      rawInvAndLn: "I/SS1/2",
      skuOrdinal: 1,
    });
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect(first.lineNumber).toBe(1);
    expect(second.lineNumber).toBe(2);
    const redacted = redactIneligibleSalesDiagnostic({
      status: "SKIPPED",
      reasonCode: "NOT_ACTIVE",
      reason: "not active",
      sku: "SS",
      quantity: "2",
      salesNet: "10.00",
      description: "Widget",
      customerAccount: "PROSPECT",
    });
    expect(redacted.salesNet).toBeNull();
    expect(redacted.quantity).toBeNull();
    expect(redacted.sku).toBeNull();
    expect(redacted.customerAccount).toBe("PROSPECT");
    expect(redacted.reasonCode).toBe("NOT_ACTIVE");
    expect(ongoingImportAllowsCatchUp({ skippedIneligible: 2 })).toBe(true);
    expect(ongoingImportAllowsCatchUp({ skippedIneligible: 0 })).toBe(false);
    expect(ongoingImportAllowsCatchUp(null)).toBe(false);
  });
});

describe("customer sales report source", () => {
  it("accepts ongoing 504 and TRM21QC and rejects historical files", () => {
    expect(
      classifyCustomerSalesReport(
        "Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number\n",
      ),
    ).toBe("504");
    expect(
      classifyCustomerSalesReport(
        "Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%\n",
      ),
    ).toBe("TRM21QC");
    expect(classifyCustomerSalesReport("CUSTOMER SALES FOR PART NUMBERS BY INVOICE LINE (561L)\n")).toBe(
      "HISTORICAL_561L_SLRB",
    );
    expect(classifyCustomerSalesReport("SLRB sales ledger\n")).toBe("HISTORICAL_561L_SLRB");
  });
});

describe("imported sales reset gates", () => {
  it("uses the pre-launch confirmation phrase", () => {
    expect(IMPORTED_SALES_RESET_CONFIRMATION).toBe("RESET PRELAUNCH IMPORTED SALES");
  });

  it("dry-run needs no backup", () => {
    expect(
      evaluateImportedSalesResetGates({
        executeRequested: false,
        confirmation: null,
        targetDatabase: null,
        actualDatabase: null,
        backupProof: null,
        restoreCheckOk: false,
        now,
      }),
    ).toEqual({ ok: true, mode: "dry-run" });
  });

  it("execute requires the phrase, a different restore, and an extra flag on production names", () => {
    const blocked = evaluateImportedSalesResetGates({
      executeRequested: true,
      confirmation: "RESET HISTORICAL SALES",
      targetDatabase: "automotive_brands_sales_reset_test",
      actualDatabase: "automotive_brands_sales_reset_test",
      backupProof: proof(),
      restoreCheckOk: true,
      now,
    });
    expect(blocked.ok).toBe(false);

    const production = evaluateImportedSalesResetGates({
      executeRequested: true,
      confirmation: IMPORTED_SALES_RESET_CONFIRMATION,
      targetDatabase: "automotive_brands",
      actualDatabase: "automotive_brands",
      backupProof: proof({ sourceDatabase: "automotive_brands" }),
      restoreCheckOk: true,
      now,
    });
    expect(production.ok).toBe(false);
    expect(isProductionSalesDatabase("automotivebrands")).toBe(true);
    const namedProduction = evaluateImportedSalesResetGates({
      executeRequested: true,
      confirmation: IMPORTED_SALES_RESET_CONFIRMATION,
      targetDatabase: "automotivebrands",
      actualDatabase: "automotivebrands",
      backupProof: proof({ sourceDatabase: "automotivebrands" }),
      restoreCheckOk: true,
      now,
    });
    expect(namedProduction.ok).toBe(false);
    const namedReady = evaluateImportedSalesResetGates({
      executeRequested: true,
      confirmation: IMPORTED_SALES_RESET_CONFIRMATION,
      targetDatabase: "automotivebrands",
      actualDatabase: "automotivebrands",
      backupProof: proof({ sourceDatabase: "automotivebrands" }),
      restoreCheckOk: true,
      allowProductionDatabase: true,
      now,
    });
    expect(namedReady).toEqual({ ok: true, mode: "execute" });
    expect(persistentSalesArchiveProblem("/workspace/var/autopart-sales-archive", "/workspace")).toMatch(/application directory/);
    expect(persistentSalesArchiveProblem("/data/autopart-imports/sales-reset-archive", "/workspace")).toBeNull();
    expect(archivedBytesMatch({ expectedSha256: "abc", expectedBytes: 4, actualSha256: "ABC", actualBytes: 4 })).toBe(true);
    expect(archivedBytesMatch({ expectedSha256: "abc", expectedBytes: 4, actualSha256: "abc", actualBytes: 3 })).toBe(false);

    const ready = evaluateImportedSalesResetGates({
      executeRequested: true,
      confirmation: IMPORTED_SALES_RESET_CONFIRMATION,
      targetDatabase: "automotive_brands_sales_reset_test",
      actualDatabase: "automotive_brands_sales_reset_test",
      backupProof: proof(),
      restoreCheckOk: true,
      now,
    });
    expect(ready).toEqual({ ok: true, mode: "execute" });
  });

  it("waives only the backup and restore checks for automotivebrands", () => {
    const base = {
      executeRequested: true as const,
      confirmation: IMPORTED_SALES_RESET_CONFIRMATION,
      targetDatabase: "automotivebrands",
      actualDatabase: "automotivebrands",
      backupProof: null,
      restoreCheckOk: false,
      allowProductionDatabase: true,
      acceptNoBackupRisk: true,
      noBackupAcknowledgement: IMPORTED_SALES_NO_BACKUP_ACKNOWLEDGEMENT,
      now,
    };
    expect(evaluateImportedSalesResetGates(base)).toEqual({ ok: true, mode: "execute" });
    expect(evaluateImportedSalesResetGates({ ...base, acceptNoBackupRisk: false }).ok).toBe(false);
    expect(evaluateImportedSalesResetGates({ ...base, allowProductionDatabase: false }).ok).toBe(false);
    expect(evaluateImportedSalesResetGates({ ...base, noBackupAcknowledgement: "yes" }).ok).toBe(false);
    expect(evaluateImportedSalesResetGates({ ...base, confirmation: "RESET IMPORTED AUTOPART SALES" }).ok).toBe(false);
    expect(
      evaluateImportedSalesResetGates({
        ...base,
        targetDatabase: "automotive_brands_sales_reset_test",
        actualDatabase: "automotive_brands_sales_reset_test",
      }).ok,
    ).toBe(false);
    expect(evaluateImportedSalesResetGates({ ...base, duringBootstrap: true }).ok).toBe(false);
    expect(IMPORTED_SALES_RESET_TRANSACTION_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
    expect(
      importedSalesResetVerificationProblem({
        preservedBefore: { companies: 2, orders: 1 },
        preservedAfter: { companies: 2, orders: 1 },
        removedAfter: { salesDocuments: 0, salesLines: 0 },
      }),
    ).toBeNull();
    expect(
      importedSalesResetVerificationProblem({
        preservedBefore: { companies: 2 },
        preservedAfter: { companies: 1 },
        removedAfter: { salesDocuments: 0 },
      }),
    ).toMatch(/companies/);
    expect(
      importedSalesResetVerificationProblem({
        preservedBefore: { companies: 2 },
        preservedAfter: { companies: 2 },
        removedAfter: { salesDocuments: 3 },
      }),
    ).toMatch(/salesDocuments/);
  });

  it("is not referenced by application startup", () => {
    const root = resolve(import.meta.dirname, "../..");
    const server = readFileSync(resolve(root, "src/server.ts"), "utf8");
    const entry = readFileSync(resolve(root, "scripts/docker-entrypoint.sh"), "utf8");
    const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
    expect(server).not.toContain("imported-sales-reset");
    expect(entry).not.toContain("imported-sales-reset");
    expect(entry).not.toContain("accept-no-backup-risk");
    expect(dockerfile).not.toContain("imported-sales-reset");
    expect(server).not.toContain("customer-sales-import");
  });
});
