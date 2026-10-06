/**
 * Autopart 216V — outstanding customer backorders.
 *
 * Production CSV headers are awkward and must be accepted as-is:
 * "Order No","Custome","r and Name","","Part Number","Description","","Ord No","OSQty","Unit","O/S Val"
 *
 * Line identity (documented):
 *   Order No + customer account + SKU matchKey + customer order/reference
 * Duplicate combinations in the same file keep a 1-based occurrence suffix
 * so legitimate repeated lines are not collapsed. Part Number alone is not unique.
 *
 * 216V Unit / O/S Val are report outstanding amounts — never Latest Cost.
 */

import { skuMatchKey } from "@/domain/stock";
import { parseAutopartMoneyToken } from "@/domain/autopart-504";

export const AUTOPART_216V_REPORT = "216V";

export type Autopart216vChangeStatus =
  | "NEW"
  | "UNCHANGED"
  | "QUANTITY_REDUCED"
  | "QUANTITY_INCREASED"
  | "CLEARED";

export type Autopart216vRow = {
  lineNumber: number;
  orderNumber: string;
  customerAccount: string;
  customerName: string;
  partNumber: string;
  partMatchKey: string;
  description: string;
  customerOrderRef: string;
  outstandingQty: string;
  unitValue: string | null;
  outstandingValue: string | null;
  identityKey: string;
  rawLine: string;
};

export type Autopart216vParseResult = {
  headerFound: boolean;
  rows: Autopart216vRow[];
  errors: string[];
  orderCount: number;
  accountCount: number;
  skuCount: number;
  outstandingQty: string;
  outstandingValue: string;
};

const HEADER_ALIASES: Record<string, string[]> = {
  orderNumber: ["order no", "order number", "orderno"],
  account: ["custome", "customer account", "account", "acct"],
  name: ["r and name", "customer name", "name", "customer and name"],
  part: ["part number", "part no", "sku"],
  description: ["description", "desc"],
  orderRef: ["ord no", "customer order number", "customer order", "reference", "ref"],
  qty: ["osqty", "os qty", "o/s qty", "outstanding qty", "qty"],
  unit: ["unit", "unit value", "unit val"],
  value: ["o/s val", "os val", "osval", "outstanding value", "o/s value"],
};

function normaliseHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function detectDelimiter(headerLine: string): "," | "\t" | ";" {
  const counts = [
    { d: "," as const, n: (headerLine.match(/,/g) ?? []).length },
    { d: "\t" as const, n: (headerLine.match(/\t/g) ?? []).length },
    { d: ";" as const, n: (headerLine.match(/;/g) ?? []).length },
  ];
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.d : ",";
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function mapHeaders(cells: string[]): Record<string, number> | null {
  const idx: Record<string, number> = {};
  const normalised = cells.map(normaliseHeader);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    let found = -1;
    for (let i = 0; i < normalised.length; i++) {
      if (aliases.includes(normalised[i]!)) {
        found = i;
        break;
      }
    }
    if (found >= 0) idx[key] = found;
  }
  if (idx["orderNumber"] == null || idx["part"] == null || idx["qty"] == null) return null;
  if (idx["account"] == null && idx["name"] == null) return null;
  return idx;
}

function looksLike216vHeaderCells(cells: string[]): boolean {
  const joined = cells.map(normaliseHeader).join(" | ");
  if (!joined.includes("order no")) return false;
  if (!joined.includes("part number")) return false;
  if (!joined.includes("osqty") && !joined.includes("os qty")) return false;
  if (!joined.includes("o/s val") && !joined.includes("os val") && !joined.includes("osval")) return false;
  return joined.includes("custome") || joined.includes("customer");
}

export function isAutopart216vFilename(filename: string): boolean {
  const f = filename.toUpperCase().replace(/[^A-Z0-9]/g, " ");
  return /(^| )216V( |$)/.test(f) || filename.toUpperCase().includes("216V.");
}

/**
 * Content-authoritative 216V detection. Filename is never enough.
 */
export function isAutopart216vReport(text: string, filename?: string): boolean {
  const raw = text.replace(/^\uFEFF/, "");
  const sample = raw.slice(0, 12_000).toUpperCase();
  if (sample.includes("TRM21QC") || sample.includes("231PO3NEW")) return false;
  if (sample.includes("LISTING OF INVOICES AND CREDITS BY CUSTOMER")) return false;
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines.slice(0, 40)) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line, detectDelimiter(line));
    if (looksLike216vHeaderCells(cells) && mapHeaders(cells)) return true;
  }
  // Filename never overrides a failed content match.
  void filename;
  return false;
}

export function parseAutopart216vQty(raw: string): string | null {
  const t = raw.replace(/,/g, "").trim();
  if (!t) return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

/**
 * Deterministic identity. Occurrence is 1 for the first in-file use of the key.
 */
export function autopart216vIdentityKey(input: {
  orderNumber: string;
  customerAccount: string;
  partMatchKey: string;
  customerOrderRef: string;
  occurrence?: number;
}): string {
  const base = [
    input.orderNumber.trim().toUpperCase(),
    input.customerAccount.trim().toUpperCase(),
    input.partMatchKey,
    input.customerOrderRef.trim().toUpperCase(),
  ].join("|");
  const n = input.occurrence ?? 1;
  return n > 1 ? `${base}#${n}` : base;
}

export function parseAutopart216vReport(text: string): Autopart216vParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const errors: string[] = [];
  const rows: Autopart216vRow[] = [];
  let headerFound = false;
  let delimiter: "," | "\t" | ";" = ",";
  let headerMap: Record<string, number> | null = null;
  const occurrence = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    if (!line.trim()) continue;
    if (!headerFound) {
      delimiter = detectDelimiter(line);
      const cells = splitCsvLine(line, delimiter);
      const mapped = mapHeaders(cells);
      if (mapped && looksLike216vHeaderCells(cells)) {
        headerFound = true;
        headerMap = mapped;
      }
      continue;
    }
    const cells = splitCsvLine(line, delimiter);
    const get = (key: string) => {
      const at = headerMap![key];
      return at == null ? "" : (cells[at] ?? "").trim();
    };
    const orderNumber = get("orderNumber");
    const customerAccount = get("account");
    const customerName = get("name");
    const partNumber = get("part");
    const description = get("description");
    const customerOrderRef = get("orderRef");
    const qtyRaw = get("qty");
    const unitRaw = get("unit");
    const valueRaw = get("value");
    if (!orderNumber && !partNumber && !qtyRaw) continue;
    if (!orderNumber || !partNumber) {
      errors.push(`Line ${lineNumber}: missing order or part number`);
      continue;
    }
    const outstandingQty = parseAutopart216vQty(qtyRaw);
    if (outstandingQty == null) {
      errors.push(`Line ${lineNumber}: invalid OSQty for ${orderNumber} / ${partNumber}`);
      continue;
    }
    const partKey = skuMatchKey(partNumber);
    const baseKey = autopart216vIdentityKey({
      orderNumber,
      customerAccount,
      partMatchKey: partKey,
      customerOrderRef,
    });
    const n = (occurrence.get(baseKey) ?? 0) + 1;
    occurrence.set(baseKey, n);
    rows.push({
      lineNumber,
      orderNumber,
      customerAccount,
      customerName,
      partNumber,
      partMatchKey: partKey,
      description,
      customerOrderRef,
      outstandingQty,
      unitValue: parseAutopartMoneyToken(unitRaw),
      outstandingValue: parseAutopartMoneyToken(valueRaw),
      identityKey: autopart216vIdentityKey({
        orderNumber,
        customerAccount,
        partMatchKey: partKey,
        customerOrderRef,
        occurrence: n,
      }),
      rawLine: line,
    });
  }

  if (!headerFound) {
    errors.push("216V header not found (Order No + Part Number + OSQty + O/S Val).");
  }

  let qtySum = 0;
  let valueSum = 0;
  for (const row of rows) {
    qtySum += Number(row.outstandingQty);
    valueSum += Number(row.outstandingValue ?? 0);
  }

  const qtyDisplay = Number.isInteger(qtySum) ? String(qtySum) : qtySum.toFixed(4).replace(/\.?0+$/, "");

  return {
    headerFound,
    rows,
    errors,
    orderCount: new Set(rows.map((r) => r.orderNumber.toUpperCase())).size,
    accountCount: new Set(rows.map((r) => r.customerAccount.trim().toUpperCase()).filter(Boolean)).size,
    skuCount: new Set(rows.map((r) => r.partMatchKey)).size,
    outstandingQty: qtyDisplay,
    outstandingValue: valueSum.toFixed(2),
  };
}

export function compare216vQty(previous: string | null, next: string): Autopart216vChangeStatus {
  if (previous == null) return "NEW";
  const a = Number(previous);
  const b = Number(next);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) < 0.000_000_1) return "UNCHANGED";
  if (b < a) return "QUANTITY_REDUCED";
  return "QUANTITY_INCREASED";
}

/**
 * Empty 216V may clear all previous outstanding lines only when the awkward
 * production header is present (strong identification). Filename alone is not enough.
 */
export function isStrongEmpty216vReport(text: string): boolean {
  if (!isAutopart216vReport(text)) return false;
  const parsed = parseAutopart216vReport(text);
  return parsed.headerFound && parsed.rows.length === 0 && parsed.errors.length <= 1;
}
