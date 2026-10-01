/**
 * Read-only Autopart 561L explicit line-number collision analysis.
 *
 * Detects when Autopart reuses the same explicit Inv & Ln line number on the
 * same document for distinct legitimate product lines — the failure mode that
 * caused RETAILA/SSAMZ last-wins upsert losses under
 * (companyId, documentType, documentReference, lineNumber).
 *
 * Does not write to the database or invent financial values.
 */
import { parseAutopart561l, type Autopart561lLine } from "@/domain/autopart-561l";

export type CollisionAuditLine = {
  documentType: "INVOICE" | "CREDIT";
  documentReference: string;
  sourceLineNumber: number | null;
  sku: string;
  units: number;
  sales: number;
  rawInvAndLn: string;
};

export type CollisionGroupKind =
  | "MULTI_SKU"
  | "SAME_SKU_DIFFERENT_VALUES"
  | "EXACT_DUPLICATE";

export type CollisionGroup = {
  documentType: "INVOICE" | "CREDIT";
  documentReference: string;
  sourceLineNumber: number;
  kind: CollisionGroupKind;
  rows: number;
  skus: string[];
  /** Units/sales that the OLD last-wins importer would discard (all but last row). */
  lostUnits: number;
  lostSales: number;
  lostInvoiceUnits: number;
  lostInvoiceSales: number;
  lostCreditUnits: number;
  lostCreditSales: number;
};

export type HistoricLineNumberSimulation = {
  surviving: CollisionAuditLine[];
  lost: CollisionAuditLine[];
  survivingUnits: number;
  survivingSales: number;
  lostUnits: number;
  lostSales: number;
  lostInvoiceUnits: number;
  lostInvoiceSales: number;
  lostCreditUnits: number;
  lostCreditSales: number;
};

export type Autopart561lCollisionAudit = {
  account: string | null;
  detectedAccounts: string[];
  sourceRows: number;
  documents: number;
  blankLineRows: number;
  explicitLineRows: number;
  malformedRows: number;
  sourceUnits: number;
  sourceSales: number;
  collisionGroups: CollisionGroup[];
  multiSkuGroups: number;
  sameSkuDifferentValueGroups: number;
  exactDuplicateGroups: number;
  affectedSkus: string[];
  /** Lines the old last-wins importer would overwrite/drop. */
  oldImporter: HistoricLineNumberSimulation;
  /** Lines kept by corrected first-keeps + reassign collisions. */
  correctedImporter: HistoricLineNumberSimulation;
  differenceUnits: number;
  differenceSales: number;
  action: "NO_ACTION" | "REIMPORT_REQUIRED";
};

function toAuditLines(parsedLines: Autopart561lLine[], accountFilter?: string | null): CollisionAuditLine[] {
  const wanted = accountFilter?.trim().toUpperCase() || null;
  const out: CollisionAuditLine[] = [];
  for (const l of parsedLines) {
    if (!l.documentReference || !l.partNumber) continue;
    if (wanted && (l.accountCode ?? "").trim().toUpperCase() !== wanted) continue;
    out.push({
      documentType: l.documentType === "CREDIT" ? "CREDIT" : "INVOICE",
      documentReference: l.documentReference,
      sourceLineNumber: l.sourceLineNumber,
      sku: l.partNumber.trim().toUpperCase(),
      units: Number(l.units ?? 0),
      sales: Number(l.salesNet ?? 0),
      rawInvAndLn: l.rawInvAndLn,
    });
  }
  return out;
}

function sum(lines: CollisionAuditLine[]): {
  units: number;
  sales: number;
  invoiceUnits: number;
  invoiceSales: number;
  creditUnits: number;
  creditSales: number;
} {
  let units = 0;
  let sales = 0;
  let invoiceUnits = 0;
  let invoiceSales = 0;
  let creditUnits = 0;
  let creditSales = 0;
  for (const l of lines) {
    units += l.units;
    sales += l.sales;
    if (l.documentType === "CREDIT") {
      creditUnits += l.units;
      creditSales += l.sales;
    } else {
      invoiceUnits += l.units;
      invoiceSales += l.sales;
    }
  }
  return { units, sales, invoiceUnits, invoiceSales, creditUnits, creditSales };
}

function classifyGroup(rows: CollisionAuditLine[]): CollisionGroupKind {
  const skus = new Set(rows.map((r) => r.sku));
  if (skus.size > 1) return "MULTI_SKU";
  const sigs = new Set(rows.map((r) => `${r.units}|${r.sales.toFixed(4)}`));
  if (sigs.size > 1) return "SAME_SKU_DIFFERENT_VALUES";
  return "EXACT_DUPLICATE";
}

/**
 * OLD importer behaviour: every explicit source line number is kept as-is;
 * in-memory last-wins then drops earlier rows that share
 * documentType+documentReference+lineNumber. Blank lines are assigned uniquely
 * after explicits (same as today) — collisions of interest are explicit repeats.
 */
export function simulateOldLastWinsImporter(lines: CollisionAuditLine[]): HistoricLineNumberSimulation {
  const used = new Map<string, Set<number>>();
  const pending: CollisionAuditLine[] = [];
  const prepared: Array<CollisionAuditLine & { lineNumber: number }> = [];

  for (const line of lines) {
    const dkey = `${line.documentType}::${line.documentReference}`;
    if (line.sourceLineNumber != null && line.sourceLineNumber >= 1) {
      const set = used.get(dkey) ?? new Set<number>();
      set.add(line.sourceLineNumber);
      used.set(dkey, set);
      prepared.push({ ...line, lineNumber: line.sourceLineNumber });
    } else {
      pending.push(line);
    }
  }
  for (const line of pending) {
    const dkey = `${line.documentType}::${line.documentReference}`;
    const set = used.get(dkey) ?? new Set<number>();
    let n = 1;
    while (set.has(n)) n += 1;
    set.add(n);
    used.set(dkey, set);
    prepared.push({ ...line, lineNumber: n });
  }

  const byKey = new Map<string, CollisionAuditLine & { lineNumber: number }>();
  const lost: CollisionAuditLine[] = [];
  for (const line of prepared) {
    const k = `${line.documentType}::${line.documentReference}::${line.lineNumber}`;
    const prev = byKey.get(k);
    if (prev) lost.push(prev);
    byKey.set(k, line);
  }
  const surviving = [...byKey.values()].map(({ lineNumber: _ln, ...rest }) => rest);
  const s = sum(surviving);
  const l = sum(lost);
  return {
    surviving,
    lost,
    survivingUnits: s.units,
    survivingSales: s.sales,
    lostUnits: l.units,
    lostSales: l.sales,
    lostInvoiceUnits: l.invoiceUnits,
    lostInvoiceSales: l.invoiceSales,
    lostCreditUnits: l.creditUnits,
    lostCreditSales: l.creditSales,
  };
}

/**
 * Corrected importer: first explicit line number wins; subsequent collisions and
 * blank OIN lines receive the smallest unused integer ≥ 1 (file order).
 */
export function simulateCorrectedImporter(lines: CollisionAuditLine[]): HistoricLineNumberSimulation {
  const used = new Map<string, Set<number>>();
  const pending: CollisionAuditLine[] = [];
  const prepared: Array<CollisionAuditLine & { lineNumber: number }> = [];

  for (const line of lines) {
    const dkey = `${line.documentType}::${line.documentReference}`;
    if (line.sourceLineNumber != null && line.sourceLineNumber >= 1) {
      const set = used.get(dkey) ?? new Set<number>();
      if (set.has(line.sourceLineNumber)) {
        pending.push(line);
      } else {
        set.add(line.sourceLineNumber);
        used.set(dkey, set);
        prepared.push({ ...line, lineNumber: line.sourceLineNumber });
      }
    } else {
      pending.push(line);
    }
  }
  for (const line of pending) {
    const dkey = `${line.documentType}::${line.documentReference}`;
    const set = used.get(dkey) ?? new Set<number>();
    let n = 1;
    while (set.has(n)) n += 1;
    set.add(n);
    used.set(dkey, set);
    prepared.push({ ...line, lineNumber: n });
  }

  // Corrected path should not last-wins-drop distinct prepared keys; still
  // apply Map for safety (identical keys only if algorithm regresses).
  const byKey = new Map<string, CollisionAuditLine & { lineNumber: number }>();
  const lost: CollisionAuditLine[] = [];
  for (const line of prepared) {
    const k = `${line.documentType}::${line.documentReference}::${line.lineNumber}`;
    const prev = byKey.get(k);
    if (prev) lost.push(prev);
    byKey.set(k, line);
  }
  const surviving = [...byKey.values()].map(({ lineNumber: _ln, ...rest }) => rest);
  const s = sum(surviving);
  const l = sum(lost);
  return {
    surviving,
    lost,
    survivingUnits: s.units,
    survivingSales: s.sales,
    lostUnits: l.units,
    lostSales: l.sales,
    lostInvoiceUnits: l.invoiceUnits,
    lostInvoiceSales: l.invoiceSales,
    lostCreditUnits: l.creditUnits,
    lostCreditSales: l.creditSales,
  };
}

export function buildCollisionGroups(lines: CollisionAuditLine[]): CollisionGroup[] {
  const groups = new Map<string, CollisionAuditLine[]>();
  for (const l of lines) {
    if (l.sourceLineNumber == null || l.sourceLineNumber < 1) continue;
    const k = `${l.documentType}::${l.documentReference}::${l.sourceLineNumber}`;
    const arr = groups.get(k) ?? [];
    arr.push(l);
    groups.set(k, arr);
  }

  const out: CollisionGroup[] = [];
  for (const [, rows] of groups) {
    if (rows.length < 2) continue;
    const kind = classifyGroup(rows);
    const lostRows = rows.slice(0, -1);
    const lost = sum(lostRows);
    const first = rows[0]!;
    out.push({
      documentType: first.documentType,
      documentReference: first.documentReference,
      sourceLineNumber: first.sourceLineNumber!,
      kind,
      rows: rows.length,
      skus: [...new Set(rows.map((r) => r.sku))].sort(),
      lostUnits: lost.units,
      lostSales: lost.sales,
      lostInvoiceUnits: lost.invoiceUnits,
      lostInvoiceSales: lost.invoiceSales,
      lostCreditUnits: lost.creditUnits,
      lostCreditSales: lost.creditSales,
    });
  }
  return out.sort(
    (a, b) =>
      Math.abs(b.lostSales) - Math.abs(a.lostSales) ||
      a.documentReference.localeCompare(b.documentReference),
  );
}

export function auditAutopart561lCollisions(
  fileText: string,
  opts?: { account?: string | null | undefined },
): Autopart561lCollisionAudit {
  const parsed = parseAutopart561l(fileText);
  const account =
    opts?.account?.trim().toUpperCase() ||
    parsed.reportStartCustomer?.trim().toUpperCase() ||
    (parsed.detectedAccounts.length === 1 ? parsed.detectedAccounts[0]! : null);

  const lines = toAuditLines(parsed.lines, account);
  const docs = new Set(lines.map((l) => `${l.documentType}::${l.documentReference}`));
  const blankLineRows = lines.filter((l) => l.sourceLineNumber == null).length;
  const explicitLineRows = lines.length - blankLineRows;
  const sourceTotals = sum(lines);

  const collisionGroups = buildCollisionGroups(lines);
  const multiSkuGroups = collisionGroups.filter((g) => g.kind === "MULTI_SKU").length;
  const sameSkuDifferentValueGroups = collisionGroups.filter(
    (g) => g.kind === "SAME_SKU_DIFFERENT_VALUES",
  ).length;
  const exactDuplicateGroups = collisionGroups.filter((g) => g.kind === "EXACT_DUPLICATE").length;

  const oldImporter = simulateOldLastWinsImporter(lines);
  const correctedImporter = simulateCorrectedImporter(lines);

  const affectedSkus = [
    ...new Set(
      collisionGroups
        .filter((g) => g.kind === "MULTI_SKU" || g.kind === "SAME_SKU_DIFFERENT_VALUES")
        .flatMap((g) => g.skus),
    ),
  ].sort();

  const differenceUnits = correctedImporter.survivingUnits - oldImporter.survivingUnits;
  const differenceSales = correctedImporter.survivingSales - oldImporter.survivingSales;

  // Recommend re-import only when old behaviour lost legitimate (non-exact-dup) value
  const legitimateLostSales = collisionGroups
    .filter((g) => g.kind !== "EXACT_DUPLICATE")
    .reduce((a, g) => a + g.lostSales, 0);
  const legitimateLostUnits = collisionGroups
    .filter((g) => g.kind !== "EXACT_DUPLICATE")
    .reduce((a, g) => a + g.lostUnits, 0);

  return {
    account,
    detectedAccounts: parsed.detectedAccounts,
    sourceRows: lines.length,
    documents: docs.size,
    blankLineRows,
    explicitLineRows,
    malformedRows: parsed.malformedRows,
    sourceUnits: sourceTotals.units,
    sourceSales: sourceTotals.sales,
    collisionGroups,
    multiSkuGroups,
    sameSkuDifferentValueGroups,
    exactDuplicateGroups,
    affectedSkus,
    oldImporter,
    correctedImporter,
    differenceUnits,
    differenceSales,
    action:
      Math.abs(legitimateLostSales) > 0.005 || Math.abs(legitimateLostUnits) > 0.0005
        ? "REIMPORT_REQUIRED"
        : "NO_ACTION",
  };
}
