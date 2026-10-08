/**
 * Autopart 407EXP — CUSTOMER LIST FOR EXPORT.
 *
 * Fixed-width, paginated text. Positions were measured on the 08 Oct 2026 export:
 *   Account 0–10, Name 11–41, Area 41–46, Rep 46–end.
 * Account codes keep punctuation and leading zeroes. Parsing never splits on spaces.
 * Import does not approve trade access.
 */

export const AUTOPART_SOURCE_SYSTEM = "AUTOPART";
export const EXP407_ACCOUNT_END = 10;
export const EXP407_NAME_START = 11;
export const EXP407_NAME_END = 41;
export const EXP407_AREA_END = 46;

export type AutopartAccountClassification =
  | "TRADE_CANDIDATE"
  | "INTERNAL"
  | "CASH"
  | "STAFF"
  | "OBSOLETE"
  | "DO_NOT_USE"
  | "UNIDENTIFIED"
  | "REQUIRES_REVIEW";

export type Exp407Row = {
  sourceRowNumber: number;
  accountCode: string;
  originalName: string;
  nameTruncated: boolean;
  areaCode: string | null;
  repCode: string | null;
  classification: AutopartAccountClassification;
  classificationNote: string;
};

export type Exp407Issue = {
  sourceRowNumber: number;
  sourceRecordId: string | null;
  issueType: string;
  severity: "ERROR" | "WARNING";
  explanation: string;
};

export type Exp407Summary = {
  physicalLines: number;
  pageBanners: number;
  repeatedHeaders: number;
  dataRows: number;
  distinctAccounts: number;
  duplicateAccounts: number;
  blankArea: number;
  blankRep: number;
  truncatedNames: number;
  rejectedRows: number;
  classifications: Record<AutopartAccountClassification, number>;
};

const EMPTY_CLASSIFICATIONS = (): Record<AutopartAccountClassification, number> => ({
  TRADE_CANDIDATE: 0,
  INTERNAL: 0,
  CASH: 0,
  STAFF: 0,
  OBSOLETE: 0,
  DO_NOT_USE: 0,
  UNIDENTIFIED: 0,
  REQUIRES_REVIEW: 0,
});

/** Preserve the account field exactly apart from the fixed-width padding spaces. */
export function preserveAccountCode(raw: string): string {
  return raw.replace(/^\s+|\s+$/g, "");
}

export function classifyAutopartAccount(
  accountCode: string,
  originalName: string,
): { classification: AutopartAccountClassification; note: string } {
  const account = accountCode.toUpperCase();
  const name = originalName.trim();
  const nameUpper = name.toUpperCase();
  if (/DO NOT USE/i.test(name)) {
    return { classification: "DO_NOT_USE", note: "Name contains DO NOT USE" };
  }
  if (/OBSOLETE/i.test(name) || /OLD ACCOUNT/i.test(name)) {
    return { classification: "OBSOLETE", note: "Name marks the account obsolete" };
  }
  if (account === "CASH" || account === "CASHSALE" || /^CASH(\s+CUSTOMER|\s+SALES)?$/i.test(name)) {
    return { classification: "CASH", note: "Cash or cash-sale account" };
  }
  if (/\bSTAFF\b/i.test(name) || /\bSTAFF\b/i.test(account)) {
    return { classification: "STAFF", note: "Staff account" };
  }
  if (
    /AUTOMOTIVE BRANDS/i.test(name) ||
    /\bFBA\b/i.test(nameUpper) ||
    /\bAMAZON\b/i.test(nameUpper)
  ) {
    return { classification: "INTERNAL", note: "Internal, Amazon, or FBA account" };
  }
  return {
    classification: "TRADE_CANDIDATE",
    note: "Imported from 407EXP. Portal access is not granted.",
  };
}

function isBanner(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^Page\s*:/i.test(trimmed)) return true;
  if (trimmed.includes("CUSTOMER LIST FOR EXPORT")) return true;
  if (/^\*+$/.test(trimmed)) return true;
  if (trimmed.includes("A U T O P A R T") || trimmed.includes("AUTOPART  SYSTEM")) return true;
  return false;
}

function isSeparator(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && /^-+$/.test(trimmed);
}

function isRepeatedHeader(accountField: string): boolean {
  return accountField.toUpperCase() === "ACCOUNT";
}

export function parse407ExpDataLine(
  line: string,
  sourceRowNumber: number,
):
  | { row: Exp407Row }
  | { skip: "blank" | "banner" | "separator" | "header" }
  | { reject: Exp407Issue } {
  if (!line.trim()) return { skip: "blank" };
  if (isBanner(line)) return { skip: "banner" };
  if (isSeparator(line)) return { skip: "separator" };
  const accountCode = preserveAccountCode(line.slice(0, EXP407_ACCOUNT_END));
  if (!accountCode) {
    return {
      reject: {
        sourceRowNumber,
        sourceRecordId: null,
        issueType: "MISSING_ACCOUNT",
        severity: "ERROR",
        explanation: "407EXP row has an empty account field",
      },
    };
  }
  if (isRepeatedHeader(accountCode)) return { skip: "header" };
  const nameField =
    line.length > EXP407_NAME_START ? line.slice(EXP407_NAME_START, EXP407_NAME_END) : "";
  const originalName = nameField.replace(/\s+$/g, "");
  const nameTruncated =
    nameField.length === EXP407_NAME_END - EXP407_NAME_START &&
    !nameField.endsWith(" ") &&
    originalName.length > 0;
  const areaCode = (line.slice(EXP407_NAME_END, EXP407_AREA_END) || "").trim() || null;
  const repCode = (line.slice(EXP407_AREA_END) || "").trim() || null;
  const classified = classifyAutopartAccount(accountCode, originalName);
  return {
    row: {
      sourceRowNumber,
      accountCode,
      originalName,
      nameTruncated,
      areaCode,
      repCode,
      classification: classified.classification,
      classificationNote: classified.note,
    },
  };
}

export function parse407Exp(text: string): {
  rows: Exp407Row[];
  issues: Exp407Issue[];
  summary: Exp407Summary;
} {
  const rows: Exp407Row[] = [];
  const issues: Exp407Issue[] = [];
  const summary = emptySummary();
  const seen = new Set<string>();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  summary.physicalLines =
    lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  lines.forEach((line, index) => {
    if (index === lines.length - 1 && line === "") return;
    const sourceRowNumber = index + 1;
    const parsed = parse407ExpDataLine(line, sourceRowNumber);
    if ("skip" in parsed) {
      if (parsed.skip === "banner") summary.pageBanners += 1;
      if (parsed.skip === "header") summary.repeatedHeaders += 1;
      return;
    }
    if ("reject" in parsed) {
      summary.rejectedRows += 1;
      issues.push(parsed.reject);
      return;
    }
    summary.dataRows += 1;
    if (parsed.row.nameTruncated) summary.truncatedNames += 1;
    if (!parsed.row.areaCode) summary.blankArea += 1;
    if (!parsed.row.repCode) summary.blankRep += 1;
    if (seen.has(parsed.row.accountCode)) {
      summary.duplicateAccounts += 1;
      issues.push({
        sourceRowNumber,
        sourceRecordId: parsed.row.accountCode,
        issueType: "DUPLICATE_ACCOUNT",
        severity: "WARNING",
        explanation: `Account ${parsed.row.accountCode} is repeated in this 407EXP file. The first row is kept.`,
      });
      return;
    }
    seen.add(parsed.row.accountCode);
    summary.distinctAccounts += 1;
    summary.classifications[parsed.row.classification] += 1;
    rows.push(parsed.row);
  });
  return { rows, issues, summary };
}

function emptySummary(): Exp407Summary {
  return {
    physicalLines: 0,
    pageBanners: 0,
    repeatedHeaders: 0,
    dataRows: 0,
    distinctAccounts: 0,
    duplicateAccounts: 0,
    blankArea: 0,
    blankRep: 0,
    truncatedNames: 0,
    rejectedRows: 0,
    classifications: EMPTY_CLASSIFICATIONS(),
  };
}
