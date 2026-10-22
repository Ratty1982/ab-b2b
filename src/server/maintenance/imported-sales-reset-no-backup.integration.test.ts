/**
 * Builds a disposable local database named automotivebrands and proves the
 * no-backup CLI there. Refuses to touch a database that already has other data.
 */
import "@/server/testing/use-protect-integration-database";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const name = "automotivebrands";
let created = false;

afterAll(async () => {
  await prisma.$disconnect();
  if (!created) return;
  execFileSync(
    "sudo",
    [
      "-n",
      "-u",
      "postgres",
      "psql",
      "-c",
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
      "-c",
      `DROP DATABASE IF EXISTS ${name}`,
    ],
    { stdio: "pipe" },
  );
});

describe("imported sales reset without a backup", () => {
  it("runs the maintenance CLI on an isolated local database", async () => {
    const existing = await prisma.$queryRaw<Array<{ datname: string }>>`
      SELECT datname FROM pg_database WHERE datname = ${name}
    `;
    if (existing.length > 0) {
      throw new Error("A local database named automotivebrands already exists. The no-backup proof will not reuse it.");
    }
    execFileSync("sudo", ["-n", "-u", "postgres", "psql", "-c", `CREATE DATABASE ${name} OWNER ab`], {
      stdio: "pipe",
    });
    created = true;
    execFileSync(
      "bash",
      [
        "-lc",
        `PGPASSWORD=ab pg_dump --schema-only --no-owner --no-acl -h localhost -U ab automotive_brands_test | PGPASSWORD=ab psql -h localhost -U ab -d ${name} -q`,
      ],
      { stdio: "pipe" },
    );
    const output = execFileSync("bun", ["scripts/prove-imported-sales-reset-no-backup.ts"], {
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://ab:ab@localhost:5432/${name}`,
      },
      encoding: "utf8",
    });
    const report = JSON.parse(output.slice(output.indexOf("{"))) as {
      database: string;
      backup: string;
      deletedDocuments: number;
      deletedLines: number;
      feedEnabledAfter: boolean;
      deleteTransactionMs: number;
      statementTimeout: string;
      orderStatus: string;
      stockOnHand: number;
      archiveDirectory: string;
      historicalSources: string;
      discardedSources: string;
      discardArchiveDirectory: string;
      baselineKind: string;
      zeroHistoryKind: string;
    };
    expect(report.database).toBe(name);
    expect(report.backup).toBe("waived");
    expect(report.deletedDocuments).toBeGreaterThanOrEqual(20_000);
    expect(report.deletedLines).toBeGreaterThanOrEqual(20_000);
    expect(report.feedEnabledAfter).toBe(false);
    expect(report.deleteTransactionMs).toBeLessThan(180_000);
    expect(report.statementTimeout).not.toBe("0");
    expect(report.orderStatus).toBe("CONFIRMED");
    expect(report.stockOnHand).toBe(7);
    expect(report.archiveDirectory.startsWith("/tmp/ab-nobackup-archive-")).toBe(true);
    expect(report.historicalSources).toBe("archived");
    expect(report.discardedSources).toBe("discarded");
    expect(report.discardArchiveDirectory.startsWith("/tmp/ab-nobackup-archive-")).toBe(true);
    expect(report.discardArchiveDirectory).not.toBe(report.archiveDirectory);
    expect(report.baselineKind).toBe("PRELAUNCH_HISTORY_DISCARDED");
    expect(report.zeroHistoryKind).toBe("NO_HISTORICAL_SALES");
  }, 240_000);
});
