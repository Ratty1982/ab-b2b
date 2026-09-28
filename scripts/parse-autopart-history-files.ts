/**
 * Developer diagnostic: parse local 561L.txt / SLRB.txt if present.
 * Does not commit secrets — prints aggregate counts only.
 *
 * Usage:
 *   bun scripts/parse-autopart-history-files.ts [path-to-561L] [path-to-SLRB]
 * Defaults: ./561L.txt ./SLRB.txt, then /tmp/561L.txt /tmp/SLRB.txt
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAutopart561l, diagnose561lRows } from "../src/domain/autopart-561l";
import { parseAutopartSlrb } from "../src/domain/autopart-slrb";

function findPair(argv: string[]): { f561: string; fSlrb: string } | null {
  if (argv[0] && argv[1]) {
    return { f561: resolve(argv[0]), fSlrb: resolve(argv[1]) };
  }
  const candidates = [
    [resolve("561L.txt"), resolve("SLRB.txt")],
    [resolve("/tmp/561L.txt"), resolve("/tmp/SLRB.txt")],
    [resolve("private/561L.txt"), resolve("private/SLRB.txt")],
  ];
  for (const [a, b] of candidates) {
    if (existsSync(a) && existsSync(b)) return { f561: a, fSlrb: b };
  }
  return null;
}

const pair = findPair(process.argv.slice(2));
if (!pair) {
  console.error(
    "No 561L.txt / SLRB.txt found. Pass paths explicitly or place files at ./561L.txt and ./SLRB.txt",
  );
  process.exit(2);
}

const text561 = readFileSync(pair.f561, "utf8");
const textSlrb = readFileSync(pair.fSlrb, "utf8");
const p561 = parseAutopart561l(text561);
const pSlrb = parseAutopartSlrb(textSlrb);

const refs561 = new Set(p561.diagnostics.uniqueDocumentRefs);
const refsSlrbSales = new Set(
  pSlrb.documents.map((d) => d.documentReference!).filter(Boolean),
);
const matched = [...refs561].filter((r) => refsSlrbSales.has(r));
const only561 = [...refs561].filter((r) => !refsSlrbSales.has(r)).sort();
const onlySlrb = [...refsSlrbSales].filter((r) => !refs561.has(r)).sort();
const skus = [
  ...new Set(p561.lines.map((l) => l.partNumber?.trim().toUpperCase()).filter(Boolean)),
];

const checkRefs = ["SC500093", "SC500117", "SC501239", "SC501700"];
const refChecks: Record<string, { in561l: boolean; inSlrb: boolean }> = {};
for (const ref of checkRefs) {
  refChecks[ref] = { in561l: refs561.has(ref), inSlrb: refsSlrbSales.has(ref) };
}

console.log(
  JSON.stringify(
    {
      files: pair,
      report561l: {
        layout: p561.layout,
        accountFieldWidth: p561.accountFieldWidth,
        reportStartCustomer: p561.reportStartCustomer,
        reportEndCustomer: p561.reportEndCustomer,
        rowAccounts: p561.detectedAccounts,
        transactionLines: p561.lines.length,
        invoiceLines: p561.invoiceLines,
        creditLines: p561.creditLines,
        uniqueDocumentRefs: p561.diagnostics.uniqueDocumentRefs.length,
        uniqueInvoiceRefs: p561.diagnostics.uniqueInvoiceRefs.length,
        uniqueCreditRefs: p561.diagnostics.uniqueCreditRefs.length,
        malformed: p561.malformedRows,
      },
      reportSlrb: {
        layout: pSlrb.layout,
        reportStartCustomer: pSlrb.reportStartCustomer,
        reportEndCustomer: pSlrb.reportEndCustomer,
        accounts: pSlrb.detectedAccounts,
        invoiceDocuments: pSlrb.invoiceDocuments,
        creditDocuments: pSlrb.creditDocuments,
        ledgerRecords: pSlrb.ledgerRecords,
        uniqueDocumentRefs: pSlrb.diagnostics.uniqueDocumentRefs.length,
        malformed: pSlrb.malformedRows,
      },
      matching: {
        matchedDocuments: matched.length,
        unmatched561l: only561.length,
        slrbOnlySales: onlySlrb.length,
        sample561lOnly: only561.slice(0, 10),
        sampleSlrbOnly: onlySlrb.slice(0, 10),
      },
      products: { uniqueSkus: skus.length },
      refChecks,
      sampleDiagnose: diagnose561lRows(p561, { kinds: ["DATA_LINE"], limit: 5 }),
    },
    null,
    2,
  ),
);
