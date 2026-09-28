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
