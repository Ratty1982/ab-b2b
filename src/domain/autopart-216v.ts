/**
 * Autopart 216V — outstanding customer backorders.
 *
 * Production CSV headers are awkward and must be accepted as-is:
 * "Order No","Custome","r and Name","","Part Number","Description","","Ord No","OSQty","Unit","O/S Val"
 *
 * Line identity (documented):
 *   BASE = Order No + customer account + SKU matchKey
 * When that base is unique in a snapshot it identifies the line alone.
 * Customer Name and Product Description never participate.
 * Customer Order / Reference is a secondary discriminator only when the same
 * base repeats in one file (with #n for identical refs). Across snapshots,
 * unique bases match even when Autopart expands truncated reference/name text;
 * duplicate-base groups may use unambiguous prefix-compatible references.
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

/** Strongest stable business identity: Order No + account + SKU matchKey. */
export function autopart216vBaseIdentityKey(input: {
  orderNumber: string;
  customerAccount: string;
  partMatchKey: string;
}): string {
  return [
    input.orderNumber.trim().toUpperCase(),
    input.customerAccount.trim().toUpperCase(),
    input.partMatchKey,
  ].join("|");
}

export function normaliseAutopart216vRef(ref: string | null | undefined): string {
  return String(ref ?? "")
    .trim()
    .toUpperCase();
}

/**
 * Exact equality or genuine prefix/truncation (one value is a prefix of the other).
 * Empty only matches empty. No fuzzy / similarity matching.
 */
export function autopart216vRefsPrefixCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = normaliseAutopart216vRef(a);
  const y = normaliseAutopart216vRef(b);
  if (x === y) return true;
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * Deterministic in-file identity key.
 * Unique base → base only. Duplicate bases → base|REF[#n].
 */
export function autopart216vIdentityKey(input: {
  orderNumber: string;
  customerAccount: string;
  partMatchKey: string;
  customerOrderRef?: string;
  /** When true, append normalised customer order/reference (duplicate-base path). */
  includeRef?: boolean;
  occurrence?: number;
}): string {
  const base = autopart216vBaseIdentityKey(input);
  const withRef = input.includeRef
    ? `${base}|${normaliseAutopart216vRef(input.customerOrderRef)}`
    : base;
  const n = input.occurrence ?? 1;
  return n > 1 ? `${withRef}#${n}` : withRef;
}

type IdentityDraft = {
  orderNumber: string;
  customerAccount: string;
  partMatchKey: string;
  customerOrderRef: string;
  lineNumber: number;
};

/**
 * Assign preferred identity keys within one snapshot.
 * Unique bases omit customer reference; duplicate bases use it as secondary key.
 */
export function assignAutopart216vIdentityKeys(drafts: IdentityDraft[]): string[] {
  const groups = new Map<string, number[]>();
  drafts.forEach((d, i) => {
    const base = autopart216vBaseIdentityKey(d);
    const list = groups.get(base) ?? [];
    list.push(i);
    groups.set(base, list);
  });
  const keys = new Array<string>(drafts.length);
  for (const [base, indexes] of groups) {
    if (indexes.length === 1) {
      keys[indexes[0]!] = base;
      continue;
    }
    const refOccurrence = new Map<string, number>();
    const ordered = [...indexes].sort((a, b) => drafts[a]!.lineNumber - drafts[b]!.lineNumber);
    for (const i of ordered) {
      const ref = normaliseAutopart216vRef(drafts[i]!.customerOrderRef);
      const n = (refOccurrence.get(ref) ?? 0) + 1;
      refOccurrence.set(ref, n);
      keys[i] = autopart216vIdentityKey({
        orderNumber: drafts[i]!.orderNumber,
        customerAccount: drafts[i]!.customerAccount,
        partMatchKey: drafts[i]!.partMatchKey,
        customerOrderRef: drafts[i]!.customerOrderRef,
        includeRef: true,
        occurrence: n,
      });
    }
  }
  return keys;
}

export type Autopart216vMatchableLine = {
  identityKey: string;
  orderNumber: string;
  customerAccount: string;
  partMatchKey: string;
  customerOrderRef: string;
};

export type Autopart216vSnapshotMatch<P extends Autopart216vMatchableLine, N extends Autopart216vMatchableLine> = {
  previous: P;
  next: N;
  /** Preserve history continuity when Autopart expands truncated text fields. */
  continuedIdentityKey: string;
};

export type Autopart216vSnapshotMatchResult<
  P extends Autopart216vMatchableLine,
  N extends Autopart216vMatchableLine,
> = {
  matches: Array<Autopart216vSnapshotMatch<P, N>>;
  unmatchedPrevious: P[];
  unmatchedNext: N[];
  ambiguities: string[];
};

/**
 * Match previous outstanding lines to the next snapshot without false CLEARED/NEW
 * when Autopart expands truncated customer reference / name / description text.
 */
export function matchAutopart216vAcrossSnapshots<
  P extends Autopart216vMatchableLine,
  N extends Autopart216vMatchableLine,
>(previous: P[], next: N[]): Autopart216vSnapshotMatchResult<P, N> {
  const matches: Array<Autopart216vSnapshotMatch<P, N>> = [];
  const ambiguities: string[] = [];
  const prevRemaining = new Map<number, P>();
  previous.forEach((line, i) => prevRemaining.set(i, line));
  const nextRemaining = new Map<number, N>();
  next.forEach((row, i) => nextRemaining.set(i, row));

  const takeMatch = (prevIdx: number, nextIdx: number) => {
    const prev = prevRemaining.get(prevIdx);
    const nxt = nextRemaining.get(nextIdx);
    if (!prev || !nxt) return;
    matches.push({
      previous: prev,
      next: nxt,
      continuedIdentityKey: prev.identityKey,
    });
    prevRemaining.delete(prevIdx);
    nextRemaining.delete(nextIdx);
  };

  // 1) Exact identityKey (same preferred key across snapshots).
  const prevByExact = new Map<string, number[]>();
  for (const [idx, line] of prevRemaining) {
    const list = prevByExact.get(line.identityKey) ?? [];
    list.push(idx);
    prevByExact.set(line.identityKey, list);
  }
  for (const [nextIdx, row] of [...nextRemaining]) {
    const candidates = prevByExact.get(row.identityKey);
    if (!candidates?.length) continue;
    const prevIdx = candidates.shift()!;
    if (!candidates.length) prevByExact.delete(row.identityKey);
    takeMatch(prevIdx, nextIdx);
  }

  // 2) Base-identity groups for leftovers.
  const groupIndexes = <T extends Autopart216vMatchableLine>(items: Map<number, T>) => {
    const groups = new Map<string, number[]>();
    for (const [idx, line] of items) {
      const base = autopart216vBaseIdentityKey(line);
      const list = groups.get(base) ?? [];
      list.push(idx);
      groups.set(base, list);
    }
    return groups;
  };

  const prevGroups = groupIndexes(prevRemaining);
  const nextGroups = groupIndexes(nextRemaining);
  const bases = new Set([...prevGroups.keys(), ...nextGroups.keys()]);

  for (const base of bases) {
    let prevIdxs = (prevGroups.get(base) ?? []).filter((i) => prevRemaining.has(i));
    let nextIdxs = (nextGroups.get(base) ?? []).filter((i) => nextRemaining.has(i));
    if (!prevIdxs.length || !nextIdxs.length) continue;

    // Unique base on both leftover sides → same physical backorder.
    if (prevIdxs.length === 1 && nextIdxs.length === 1) {
      takeMatch(prevIdxs[0]!, nextIdxs[0]!);
      continue;
    }

    // Duplicate-base groups: unambiguous prefix-compatible reference only.
    let progressed = true;
    while (progressed) {
      progressed = false;
      prevIdxs = prevIdxs.filter((i) => prevRemaining.has(i));
      nextIdxs = nextIdxs.filter((i) => nextRemaining.has(i));
      if (!prevIdxs.length || !nextIdxs.length) break;

      const prevToNext = new Map<number, number[]>();
      const nextToPrev = new Map<number, number[]>();
      for (const pIdx of prevIdxs) {
        const pref = prevRemaining.get(pIdx)!;
        for (const nIdx of nextIdxs) {
          const nrow = nextRemaining.get(nIdx)!;
          if (!autopart216vRefsPrefixCompatible(pref.customerOrderRef, nrow.customerOrderRef)) continue;
          const pl = prevToNext.get(pIdx) ?? [];
          pl.push(nIdx);
          prevToNext.set(pIdx, pl);
          const nl = nextToPrev.get(nIdx) ?? [];
          nl.push(pIdx);
          nextToPrev.set(nIdx, nl);
        }
      }

      for (const pIdx of prevIdxs) {
        if (!prevRemaining.has(pIdx)) continue;
        const candidates = (prevToNext.get(pIdx) ?? []).filter((n) => nextRemaining.has(n));
        if (candidates.length !== 1) continue;
        const nIdx = candidates[0]!;
        const reverse = (nextToPrev.get(nIdx) ?? []).filter((p) => prevRemaining.has(p));
        if (reverse.length !== 1 || reverse[0] !== pIdx) continue;
        takeMatch(pIdx, nIdx);
        progressed = true;
      }
    }

    prevIdxs = prevIdxs.filter((i) => prevRemaining.has(i));
    nextIdxs = nextIdxs.filter((i) => nextRemaining.has(i));
    if (prevIdxs.length && nextIdxs.length) {
      ambiguities.push(
        `Ambiguous base identity ${base}: ${prevIdxs.length} previous vs ${nextIdxs.length} next — left unmatched`,
      );
    }
  }

  return {
    matches,
    unmatchedPrevious: [...prevRemaining.values()],
    unmatchedNext: [...nextRemaining.values()],
    ambiguities,
  };
}

export function parseAutopart216vReport(text: string): Autopart216vParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const errors: string[] = [];
  const draftRows: Array<Omit<Autopart216vRow, "identityKey">> = [];
  let headerFound = false;
  let delimiter: "," | "\t" | ";" = ",";
  let headerMap: Record<string, number> | null = null;

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
    draftRows.push({
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
      rawLine: line,
    });
  }

  const identityKeys = assignAutopart216vIdentityKeys(draftRows);
  const rows: Autopart216vRow[] = draftRows.map((row, i) => ({
    ...row,
    identityKey: identityKeys[i]!,
  }));

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
