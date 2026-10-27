/**
 * Manual Amazon UK sell-through CSV.
 * This is not an Autopart 504/TRM file. OIN replenishment rows are rejected.
 */

import { isAutopart504Report } from "@/domain/autopart-504";
import { isAutopartTrm21qcReport } from "@/domain/autopart-trm21qc";
import { isOinReplenishmentReference } from "@/domain/fba-replenishment";
import { skuMatchKey } from "@/domain/stock";

export type FbaAmazonSalesRow = {
  sku: string;
  matchKey: string;
  saleDate: string;
  unitsSold: number;
  unitsCredited: number;
  marketplace: string;
};

export type FbaAmazonSalesParse =
  | {
      ok: true;
      rows: FbaAmazonSalesRow[];
      coverageFrom: string;
      coverageTo: string;
      mergedDuplicateDays: number;
    }
  | { ok: false; error: string };

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_UK = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;

function parseDate(raw: string): string | null {
  const text = raw.trim();
  const iso = DATE_ISO.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = DATE_UK.exec(text);
  if (!uk) return null;
  return `${uk[3]}-${uk[2]!.padStart(2, "0")}-${uk[1]!.padStart(2, "0")}`;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else quoted = false;
      } else current += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function headerIndex(headers: string[], names: string[]): number {
  const normalised = headers.map((cell) => cell.trim().toLowerCase().replace(/\s+/g, "_"));
  return normalised.findIndex((cell) => names.includes(cell));
}

function numberCell(raw: string): number | null {
  const text = raw.trim();
  if (!text) return 0;
  const n = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function parseFbaAmazonSalesCsv(text: string): FbaAmazonSalesParse {
  const source = text.replace(/^\uFEFF/, "").trim();
  if (!source) return { ok: false, error: "The Amazon sales file is empty." };
  if (isAutopart504Report(source) || isAutopartTrm21qcReport(source)) {
    return {
      ok: false,
      error:
        "This file is an Autopart 504 or TRM21QC report. OIN replenishment quantities are not Amazon consumer sales.",
    };
  }
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  const headers = splitCsvLine(lines[0] ?? "");
  const skuAt = headerIndex(headers, ["sku", "part_number", "part", "seller_sku"]);
  const dateAt = headerIndex(headers, ["date", "sale_date", "sales_date"]);
  const soldAt = headerIndex(headers, ["units_sold", "units", "sold", "quantity_sold"]);
  const creditAt = headerIndex(headers, ["units_credited", "credits", "returns", "units_returned"]);
  const marketAt = headerIndex(headers, ["marketplace", "market"]);
  const documentAt = headerIndex(headers, ["document", "document_number", "invoice"]);
  if (skuAt < 0 || dateAt < 0 || soldAt < 0) {
    return {
      ok: false,
      error:
        "The file needs sku, date and units_sold columns. It was not imported as Amazon sales.",
    };
  }
  const merged = new Map<string, FbaAmazonSalesRow>();
  let mergedDuplicateDays = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i] ?? "");
    if (cells.every((cell) => !cell)) continue;
    const document = documentAt >= 0 ? (cells[documentAt] ?? "") : "";
    if (isOinReplenishmentReference(document)) {
      return {
        ok: false,
        error: `Row ${i + 1} is an OIN replenishment document. It was not imported as Amazon sales.`,
      };
    }
    const sku = (cells[skuAt] ?? "").trim();
    const saleDate = parseDate(cells[dateAt] ?? "");
    const unitsSold = numberCell(cells[soldAt] ?? "");
    const unitsCredited = creditAt >= 0 ? numberCell(cells[creditAt] ?? "") : 0;
    if (!sku || !saleDate || unitsSold == null || unitsCredited == null) {
      return { ok: false, error: `Row ${i + 1} has a missing SKU, date or a negative quantity.` };
    }
    const marketplace = (marketAt >= 0 ? cells[marketAt] : "")?.trim().toUpperCase() || "AMAZON_UK";
    if (marketplace !== "AMAZON_UK") {
      return {
        ok: false,
        error: `Row ${i + 1} is marketplace ${marketplace}. This forecast is Amazon UK only.`,
      };
    }
    const matchKey = skuMatchKey(sku);
    const key = `${matchKey}|${saleDate}|${marketplace}`;
    const existing = merged.get(key);
    if (existing) {
      existing.unitsSold += unitsSold;
      existing.unitsCredited += unitsCredited;
      mergedDuplicateDays += 1;
      continue;
    }
    merged.set(key, { sku, matchKey, saleDate, unitsSold, unitsCredited, marketplace });
  }
  const rows = [...merged.values()];
  if (!rows.length) return { ok: false, error: "The Amazon sales file has no data rows." };
  const dates = rows.map((row) => row.saleDate).sort();
  return {
    ok: true,
    rows,
    coverageFrom: dates[0]!,
    coverageTo: dates[dates.length - 1]!,
    mergedDuplicateDays,
  };
}
