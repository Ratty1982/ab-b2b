/**
 * Shared money / date helpers for Autopart customer history reports
 * (561L, SLRB, 407P100). Authoritative arithmetic uses scaled Money — never floats.
 */
import { moneyToString, parseMoney, subMoney, type Money } from "@/domain/money";

/** Strip currency decoration and parse Autopart monetary fields to Money (4dp scale). */
export function parseAutopartMoney(raw: string | null | undefined): Money | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/^\uFEFF/, "");
  if (!s) return null;
  s = s.replace(/£/g, "").replace(/,/g, "").replace(/\s+/g, "");
  // Accounting negative: (123.45)
  if (/^\(.*\)$/.test(s)) {
    s = `-${s.slice(1, -1)}`;
  }
  // Trailing CR / DR markers sometimes appear on Autopart exports
  const upper = s.toUpperCase();
  if (upper.endsWith("CR")) {
    s = `-${s.slice(0, -2)}`;
  } else if (upper.endsWith("DR")) {
    s = s.slice(0, -2);
  }
  if (!s || s === "-" || s === "+") return null;
  return parseMoney(s);
}

export function autopartMoneyToGbp2(value: Money): string {
  return moneyToString(value, 2);
}

export function availableCreditFromExposure(input: {
  creditLimit: Money;
  totalExposure: Money;
}): { availableCreditRaw: Money; availableCreditDisplay: string; overLimitBy: Money | null } {
  const raw = subMoney(input.creditLimit, input.totalExposure);
  const over = raw.minor < 0n ? { minor: -raw.minor } : null;
  return {
    availableCreditRaw: raw,
    availableCreditDisplay: autopartMoneyToGbp2(raw.minor < 0n ? { minor: 0n } : raw),
    overLimitBy: over,
  };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * Parse Autopart date-only strings such as "06 Oct 14" → "2014-10-06".
 * Returns YYYY-MM-DD or null. Does not apply timezone conversion.
 */
export function parseAutopartDateOnly(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim().replace(/\s+/g, " ");
  if (!t) return null;

  // Already ISO date-only
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  // DD/MM/YYYY or DD/MM/YY
  const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return formatYmd(year, month, day);
  }

  // DD Mon YY / DD Mon YYYY
  const named = t.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})$/);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2]!.toLowerCase()];
    if (!month) return null;
    let year = Number(named[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return formatYmd(year, month, day);
  }

  return null;
}

function formatYmd(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Validate calendar day without timezone shift
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Case-insensitive exact account compare after trim/collapse — never prefix-fuzzy. */
export function autopartAccountsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normaliseAccountToken(a);
  const nb = normaliseAccountToken(b);
  if (!na || !nb) return false;
  return na === nb;
}

export function normaliseAccountToken(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t.toUpperCase();
}

/**
 * Defensive gate after column extraction — never treat money/qty as account IDs.
 * Genuine Autopart codes may be alphanumeric; pure numeric / decimal / currency fail.
 */
export function isPlausibleAutopartAccountCode(raw: string | null | undefined): boolean {
  const token = normaliseAccountToken(raw);
  if (!token) return false;
  // Currency / accounting decoration
  if (/[£$€]/.test(token)) return false;
  if (/\(.*\)/.test(token)) return false;
  if (/(?:CR|DR)$/i.test(token) && /[\d.]/.test(token)) return false;
  // Pure integer / decimal amounts (including negatives like -1, -104.38)
  if (/^[+-]?\d+(?:\.\d+)?$/.test(token)) return false;
  // Thousands-separated money: 1,234.56
  if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(token)) return false;
  // Must contain at least one letter (Autopart customer codes are not pure digits)
  if (!/[A-Z]/.test(token)) return false;
  // Reject tokens that are clearly Inv & Ln identities
  if (/^[IC]\/.+\/\d+$/i.test(token)) return false;
  if (token.length > 32) return false;
  return true;
}

/** Extract account only when the raw field is a plausible Autopart account code. */
export function extractAutopartAccountCode(raw: string | null | undefined): string | null {
  const token = normaliseAccountToken(raw);
  if (!token || !isPlausibleAutopartAccountCode(token)) return null;
  return token;
}

/** Minimal CSV line splitter — respects double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function splitOnChar(line: string, delimiter: string): string[] {
  if (delimiter === ",") return splitCsvLine(line);
  return line.split(delimiter).map((c) => c.trim());
}

/**
 * Content-based cell split for Autopart report lines.
 * Prefers comma CSV, then tab / semicolon, then multi-space (report text).
 * Filename/extension is irrelevant — callers pass file text only.
 */
export function splitAutopartReportCells(line: string): string[] {
  const raw = line.replace(/\t+$/g, "");
  if (!raw.trim()) return [];

  const comma = splitCsvLine(raw);
  if (comma.length >= 3) return comma;

  if (raw.includes("\t")) {
    const tab = splitOnChar(raw, "\t").filter((c) => c.length > 0 || comma.length > 1);
    if (tab.length >= 3) return tab;
  }

  if (raw.includes(";")) {
    const semi = splitOnChar(raw, ";");
    if (semi.length >= 3) return semi;
  }

  // Report-style: 2+ spaces between columns (keep single spaces inside description)
  if (/\s{2,}/.test(raw)) {
    const spaced = raw.trim().split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (spaced.length >= 3) return spaced;
  }

  return comma;
}

export type FixedWidthColumn = {
  key: string;
  start: number;
  /** Exclusive end; null = to end of line. */
  end: number | null;
};

/**
 * Locate labelled columns on a fixed-width / space-padded header line.
 * Returns column slices and the account field width when account is present.
 */
export function detectFixedWidthLayout(
  headerLine: string,
  labels: Array<{ key: string; patterns: RegExp[] }>,
): { columns: FixedWidthColumn[]; accountFieldWidth: number | null } | null {
  const found: Array<{ key: string; start: number; labelLength: number }> = [];
  for (const label of labels) {
    for (const pattern of label.patterns) {
      const m = headerLine.match(pattern);
      if (m && m.index != null) {
        found.push({ key: label.key, start: m.index, labelLength: m[0].length });
        break;
      }
    }
  }
  const keys = new Set(found.map((f) => f.key));
  // Need at least the mandatory keys the caller cares about — require >= 3 hits
  if (found.length < 3) return null;

  found.sort((a, b) => a.start - b.start);
  const columns: FixedWidthColumn[] = found.map((f, idx) => ({
    key: f.key,
    start: f.start,
    end: idx + 1 < found.length ? found[idx + 1]!.start : null,
  }));

  let accountFieldWidth: number | null = null;
  const acct = columns.find((c) => c.key === "account");
  if (acct && acct.end != null) {
    accountFieldWidth = Math.max(1, acct.end - acct.start);
  } else if (acct) {
    // Last column — width unknown from layout
    accountFieldWidth = null;
  }

  // De-dupe preference: first occurrence wins (already sorted)
  void keys;
  return { columns, accountFieldWidth };
}

export function sliceFixedWidthCells(
  line: string,
  columns: FixedWidthColumn[],
): { [key: string]: string | undefined } {
  const out: { [key: string]: string | undefined } = {};
  const padded = line.length >= (columns[columns.length - 1]?.start ?? 0) ? line : line.padEnd(200);
  for (const col of columns) {
    const raw = col.end != null ? padded.slice(col.start, col.end) : padded.slice(col.start);
    out[col.key] = raw.trim();
  }
  return out;
}

export function normaliseReportLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
}

export function headerKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[./]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
