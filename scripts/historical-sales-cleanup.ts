/**
 * Historical Autopart sales cleanup.
 *
 * Dry-run (default, read-only):
 *   bun scripts/historical-sales-cleanup.ts
 *
 * Apply is refused until a tested PostgreSQL restore and a storage backup
 * are attested. This command never deletes. The executable procedure is
 * scripts/historical-sales-cleanup.apply.sql and is run only in a later
 * reviewed session. That procedure stays disabled unless the operator sets
 * ab.historical_cleanup_enabled and the confirmation phrase in the same
 * psql session. Deploy and server start do not run either file.
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
    "Apply gates passed, but this command does not delete. After the dry-run and a tested backup restore, a separate reviewed session may run scripts/historical-sales-cleanup.apply.sql.",
  );
  process.exitCode = 2;
}

await import("../src/infra/database/client").then(({ prisma }) => prisma.$disconnect());
