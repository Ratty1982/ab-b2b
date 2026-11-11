/**
 * Builds a disposable local database named automotivebrands and proves the
 * no-backup CLI there. Refuses to touch a database that already has other data.
 *
 * Uses TCP credentials from TEST_DATABASE_URL so GitHub Actions service
 * containers work (no host `sudo -u postgres` required).
 */
import "@/server/testing/use-protect-integration-database";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const name = "automotivebrands";
let created = false;

type PgEndpoint = {
  host: string;
  port: string;
  user: string;
  password: string;
  sourceDatabase: string;
};

function readEndpoint(): PgEndpoint {
  const url = new URL(process.env["TEST_DATABASE_URL"] || process.env["DATABASE_URL"] || "");
  const sourceDatabase = url.pathname.replace(/^\//, "").split("?")[0] || "automotive_brands_test";
  return {
    host: url.hostname || "localhost",
    port: url.port || "5432",
    user: decodeURIComponent(url.username || "ab"),
    password: decodeURIComponent(url.password || "ab"),
    sourceDatabase,
  };
}

function psqlEnv(endpoint: PgEndpoint): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGPASSWORD: endpoint.password,
    PGHOST: endpoint.host,
    PGPORT: endpoint.port,
    PGUSER: endpoint.user,
  };
}

function runPsql(endpoint: PgEndpoint, database: string, sql: string) {
  execFileSync(
    "psql",
    ["-h", endpoint.host, "-p", endpoint.port, "-U", endpoint.user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql],
    { stdio: "pipe", env: psqlEnv(endpoint) },
  );
}

function dropDisposableDatabase(endpoint: PgEndpoint) {
  runPsql(
    endpoint,
    "postgres",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid();`,
  );
  runPsql(endpoint, "postgres", `DROP DATABASE IF EXISTS ${name};`);
}

afterAll(async () => {
  try {
    if (created) {
      dropDisposableDatabase(readEndpoint());
    }
  } catch {
    // Best-effort cleanup for disposable proof DB.
  }
  await prisma.$disconnect();
});

describe("imported sales reset without a backup", () => {
  it("runs the maintenance CLI on an isolated local database", async () => {
    const endpoint = readEndpoint();
    const existing = await prisma.$queryRaw<Array<{ datname: string }>>`
      SELECT datname FROM pg_database WHERE datname = ${name}
    `;
    if (existing.length > 0) {
      throw new Error(
        "A local database named automotivebrands already exists. The no-backup proof will not reuse it.",
      );
    }

    // CREATE DATABASE cannot run inside a Prisma interactive transaction.
    runPsql(endpoint, "postgres", `CREATE DATABASE ${name} OWNER ${endpoint.user};`);
    created = true;
    execFileSync(
      "bash",
      [
        "-c",
        `pg_dump --schema-only --no-owner --no-acl -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$SOURCE_DB" | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q`,
      ],
      {
        stdio: "pipe",
        env: {
          ...psqlEnv(endpoint),
          SOURCE_DB: endpoint.sourceDatabase,
          TARGET_DB: name,
        },
      },
    );

    const targetUrl = `postgresql://${encodeURIComponent(endpoint.user)}:${encodeURIComponent(endpoint.password)}@${endpoint.host}:${endpoint.port}/${name}`;
    const output = execFileSync("bun", ["scripts/prove-imported-sales-reset-no-backup.ts"], {
      env: {
        ...process.env,
        DATABASE_URL: targetUrl,
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
