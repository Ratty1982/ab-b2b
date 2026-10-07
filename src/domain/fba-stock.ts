/**
 * Amazon FBA stock is company-owned inventory held at Autopart branch OPTIMUS.
 * It is not B2B sellable stock and is not warehouse Avail.
 *
 * A native 231PO3NEW file is a complete FBA snapshot only when the report banner
 * selects Branch OPTIMUS and Select Group, Sub Grp, and GROUP are all ALL.
 * A delimited CSV has no branch-filter banner, so products missing from it are
 * left unchanged. Usage/sales columns are ignored for demand.
 *
 * FBA stock is shown as stale 14 days after the last successful manual import.
 * The badge does not block purchasing.
 */

import { detectCsvDelimiter, parseCsvRecords } from "@/domain/catalogue-csv";
import { isAutopart504Report } from "@/domain/autopart-504";
import { isAutopart216vReport } from "@/domain/autopart-216v";
import { isAutopartTrm21qcReport } from "@/domain/autopart-trm21qc";
import { normalizeStockSku, skuMatchKey } from "@/domain/stock";
import { is231Po3NewReport, parseNative231Po3New } from "@/domain/stock-parse-native";
import { headerKey } from "@/domain/stock-parse";
import { parseAvailCell } from "@/domain/stock-parse-types";

export const FBA_LOCATION_CODE = "FBA";
export const FBA_SOURCE_BRANCH = "OPTIMUS";
export const WAREHOUSE_SOURCE_BRANCH = "SS";
export const FBA_STOCK_LABEL = "FBA Stock";
export const FBA_SOURCE_LABEL = "Amazon FBA";
export const WAREHOUSE_STOCK_LABEL = "Warehouse Stock";
export const TOTAL_STOCK_LABEL = "Total Stock";

/** Manual FBA imports older than this are marked stale. Nothing is blocked. */
export const FBA_STOCK_STALE_AFTER_DAYS = 14;

export const FBA_WAREHOUSE_FILE_MESSAGE =
  "This file contains Warehouse branch SS data and cannot be imported as FBA Stock.";

export type FbaParsedRow = {
  line: number;
  sku: string;
  matchKey: string;
  description: string | null;
  branch: string;
  availQty: number;
};

export type FbaFileAssessment =
  | { ok: false; message: string }
  | {
      ok: true;
      sourceBranch: typeof FBA_SOURCE_BRANCH;
      sourceLabel: typeof FBA_SOURCE_LABEL;
      completeSnapshot: boolean;
      rows: FbaParsedRow[];
      invalidRows: number;
      duplicateSkus: number;
      warnings: string[];
    };

export type FbaImportTotals = {
  productsProcessed: number;
  matchedExisting: number;
  newProducts: number;
  productsWithStock: number;
  totalUnits: number;
  changedQuantities: number;
  zeroStock: number;
  absentZeroed: number;
  invalidRows: number;
  duplicateSkus: number;
  warnings: string[];
};

type Candidate = {
  line: number;
  sku: string;
  description: string | null;
  branch: string | null;
  availOk: boolean;
  availQty: number;
};

function foreignReportMessage(text: string): string | null {
  const sample = text.slice(0, 6000).toUpperCase();
  if (sample.includes("(504C)") || sample.includes("LISTING OF INVOICES AND CREDITS BY CUSTOMER")) {
    return "This file is a 504C report and cannot be imported as FBA Stock.";
  }
  if (isAutopart216vReport(text)) return "This file is a 216V report and cannot be imported as FBA Stock.";
  if (isAutopartTrm21qcReport(text) && !is231Po3NewReport(text)) {
    return "This file is a TRM21QC report and cannot be imported as FBA Stock.";
  }
  if (isAutopart504Report(text) && !is231Po3NewReport(text)) {
    return "This file is a 504 report and cannot be imported as FBA Stock.";
  }
  return null;
}

function bannerValue(text: string, label: string): string | null {
  const match = new RegExp(`\\[${label}\\s+([^\\]]+)\\]`, "i").exec(text);
  return match?.[1]?.trim().toUpperCase() ?? null;
}

function nativeCompleteness(text: string): { complete: boolean; warning: string | null } {
  const branch = bannerValue(text, "Branch");
  const selectGroup = bannerValue(text, "Select Group");
  const subGrp = bannerValue(text, "Sub Grp");
  const group = bannerValue(text, "GROUP");
  const complete = branch === FBA_SOURCE_BRANCH && selectGroup === "ALL" && subGrp === "ALL" && group === "ALL";
  if (complete) {
    return {
      complete: true,
      warning: null,
    };
  }
  return {
    complete: false,
    warning:
      "This file is not a complete Amazon FBA snapshot, so products missing from the file were left unchanged.",
  };
}

function collapseDuplicates(candidates: Candidate[]): {
  rows: FbaParsedRow[];
  invalidRows: number;
  duplicateSkus: number;
  warnings: string[];
} {
  const warnings: string[] = [];
  const byKey = new Map<string, Candidate[]>();
  let invalidRows = 0;
  for (const row of candidates) {
    if (!row.sku || !row.availOk || row.availQty < 0 || row.branch !== FBA_SOURCE_BRANCH) {
      invalidRows += 1;
      continue;
    }
    const key = skuMatchKey(row.sku);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  const rows: FbaParsedRow[] = [];
  let duplicateSkus = 0;
  for (const [key, list] of byKey) {
    if (list.length > 1) {
      duplicateSkus += list.length;
      warnings.push(`${list[0]!.sku} appears more than once and was not imported.`);
      continue;
    }
    const row = list[0]!;
    rows.push({
      line: row.line,
      sku: row.sku,
      matchKey: key,
      description: row.description,
      branch: FBA_SOURCE_BRANCH,
      availQty: row.availQty,
    });
  }
  return { rows, invalidRows, duplicateSkus, warnings };
}

function rejectBranches(candidates: Candidate[]): string | null {
  const branches = new Set(candidates.map((row) => row.branch).filter((branch): branch is string => Boolean(branch)));
  if (branches.has(WAREHOUSE_SOURCE_BRANCH)) return FBA_WAREHOUSE_FILE_MESSAGE;
  if (!branches.has(FBA_SOURCE_BRANCH)) {
    return "This file does not identify an Amazon FBA source and cannot be imported as FBA Stock.";
  }
  if ([...branches].some((branch) => branch !== FBA_SOURCE_BRANCH)) {
    return "This file is not an Amazon FBA stock export.";
  }
  return null;
}

function fromNative(text: string): FbaFileAssessment {
  const parsed = parseNative231Po3New(text);
  if ("code" in parsed) {
    return {
      ok: false,
      message: "231PO3NEW was detected, but the Avail column could not be parsed reliably. No FBA stock was changed.",
    };
  }
  const candidates: Candidate[] = parsed.rows.map((row) => ({
    line: row.line,
    sku: row.sku,
    description: row.description,
    branch: row.branchCode ?? null,
    availOk: row.avail.ok,
    availQty: row.avail.ok ? row.avail.value : 0,
  }));
  if (!candidates.length) {
    return { ok: false, message: "No usable FBA stock rows were found." };
  }
  const rejected = rejectBranches(candidates);
  if (rejected) return { ok: false, message: rejected };
  const collapsed = collapseDuplicates(candidates);
  if (!collapsed.rows.length) {
    return { ok: false, message: "No usable FBA stock rows were found." };
  }
  const completeness = nativeCompleteness(text);
  return {
    ok: true,
    sourceBranch: FBA_SOURCE_BRANCH,
    sourceLabel: FBA_SOURCE_LABEL,
    completeSnapshot: completeness.complete,
    rows: collapsed.rows,
    invalidRows: collapsed.invalidRows,
    duplicateSkus: collapsed.duplicateSkus,
    warnings: completeness.warning ? [completeness.warning, ...collapsed.warnings] : collapsed.warnings,
  };
}

function csvHeaderIndex(keys: string[], names: string[]): number {
  return keys.findIndex((key) => names.includes(key));
}

function fromCsv(text: string): FbaFileAssessment | null {
  const lines = text.split(/\r?\n/);
  const headerLine = lines.find((line) => /avail/i.test(line) && /part/i.test(line));
  if (!headerLine || !headerLine.includes(",")) return null;
  const delimiter = detectCsvDelimiter(text);
  const records = parseCsvRecords(text, delimiter);
  if (records.length < 2) return { ok: false, message: "This file is not a 231PO3NEW stock export and cannot be imported as FBA Stock." };
  const keys = (records[0] ?? []).map((cell) => headerKey(cell));
  const branchIdx = csvHeaderIndex(keys, ["branch"]);
  const skuIdx = csvHeaderIndex(keys, ["partnumber", "partno", "sku", "code"]);
  const availIdx = csvHeaderIndex(keys, ["avail", "available"]);
  const descIdx = csvHeaderIndex(keys, ["description", "desc"]);
  if (branchIdx < 0) {
    return { ok: false, message: "This file does not identify an Amazon FBA source and cannot be imported as FBA Stock." };
  }
  if (skuIdx < 0 || availIdx < 0) {
    return { ok: false, message: "This file is not a 231PO3NEW stock export and cannot be imported as FBA Stock." };
  }
  const stockish = keys.some((key) => ["stk", "pickqty", "physicalstk", "latestcost"].includes(key));
  if (!stockish && !is231Po3NewReport(text)) {
    return { ok: false, message: "This file is not a 231PO3NEW stock export and cannot be imported as FBA Stock." };
  }
  const candidates: Candidate[] = [];
  for (let i = 1; i < records.length; i += 1) {
    const rec = records[i] ?? [];
    if (rec.every((cell) => !cell.trim())) continue;
    const sku = normalizeStockSku(rec[skuIdx] ?? "");
    const avail = parseAvailCell(rec[availIdx] ?? "");
    const branch = (rec[branchIdx] ?? "").replace(/\s+/g, "").toUpperCase() || null;
    candidates.push({
      line: i + 1,
      sku,
      description: descIdx >= 0 ? (rec[descIdx] ?? "").trim() || null : null,
      branch,
      availOk: Boolean(sku) && avail.ok && avail.value >= 0,
      availQty: avail.ok ? avail.value : 0,
    });
  }
  if (!candidates.length) return { ok: false, message: "No usable FBA stock rows were found." };
  const rejected = rejectBranches(candidates);
  if (rejected) return { ok: false, message: rejected };
  const collapsed = collapseDuplicates(candidates);
  if (!collapsed.rows.length) return { ok: false, message: "No usable FBA stock rows were found." };
  return {
    ok: true,
    sourceBranch: FBA_SOURCE_BRANCH,
    sourceLabel: FBA_SOURCE_LABEL,
    completeSnapshot: false,
    rows: collapsed.rows,
    invalidRows: collapsed.invalidRows,
    duplicateSkus: collapsed.duplicateSkus,
    warnings: [
      "This file is not a complete Amazon FBA snapshot, so products missing from the file were left unchanged.",
      ...collapsed.warnings,
    ],
  };
}

/** Validate an uploaded file as Amazon FBA stock. Does not read warehouse Avail into the result quantity. */
export function assessFbaStockFile(text: string): FbaFileAssessment {
  const raw = text.replace(/^\uFEFF/, "");
  if (!raw.trim()) return { ok: false, message: "The file is empty." };
  const foreign = foreignReportMessage(raw);
  if (foreign) return { ok: false, message: foreign };
  const headerLine = raw.split(/\r?\n/).find((line) => /avail/i.test(line) && /part/i.test(line));
  if (headerLine?.includes(",") && /branch/i.test(headerLine)) {
    const csv = fromCsv(raw);
    if (csv) return csv;
  }
  if (is231Po3NewReport(raw)) return fromNative(raw);
  const csv = fromCsv(raw);
  if (csv) return csv;
  return { ok: false, message: "This file is not a 231PO3NEW stock export and cannot be imported as FBA Stock." };
}

export function planFbaSnapshot(input: {
  rows: Array<{ matchKey: string; availQty: number }>;
  existingProductKeys: Set<string>;
  previousQty: Map<string, number>;
  completeSnapshot: boolean;
  invalidRows: number;
  duplicateSkus: number;
  warnings: string[];
}): FbaImportTotals {
  const fileKeys = new Set(input.rows.map((row) => row.matchKey));
  let matchedExisting = 0;
  let newProducts = 0;
  let productsWithStock = 0;
  let totalUnits = 0;
  let changedQuantities = 0;
  let zeroStock = 0;
  for (const row of input.rows) {
    totalUnits += row.availQty;
    if (row.availQty > 0) productsWithStock += 1;
    else zeroStock += 1;
    if (input.existingProductKeys.has(row.matchKey)) matchedExisting += 1;
    else newProducts += 1;
    const previous = input.previousQty.get(row.matchKey);
    if (previous == null || previous !== row.availQty) changedQuantities += 1;
  }
  let absentZeroed = 0;
  if (input.completeSnapshot) {
    for (const [key, qty] of input.previousQty) {
      if (fileKeys.has(key) || qty === 0) continue;
      absentZeroed += 1;
    }
  }
  return {
    productsProcessed: input.rows.length,
    matchedExisting,
    newProducts,
    productsWithStock,
    totalUnits,
    changedQuantities,
    zeroStock,
    absentZeroed,
    invalidRows: input.invalidRows,
    duplicateSkus: input.duplicateSkus,
    warnings: input.warnings,
  };
}

/** Company-owned units. Not B2B sellable availability. */
export function totalOwnedStock(warehouseQty: number, fbaQty: number): number {
  return warehouseQty + fbaQty;
}

export function fbaStockIsStale(importedAt: Date | null, now = new Date()): boolean {
  if (!importedAt) return false;
  const ageMs = now.getTime() - importedAt.getTime();
  return ageMs > FBA_STOCK_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
