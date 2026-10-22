import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ongoingImportAllowsCatchUp, signedHistoricalMeasure } from "@/domain/customer-sales-history";
import { classifyCustomerSalesReport } from "@/domain/customer-sales-import";
import {
  IMPORTED_SALES_RESET_CONFIRMATION,
  evaluateImportedSalesResetGates,
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

  it("is not referenced by application startup", () => {
    const root = resolve(import.meta.dirname, "../..");
    const server = readFileSync(resolve(root, "src/server.ts"), "utf8");
    const entry = readFileSync(resolve(root, "scripts/docker-entrypoint.sh"), "utf8");
    expect(server).not.toContain("imported-sales-reset");
    expect(entry).not.toContain("imported-sales-reset");
    expect(server).not.toContain("customer-sales-import");
  });
});
