/**
 * One-time customer data reset.
 *
 * Dry-run is the default. This script is not run by deployment or application startup.
 *
 *   bun scripts/customer-data-reset.ts
 *   bun scripts/customer-data-reset.ts --report /tmp/customer-data-reset.txt
 *
 * Execute (only after a backup has been restored to a different database):
 *
 *   AB_RESET_CONFIRM='RESET HISTORICAL SALES' \
 *   AB_RESET_TARGET='database_name' \
 *   AB_RESET_RESTORE_URL='postgresql://.../restored_copy' \
 *   bun scripts/customer-data-reset.ts \
 *     --execute \
 *     --backup-proof /path/proof.json \
 *     --acknowledge-exported-orders \
     --include-b2b-orders
 *
 * proof.json:
 *   {
 *     "backupPath": "/path/ab-backup.dump",
 *     "backupBytes": 123,
 *     "backupSha256": "<sha256 of that file>",
 *     "sourceDatabase": "database_name",
 *     "restoredDatabase": "restored_copy",
 *     "restoredAt": "2026-10-15T12:00:00.000Z"
 *   }
 *
 * --reset-ongoing is refused. Daily 504/TRM rows are not deleted.
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
  executeCustomerDataReset,
  planCustomerDataReset,
} from "../src/server/maintenance/customer-data-reset";

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
  if (file.size !== parsed.backupBytes) {
    throw new Error("Backup file size does not match the proof.");
  }
  const hash = createHash("sha256").update(readFileSync(parsed.backupPath)).digest("hex");
  if (hash.toLowerCase() !== parsed.backupSha256.toLowerCase()) {
    throw new Error("Backup file checksum does not match the proof.");
  }
  return {
    backupPath: parsed.backupPath,
    backupBytes: parsed.backupBytes,
    backupSha256: parsed.backupSha256,
    sourceDatabase: parsed.sourceDatabase,
    restoredDatabase: parsed.restoredDatabase,
    restoredAt: parsed.restoredAt,
  };
}

async function restoreAnswers(url: string): Promise<boolean> {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    await client.$queryRaw`SELECT 1`;
    const accounts = await client.autopartAccount.count();
    return accounts >= 0;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

function formatPlan(
  plan: Awaited<ReturnType<typeof planCustomerDataReset>>,
  identity: { database: string | null; host: string | null },
): string {
  const lines: string[] = [];
  lines.push("Historical sales reset — dry-run");
  lines.push(`Environment: ${process.env.NODE_ENV ?? "unknown"}`);
  lines.push(`Database: ${identity.database ?? "unknown"}`);
  lines.push(`Host: ${identity.host ?? "unknown"}`);
  lines.push("");
  lines.push("Preserved");
  for (const item of plan.preserved) lines.push(`- ${item.name}: ${item.reason}`);
  lines.push("");
  lines.push("Reset when execute is confirmed");
  for (const item of plan.reset) lines.push(`- ${item.name}: ${item.reason}`);
  lines.push("");
  lines.push("Not reset");
  for (const item of plan.notReset) lines.push(`- ${item.name}: ${item.reason}`);
  lines.push("");
  lines.push("Counts that stay");
  for (const [name, count] of Object.entries(plan.counts.preserved)) {
    lines.push(`- ${name}: ${count}`);
  }
  lines.push("");
  lines.push("Counts that would change");
  for (const [name, count] of Object.entries(plan.counts.reset)) {
    lines.push(`- ${name}: ${count}`);
  }
  lines.push("");
  lines.push("Financial source totals");
  lines.push(`- Historical line net: ${plan.totals.historicLineNet}`);
  lines.push(`- Ongoing TRM line net: ${plan.totals.ongoingLineNet}`);
  lines.push(`- Historical document goods: ${plan.totals.historicGoods}`);
  lines.push(`- Ongoing document goods: ${plan.totals.ongoingGoods}`);
  lines.push(`- Global 561L sales: ${plan.totals.globalInvoiceSales}`);
  lines.push(`- Global SLRB goods: ${plan.totals.globalLedgerGoods}`);
  lines.push("");
  lines.push("Reporting after the reset");
  for (const effect of plan.reportingEffects) lines.push(`- ${effect}`);
  lines.push("");
  lines.push("CRM review only — these records are not deleted");
  for (const [name, count] of Object.entries(plan.counts.review)) {
    lines.push(`- ${name}: ${count}`);
  }
  lines.push(`- Customers with a verified Autopart account or 407EXP link: ${plan.companies.keep}`);
  lines.push(`- Customers with neither, left in place for review: ${plan.companies.review}`);
  for (const company of plan.companies.reviewSample) {
    lines.push(`  - ${company.name} (${company.status})`);
  }
  lines.push(`- Staff users: ${plan.staffUsers}`);
  lines.push(`- Portal users: ${plan.portalUsers}`);
  lines.push("");
  lines.push("Daily feed left in place");
  lines.push(`- Ongoing product lines: ${plan.ongoingProtected.lines}`);
  lines.push(`- Ongoing documents: ${plan.ongoingProtected.documents}`);
  lines.push(`- Ongoing import runs: ${plan.ongoingProtected.runs}`);
  lines.push(`- Daily sales schedule on: ${String(plan.feeds.ongoingSalesEnabled)}`);
  lines.push(`- Invoice schedule on: ${String(plan.feeds.invoiceFeedEnabled)}`);
  lines.push(`- Backorder schedule on: ${String(plan.feeds.backorderFeedEnabled)}`);
  lines.push("");
  lines.push("Orders");
  if (!plan.orders.length) lines.push("- No orders.");
  for (const order of plan.orders) {
    lines.push(`- ${order.hold ? "Hold" : "Remove"} ${order.orderNumber} (${order.customerName}): ${order.summary}`);
  }
  lines.push("");
  lines.push("Checklist");
  plan.checklist.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  lines.push("");
  lines.push("This was a dry-run. No rows were deleted.");
  return lines.join("\n");
}

async function main() {
  if (hasFlag("--reset-ongoing")) {
    console.error(
      "Ongoing 504 and TRM records are not part of this reset. Remove --reset-ongoing.",
    );
    process.exitCode = 2;
    return;
  }

  const duringBootstrap = resetInvocationIsBootstrap(process.env);
  if (duringBootstrap) {
    console.error("The reset cannot run during deployment, container startup, or a package lifecycle script.");
    process.exitCode = 2;
    return;
  }

  const identity = describeDatabaseUrl(process.env.DATABASE_URL ?? "");
  const database = identity.database ?? databaseNameFromUrl(process.env.DATABASE_URL ?? "");
  const plan = await planCustomerDataReset(undefined, {
    acknowledgeExportedOrders: hasFlag("--acknowledge-exported-orders"),
  });
  const text = formatPlan(plan, identity);
  const reportPath = argValue("--report");
  if (reportPath) writeFileSync(reportPath, text);
  console.log(text);

  if (!hasFlag("--execute")) return;

  const proofPath = argValue("--backup-proof");
  const proof = proofPath ? readProof(proofPath) : null;
  const restoreUrl = process.env.AB_RESET_RESTORE_URL ?? "";
  const restoreCheckOk = restoreUrl ? await restoreAnswers(restoreUrl) : false;
  const result = await executeCustomerDataReset({
    startedBy: "cli",
    confirmation: process.env.AB_RESET_CONFIRM ?? null,
    targetDatabase: process.env.AB_RESET_TARGET ?? null,
    actualDatabase: database,
    backupProof: proof,
    restoreCheckOk,
    acknowledgeExportedOrders: hasFlag("--acknowledge-exported-orders"),
    includeB2bOrders: hasFlag("--include-b2b-orders"),
    duringBootstrap,
    ongoingResetRequested: false,
  });
  if (!result.ok) {
    console.error(result.reason);
    process.exitCode = 2;
    return;
  }
  const executeText = JSON.stringify(result.report, null, 2);
  console.log(executeText);
  if (reportPath) writeFileSync(reportPath, `${text}\n\n${executeText}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
