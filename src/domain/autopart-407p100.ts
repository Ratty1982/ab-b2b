/**
 * Autopart 407P100 — CURRENT customer credit exposure.
 * Authoritative AB source for imported credit position when successfully committed.
 */
import {
  autopartMoneyToGbp2,
  availableCreditFromExposure,
  headerKey,
  normaliseAccountToken,
  normaliseReportLines,
  parseAutopartMoney,
  splitCsvLine,
} from "@/domain/autopart-report-money";
import { moneyZero, type Money } from "@/domain/money";

export type Autopart407p100Position = {
  accountCode: string | null;
  /** Optional Autopart customer name from report (display only). */
  customerName: string | null;
  invoices: string;
  picking: string;
  dropShip: string;
  crossDock: string;
  suspends: string;
  unConsol: string;
  totalExposure: string;
  creditLimit: string;
  availableCreditRaw: string;
  availableCreditDisplay: string;
  overLimitBy: string | null;
  lineNumberInFile: number;
};

export type Autopart407p100InvalidRow = {
  lineNumberInFile: number;
  accountCode: string | null;
  customerName: string | null;
  reason: string;
};

export type Autopart407p100ParseDiagnostics = {
  /** Valid credit-position data rows. */
  validRows: number;
  /** Rows rejected (malformed / missing account / invalid money). */
  invalidRows: number;
  /** Account codes that appear more than once among valid rows. */
  duplicateAccountCodes: string[];
};

export type Autopart407p100ParseResult = {
  report: "407P100";
  /** All valid credit-position rows (multi-customer report). */
  positions: Autopart407p100Position[];
  invalidRows: Autopart407p100InvalidRow[];
  detectedAccounts: string[];
  headerFound: boolean;
  malformedRows: number;
  errors: string[];
  diagnostics: Autopart407p100ParseDiagnostics;
};

/**
 * Financial + identity fingerprint for identical-row dedupe on per-company import.
 * Unrelated customers in the same 407P100 are never part of this comparison.
 */
export function creditPositionFingerprint(p: Autopart407p100Position): string {
  return [
    p.accountCode ?? "",
    p.customerName ?? "",
    p.invoices,
    p.picking,
    p.dropShip,
    p.crossDock,
    p.suspends,
    p.unConsol,
    p.totalExposure,
    p.creditLimit,
  ].join("\u0001");
}

export type SelectCompany407p100RowResult =
  | {
      status: "MATCHED";
      position: Autopart407p100Position;
      matchedAccount: string;
      matchedVia: "VERIFIED" | "ALIAS";
      /** Extra identical rows discarded after safe dedupe (0 when unique). */
      identicalDuplicatesDiscarded: number;
    }
  | {
      status: "NOT_FOUND";
      matchedAccount: null;
    }
  | {
      status: "CONFLICTING_DUPLICATES";
      matchedAccount: string;
      positions: Autopart407p100Position[];
    };

/**
 * Select the current company's row from a multi-customer 407P100 parse.
 *
 * Matching is exact verified account OR explicit verified alias only —
 * no prefix / fuzzy / 561L truncation. Unrelated accounts are ignored.
 *
 * Identical duplicate target rows are safely deduped; conflicting values BLOCK.
 */
export function selectCompanyRowFrom407p100(input: {
  positions: Autopart407p100Position[];
  verifiedAccount: string;
  acceptedAccounts: Set<string>;
}): SelectCompany407p100RowResult {
  const verified = normaliseAccountToken(input.verifiedAccount);
  if (!verified) {
    return { status: "NOT_FOUND", matchedAccount: null };
  }

  const matches = input.positions.filter(
    (p) => p.accountCode != null && input.acceptedAccounts.has(p.accountCode),
  );
  if (matches.length === 0) {
    return { status: "NOT_FOUND", matchedAccount: null };
  }

  const byFingerprint = new Map<string, Autopart407p100Position>();
  for (const m of matches) {
    const key = creditPositionFingerprint(m);
    if (!byFingerprint.has(key)) byFingerprint.set(key, m);
  }
  const unique = [...byFingerprint.values()];
  if (unique.length > 1) {
    const matchedAccount = unique[0]!.accountCode!;
    return {
      status: "CONFLICTING_DUPLICATES",
      matchedAccount,
      positions: unique,
    };
  }

  const position = unique[0]!;
  const matchedAccount = position.accountCode!;
  const matchedVia: "VERIFIED" | "ALIAS" =
    matchedAccount === verified ? "VERIFIED" : "ALIAS";
  return {
    status: "MATCHED",
    position,
    matchedAccount,
    matchedVia,
    identicalDuplicatesDiscarded: matches.length - 1,
  };
}

const HEADER_ALIASES: Record<string, string> = {
  acct: "account",
  "a c": "account",
  account: "account",
  customer: "account",
  invoices: "invoices",
  picking: "picking",
  dropship: "dropShip",
  "drop ship": "dropShip",
  crossdock: "crossDock",
  "cross dock": "crossDock",
  suspends: "suspends",
  unconsol: "unConsol",
  "un consol": "unConsol",
  unconsolidated: "unConsol",
  total: "total",
  "credit limit": "creditLimit",
  creditlimit: "creditLimit",
  "cr limit": "creditLimit",
  crlimit: "creditLimit",
  limit: "creditLimit",
  "customer name": "customerName",
  customername: "customerName",
  name: "customerName",
};

function gbpOrZero(m: Money | null): string {
  return autopartMoneyToGbp2(m ?? moneyZero());
}

function buildPosition(input: {
  accountCode: string | null;
  customerName: string | null;
  invoices: Money | null;
  picking: Money | null;
  dropShip: Money | null;
  crossDock: Money | null;
  suspends: Money | null;
  unConsol: Money | null;
  total: Money;
  creditLimit: Money;
  lineNumberInFile: number;
}): Autopart407p100Position {
  const avail = availableCreditFromExposure({
    creditLimit: input.creditLimit,
    totalExposure: input.total,
  });
  return {
    accountCode: input.accountCode,
    customerName: input.customerName,
    invoices: gbpOrZero(input.invoices),
    picking: gbpOrZero(input.picking),
    dropShip: gbpOrZero(input.dropShip),
    crossDock: gbpOrZero(input.crossDock),
    suspends: gbpOrZero(input.suspends),
    unConsol: gbpOrZero(input.unConsol),
    totalExposure: gbpOrZero(input.total),
    creditLimit: gbpOrZero(input.creditLimit),
    availableCreditRaw: autopartMoneyToGbp2(avail.availableCreditRaw),
    availableCreditDisplay: avail.availableCreditDisplay,
    overLimitBy: avail.overLimitBy ? autopartMoneyToGbp2(avail.overLimitBy) : null,
    lineNumberInFile: input.lineNumberInFile,
  };
}

/**
 * Supports:
 * 1) CSV with header row including Invoices / Credit Limit
 * 2) Key/value style summary for a single account
 */
export function parseAutopart407p100(text: string): Autopart407p100ParseResult {
  const lines = normaliseReportLines(text);
  const errors: string[] = [];
  const positions: Autopart407p100Position[] = [];
  type ColMap = {
    account?: number;
    customerName?: number;
    invoices?: number;
    picking?: number;
    dropShip?: number;
    crossDock?: number;
    suspends?: number;
    unConsol?: number;
    total: number;
    creditLimit: number;
  };
  let headerFound = false;
  let colMap: ColMap | null = null;
  let malformedRows = 0;
  const invalidRows: Autopart407p100InvalidRow[] = [];
  const accounts = new Set<string>();

  // First pass: detect CSV header (supports multi-customer 407P100 exports).
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (!raw.trim()) continue;
    const cells = splitCsvLine(raw);
    const mapped = mapHeader(cells);
    if (mapped && mapped.total != null && mapped.creditLimit != null) {
      headerFound = true;
      colMap = mapped;
      for (let j = i + 1; j < lines.length; j++) {
        const row = lines[j] ?? "";
        if (!row.trim()) continue;
        const upper = row.trim().toUpperCase();
        if (upper.startsWith("END OF REPORT") || upper.startsWith("PAGE ")) continue;
        const data = splitCsvLine(row);
        if (looksLikeTotal(data)) continue;
        const accountCode = normaliseAccountToken(cellAt(data, colMap.account));
        const customerNameRaw = cellAt(data, colMap.customerName)?.trim() || null;
        const total = parseAutopartMoney(cellAt(data, colMap.total));
        const creditLimit = parseAutopartMoney(cellAt(data, colMap.creditLimit));
        if (total == null || creditLimit == null) {
          malformedRows += 1;
          invalidRows.push({
            lineNumberInFile: j + 1,
            accountCode,
            customerName: customerNameRaw,
            reason:
              total == null && creditLimit == null
                ? "Invalid Total and Credit Limit"
                : total == null
                  ? "Invalid Total"
                  : "Invalid Credit Limit",
          });
          continue;
        }
        if (!accountCode) {
          malformedRows += 1;
          invalidRows.push({
            lineNumberInFile: j + 1,
            accountCode: null,
            customerName: customerNameRaw,
            reason: "Missing Autopart customer account",
          });
          continue;
        }
        accounts.add(accountCode);
        positions.push(
          buildPosition({
            accountCode,
            customerName: customerNameRaw,
            invoices: parseAutopartMoney(cellAt(data, colMap.invoices)),
            picking: parseAutopartMoney(cellAt(data, colMap.picking)),
            dropShip: parseAutopartMoney(cellAt(data, colMap.dropShip)),
            crossDock: parseAutopartMoney(cellAt(data, colMap.crossDock)),
            suspends: parseAutopartMoney(cellAt(data, colMap.suspends)),
            unConsol: parseAutopartMoney(cellAt(data, colMap.unConsol)),
            total,
            creditLimit,
            lineNumberInFile: j + 1,
          }),
        );
      }
      break;
    }
  }

  // Key/value fallback for single-account summary exports
  if (!headerFound) {
    const kv = parseKeyValueSummary(lines);
    if (kv) {
      headerFound = true;
      if (kv.accountCode) accounts.add(kv.accountCode);
      if (kv.total == null || kv.creditLimit == null) {
        malformedRows += 1;
        invalidRows.push({
          lineNumberInFile: kv.lineNumberInFile,
          accountCode: kv.accountCode,
          customerName: null,
          reason: "407P100 summary missing Total or Credit Limit",
        });
        errors.push("407P100 summary missing Total or Credit Limit");
      } else if (!kv.accountCode) {
        malformedRows += 1;
        invalidRows.push({
          lineNumberInFile: kv.lineNumberInFile,
          accountCode: null,
          customerName: null,
          reason: "Missing Autopart customer account",
        });
      } else {
        positions.push(
          buildPosition({
            accountCode: kv.accountCode,
            customerName: null,
            invoices: kv.invoices,
            picking: kv.picking,
            dropShip: kv.dropShip,
            crossDock: kv.crossDock,
            suspends: kv.suspends,
            unConsol: kv.unConsol,
            total: kv.total,
            creditLimit: kv.creditLimit,
            lineNumberInFile: kv.lineNumberInFile,
          }),
        );
      }
    } else {
      errors.push("407P100 header/summary not recognised");
    }
  }

  if (headerFound && positions.length === 0 && invalidRows.length === 0 && !errors.length) {
    errors.push("407P100 contained no credit-position rows");
  }

  const accountCounts = new Map<string, number>();
  for (const p of positions) {
    if (!p.accountCode) continue;
    accountCounts.set(p.accountCode, (accountCounts.get(p.accountCode) ?? 0) + 1);
  }
  const duplicateAccountCodes = [...accountCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([a]) => a)
    .sort();

  return {
    report: "407P100",
    positions,
    invalidRows,
    detectedAccounts: [...accounts].sort(),
    headerFound,
    malformedRows,
    errors,
    diagnostics: {
      validRows: positions.length,
      invalidRows: invalidRows.length,
      duplicateAccountCodes,
    },
  };
}

function mapHeader(cells: string[]): {
  account?: number;
  customerName?: number;
  invoices?: number;
  picking?: number;
  dropShip?: number;
  crossDock?: number;
  suspends?: number;
  unConsol?: number;
  total: number;
  creditLimit: number;
} | null {
  const map: Partial<Record<string, number>> = {};
  cells.forEach((cell, idx) => {
    const key = HEADER_ALIASES[headerKey(cell)];
    if (key) map[key] = idx;
  });
  if (map["total"] != null && map["creditLimit"] != null) {
    return {
      ...(map["account"] != null ? { account: map["account"] } : {}),
      ...(map["customerName"] != null ? { customerName: map["customerName"] } : {}),
      ...(map["invoices"] != null ? { invoices: map["invoices"] } : {}),
      ...(map["picking"] != null ? { picking: map["picking"] } : {}),
      ...(map["dropShip"] != null ? { dropShip: map["dropShip"] } : {}),
      ...(map["crossDock"] != null ? { crossDock: map["crossDock"] } : {}),
      ...(map["suspends"] != null ? { suspends: map["suspends"] } : {}),
      ...(map["unConsol"] != null ? { unConsol: map["unConsol"] } : {}),
      total: map["total"],
      creditLimit: map["creditLimit"],
    };
  }
  return null;
}

function cellAt(cells: string[], idx: number | undefined): string | null {
  if (idx == null) return null;
  return cells[idx] ?? null;
}

function looksLikeTotal(cells: string[]): boolean {
  const j = cells.join(" ").toUpperCase();
  return j.includes("GRAND TOTAL") || j.startsWith("TOTALS");
}

function parseKeyValueSummary(lines: string[]): {
  accountCode: string | null;
  invoices: Money | null;
  picking: Money | null;
  dropShip: Money | null;
  crossDock: Money | null;
  suspends: Money | null;
  unConsol: Money | null;
  total: Money | null;
  creditLimit: Money | null;
  lineNumberInFile: number;
} | null {
  let accountCode: string | null = null;
  let invoices: Money | null = null;
  let picking: Money | null = null;
  let dropShip: Money | null = null;
  let crossDock: Money | null = null;
  let suspends: Money | null = null;
  let unConsol: Money | null = null;
  let total: Money | null = null;
  let creditLimit: Money | null = null;
  let hits = 0;
  let lastLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (!raw.trim()) continue;
    lastLine = i + 1;
    const acct = raw.match(/^\s*(?:Account|A\/C|Acct\.?)\s*[:=]\s*(\S+)/i);
    if (acct) {
      accountCode = normaliseAccountToken(acct[1]);
      hits += 1;
      continue;
    }
    const m = raw.match(
      /^\s*([A-Za-z][A-Za-z0-9./]*(?:\s+[A-Za-z][A-Za-z0-9./]*)*)\s*[:=]?\s+(£?-?[\d,().]+(?:\s*CR)?)\s*$/i,
    );
    if (!m) continue;
    const label = headerKey(m[1]!);
    const value = parseAutopartMoney(m[2]!);
    if (label === "account" || label === "a c" || label === "acct") {
      accountCode = normaliseAccountToken(m[2]!);
      hits += 1;
      continue;
    }
    if (value == null) continue;
    if (label === "invoices") {
      invoices = value;
      hits += 1;
    } else if (label === "picking") {
      picking = value;
      hits += 1;
    } else if (label === "drop ship" || label === "dropship") {
      dropShip = value;
      hits += 1;
    } else if (label === "cross dock" || label === "crossdock") {
      crossDock = value;
      hits += 1;
    } else if (label === "suspends") {
      suspends = value;
      hits += 1;
    } else if (label === "unconsol" || label === "un consol" || label === "unconsolidated") {
      unConsol = value;
      hits += 1;
    } else if (label === "total") {
      total = value;
      hits += 1;
    } else if (label === "credit limit" || label === "creditlimit" || label === "limit") {
      creditLimit = value;
      hits += 1;
    }
  }

  if (hits < 2 || (total == null && creditLimit == null)) return null;
  return {
    accountCode,
    invoices,
    picking,
    dropShip,
    crossDock,
    suspends,
    unConsol,
    total,
    creditLimit,
    lineNumberInFile: lastLine,
  };
}
