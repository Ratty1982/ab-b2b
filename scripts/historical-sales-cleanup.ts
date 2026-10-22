/**
 * Historical Autopart sales cleanup.
 *
 * Dry-run (default, read-only):
 *   bun scripts/historical-sales-cleanup.ts
 *
 * Apply is refused until a tested PostgreSQL restore and a storage backup
 * are attested. Apply is not run by deploy, startup, or this repository's
 * default command. Do not pass --apply until that evidence has been reviewed.
 *
 *   bun scripts/historical-sales-cleanup.ts \
 *     --apply \
 *     --confirm ARCHIVE_AND_DELETE_HISTORICAL_SALES \
 *     --postgres-restore-tested-at 2026-10-21T12:00:00Z \
 *     --storage-backup /secure/autopart-history-archive
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { planHistoricalSalesCleanup } from "../src/server/maintenance/historical-sales-cleanup";

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

const apply = process.argv.includes("--apply");
const plan = await planHistoricalSalesCleanup({
  apply,
  confirmation: arg("--confirm"),
  attestation: apply
    ? {
        postgresRestoreTestedAt: arg("--postgres-restore-tested-at") ?? "",
        storageBackupPath: arg("--storage-backup") ?? "",
      }
    : null,
});

const outDir = process.env["HISTORICAL_CLEANUP_OUT"] || "/tmp/historical-cleanup";
await mkdir(outDir, { recursive: true });
const stamp = plan.generatedAt.replace(/[:.]/g, "-");
const reportPath = path.join(outDir, `dry-run-${stamp}.json`);
await writeFile(reportPath, JSON.stringify(plan, null, 2));

console.log(JSON.stringify({ reportPath, database: plan.database, mode: plan.gates.mode, errors: plan.gates.errors, counts: plan.counts }, null, 2));

if (apply && plan.gates.mode !== "apply") {
  console.error("Apply refused. No rows were deleted.");
  process.exitCode = 1;
} else if (apply && plan.gates.mode === "apply") {
  console.error(
    "Apply gates passed, but deletion is not executed by this command. Archive the listed files, take the approved backup, and run the reviewed SQL from docs/historical-sales-cleanup.md in a controlled session.",
  );
  process.exitCode = 2;
}

await import("../src/infra/database/client").then(({ prisma }) => prisma.$disconnect());
