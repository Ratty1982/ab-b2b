/**
 * Dry-run by default. One-time pre-launch wipe of imported Autopart sales.
 * Does not delete customers, orders, stock, prices, or configuration.
 *
 *   bun scripts/imported-sales-reset.ts
 *
 * Execute only after a backup has been restored to a different database:
 *
 *   AB_RESET_CONFIRM='RESET PRELAUNCH IMPORTED SALES' \
 *   AB_RESET_TARGET='database_name' \
 *   AB_RESET_RESTORE_URL='postgresql://.../restored_copy' \
 *   bun scripts/imported-sales-reset.ts --execute --backup-proof /path/proof.json
 *
 * A production database name also requires --allow-production-database.
 * Execute leaves automatic 504/TRM21QC importing off.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  databaseNameFromUrl,
  describeDatabaseUrl,
  resetInvocationIsBootstrap,
  type BackupProof,
} from "../src/domain/customer-data-reset";
import {
  executeImportedSalesReset,
  planImportedSalesReset,
} from "../src/server/maintenance/imported-sales-reset";

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readProof(path: string): BackupProof {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BackupProof>;
  if (
    typeof parsed.backupPath !== "string" ||
    typeof parsed.backupBytes !== "number" ||
    typeof parsed.backupSha256 !== "string" ||
    typeof parsed.sourceDatabase !== "string" ||
    typeof parsed.restoredDatabase !== "string" ||
    typeof parsed.restoredAt !== "string"
  ) {
    throw new Error("Backup proof is incomplete.");
  }
  const file = statSync(parsed.backupPath);
  if (file.size !== parsed.backupBytes) throw new Error("Backup file size does not match the proof.");
  const hash = createHash("sha256").update(readFileSync(parsed.backupPath)).digest("hex");
  if (hash.toLowerCase() !== parsed.backupSha256.toLowerCase()) {
    throw new Error("Backup file checksum does not match the proof.");
  }
  return parsed as BackupProof;
}

async function restoreAnswers(url: string): Promise<boolean> {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

function formatPlan(plan: Awaited<ReturnType<typeof planImportedSalesReset>>, database: string | null): string {
  const lines = [
    "Pre-launch imported sales reset — dry-run",
    `Database: ${database ?? "unknown"}`,
    `Automatic 504/TRM21QC importing is currently ${plan.feedEnabled ? "ON" : "OFF"}. Execute switches it OFF and leaves it off.`,
    "",
    "Would stay",
  ];
  for (const [name, count] of Object.entries(plan.counts.preserved)) lines.push(`- ${name}: ${count}`);
  lines.push("", "Would be removed");
  for (const [name, count] of Object.entries(plan.counts.removed)) lines.push(`- ${name}: ${count}`);
  lines.push(
    "",
    `Imported documents that name a B2B order (the order is kept): ${plan.orderReferenceCount}`,
  );
  if (plan.orderReferenceCount > plan.orderReferences.length) {
    lines.push(`Showing the first ${plan.orderReferences.length}.`);
  }
  if (!plan.orderReferences.length) lines.push("- None.");
  for (const doc of plan.orderReferences) {
    lines.push(`- ${doc.documentReference} ${doc.documentType} ${doc.abOrderNumber ?? doc.abOrderId ?? ""}`);
  }
  lines.push("", "Effect");
  for (const effect of plan.effects) lines.push(`- ${effect}`);
  lines.push("", "Approval gates");
  plan.approvalGates.forEach((gate, index) => lines.push(`${index + 1}. ${gate}`));
  lines.push("", "This was a dry-run. No rows were deleted.");
  return lines.join("\n");
}

async function main() {
  if (resetInvocationIsBootstrap(process.env)) {
    console.error("The reset cannot run during deployment, container startup, or a package lifecycle script.");
    process.exitCode = 2;
    return;
  }
  const database = databaseNameFromUrl(process.env.DATABASE_URL ?? "") ?? describeDatabaseUrl(process.env.DATABASE_URL ?? "").database;
  const plan = await planImportedSalesReset();
  const text = formatPlan(plan, database);
  const reportPath = argValue("--report");
  if (reportPath) writeFileSync(reportPath, text);
  console.log(text);
  if (!hasFlag("--execute")) return;

  const proofPath = argValue("--backup-proof");
  const restoreUrl = process.env.AB_RESET_RESTORE_URL ?? "";
  const result = await executeImportedSalesReset({
    confirmation: process.env.AB_RESET_CONFIRM ?? null,
    targetDatabase: process.env.AB_RESET_TARGET ?? null,
    actualDatabase: database,
    backupProof: proofPath ? readProof(proofPath) : null,
    restoreCheckOk: restoreUrl ? await restoreAnswers(restoreUrl) : false,
    duringBootstrap: false,
    allowProductionDatabase: hasFlag("--allow-production-database"),
  });
  if (!result.ok) {
    console.error(result.reason);
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify(result.report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
