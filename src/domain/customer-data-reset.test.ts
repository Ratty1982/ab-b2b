import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RESET_CONFIRMATION_PHRASE,
  databaseNameFromUrl,
  evaluateResetGates,
  orderResetDecision,
  validateBackupProof,
  type BackupProof,
} from "@/domain/customer-data-reset";

const now = new Date("2026-10-15T12:00:00.000Z");

function proof(overrides: Partial<BackupProof> = {}): BackupProof {
  return {
    backupPath: "/backups/ab.dump",
    backupBytes: 10,
    backupSha256: "a".repeat(64),
    sourceDatabase: "automotive_brands",
    restoredDatabase: "automotive_brands_restore",
    restoredAt: "2026-10-15T11:00:00.000Z",
    ...overrides,
  };
}

describe("customer data reset gates", () => {
  it("dry-run is the default and does not need a backup", () => {
    const result = evaluateResetGates({
      executeRequested: false,
      confirmation: null,
      targetDatabase: null,
      actualDatabase: null,
      backupProof: null,
      restoreCheckOk: false,
      ongoingResetRequested: false,
      now,
    });
    expect(result).toEqual({ ok: true, mode: "dry-run" });
  });

  it("refuses to run during deployment or bootstrap", () => {
    const result = evaluateResetGates({
      executeRequested: true,
      confirmation: RESET_CONFIRMATION_PHRASE,
      targetDatabase: "automotive_brands",
      actualDatabase: "automotive_brands",
      backupProof: proof(),
      restoreCheckOk: true,
      ongoingResetRequested: false,
      duringBootstrap: true,
      now,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an ongoing-feed reset", () => {
    const result = evaluateResetGates({
      executeRequested: false,
      confirmation: null,
      targetDatabase: null,
      actualDatabase: null,
      backupProof: null,
      restoreCheckOk: false,
      ongoingResetRequested: true,
      now,
    });
    expect(result.ok).toBe(false);
  });

  it("execute requires the phrase, database name, backup, and a different restore", () => {
    const blocked = evaluateResetGates({
      executeRequested: true,
      confirmation: "yes",
      targetDatabase: "automotive_brands",
      actualDatabase: "automotive_brands",
      backupProof: proof(),
      restoreCheckOk: true,
      ongoingResetRequested: false,
      now,
    });
    expect(blocked.ok).toBe(false);

    const sameDatabase = validateBackupProof(
      proof({ restoredDatabase: "automotive_brands" }),
      now,
    );
    expect(sameDatabase.ok).toBe(false);

    const ready = evaluateResetGates({
      executeRequested: true,
      confirmation: RESET_CONFIRMATION_PHRASE,
      targetDatabase: "automotive_brands",
      actualDatabase: "automotive_brands",
      backupProof: proof(),
      restoreCheckOk: true,
      ongoingResetRequested: false,
      now,
    });
    expect(ready).toEqual({ ok: true, mode: "execute" });
  });

  it("holds an exported order unless the consequence is acknowledged", () => {
    const evidence = {
      orderNumber: "AB-000001",
      status: "DISPATCHED",
      autopartExportStatus: "EXPORTED",
      autopartExportCount: 1,
      exportBatchReference: "APX-000001",
      externalRef: null,
      fulfilmentSources: ["AUTOPART_EXPORT"],
    };
    expect(orderResetDecision(evidence, false).hold).toBe(true);
    expect(orderResetDecision(evidence, false).summary).toContain("does not delete it from Autopart");
    expect(orderResetDecision(evidence, true).hold).toBe(false);
    expect(
      orderResetDecision(
        {
          ...evidence,
          status: "PLACED",
          autopartExportStatus: "NOT_EXPORTED",
          autopartExportCount: 0,
          exportBatchReference: null,
          fulfilmentSources: ["ORDER_PLACE"],
        },
        false,
      ).hold,
    ).toBe(false);
  });

  it("reads the database name without printing the connection string", () => {
    expect(databaseNameFromUrl("postgresql://ab:secret@localhost:5432/automotive_brands?schema=public")).toBe(
      "automotive_brands",
    );
  });

  it("is not referenced by application startup", () => {
    const root = resolve(import.meta.dirname, "../..");
    const server = readFileSync(resolve(root, "src/server.ts"), "utf8");
    const entry = readFileSync(resolve(root, "scripts/docker-entrypoint.sh"), "utf8");
    expect(server).not.toContain("customer-data-reset");
    expect(entry).not.toContain("customer-data-reset");
  });
});
