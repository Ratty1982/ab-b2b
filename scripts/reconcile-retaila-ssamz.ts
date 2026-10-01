/**
 * READ-ONLY RETAILA / SSAMZ reconciliation (561L + SLRB + optional DB).
 *
 * Does NOT import, mutate financial data, or write to the database.
 *
 * Usage:
 *   bun scripts/reconcile-retaila-ssamz.ts \
 *     path/to/561L-RETAILA.CSV \
 *     path/to/SLRB-RETAILA.CSV \
 *     [--account RETAILA] \
 *     [--sku SSAMZ] \
 *     [--company-id <cuid>]
 *
 * Defaults look for:
 *   ./561L-RETAILA.CSV ./SLRB-RETAILA.CSV
 *   /tmp/561L-RETAILA.CSV /tmp/SLRB-RETAILA.CSV
 *   ./private/561L-RETAILA.CSV ./private/SLRB-RETAILA.CSV
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseAutopart561l, parseInvAndLn } from "../src/domain/autopart-561l";
import { parseAutopartSlrb } from "../src/domain/autopart-slrb";

type MoneyAgg = { rows: number; units: number; sales: number };

function money(): MoneyAgg {
  return { rows: 0, units: 0, sales: 0 };
}

function add(a: MoneyAgg, units: number | null | undefined, sales: string | number | null | undefined) {
  a.rows += 1;
  a.units += Number(units ?? 0);
  a.sales += Number(sales ?? 0);
}

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function gbp(n: number): string {
  return `£${fmt(n, 2)}`;
}

/** Inv & Ln structural form (safe — no full document numbers in label). */
function invLnForm(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^([IC])\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(\d*)$/i);
  if (!m) return "OTHER_UNPARSED";
  const kind = m[1]!.toUpperCase() === "C" ? "C" : "I";
  const ref = m[2]!;
  const line = m[3] ?? "";
  const refShape =
    /^OIN\d+$/i.test(ref)
      ? "OIN#"
      : /^SS\d+$/i.test(ref)
        ? "SS#"
        : /^SC\d+$/i.test(ref)
          ? "SC#"
          : /^\d+-\d+-\d+$/.test(ref)
            ? "AMZ-ORDER#"
            : /^[A-Z]+\d+$/i.test(ref)
              ? "ALPHA#"
              : "OTHER_REF";
  return line === "" ? `${kind}/${refShape}/` : `${kind}/${refShape}/N`;
}

function safeInvExample(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^([IC])\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(\d*)$/i);
  if (!m) {
    // Mask mid-section; keep structure only
    if (t.length <= 12) return t.replace(/[A-Za-z0-9]/g, "x");
    return `${t.slice(0, 4)}…${t.slice(-2)}`;
  }
  const kind = m[1]!.toUpperCase();
  const ref = m[2]!;
  const line = m[3] ?? "";
  const masked =
    ref.length <= 4 ? ref : `${ref.slice(0, 3)}…${ref.slice(-2)}`;
  return `${kind}/${masked}/${line}`;
}

function findPair(argv: string[]): { f561: string; fSlrb: string; account: string; sku: string; companyId: string | null } {
  const args = [...argv];
  let account = "RETAILA";
  let sku = "SSAMZ";
  let companyId: string | null = null;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--account") {
      account = (args[++i] ?? account).toUpperCase();
    } else if (a === "--sku") {
      sku = (args[++i] ?? sku).toUpperCase();
    } else if (a === "--company-id") {
      companyId = args[++i] ?? null;
    } else {
      positional.push(a);
    }
  }

  if (positional[0] && positional[1]) {
    return {
      f561: resolve(positional[0]),
      fSlrb: resolve(positional[1]),
      account,
      sku,
      companyId,
    };
  }

  const candidates = [
    [resolve("561L-RETAILA.CSV"), resolve("SLRB-RETAILA.CSV")],
    [resolve("/tmp/561L-RETAILA.CSV"), resolve("/tmp/SLRB-RETAILA.CSV")],
    [resolve("private/561L-RETAILA.CSV"), resolve("private/SLRB-RETAILA.CSV")],
    [resolve("561L.txt"), resolve("SLRB.txt")],
    [resolve("/tmp/561L.txt"), resolve("/tmp/SLRB.txt")],
  ];
  for (const [a, b] of candidates) {
    if (existsSync(a) && existsSync(b)) {
      return { f561: a, fSlrb: b, account, sku, companyId };
    }
  }
  console.error(
    [
      "Missing source files.",
      "Pass: bun scripts/reconcile-retaila-ssamz.ts <561L> <SLRB> [--account RETAILA] [--sku SSAMZ]",
      "Or place 561L-RETAILA.CSV + SLRB-RETAILA.CSV in ./, /tmp/, or ./private/",
    ].join("\n"),
  );
  process.exit(2);
}

function sameAccount(code: string | null | undefined, wanted: string): boolean {
  if (!code) return false;
  return code.trim().toUpperCase() === wanted.toUpperCase();
}

function exactSku(part: string | null | undefined, wanted: string): boolean {
  if (!part) return false;
  return part.trim().toUpperCase() === wanted.toUpperCase();
}

const cfg = findPair(process.argv.slice(2));
const text561 = readFileSync(cfg.f561, "utf8");
const textSlrb = readFileSync(cfg.fSlrb, "utf8");

// Physical SSAMZ rows in raw file (CSV/native line scan — account + exact SKU token)
const physicalLines = text561.split(/\r?\n/);
let physicalSsamz = 0;
for (const line of physicalLines) {
  if (!line.trim()) continue;
  // Exact SKU token: comma-CSV Part Number column or whitespace-bounded token
  const upper = line.toUpperCase();
  if (!upper.includes(cfg.sku)) continue;
  // Reject SSAMZ-1 when looking for SSAMZ: require non-hyphen boundary after SKU
  const re = new RegExp(`(?:^|[,\\s])${cfg.sku}(?:$|[,\\s])`, "i");
  if (!re.test(line)) continue;
  if (cfg.account && !upper.includes(cfg.account.toUpperCase()) && physicalSsamz === 0) {
    // account may be carried forward in native layout — count SKU hits; parser filters account
  }
  physicalSsamz += 1;
}

const parsed561 = parseAutopart561l(text561);
const parsedSlrb = parseAutopartSlrb(textSlrb);

const ssamzRows = parsed561.rows.filter(
  (r) =>
    (r.classification === "LINE" || r.classification === "MALFORMED") &&
    exactSku(r.partNumber, cfg.sku) &&
    (sameAccount(r.accountCode, cfg.account) ||
      // native carry-forward may leave account null on continuation — keep SKU-exact MALFORMED too if report is single-account
      (!r.accountCode && parsed561.reportStartCustomer?.toUpperCase() === cfg.account)),
);

const ssamzParsedOk = ssamzRows.filter((r) => r.classification === "LINE");
const ssamzRejected = ssamzRows.filter((r) => r.classification === "MALFORMED");

// Prefer parser-filtered account==RETAILA lines from valid LINE set
const sourceLines = parsed561.lines.filter(
  (l) => exactSku(l.partNumber, cfg.sku) && sameAccount(l.accountCode, cfg.account),
);

const source = money();
const sourceInv = money();
const sourceCrn = money();
for (const l of sourceLines) {
  add(source, l.units, l.salesNet);
  if (l.documentType === "CREDIT") add(sourceCrn, l.units, l.salesNet);
  else add(sourceInv, l.units, l.salesNet);
}

const uniqueDocs = new Set(sourceLines.map((l) => l.documentReference!).filter(Boolean));
const uniqueInvLn = new Set(sourceLines.map((l) => l.rawInvAndLn.trim()));

// Inv & Ln forms
const formMap = new Map<string, MoneyAgg & { example: string }>();
for (const l of sourceLines) {
  const form = invLnForm(l.rawInvAndLn);
  const cur = formMap.get(form) ?? { ...money(), example: safeInvExample(l.rawInvAndLn) };
  add(cur, l.units, l.salesNet);
  formMap.set(form, cur);
}

// Rejected SSAMZ (parsed as row with part but not LINE)
const rejectedAgg = money();
const rejectReasons = new Map<string, number>();
for (const r of ssamzRejected) {
  add(rejectedAgg, r.units, r.salesNet);
  const reason = r.issue ?? "UNKNOWN_REJECT";
  rejectReasons.set(reason, (rejectReasons.get(reason) ?? 0) + 1);
}

// ── SLRB stage analysis for SSAMZ document refs ─────────────────────────────
const ssamzDocRefs = [...uniqueDocs];
const rawSlrbText = textSlrb.toUpperCase();
const rawSlrbPresent: string[] = [];
const rawSlrbMissing: string[] = [];
for (const ref of ssamzDocRefs) {
  // word-ish presence in raw SLRB (Ref column values are uppercase-normalised)
  if (rawSlrbText.includes(ref.toUpperCase())) rawSlrbPresent.push(ref);
  else rawSlrbMissing.push(ref);
}

const slrbParsedByRef = new Map(
  parsedSlrb.documents
    .filter((d) => d.documentReference)
    .map((d) => [d.documentReference!.toUpperCase(), d]),
);
// Note: importer also keys SLRB by ref only (last wins if INV+CRN share ref)
const slrbParsedOk: string[] = [];
const slrbPresentButNotParsed: string[] = [];
for (const ref of rawSlrbPresent) {
  if (slrbParsedByRef.has(ref.toUpperCase())) slrbParsedOk.push(ref);
  else slrbPresentButNotParsed.push(ref);
}

const slrbMatched: string[] = [];
const slrbParsedButNotMatched: string[] = [];
for (const ref of ssamzDocRefs) {
  if (slrbParsedByRef.has(ref.toUpperCase())) slrbMatched.push(ref);
  else slrbParsedButNotMatched.push(ref);
}

function aggForDocs(refs: string[]): MoneyAgg {
  const set = new Set(refs.map((r) => r.toUpperCase()));
  const a = money();
  for (const l of sourceLines) {
    if (l.documentReference && set.has(l.documentReference.toUpperCase())) {
      add(a, l.units, l.salesNet);
    }
  }
  return a;
}

const missingFromRawSlrbAgg = aggForDocs(rawSlrbMissing);
const presentButRejectedSlrbAgg = aggForDocs(slrbPresentButNotParsed);
// Importer still writes 561L-only docs — quantify financial impact of missing SLRB match
const unmatchedSlrbAgg = aggForDocs(
  ssamzDocRefs.filter((r) => !slrbParsedByRef.has(r.toUpperCase())),
);

// SLRB structural forms (safe)
const slrbFormMap = new Map<string, { docs: number; exampleType: string; exampleRef: string }>();
for (const d of parsedSlrb.documents) {
  const ref = d.documentReference ?? "";
  const shape =
    /^OIN\d+$/i.test(ref)
      ? "OIN#"
      : /^SS\d+$/i.test(ref)
        ? "SS#"
        : /^SC\d+$/i.test(ref)
          ? "SC#"
          : /^\d+-\d+-\d+$/.test(ref)
            ? "AMZ-ORDER#"
            : "OTHER_REF";
  const form = `${d.rawType ?? "?"} / ${shape}`;
  const cur = slrbFormMap.get(form) ?? {
    docs: 0,
    exampleType: d.rawType ?? "?",
    exampleRef: ref.length <= 4 ? ref : `${ref.slice(0, 3)}…${ref.slice(-2)}`,
  };
  cur.docs += 1;
  slrbFormMap.set(form, cur);
}

// ── Line-number collision / blank-line analysis (source-side) ───────────────
type DocLine = {
  sourceLineNumber: number | null;
  sku: string;
  units: number;
  sales: number;
  rawInvAndLn: string;
};
const byDoc = new Map<string, DocLine[]>();
for (const l of sourceLines) {
  const key = `${l.documentType}::${l.documentReference}`;
  const arr = byDoc.get(key) ?? [];
  arr.push({
    sourceLineNumber: l.sourceLineNumber,
    sku: l.partNumber!.trim().toUpperCase(),
    units: Number(l.units ?? 0),
    sales: Number(l.salesNet ?? 0),
    rawInvAndLn: l.rawInvAndLn,
  });
  byDoc.set(key, arr);
}

/**
 * Simulate importer line-number assignment (autopart-history.ts):
 * first claim of an explicit source line keeps it; colliding explicit lines and
 * blank OIN lines are reassigned to the smallest unused integer ≥ 1.
 */
function assignLineNumbers(rows: DocLine[]): Array<DocLine & { assigned: number }> {
  const used = new Set<number>();
  const out: Array<DocLine & { assigned: number }> = [];
  const pending: DocLine[] = [];
  for (const r of rows) {
    if (r.sourceLineNumber != null && r.sourceLineNumber >= 1) {
      if (used.has(r.sourceLineNumber)) pending.push(r);
      else {
        used.add(r.sourceLineNumber);
        out.push({ ...r, assigned: r.sourceLineNumber });
      }
    } else pending.push(r);
  }
  for (const r of pending) {
    let n = 1;
    while (used.has(n)) n += 1;
    used.add(n);
    out.push({ ...r, assigned: n });
  }
  return out;
}

const collisionDocs: Array<{
  doc: string;
  blankRows: number;
  explicitRows: number;
  assignedKeys: number;
  droppedByDedupe: number;
  droppedUnits: number;
  droppedSales: number;
}> = [];

let collisionUnits = 0;
let collisionSales = 0;
let collisionRows = 0;

for (const [doc, rows] of byDoc) {
  const assigned = assignLineNumbers(rows);
  const byKey = new Map<number, DocLine & { assigned: number }>();
  let dropped = 0;
  let dUnits = 0;
  let dSales = 0;
  for (const r of assigned) {
    if (byKey.has(r.assigned)) {
      // last wins (matches dedupePreparedHistoricLines)
      const prev = byKey.get(r.assigned)!;
      dropped += 1;
      dUnits += prev.units;
      dSales += prev.sales;
    }
    byKey.set(r.assigned, r);
  }
  const blankRows = rows.filter((r) => r.sourceLineNumber == null).length;
  const explicitRows = rows.length - blankRows;
  if (dropped > 0 || (blankRows > 0 && explicitRows > 0 && blankRows + explicitRows !== byKey.size)) {
    collisionDocs.push({
      doc: doc.replace(/::.+$/, "::…"),
      blankRows,
      explicitRows,
      assignedKeys: byKey.size,
      droppedByDedupe: dropped,
      droppedUnits: dUnits,
      droppedSales: dSales,
    });
  }
  if (dropped > 0) {
    collisionRows += dropped;
    collisionUnits += dUnits;
    collisionSales += dSales;
  }
}

// Exact duplicate source keys (same doc + same explicit line number, before blank assign)
const exactDupAgg = money();
for (const [, rows] of byDoc) {
  const seen = new Map<number, DocLine>();
  for (const r of rows) {
    if (r.sourceLineNumber == null) continue;
    if (seen.has(r.sourceLineNumber)) {
      add(exactDupAgg, r.units, r.sales);
    } else seen.set(r.sourceLineNumber, r);
  }
}

// ── Optional DB totals ──────────────────────────────────────────────────────
type DbTotals = {
  rows: number;
  invoices: number;
  credits: number;
  units: number;
  sales: number;
  docs: number;
  minDate: string | null;
  maxDate: string | null;
} | null;

let dbTotals: DbTotals = null;
let dbCompanyLabel: string | null = null;

try {
  const prisma = new PrismaClient();
  let companyId = cfg.companyId;
  if (!companyId) {
    const company = await prisma.company.findFirst({
      where: { autopartCustomerCode: { equals: cfg.account, mode: "insensitive" } },
      select: { id: true, name: true, autopartCustomerCode: true },
    });
    if (company) {
      companyId = company.id;
      dbCompanyLabel = `${company.name} (${company.autopartCustomerCode})`;
    } else {
      const alias = await prisma.autopartCustomerAccountAlias.findFirst({
        where: { alias: { equals: cfg.account, mode: "insensitive" } },
        select: {
          companyId: true,
          company: { select: { name: true, autopartCustomerCode: true } },
        },
      });
      if (alias) {
        companyId = alias.companyId;
        dbCompanyLabel = `${alias.company.name} (${alias.company.autopartCustomerCode})`;
      }
    }
  }
  if (companyId) {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        rows: number;
        invoices: number;
        credits: number;
        units: string;
        sales: string;
        docs: number;
        mind: Date | null;
        maxd: Date | null;
      }>
    >(
      `
      SELECT COUNT(*)::int AS rows,
        SUM(CASE WHEN l."documentType" = 'INVOICE' THEN 1 ELSE 0 END)::int AS invoices,
        SUM(CASE WHEN l."documentType" = 'CREDIT' THEN 1 ELSE 0 END)::int AS credits,
        COALESCE(SUM(l.units), 0)::text AS units,
        COALESCE(SUM(l."salesNet"), 0)::text AS sales,
        COUNT(DISTINCT l."documentId")::int AS docs,
        MIN(d."documentDate") AS mind,
        MAX(d."documentDate") AS maxd
      FROM "AutopartSalesLine" l
      LEFT JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l."companyId" = $1 AND UPPER(TRIM(l.sku)) = $2
      `,
      companyId,
      cfg.sku,
    );
    const r = rows[0];
    if (r) {
      dbTotals = {
        rows: r.rows,
        invoices: r.invoices,
        credits: r.credits,
        units: Number(r.units),
        sales: Number(r.sales),
        docs: r.docs,
        minDate: r.mind ? r.mind.toISOString().slice(0, 10) : null,
        maxDate: r.maxd ? r.maxd.toISOString().slice(0, 10) : null,
      };
    }
  }
  await prisma.$disconnect();
} catch (e) {
  console.error("DB query skipped/failed:", e instanceof Error ? e.message : e);
}

// ── Classification of every source SSAMZ LINE (import path simulation) ──────
const categories = new Map<string, MoneyAgg>();
function cat(name: string, units: number, sales: number) {
  const c = categories.get(name) ?? money();
  add(c, units, sales);
  categories.set(name, c);
}

for (const l of sourceLines) {
  const ref = l.documentReference!;
  const identity = parseInvAndLn(l.rawInvAndLn);
  if (!identity.ok) {
    cat("SOURCE_PARSE_REJECTED", Number(l.units ?? 0), Number(l.salesNet ?? 0));
    continue;
  }
  // Simulate assigned key collisions within this report
  // (full collision quantified separately; here mark blank-line rows)
  if (l.sourceLineNumber == null) {
    cat("BLANK_LINE_NUMBER_SOURCE", Number(l.units ?? 0), Number(l.salesNet ?? 0));
  } else {
    cat("EXPLICIT_LINE_NUMBER_SOURCE", Number(l.units ?? 0), Number(l.salesNet ?? 0));
  }
  if (!slrbParsedByRef.has(ref.toUpperCase())) {
    cat("DOCUMENT_NOT_IN_PARSED_SLRB", Number(l.units ?? 0), Number(l.salesNet ?? 0));
  } else {
    cat("DOCUMENT_MATCHED_SLRB", Number(l.units ?? 0), Number(l.salesNet ?? 0));
  }
}

for (const r of ssamzRejected) {
  cat("SOURCE_PARSE_REJECTED_ROW", Number(r.units ?? 0), Number(r.salesNet ?? 0));
}

const report = {
  files: { file561l: cfg.f561, fileSlrb: cfg.fSlrb, account: cfg.account, sku: cfg.sku },
  source: {
    physicalSkuLineHitsApprox: physicalSsamz,
    parsedOkRows: source.rows,
    rejectedRows: rejectedAgg.rows,
    invoiceRows: sourceInv.rows,
    creditRows: sourceCrn.rows,
    invoiceUnits: sourceInv.units,
    creditUnits: sourceCrn.units,
    netUnits: source.units,
    invoiceSales: sourceInv.sales,
    creditSales: sourceCrn.sales,
    netSales: source.sales,
    uniqueDocuments: uniqueDocs.size,
    uniqueInvAndLn: uniqueInvLn.size,
    rejectReasons: Object.fromEntries(rejectReasons),
  },
  invLnForms: Object.fromEntries(
    [...formMap.entries()].map(([k, v]) => [
      k,
      { rows: v.rows, units: v.units, sales: v.sales, example: v.example },
    ]),
  ),
  slrbPipeline: {
    ssamzDocumentsReferencedBy561l: ssamzDocRefs.length,
    presentInRawSlrb: rawSlrbPresent.length,
    successfullyParsedFromSlrb: slrbParsedOk.length,
    matchedByImporterKey: slrbMatched.length,
    missingFromRawSlrb: rawSlrbMissing.length,
    presentInSlrbButRejectedByParser: slrbPresentButNotParsed.length,
    parsedBySlrbButNotMatched: slrbParsedButNotMatched.length,
    financial: {
      missingFromRawSlrb: missingFromRawSlrbAgg,
      presentButRejectedBySlrbParser: presentButRejectedSlrbAgg,
      noParsedSlrbMatch: unmatchedSlrbAgg,
    },
    note: "Importer still persists 561L lines when SLRB header is missing (source=561L). Missing SLRB alone does not drop AutopartSalesLine rows — but prove with DB diff.",
  },
  slrbForms: Object.fromEntries(slrbFormMap),
  collisions: {
    docsWithEvidence: collisionDocs.length,
    droppedRowsLastWins: collisionRows,
    droppedUnits: collisionUnits,
    droppedSales: collisionSales,
    sampleDocs: collisionDocs.slice(0, 20),
    exactExplicitLineDuplicates: exactDupAgg,
  },
  database: dbTotals
    ? {
        company: dbCompanyLabel,
        ...dbTotals,
        matchesUiExpectation:
          Math.abs(dbTotals.units - 23108) < 0.001 && Math.abs(dbTotals.sales - 708641.75) < 0.01,
      }
    : {
        available: false,
        reason:
          "No RETAILA company / SSAMZ rows in this environment DB (or --company-id not provided).",
      },
  differenceVsExpectedUi: dbTotals
    ? {
        units: source.units - dbTotals.units,
        sales: source.sales - dbTotals.sales,
      }
    : {
        unitsVsReportedUi: source.units - 23108,
        salesVsReportedUi: source.sales - 708641.75,
      },
  categories: Object.fromEntries(categories),
  importerIdentity: {
    uniqueKey: 'AutopartSalesLine @@unique([companyId, documentType, documentReference, lineNumber])',
    upsert: 'ON CONFLICT (companyId, documentType, documentReference, lineNumber) DO UPDATE',
    blankLineAllocation:
      "After explicit source line numbers, assign smallest unused integer >= 1 per document (deterministic within a single import pass).",
    inMemoryDedupe: "Last prepared row wins for identical identity key before SQL upsert.",
  },
};

console.log("\n========== SSAMZ RECONCILIATION ==========\n");
console.log(`SKU: ${cfg.sku}  Account: ${cfg.account}`);
console.log(`561L: ${cfg.f561}`);
console.log(`SLRB: ${cfg.fSlrb}`);
console.log("\nSOURCE (parsed 561L, exact SKU + account)");
console.log(`  Rows:      ${source.rows}`);
console.log(`  Net units: ${fmt(source.units, 3)}`);
console.log(`  Net sales: ${gbp(source.sales)}`);
console.log(`  Invoices:  ${sourceInv.rows} rows / ${fmt(sourceInv.units, 3)} u / ${gbp(sourceInv.sales)}`);
console.log(`  Credits:   ${sourceCrn.rows} rows / ${fmt(sourceCrn.units, 3)} u / ${gbp(sourceCrn.sales)}`);
console.log(`  Unique docs: ${uniqueDocs.size}  Unique Inv&Ln: ${uniqueInvLn.size}`);
console.log(`  Rejected SSAMZ rows: ${rejectedAgg.rows} / ${fmt(rejectedAgg.units, 3)} u / ${gbp(rejectedAgg.sales)}`);

console.log("\nSLRB PIPELINE (SSAMZ document refs from 561L)");
console.log(`  Referenced by raw/parsed 561L: ${ssamzDocRefs.length}`);
console.log(`  Present in raw SLRB:           ${rawSlrbPresent.length}`);
console.log(`  Successfully parsed SLRB:      ${slrbParsedOk.length}`);
console.log(`  Matched (parsed SLRB by ref):  ${slrbMatched.length}`);
console.log(`  Missing from raw SLRB:         ${rawSlrbMissing.length}  → ${fmt(missingFromRawSlrbAgg.units, 3)} u / ${gbp(missingFromRawSlrbAgg.sales)}`);
console.log(
  `  Present but SLRB-rejected:     ${slrbPresentButNotParsed.length}  → ${fmt(presentButRejectedSlrbAgg.units, 3)} u / ${gbp(presentButRejectedSlrbAgg.sales)}`,
);
console.log(
  `  No parsed SLRB match:          ${unmatchedSlrbAgg.rows} source lines → ${fmt(unmatchedSlrbAgg.units, 3)} u / ${gbp(unmatchedSlrbAgg.sales)}`,
);

console.log("\nINV & LN FORMS");
for (const [form, v] of [...formMap.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
  console.log(`  ${form.padEnd(18)} rows=${v.rows} units=${fmt(v.units, 3)} sales=${gbp(v.sales)} eg=${v.example}`);
}

console.log("\nLINE-NUMBER / DEDUPE (simulated importer)");
console.log(`  Dropped by last-wins dedupe: ${collisionRows} rows / ${fmt(collisionUnits, 3)} u / ${gbp(collisionSales)}`);
console.log(`  Exact explicit-line dups:    ${exactDupAgg.rows} rows / ${fmt(exactDupAgg.units, 3)} u / ${gbp(exactDupAgg.sales)}`);

if (dbTotals) {
  console.log("\nDATABASE");
  console.log(`  Company: ${dbCompanyLabel}`);
  console.log(`  Rows: ${dbTotals.rows}  Docs: ${dbTotals.docs}`);
  console.log(`  Net units: ${fmt(dbTotals.units, 3)}`);
  console.log(`  Net sales: ${gbp(dbTotals.sales)}`);
  console.log(`  Dates: ${dbTotals.minDate ?? "—"} → ${dbTotals.maxDate ?? "—"}`);
  console.log(`  Diff source−DB: ${fmt(source.units - dbTotals.units, 3)} u / ${gbp(source.sales - dbTotals.sales)}`);
} else {
  console.log("\nDATABASE");
  console.log("  Not available in this environment (no RETAILA company / SSAMZ history).");
  console.log(`  Diff vs reported UI (23,108 / £708,641.75): ${fmt(source.units - 23108, 3)} u / ${gbp(source.sales - 708641.75)}`);
}

console.log("\n--- JSON ---\n");
console.log(JSON.stringify(report, null, 2));
