/**
 * Read-only report of which connected database this process is using
 * and how current accounts and stored lines would import or stay staged.
 * It does not reset or import anything.
 *
 *   bun scripts/historic-matching-readiness.ts
 */
import { writeFileSync } from "node:fs";
import { buildHistoricMatchingReadiness } from "../src/server/companies/autopart-history-all";

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

const report = await buildHistoricMatchingReadiness();
const text = JSON.stringify(report, null, 2);
const reportPath = argValue("--report");
if (reportPath) writeFileSync(reportPath, text);
console.log(text);
