/**
 * READ-ONLY Autopart 561L explicit line-number collision audit.
 *
 * Does NOT import, delete, or mutate AutopartSalesLine / financial history.
 *
 * Usage:
 *   bun scripts/audit-historic-561l-collisions.ts <561L-file> [--account CODE]
 *   bun scripts/audit-historic-561l-collisions.ts --dir /path/to/files
 *   bun scripts/audit-historic-561l-collisions.ts --list-imports
 *
 * Examples:
 *   bun scripts/audit-historic-561l-collisions.ts ./561L-RETAILA.CSV --account RETAILA
 *   bun scripts/audit-historic-561l-collisions.ts --dir /tmp/historic-561l
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { auditAutopart561lCollisions } from "../src/domain/autopart-561l-collision-audit";

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function gbp(n: number): string {
  return `£${fmt(n, 2)}`;
}

function maskRef(ref: string): string {
  if (ref.length <= 6) return ref;
  return `${ref.slice(0, 3)}…${ref.slice(-2)}`;
}

function collect561lFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) continue;
    if (/561l/i.test(name) && /\.(csv|txt)$/i.test(name)) out.push(p);
  }
  return out.sort();
}

async function listImports(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const runs = await prisma.autopartCustomerImportRun.findMany({
      where: { type: "HISTORY_561L_SLRB", status: "COMMITTED", dryRun: false },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        companyId: true,
        filename: true,
        detectedAccount: true,
        rowsValid: true,
        rowsImported: true,
        completedAt: true,
        company: { select: { name: true, autopartCustomerCode: true } },
      },
    });

    const byCompany = new Map<string, (typeof runs)[number]>();
    for (const r of runs) {
      if (!r.companyId) continue;
      if (!byCompany.has(r.companyId)) byCompany.set(r.companyId, r);
    }

    console.log("\n========== COMMITTED HISTORIC 561L IMPORTS (DB) ==========\n");
    console.log(
      [
        "Account".padEnd(14),
        "Lines".padStart(8),
        "Net units".padStart(14),
        "Net sales".padStart(16),
        "Import date".padEnd(12),
        "Source file",
      ].join("  "),
    );

    const rows: Array<Record<string, unknown>> = [];
    for (const [companyId, r] of byCompany) {
      const agg = await prisma.$queryRawUnsafe<
        Array<{ lines: number; units: string; sales: string }>
      >(
        `SELECT COUNT(*)::int as lines,
                COALESCE(SUM(units),0)::text as units,
                COALESCE(SUM("salesNet"),0)::text as sales
         FROM "AutopartSalesLine"
         WHERE "companyId" = $1 AND source = '561L'`,
        companyId,
      );
      const a = agg[0]!;
      const account = (r.detectedAccount || r.company?.autopartCustomerCode || "?").toUpperCase();
      const date = (r.completedAt ?? new Date(0)).toISOString().slice(0, 10);
      console.log(
        [
          account.slice(0, 14).padEnd(14),
          String(a.lines).padStart(8),
          fmt(Number(a.units), 3).padStart(14),
          gbp(Number(a.sales)).padStart(16),
          date.padEnd(12),
          r.filename ?? "(not retained)",
        ].join("  "),
      );
      rows.push({
        companyId,
        account,
        // Avoid dumping full customer trading names in default console audit
        mam: r.company?.autopartCustomerCode ?? null,
        historicImportDate: date,
        sourceFilename: r.filename,
        stored561lLines: a.lines,
        netUnits: Number(a.units),
        netSales: Number(a.sales),
        rowsValidFromRun: r.rowsValid,
        rowsImportedFromRun: r.rowsImported,
        sourceAvailability: r.filename ? "FILENAME_RECORDED_CONTENT_NOT_STORED" : "UNKNOWN",
      });
    }
    console.log(`\nCompanies with committed historic import: ${byCompany.size}`);
    console.log(
      "Note: import run metadata stores filename/hash only — original 561L body is not retained in DB.",
    );
    console.log("\n--- JSON ---\n");
    console.log(JSON.stringify({ imports: rows }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function printAudit(filePath: string, account: string | null): void {
  const text = readFileSync(filePath, "utf8");
  const audit = auditAutopart561lCollisions(text, { account });

  console.log("\n========== 561L COLLISION AUDIT ==========\n");
  console.log(`File:     ${filePath}`);
  console.log(`Account:  ${audit.account ?? "(multi/unknown — pass --account)"}`);
  console.log(`Detected: ${audit.detectedAccounts.join(", ") || "—"}`);
  console.log(`Rows:     ${audit.sourceRows}  Documents: ${audit.documents}`);
  console.log(
    `Explicit: ${audit.explicitLineRows}  Blank line#: ${audit.blankLineRows}  Malformed: ${audit.malformedRows}`,
  );
  console.log(`Source:   ${fmt(audit.sourceUnits, 3)} u / ${gbp(audit.sourceSales)}`);
  console.log("");
  console.log("Collision groups:");
  console.log(`  Multi-SKU (legitimate):     ${audit.multiSkuGroups}`);
  console.log(`  Same SKU, different values: ${audit.sameSkuDifferentValueGroups}`);
  console.log(`  Exact duplicate groups:     ${audit.exactDuplicateGroups}`);
  const skuPreview = audit.affectedSkus.slice(0, 25).join(", ");
  console.log(
    `  Affected SKUs (${audit.affectedSkus.length}): ${
      audit.affectedSkus.length ? `${skuPreview}${audit.affectedSkus.length > 25 ? ", …" : ""}` : "—"
    }`,
  );
  console.log("");
  console.log("Old importer (last-wins) would lose:");
  console.log(
    `  Lines: ${audit.oldImporter.lost.length}  Units: ${fmt(audit.oldImporter.lostUnits, 3)}  Sales: ${gbp(audit.oldImporter.lostSales)}`,
  );
  console.log(
    `  Invoices: ${fmt(audit.oldImporter.lostInvoiceUnits, 3)} u / ${gbp(audit.oldImporter.lostInvoiceSales)}`,
  );
  console.log(
    `  Credits:  ${fmt(audit.oldImporter.lostCreditUnits, 3)} u / ${gbp(audit.oldImporter.lostCreditSales)}`,
  );
  console.log("");
  console.log("Corrected importer retains:");
  console.log(
    `  Lines: ${audit.correctedImporter.surviving.length}  Units: ${fmt(audit.correctedImporter.survivingUnits, 3)}  Sales: ${gbp(audit.correctedImporter.survivingSales)}`,
  );
  console.log(
    `Difference (corrected − old): ${fmt(audit.differenceUnits, 3)} u / ${gbp(audit.differenceSales)}`,
  );
  console.log(`ACTION: ${audit.action}`);

  if (audit.collisionGroups.length) {
    console.log("\nTop collision groups (masked refs):");
    for (const g of audit.collisionGroups.slice(0, 15)) {
      console.log(
        `  ${g.documentType} ${maskRef(g.documentReference)}/${g.sourceLineNumber}  ${g.kind}  rows=${g.rows}  skus=${g.skus.length}  lost=${fmt(g.lostUnits, 3)}u ${gbp(g.lostSales)}`,
      );
    }
  }

  // Safe JSON: no full document dumps
  const json = {
    file: basename(filePath),
    account: audit.account,
    sourceRows: audit.sourceRows,
    documents: audit.documents,
    blankLineRows: audit.blankLineRows,
    explicitLineRows: audit.explicitLineRows,
    malformedRows: audit.malformedRows,
    sourceUnits: audit.sourceUnits,
    sourceSales: audit.sourceSales,
    multiSkuGroups: audit.multiSkuGroups,
    sameSkuDifferentValueGroups: audit.sameSkuDifferentValueGroups,
    exactDuplicateGroups: audit.exactDuplicateGroups,
    affectedSkuCount: audit.affectedSkus.length,
    affectedSkusSample: audit.affectedSkus.slice(0, 40),
    oldImporterLost: {
      lines: audit.oldImporter.lost.length,
      units: audit.oldImporter.lostUnits,
      sales: audit.oldImporter.lostSales,
      invoiceUnits: audit.oldImporter.lostInvoiceUnits,
      invoiceSales: audit.oldImporter.lostInvoiceSales,
      creditUnits: audit.oldImporter.lostCreditUnits,
      creditSales: audit.oldImporter.lostCreditSales,
    },
    correctedImporter: {
      lines: audit.correctedImporter.surviving.length,
      units: audit.correctedImporter.survivingUnits,
      sales: audit.correctedImporter.survivingSales,
    },
    differenceUnits: audit.differenceUnits,
    differenceSales: audit.differenceSales,
    action: audit.action,
    collisionGroups: audit.collisionGroups.map((g) => ({
      documentType: g.documentType,
      documentReferenceMasked: maskRef(g.documentReference),
      sourceLineNumber: g.sourceLineNumber,
      kind: g.kind,
      rows: g.rows,
      skuCount: g.skus.length,
      lostUnits: g.lostUnits,
      lostSales: g.lostSales,
    })),
  };
  console.log("\n--- JSON ---\n");
  console.log(JSON.stringify(json, null, 2));
}

const argv = process.argv.slice(2);
let account: string | null = null;
let dir: string | null = null;
let list = false;
const files: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--account") account = (argv[++i] ?? "").toUpperCase() || null;
  else if (a === "--dir") dir = argv[++i] ?? null;
  else if (a === "--list-imports") list = true;
  else if (a.startsWith("-")) {
    console.error(`Unknown flag: ${a}`);
    process.exit(2);
  } else files.push(resolve(a));
}

if (list) {
  await listImports();
  process.exit(0);
}

const targets: string[] = [...files];
if (dir) {
  const abs = resolve(dir);
  if (!existsSync(abs)) {
    console.error(`Directory not found: ${abs}`);
    process.exit(2);
  }
  targets.push(...collect561lFiles(abs));
}

if (!targets.length) {
  // Sensible defaults for this workspace
  const defaults = [
    resolve("/home/ubuntu/.cursor/projects/workspace/uploads"),
    resolve("/tmp"),
    resolve("private"),
    resolve("."),
  ];
  for (const d of defaults) {
    if (existsSync(d) && statSync(d).isDirectory()) targets.push(...collect561lFiles(d));
  }
}

const unique = [...new Set(targets)].filter((p) => existsSync(p));
if (!unique.length) {
  console.error(
    [
      "No 561L files found.",
      "Pass a file path, or --dir <folder>, or place *561L*.CSV under uploads/tmp/private.",
      "Use --list-imports to list committed historic imports from the DB (source bodies are not stored).",
    ].join("\n"),
  );
  process.exit(2);
}

console.log(`Auditing ${unique.length} 561L file(s)…`);
const summary: Array<{
  file: string;
  account: string | null;
  multiSkuGroups: number;
  missingLines: number;
  unitsImpact: number;
  salesImpact: number;
  action: string;
}> = [];

for (const f of unique) {
  printAudit(f, account);
  const audit = auditAutopart561lCollisions(readFileSync(f, "utf8"), { account });
  summary.push({
    file: basename(f),
    account: audit.account,
    multiSkuGroups: audit.multiSkuGroups,
    missingLines: audit.oldImporter.lost.length,
    unitsImpact: audit.differenceUnits,
    salesImpact: audit.differenceSales,
    action: audit.action,
  });
}

console.log("\n========== ACCOUNT SUMMARY ==========\n");
console.log(
  [
    "Account".padEnd(12),
    "Groups".padStart(7),
    "Missing".padStart(8),
    "Units".padStart(12),
    "Net sales".padStart(14),
    "Action",
  ].join("  "),
);
for (const s of summary) {
  console.log(
    [
      (s.account ?? "?").slice(0, 12).padEnd(12),
      String(s.multiSkuGroups).padStart(7),
      String(s.missingLines).padStart(8),
      fmt(s.unitsImpact, 3).padStart(12),
      gbp(s.salesImpact).padStart(14),
      s.action === "REIMPORT_REQUIRED" ? "Re-import required" : "No action",
    ].join("  "),
  );
}
console.log("\n--- SUMMARY JSON ---\n");
console.log(JSON.stringify({ summary }, null, 2));
