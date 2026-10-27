/**
 * Manual Amazon UK FBA sell-through CSV.
 * Coverage comes from declared metadata, not the first and last sale dates.
 * MFN and FBM rows reject the file. OIN replenishment is not consumer sales.
 */

import { isAutopart504Report } from "@/domain/autopart-504";
import { isAutopartTrm21qcReport } from "@/domain/autopart-trm21qc";
import { isOinReplenishmentReference } from "@/domain/fba-replenishment";
import { daysInclusive } from "@/domain/sales-history-period";
import { skuMatchKey } from "@/domain/stock";

export type FbaAmazonSalesRow = {
  sku: string;
  matchKey: string;
  saleDate: string;
  unitsSold: number;
  unitsCredited: number;
  marketplace: string;
  fulfilmentChannel: "FBA";
};

export type FbaAmazonSalesParse =
  | {
      ok: true;
      rows: FbaAmazonSalesRow[];
      coverageFrom: string;
      coverageTo: string;
      extractedOn: string;
      fulfilmentScope: "FBA";
      declaredComplete: boolean;
      zerosOmitted: boolean;
      normalizedFbaOnly: boolean;
      coverageHasGaps: boolean;
      mergedDuplicateDays: number;
    }
  | { ok: false; error: string };

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_UK = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;
const FBA_CHANNELS = new Set(["AFN", "FBA"]);

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

function yes(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "yes" || value === "true" || value === "y" || value === "1";
}

function channelLabel(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
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
  const lines = source.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  const metadataHeaders = splitCsvLine(lines[0] ?? "");
  const fromAt = headerIndex(metadataHeaders, ["coverage_from", "report_start", "start_date"]);
  const toAt = headerIndex(metadataHeaders, ["coverage_to", "report_end", "end_date"]);
  const extractedAt = headerIndex(metadataHeaders, [
    "extracted_on",
    "extraction_date",
    "report_date",
  ]);
  const scopeAt = headerIndex(metadataHeaders, [
    "fulfilment_scope",
    "fulfillment_scope",
    "fba_scope",
  ]);
  if (fromAt < 0 || toAt < 0 || extractedAt < 0 || scopeAt < 0) {
    return {
      ok: false,
      error:
        "Amazon sales need coverage_from, coverage_to, extracted_on and fulfilment_scope before the SKU rows. Coverage is not inferred from the first and last sale.",
    };
  }
  const meta = splitCsvLine(lines[1] ?? "");
  const coverageFrom = parseDate(meta[fromAt] ?? "");
  const coverageTo = parseDate(meta[toAt] ?? "");
  const extractedOn = parseDate(meta[extractedAt] ?? "");
  const scope = channelLabel(meta[scopeAt] ?? "");
  if (!coverageFrom || !coverageTo || !extractedOn) {
    return { ok: false, error: "coverage_from, coverage_to and extracted_on must be dates." };
  }
  if (coverageFrom > coverageTo) {
    return { ok: false, error: "coverage_from is after coverage_to." };
  }
  if (extractedOn < coverageTo) {
    return {
      ok: false,
      error:
        "extracted_on is before coverage_to, so the file cannot be a complete extract of that range.",
    };
  }
  if (scope !== "FBA" && scope !== "AFN") {
    return {
      ok: false,
      error: `fulfilment_scope is ${scope || "blank"}. Only an FBA or AFN extract can be imported. MFN and FBM are not FBA sell-through.`,
    };
  }
  const completeAt = headerIndex(metadataHeaders, ["complete", "complete_daily"]);
  const zerosAt = headerIndex(metadataHeaders, ["zeros_omitted", "zero_days_omitted"]);
  const declaredComplete = completeAt >= 0 && yes(meta[completeAt]);
  const zerosOmitted = zerosAt >= 0 && yes(meta[zerosAt]);

  const dataHeaders = splitCsvLine(lines[2] ?? "");
  const skuAt = headerIndex(dataHeaders, ["sku", "part_number", "part", "seller_sku"]);
  const dateAt = headerIndex(dataHeaders, ["date", "sale_date", "sales_date"]);
  const soldAt = headerIndex(dataHeaders, ["units_sold", "units", "sold", "quantity_sold"]);
  const creditAt = headerIndex(dataHeaders, [
    "units_credited",
    "credits",
    "returns",
    "units_returned",
  ]);
  const marketAt = headerIndex(dataHeaders, ["marketplace", "market"]);
  const documentAt = headerIndex(dataHeaders, ["document", "document_number", "invoice"]);
  const channelAt = headerIndex(dataHeaders, [
    "fulfilment_channel",
    "fulfillment_channel",
    "fulfilment",
    "fulfillment",
  ]);
  if (skuAt < 0 || dateAt < 0 || soldAt < 0) {
    return {
      ok: false,
      error: "The file needs sku, date and units_sold columns after the coverage metadata.",
    };
  }
  const normalizedFbaOnly = channelAt < 0;
  const merged = new Map<string, FbaAmazonSalesRow>();
  let mergedDuplicateDays = 0;
  for (let i = 3; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i] ?? "");
    if (cells.every((cell) => !cell)) continue;
    const document = documentAt >= 0 ? (cells[documentAt] ?? "") : "";
    if (isOinReplenishmentReference(document)) {
      return {
        ok: false,
        error: `Row ${i + 1} is an OIN replenishment document. It was not imported as Amazon sales.`,
      };
    }
    if (!normalizedFbaOnly) {
      const channel = channelLabel(cells[channelAt] ?? "");
      if (!FBA_CHANNELS.has(channel)) {
        return {
          ok: false,
          error: `Row ${i + 1} fulfilment channel is ${channel || "blank"}. Only AFN or FBA rows can be imported. MFN and FBM cannot contribute to FBA demand, and this file was not stored.`,
        };
      }
    }
    const sku = (cells[skuAt] ?? "").trim();
    const saleDate = parseDate(cells[dateAt] ?? "");
    const unitsSold = numberCell(cells[soldAt] ?? "");
    const unitsCredited = creditAt >= 0 ? numberCell(cells[creditAt] ?? "") : 0;
    if (!sku || !saleDate || unitsSold == null || unitsCredited == null) {
      return { ok: false, error: `Row ${i + 1} has a missing SKU, date or a negative quantity.` };
    }
    if (saleDate < coverageFrom || saleDate > coverageTo) {
      return {
        ok: false,
        error: `Row ${i + 1} date ${saleDate} is outside the declared coverage ${coverageFrom} to ${coverageTo}.`,
      };
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
    merged.set(key, {
      sku,
      matchKey,
      saleDate,
      unitsSold,
      unitsCredited,
      marketplace,
      fulfilmentChannel: "FBA",
    });
  }
  const rows = [...merged.values()];
  if (!rows.length) return { ok: false, error: "The Amazon sales file has no data rows." };
  const distinctDays = new Set(rows.map((row) => row.saleDate)).size;
  const coverageHasGaps = distinctDays < daysInclusive({ from: coverageFrom, to: coverageTo });
  return {
    ok: true,
    rows,
    coverageFrom,
    coverageTo,
    extractedOn,
    fulfilmentScope: "FBA",
    declaredComplete,
    zerosOmitted,
    normalizedFbaOnly,
    coverageHasGaps,
    mergedDuplicateDays,
  };
}
