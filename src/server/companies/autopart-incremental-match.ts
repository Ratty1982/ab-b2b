/**
 * Incremental 561L / SLRB matching.
 *
 * Source identity is the only confident match. It is the existing production
 * contract: sha256 of the natural key plus the occurrence counted inside each
 * 200-row write. Account + Inv & Ln is not a product line. Account + type +
 * reference + date is not a ledger transaction.
 *
 * A different part on an existing reference is a new line. The same part with a
 * different quantity or amount is a financial conflict. The same commercial
 * values without the stored source identity are ambiguous. Conflicts and
 * ambiguous rows are quarantined and block the import before any write.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { CsvScanRecord, CanonicalColumn } from "@/domain/autopart-bulk-csv";
import { interpretInvoiceRecord, interpretLedgerRecord } from "@/domain/autopart-bulk-csv";

export const FINANCIAL_IMPORT_CHUNK = 200;

export const INCREMENTAL_MATCHING_RULE =
  "A row matches an existing record only when its source identity matches. Account and Inv & Ln do not identify a 561L product line. Account, type, reference, and date do not identify an SLRB transaction. Financial conflicts and ambiguous rows are quarantined and block the import before any write.";

export type MatchDecision = "NEW" | "IDENTICAL" | "AMBIGUOUS" | "FINANCIAL_CONFLICT";

export type IncrementalExample = {
  classification: MatchDecision;
  rowNumber: number;
  accountCode: string;
  reference: string;
  partNumber: string | null;
  explanation: string;
};

export type IncrementalMatchReport = {
  newRecords: number;
  identicalRecords: number;
  ambiguousRecords: number;
  financialConflicts: number;
  rejectedRecords: number;
  /** Change that will be written. Zero when the file is blocked. */
  expectedStoredTotalChange: string;
  /** Sum of rows classified as new, including when the file is blocked and that sum is not written. */
  classifiedNewAmount: string;
  totalMeasure: "NET_EX_VAT" | "LEDGER_GOODS";
  canCommit: boolean;
  blockedReason: string | null;
  matchingRule: string;
  examples: IncrementalExample[];
};

type MoneyValue = Prisma.Decimal | string | null | undefined;

export function sourceIdentity(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001e")).digest("hex");
}

export function decimalSame(left: MoneyValue, right: MoneyValue): boolean {
  const a = left == null || left === "" ? null : new Prisma.Decimal(left);
  const b = right == null || right === "" ? null : new Prisma.Decimal(right);
  if (a == null || b == null) return a == null && b == null;
  return a.equals(b);
}

export function ledgerDateKey(value: Date | string | null | undefined): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export type PreparedInvoiceLine = {
  sourceIdentity: string;
  accountCode: string;
  rawInvAndLn: string;
  documentReference: string | null;
  documentType: string;
  sourceLineNumber: number | null;
  partNumber: string;
  description: string | null;
  quantity: string;
  salesAmount: string;
  salesMeasure: "NET_EX_VAT";
  rawSource: Record<string, string>;
  parseIssue: string | null;
  rowNumber: number;
};

export type PreparedLedgerLine = {
  sourceIdentity: string;
  accountCode: string;
  rawType: string;
  ledgerKind: "INVOICE" | "CREDIT" | "PAYMENT" | "JOURNAL" | "UNKNOWN";
  reference: string;
  transactionDate: string | null;
  goodsAmount: string | null;
  vatAmount: string | null;
  totalAmount: string | null;
  runningBalance: string | null;
  originalName: string | null;
  sacct: string | null;
  rawSource: Record<string, string>;
  parseIssue: string | null;
  rowNumber: number;
};

export type PrepareWarning = {
  rowNumber: number;
  sourceRecordId: string;
  issueType: string;
  explanation: string;
};

type Rejection = {
  rowNumber: number;
  sourceRecordId: string | null;
  issueType: string;
  explanation: string;
  raw: string;
};

function blockedReason(financialConflicts: number, ambiguousRecords: number): string | null {
  if (financialConflicts === 0 && ambiguousRecords === 0) return null;
  return `Import blocked: ${financialConflicts} financial conflicts and ${ambiguousRecords} ambiguous records. No stored amounts, quantities, or ledger totals were changed.`;
}

function finishReport(input: {
  counts: Record<MatchDecision, number>;
  rejectedRecords: number;
  classifiedNew: Prisma.Decimal;
  totalMeasure: IncrementalMatchReport["totalMeasure"];
  examples: IncrementalExample[];
}): IncrementalMatchReport {
  const financialConflicts = input.counts.FINANCIAL_CONFLICT;
  const ambiguousRecords = input.counts.AMBIGUOUS;
  const reason = blockedReason(financialConflicts, ambiguousRecords);
  const hasWritable = input.counts.NEW + input.counts.IDENTICAL > 0;
  const canCommit = reason == null && hasWritable;
  const classifiedNewAmount = input.classifiedNew.toFixed(2);
  return {
    newRecords: input.counts.NEW,
    identicalRecords: input.counts.IDENTICAL,
    ambiguousRecords,
    financialConflicts,
    rejectedRecords: input.rejectedRecords,
    expectedStoredTotalChange: canCommit ? classifiedNewAmount : "0.00",
    classifiedNewAmount,
    totalMeasure: input.totalMeasure,
    canCommit,
    blockedReason: reason,
    matchingRule: INCREMENTAL_MATCHING_RULE,
    examples: input.examples,
  };
}

export function prepareInvoiceChunk(
  headers: string[],
  map: Partial<Record<CanonicalColumn, number>>,
  records: CsvScanRecord[],
): { lines: PreparedInvoiceLine[]; rejections: Rejection[]; warnings: PrepareWarning[] } {
  const occurrences = new Map<string, number>();
  const lines: PreparedInvoiceLine[] = [];
  const rejections: Rejection[] = [];
  const warnings: PrepareWarning[] = [];
  for (const record of records) {
    const interpreted = interpretInvoiceRecord(record, headers, map);
    if ("reject" in interpreted) {
      rejections.push(interpreted.reject);
      continue;
    }
    const row = interpreted.row;
    const natural = [
      row.accountCode,
      row.rawInvAndLn,
      row.partNumber,
      row.quantity,
      row.salesAmount,
    ].join("\u001e");
    const occurrence = (occurrences.get(natural) ?? 0) + 1;
    occurrences.set(natural, occurrence);
    lines.push({
      sourceIdentity: sourceIdentity([natural, String(occurrence)]),
      accountCode: row.accountCode,
      rawInvAndLn: row.rawInvAndLn,
      documentReference: row.documentReference,
      documentType: row.documentType,
      sourceLineNumber: row.sourceLineNumber,
      partNumber: row.partNumber,
      description: row.description,
      quantity: row.quantity,
      salesAmount: row.salesAmount,
      salesMeasure: row.salesMeasure,
      rawSource: row.raw,
      parseIssue: row.parseIssue,
      rowNumber: row.rowNumber,
    });
    if (row.parseIssue) {
      warnings.push({
        rowNumber: row.rowNumber,
        sourceRecordId: `${row.accountCode}:${row.rawInvAndLn}`,
        issueType: "MALFORMED_REFERENCE",
        explanation: row.parseIssue,
      });
    }
  }
  return { lines, rejections, warnings };
}

export function prepareLedgerChunk(
  headers: string[],
  map: Partial<Record<CanonicalColumn, number>>,
  records: CsvScanRecord[],
): { lines: PreparedLedgerLine[]; rejections: Rejection[]; warnings: PrepareWarning[] } {
  const occurrences = new Map<string, number>();
  const lines: PreparedLedgerLine[] = [];
  const rejections: Rejection[] = [];
  const warnings: PrepareWarning[] = [];
  for (const record of records) {
    const interpreted = interpretLedgerRecord(record, headers, map);
    if ("reject" in interpreted) {
      rejections.push(interpreted.reject);
      continue;
    }
    const row = interpreted.row;
    const natural = [
      row.accountCode,
      row.rawType,
      row.reference,
      row.transactionDate ?? "",
      row.goodsAmount ?? "",
      row.vatAmount ?? "",
      row.totalAmount ?? "",
      row.runningBalance ?? "",
    ].join("\u001e");
    const occurrence = (occurrences.get(natural) ?? 0) + 1;
    occurrences.set(natural, occurrence);
    lines.push({
      sourceIdentity: sourceIdentity([natural, String(occurrence)]),
      accountCode: row.accountCode,
      rawType: row.rawType,
      ledgerKind: row.ledgerKind,
      reference: row.reference,
      transactionDate: row.transactionDate,
      goodsAmount: row.goodsAmount,
      vatAmount: row.vatAmount,
      totalAmount: row.totalAmount,
      runningBalance: row.runningBalance,
      originalName: row.originalName,
      sacct: row.sacct,
      rawSource: row.raw,
      parseIssue: row.parseIssue,
      rowNumber: row.rowNumber,
    });
    if (row.parseIssue) {
      warnings.push({
        rowNumber: row.rowNumber,
        sourceRecordId: `${row.accountCode}:${row.reference}`,
        issueType: row.ledgerKind === "UNKNOWN" ? "UNKNOWN_TRANSACTION_TYPE" : "INVALID_DATE",
        explanation: row.parseIssue,
      });
    }
  }
  return { lines, rejections, warnings };
}

export type StoredInvoiceCandidate = {
  sourceIdentity: string;
  accountCode: string;
  rawInvAndLn: string;
  partNumber: string;
  quantity: MoneyValue;
  salesAmount: MoneyValue;
};

export type StoredLedgerCandidate = {
  sourceIdentity: string;
  accountCode: string;
  rawType: string;
  reference: string;
  transactionDate: Date | string | null;
  goodsAmount: MoneyValue;
  vatAmount: MoneyValue;
  totalAmount: MoneyValue;
  runningBalance: MoneyValue;
};

function invoicePartKey(row: {
  accountCode: string;
  rawInvAndLn: string;
  partNumber: string;
}): string {
  return [row.accountCode, row.rawInvAndLn, row.partNumber].join("\u001e");
}

function ledgerWeakKey(row: {
  accountCode: string;
  rawType: string;
  reference: string;
  transactionDate?: Date | string | null;
}): string {
  return [row.accountCode, row.rawType, row.reference, ledgerDateKey(row.transactionDate)].join(
    "\u001e",
  );
}

function classifyByCandidates(input: {
  sourceIdentity: string;
  storedIdentities: ReadonlySet<string>;
  seenInFile: ReadonlySet<string>;
  candidateCount: number;
  sameMoneyCount: number;
  conflictExplanation: string;
  ambiguousExplanation: string;
}): { decision: MatchDecision; explanation: string } {
  if (input.storedIdentities.has(input.sourceIdentity)) {
    return {
      decision: "IDENTICAL",
      explanation:
        "Source identity already exists. Stored quantity and financial amounts stay unchanged.",
    };
  }
  if (input.seenInFile.has(input.sourceIdentity)) {
    return {
      decision: "IDENTICAL",
      explanation:
        "This source identity repeats an earlier row in this file. The repeated row does not add a second stored line.",
    };
  }
  if (input.candidateCount === 0) {
    return { decision: "NEW", explanation: "No stored row has this source identity." };
  }
  if (input.sameMoneyCount === 0) {
    return { decision: "FINANCIAL_CONFLICT", explanation: input.conflictExplanation };
  }
  return { decision: "AMBIGUOUS", explanation: input.ambiguousExplanation };
}

const INVOICE_CONFLICT =
  "The same account, invoice reference, and part already exist with a different quantity or sales amount. The stored values were kept and this row was not written.";
const INVOICE_AMBIGUOUS =
  "The account, invoice reference, and part match stored lines, but the source identity does not. The row was quarantined and no stored line was changed.";
const LEDGER_CONFLICT =
  "The same account, type, reference, and date already exist with different goods, VAT, total, or running balance. The stored values were kept and this row was not written.";
const LEDGER_AMBIGUOUS =
  "The account, type, reference, and date match stored ledger rows, but the source identity does not. The row was quarantined and no stored transaction was changed.";

export function analysePreparedInvoices(
  lines: PreparedInvoiceLine[],
  rejectedRecords: number,
  stored: StoredInvoiceCandidate[],
): IncrementalMatchReport {
  const storedIdentities = new Set(stored.map((row) => row.sourceIdentity));
  const seenInFile = new Set<string>();
  const byPart = new Map<string, StoredInvoiceCandidate[]>();
  for (const row of stored) {
    const key = invoicePartKey(row);
    const list = byPart.get(key);
    if (list) list.push(row);
    else byPart.set(key, [row]);
  }
  const counts: Record<MatchDecision, number> = {
    NEW: 0,
    IDENTICAL: 0,
    AMBIGUOUS: 0,
    FINANCIAL_CONFLICT: 0,
  };
  let classifiedNew = new Prisma.Decimal(0);
  const examples: IncrementalExample[] = [];
  const exampleCap: Record<MatchDecision, number> = {
    NEW: 0,
    IDENTICAL: 0,
    AMBIGUOUS: 0,
    FINANCIAL_CONFLICT: 0,
  };
  for (const line of lines) {
    const candidates = byPart.get(invoicePartKey(line)) ?? [];
    const sameMoney = candidates.filter(
      (candidate) =>
        decimalSame(candidate.quantity, line.quantity) &&
        decimalSame(candidate.salesAmount, line.salesAmount),
    ).length;
    const result = classifyByCandidates({
      sourceIdentity: line.sourceIdentity,
      storedIdentities,
      seenInFile,
      candidateCount: candidates.length,
      sameMoneyCount: sameMoney,
      conflictExplanation: INVOICE_CONFLICT,
      ambiguousExplanation: INVOICE_AMBIGUOUS,
    });
    counts[result.decision] += 1;
    if (result.decision === "NEW") classifiedNew = classifiedNew.plus(line.salesAmount);
    if (result.decision === "NEW" || result.decision === "IDENTICAL") {
      seenInFile.add(line.sourceIdentity);
    }
    const seen = exampleCap[result.decision];
    if (seen < 8) {
      exampleCap[result.decision] = seen + 1;
      examples.push({
        classification: result.decision,
        rowNumber: line.rowNumber,
        accountCode: line.accountCode,
        reference: line.rawInvAndLn,
        partNumber: line.partNumber,
        explanation: result.explanation,
      });
    }
  }
  return finishReport({
    counts,
    rejectedRecords,
    classifiedNew,
    totalMeasure: "NET_EX_VAT",
    examples,
  });
}

function ledgerMoneySame(candidate: StoredLedgerCandidate, line: PreparedLedgerLine): boolean {
  return (
    decimalSame(candidate.goodsAmount, line.goodsAmount) &&
    decimalSame(candidate.vatAmount, line.vatAmount) &&
    decimalSame(candidate.totalAmount, line.totalAmount) &&
    decimalSame(candidate.runningBalance, line.runningBalance)
  );
}

export function analysePreparedLedger(
  lines: PreparedLedgerLine[],
  rejectedRecords: number,
  stored: StoredLedgerCandidate[],
): IncrementalMatchReport {
  const storedIdentities = new Set(stored.map((row) => row.sourceIdentity));
  const seenInFile = new Set<string>();
  const byKey = new Map<string, StoredLedgerCandidate[]>();
  for (const row of stored) {
    const key = ledgerWeakKey(row);
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  const counts: Record<MatchDecision, number> = {
    NEW: 0,
    IDENTICAL: 0,
    AMBIGUOUS: 0,
    FINANCIAL_CONFLICT: 0,
  };
  let classifiedNew = new Prisma.Decimal(0);
  const examples: IncrementalExample[] = [];
  const exampleCap: Record<MatchDecision, number> = {
    NEW: 0,
    IDENTICAL: 0,
    AMBIGUOUS: 0,
    FINANCIAL_CONFLICT: 0,
  };
  for (const line of lines) {
    const candidates = byKey.get(ledgerWeakKey(line)) ?? [];
    const sameMoney = candidates.filter((candidate) => ledgerMoneySame(candidate, line)).length;
    const result = classifyByCandidates({
      sourceIdentity: line.sourceIdentity,
      storedIdentities,
      seenInFile,
      candidateCount: candidates.length,
      sameMoneyCount: sameMoney,
      conflictExplanation: LEDGER_CONFLICT,
      ambiguousExplanation: LEDGER_AMBIGUOUS,
    });
    counts[result.decision] += 1;
    if (result.decision === "NEW" && line.goodsAmount) {
      classifiedNew = classifiedNew.plus(line.goodsAmount);
    }
    if (result.decision === "NEW" || result.decision === "IDENTICAL") {
      seenInFile.add(line.sourceIdentity);
    }
    const seen = exampleCap[result.decision];
    if (seen < 8) {
      exampleCap[result.decision] = seen + 1;
      examples.push({
        classification: result.decision,
        rowNumber: line.rowNumber,
        accountCode: line.accountCode,
        reference: line.reference,
        partNumber: null,
        explanation: result.explanation,
      });
    }
  }
  return finishReport({
    counts,
    rejectedRecords,
    classifiedNew,
    totalMeasure: "LEDGER_GOODS",
    examples,
  });
}
