import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
