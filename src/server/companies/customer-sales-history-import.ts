/**
 * Import Sales History for one Active customer.
 * 561L supplies product lines. SLRB supplies document and ledger evidence.
 * The retired global historical importer is not used.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireCompanyAccess, requireSystemPermission } from "@/server/rbac/guards";
import { grants } from "@/server/rbac/access";
import { parseAutopart561l } from "@/domain/autopart-561l";
import { parseAutopartSlrb } from "@/domain/autopart-slrb";
import {
  historicalDocumentIsSale,
  historicalProductLineIdentity,
  historicalProductLineLookupFingerprints,
  signedHistoricalMeasure,
  type HistoricalDocumentType,
} from "@/domain/customer-sales-history";
import { classifyCustomerSalesReport } from "@/domain/customer-sales-import";
import { PRELAUNCH_HISTORY_DISCARDED } from "@/domain/imported-sales-reset";
import {
  foreignAutopartClaims,
  resolveAutopartCodeOwnership,
} from "@/server/companies/autopart-account-verification";

const MAX_REPORT_CHARS = 8_000_000;
const PREVIEW_ROW_LIMIT = 100;

export type CustomerSalesHistoryRow = {
  document: string;
  type: string;
  date: string | null;
  account: string;
  amount: string | null;
  sku: string | null;
  quantity: string | null;
  disposition: "import" | "duplicate" | "ledger" | "rejected";
  reason: string;
  fingerprint?: string;
};

export type CustomerSalesHistoryCounts = {
  import: number;
  productLines: number;
  supportingDocuments: number;
  duplicate: number;
  ledger: number;
  rejected: number;
  failed: number;
};

export type CustomerSalesHistoryPreview = {
  canCommit: boolean;
  companyId: string;
  companyName: string;
  accountCodes: string[];
  message: string | null;
  counts: CustomerSalesHistoryCounts;
  rejectionGroups: Array<{ reason: string; count: number }>;
  rows: CustomerSalesHistoryRow[];
  rejectedExamples: CustomerSalesHistoryRow[];
  rejectedTotal: number;
  rejectedPage: number;
  rejectedPages: number;
  dateFrom: string | null;
  dateTo: string | null;
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
  completion: "COMPLETE" | "REVIEW";
};

export type HistoryTarget = {
  companyId: string;
  companyName: string;
  codes: string[];
};

export async function requireHistoryImporter(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!grants(profile, "admin.access", "orders.edit")) {
    throw new AuthError("Not permitted to import customer sales history", "FORBIDDEN", 403);
  }
  return profile;
}

/** Importer role plus access to this specific customer. */
export async function requireHistoryImporterForCompany(userId: string, companyId: string) {
  await requireHistoryImporter(userId);
  await requireCompanyAccess(userId, companyId);
}

export async function loadCustomerSalesHistoryTarget(companyId: string): Promise<HistoryTarget> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      status: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      autopartAccountAliases: { select: { alias: true } },
    },
  });
  if (!company) throw new AuthError("Customer not found", "NOT_FOUND", 404);
  if (company.status !== "ACTIVE") {
    throw new AuthError("Import Sales History is available only for an Active customer.", "VALIDATION", 400);
  }
  if (!company.autopartCustomerCode || !company.autopartCustomerCodeVerifiedAt) {
    throw new AuthError(
      "Verify a unique Autopart account before importing this customer's sales history.",
      "VALIDATION",
      400,
    );
  }
  const primary = await resolveAutopartCodeOwnership(company.autopartCustomerCode);
  if (primary.companyId !== company.id || primary.authority !== "verified-code") {
    throw new AuthError(
      "This customer's Autopart account is not uniquely verified.",
      "VALIDATION",
      400,
    );
  }
  if ((await foreignAutopartClaims(company.autopartCustomerCode, company.id)).length > 0) {
    throw new AuthError(
      "This Autopart account is also held by another customer.",
      "VALIDATION",
      400,
    );
  }
  const codes = [company.autopartCustomerCode.trim().toUpperCase()];
  for (const alias of company.autopartAccountAliases) {
    const key = alias.alias.trim().toUpperCase();
    const ownership = await resolveAutopartCodeOwnership(key);
    if (ownership.companyId !== company.id || ownership.authority !== "verified-alias") {
      throw new AuthError(`Alias ${key} is not uniquely verified for this customer.`, "VALIDATION", 400);
    }
    if ((await foreignAutopartClaims(key, company.id)).length > 0) {
      throw new AuthError(`Alias ${key} is also held by another customer.`, "VALIDATION", 400);
    }
    codes.push(key);
  }
  return { companyId: company.id, companyName: company.name, codes };
}

function emptyCounts(): CustomerSalesHistoryCounts {
  return { import: 0, productLines: 0, supportingDocuments: 0, duplicate: 0, ledger: 0, rejected: 0, failed: 0 };
}

function moneyKey(value: { toString(): string } | string | null | undefined, scale: 2 | 3): string | null {
  if (value == null || value === "") return null;
  const amount = Number(value.toString());
  if (!Number.isFinite(amount)) return null;
  return amount.toFixed(scale);
}

function pushRow(
  rows: CustomerSalesHistoryRow[],
  counts: CustomerSalesHistoryPreview["counts"],
  row: CustomerSalesHistoryRow,
  sampleLimit = PREVIEW_ROW_LIMIT,
) {
  counts[row.disposition] += 1;
  if (rows.length < sampleLimit) rows.push(row);
}

function utcNoon(dateOnly: string | null): Date | null {
  if (!dateOnly) return null;
  return new Date(`${dateOnly}T12:00:00.000Z`);
}

function hashText(text: string | undefined): string | null {
  if (!text) return null;
  return createHash("sha256").update(text).digest("hex");
}

type PlannedDocument = {
  account: string;
  documentType: HistoricalDocumentType;
  documentReference: string;
  documentDate: string | null;
  goodsNet: string | null;
  vat: string | null;
  grossTotal: string | null;
  source: "SLRB" | "561L";
  duplicate: boolean;
  valueConflict: boolean;
};

type PlannedLine = {
  account: string;
  documentType: HistoricalDocumentType;
  documentReference: string;
  lineNumber: number;
  sku: string;
  description: string | null;
  units: string;
  salesNet: string;
  rawInvAndLn: string | null;
  fingerprint: string;
  duplicate: boolean;
  valueConflict: boolean;
};

export type PlannedCustomerSalesHistory = {
  documents: PlannedDocument[];
  lines: PlannedLine[];
  rows: CustomerSalesHistoryRow[];
  rejectedRows: CustomerSalesHistoryRow[];
  counts: CustomerSalesHistoryCounts;
  rejectionGroups: Array<{ reason: string; count: number }>;
  dates: string[];
};

function planHistory(input: {
  text561l?: string;
  textSlrb?: string;
  codes: string[];
  sampleLimit?: number;
}): PlannedCustomerSalesHistory {
  const sampleLimit = input.sampleLimit ?? PREVIEW_ROW_LIMIT;
  const authorised = new Set(input.codes.map((code) => code.toUpperCase()));
  const documents = new Map<string, PlannedDocument>();
  const lines: PlannedLine[] = [];
  const rows: CustomerSalesHistoryRow[] = [];
  const rejectedRows: CustomerSalesHistoryRow[] = [];
  const rejectionGroups = new Map<string, number>();
  const counts = emptyCounts();
  const remember = (row: CustomerSalesHistoryRow) => {
    counts[row.disposition] += 1;
    if (row.disposition === "import") {
      if (row.sku) counts.productLines += 1;
      else counts.supportingDocuments += 1;
    }
    if (row.disposition === "rejected") {
      rejectionGroups.set(row.reason, (rejectionGroups.get(row.reason) ?? 0) + 1);
      rejectedRows.push(row);
    }
    if (rows.length < sampleLimit) rows.push(row);
  };
  const dates: string[] = [];
  const lineKeys = new Set<string>();
  const skuOrdinal = new Map<string, number>();
  const usedLineNumbers = new Map<string, Set<number>>();

  function takeLineNumber(docKey: string, preferred: number | null): number {
    const used = usedLineNumbers.get(docKey) ?? new Set<number>();
    usedLineNumbers.set(docKey, used);
    if (preferred && preferred > 0 && !used.has(preferred)) {
      used.add(preferred);
      return preferred;
    }
    let next = 1;
    while (used.has(next)) next += 1;
    used.add(next);
    return next;
  }

  if (input.textSlrb?.trim()) {
    const parsed = parseAutopartSlrb(input.textSlrb);
    for (const row of parsed.rows) {
      if (row.classification !== "MALFORMED") continue;
      remember({
        document: row.documentReference ?? "",
        type: row.documentType,
        date: row.documentDate,
        account: row.accountCode ?? "",
        amount: row.grossTotal ?? row.goodsNet,
        sku: null,
        quantity: null,
        disposition: "rejected",
        reason: row.issue ?? "Ledger row could not be read.",
      });
    }
    for (const row of parsed.rows) {
      if (
        (row.classification !== "DOCUMENT" && row.classification !== "LEDGER") ||
        !row.documentReference ||
        !row.accountCode
      ) {
        continue;
      }
      const account = row.accountCode.trim().toUpperCase();
      const documentType = row.documentType;
      if (!authorised.has(account)) {
        remember({
          document: row.documentReference,
          type: documentType,
          date: row.documentDate,
          account,
          amount: row.grossTotal ?? row.goodsNet,
          sku: null,
          quantity: null,
          disposition: "rejected",
          reason: "Account is not a verified code or alias for this customer.",
        });
        continue;
      }
      const sale = historicalDocumentIsSale(documentType);
      const key = `${documentType}|${row.documentReference}`;
      if (documents.has(key) || lineKeys.has(`doc|${key}`)) {
        remember({
          document: row.documentReference,
          type: documentType,
          date: row.documentDate,
          account,
          amount: sale ? signedHistoricalMeasure(documentType, row.goodsNet, 2) : row.grossTotal,
          sku: null,
          quantity: null,
          disposition: "duplicate",
          reason: "This document is already in the selected reports.",
        });
        continue;
      }
      documents.set(key, {
        account,
        documentType,
        documentReference: row.documentReference,
        documentDate: row.documentDate,
        goodsNet: sale ? signedHistoricalMeasure(documentType, row.goodsNet, 2) : null,
        vat: sale ? signedHistoricalMeasure(documentType, row.vat, 2) : null,
        grossTotal: sale ? signedHistoricalMeasure(documentType, row.grossTotal, 2) : row.grossTotal,
        source: "SLRB",
        duplicate: false,
        valueConflict: false,
      });
      lineKeys.add(`doc|${key}`);
      if (row.documentDate) dates.push(row.documentDate);
      remember({
        document: row.documentReference,
        type: documentType,
        date: row.documentDate,
        account,
        amount: sale ? signedHistoricalMeasure(documentType, row.goodsNet, 2) : row.grossTotal,
        sku: null,
        quantity: null,
        disposition: sale ? "import" : "ledger",
        reason: sale
          ? "SLRB document evidence. Product lines come from 561L and are not added again here."
          : "Ledger record. It is not counted as a product sale.",
      });
    }
  }

  if (input.text561l?.trim()) {
    const parsed = parseAutopart561l(input.text561l);
    for (const row of parsed.rows) {
      if (row.classification !== "MALFORMED") continue;
      remember({
        document: row.documentReference ?? "",
        type: row.documentType,
        date: null,
        account: row.accountCode ?? "",
        amount: row.salesNet,
        sku: row.partNumber,
        quantity: row.units == null ? null : String(row.units),
        disposition: "rejected",
        reason: row.issue ?? "Product line could not be read.",
      });
    }
    for (const row of parsed.lines) {
      if (row.classification !== "LINE" || !row.documentReference || !row.accountCode || !row.partNumber) {
        if (row.classification === "MALFORMED" || row.issue) {
          remember({
            document: row.documentReference ?? "",
            type: row.documentType,
            date: null,
            account: row.accountCode ?? "",
            amount: row.salesNet,
            sku: row.partNumber,
            quantity: row.units == null ? null : String(row.units),
            disposition: "rejected",
            reason: row.issue ?? "Product line could not be read.",
          });
        }
        continue;
      }
      const account = row.accountCode.trim().toUpperCase();
      const documentType = row.documentType;
      if (!authorised.has(account)) {
        remember({
          document: row.documentReference,
          type: documentType,
          date: null,
          account,
          amount: row.salesNet,
          sku: row.partNumber,
          quantity: row.units == null ? null : String(row.units),
          disposition: "rejected",
          reason: "Account is not a verified code or alias for this customer.",
        });
        continue;
      }
      const units = signedHistoricalMeasure(documentType, row.units == null ? null : String(row.units), 3);
      const salesNet = signedHistoricalMeasure(documentType, row.salesNet, 2);
      // Zero is valid. Only reject when quantity or sales could not be read.
      if (units == null || salesNet == null) {
        remember({
          document: row.documentReference,
          type: documentType,
          date: null,
          account,
          amount: row.salesNet,
          sku: row.partNumber,
          quantity: row.units == null ? null : String(row.units),
          disposition: "rejected",
          reason:
            units == null
              ? row.units == null
                ? "Invalid units: (blank)"
                : `Invalid units: ${JSON.stringify(String(row.units))}`
              : "Quantity or sales amount is missing.",
        });
        continue;
      }
      const docKey = `${documentType}|${row.documentReference}`;
      const ordinalKey = `${docKey}|${row.partNumber.toUpperCase()}`;
      const hasSourceLine = row.sourceLineNumber != null && row.sourceLineNumber > 0;
      const ordinal = hasSourceLine ? 0 : (skuOrdinal.get(ordinalKey) ?? 0) + 1;
      if (!hasSourceLine) skuOrdinal.set(ordinalKey, ordinal);
      const identity = historicalProductLineIdentity({
        documentType,
        documentReference: row.documentReference,
        sku: row.partNumber,
        sourceLineNumber: hasSourceLine ? row.sourceLineNumber : null,
        rawInvAndLn: row.rawInvAndLn,
        skuOrdinal: ordinal,
        units,
        salesNet,
      });
      if (lineKeys.has(identity.fingerprint)) {
        remember({
          document: row.documentReference,
          type: documentType,
          date: null,
          account,
          amount: salesNet,
          sku: row.partNumber,
          quantity: units,
          disposition: "duplicate",
          reason: "This source line is already in the selected report.",
          fingerprint: identity.fingerprint,
        });
        continue;
      }
      const lineNumber = takeLineNumber(docKey, identity.lineNumber);
      if (!documents.has(docKey)) {
        documents.set(docKey, {
          account,
          documentType,
          documentReference: row.documentReference,
          documentDate: null,
          goodsNet: null,
          vat: null,
          grossTotal: null,
          source: "561L",
          duplicate: false,
          valueConflict: false,
        });
      }
      lines.push({
        account,
        documentType,
        documentReference: row.documentReference,
        lineNumber,
        sku: row.partNumber,
        description: row.description,
        units,
        salesNet,
        rawInvAndLn: row.rawInvAndLn || null,
        fingerprint: identity.fingerprint,
        duplicate: false,
        valueConflict: false,
      });
      lineKeys.add(identity.fingerprint);
      remember({
        document: row.documentReference,
        type: documentType,
        date: null,
        account,
        amount: salesNet,
        sku: row.partNumber,
        quantity: units,
        disposition: "import",
        reason: "561L product-sales evidence.",
        fingerprint: identity.fingerprint,
      });
    }
  }

  return {
    documents: [...documents.values()],
    lines,
    rows,
    rejectedRows,
    counts,
    rejectionGroups: [...rejectionGroups.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
    dates,
  };
}

const STORED_LOOKUP_CHUNK = 2_500;

function valuesConflict(
  stored: { toString(): string } | null | undefined,
  incoming: string | null,
  scale: 2 | 3,
): boolean {
  const left = moneyKey(stored, scale);
  const right = moneyKey(incoming, scale);
  return left != null && right != null && left !== right;
}

function sameCalendarDay(stored: Date | null | undefined, incoming: string | null): boolean {
  if (!stored || !incoming) return true;
  return stored.toISOString().slice(0, 10) === incoming;
}

async function loadStoredHistory(companyId: string, refs: string[]) {
  const storedDocs: {
    documentType: string;
    documentReference: string;
    documentDate: Date | null;
    goodsNet: { toString(): string } | null;
    vat: { toString(): string } | null;
    grossTotal: { toString(): string } | null;
  }[] = [];
  const storedLines: {
    documentType: string;
    documentReference: string;
    lineNumber: number;
    sourceFingerprint: string | null;
    units: { toString(): string };
    salesNet: { toString(): string };
  }[] = [];
  for (let index = 0; index < refs.length; index += STORED_LOOKUP_CHUNK) {
    const chunk = refs.slice(index, index + STORED_LOOKUP_CHUNK);
    storedDocs.push(
      ...(await prisma.autopartSalesDocument.findMany({
        where: { companyId, documentReference: { in: chunk } },
        select: {
          documentType: true,
          documentReference: true,
          documentDate: true,
          goodsNet: true,
          vat: true,
          grossTotal: true,
        },
      })),
    );
    storedLines.push(
      ...(await prisma.autopartSalesLine.findMany({
        where: { companyId, documentReference: { in: chunk } },
        select: {
          documentType: true,
          documentReference: true,
          lineNumber: true,
          sourceFingerprint: true,
          units: true,
          salesNet: true,
        },
      })),
    );
  }
  return { storedDocs, storedLines };
}

async function markExisting(target: HistoryTarget, planned: PlannedCustomerSalesHistory) {
  const refs = [...new Set(planned.documents.map((doc) => doc.documentReference))];
  const { storedDocs, storedLines } = refs.length
    ? await loadStoredHistory(target.companyId, refs)
    : { storedDocs: [], storedLines: [] };
  const docByKey = new Map(storedDocs.map((doc) => [`${doc.documentType}|${doc.documentReference}`, doc]));
  const lineByFingerprint = new Map(
    storedLines
      .filter((line) => line.sourceFingerprint)
      .map((line) => [line.sourceFingerprint as string, line]),
  );
  const lineByNumber = new Map(
    storedLines.map((line) => [`${line.documentType}|${line.documentReference}|${line.lineNumber}`, line]),
  );
  const duplicateFingerprints = new Set<string>();
  const conflictFingerprints = new Set<string>();
  const duplicateDocs = new Set<string>();
  const conflictDocs = new Set<string>();

  for (const line of planned.lines) {
    const docKey = `${line.documentType}|${line.documentReference}`;
    // Exact fingerprint first; legacy ln: only when measures match (shared /N must not
    // collapse distinct SKUs onto the one line stored under the old key).
    let stored = lineByFingerprint.get(line.fingerprint);
    if (!stored) {
      for (const key of historicalProductLineLookupFingerprints(line.fingerprint)) {
        if (key === line.fingerprint) continue;
        const candidate = lineByFingerprint.get(key);
        if (
          candidate &&
          !valuesConflict(candidate.units, line.units, 3) &&
          !valuesConflict(candidate.salesNet, line.salesNet, 2)
        ) {
          stored = candidate;
          break;
        }
      }
    }
    if (!stored) stored = lineByNumber.get(`${docKey}|${line.lineNumber}`);
    if (!stored) continue;
    line.duplicate = true;
    planned.counts.import -= 1;
    planned.counts.productLines -= 1;
    planned.counts.duplicate += 1;
    duplicateFingerprints.add(line.fingerprint);
    const conflict =
      valuesConflict(stored.units, line.units, 3) || valuesConflict(stored.salesNet, line.salesNet, 2);
    if (conflict) {
      line.valueConflict = true;
      planned.counts.failed += 1;
      conflictFingerprints.add(line.fingerprint);
    }
  }
  for (const doc of planned.documents) {
    const key = `${doc.documentType}|${doc.documentReference}`;
    const stored = docByKey.get(key);
    if (!stored) continue;
    doc.duplicate = true;
    if (doc.source !== "SLRB") continue;
    const sale = historicalDocumentIsSale(doc.documentType);
    planned.counts[sale ? "import" : "ledger"] -= 1;
    planned.counts.duplicate += 1;
    if (sale) planned.counts.supportingDocuments -= 1;
    duplicateDocs.add(key);
    const conflict =
      !sameCalendarDay(stored.documentDate, doc.documentDate) ||
      valuesConflict(stored.goodsNet, doc.goodsNet, 2) ||
      valuesConflict(stored.vat, doc.vat, 2) ||
      valuesConflict(stored.grossTotal, doc.grossTotal, 2);
    if (conflict) {
      doc.valueConflict = true;
      planned.counts.failed += 1;
      conflictDocs.add(key);
    }
  }
  for (const row of planned.rows) {
    if (row.disposition !== "import" && row.disposition !== "ledger") continue;
    const docKey = `${row.type}|${row.document}`;
    const fingerprintKeys = row.fingerprint
      ? historicalProductLineLookupFingerprints(row.fingerprint)
      : [];
    // ln: keys uniquely identified a stored lineNumber. row: keys share Autopart
    // source lines across SKUs, so only fingerprint membership is safe there.
    const lineNumber =
      row.fingerprint?.startsWith("ln:") ? Number(row.fingerprint.split("|").pop()) : null;
    const sameLine = lineNumber != null && lineByNumber.has(`${docKey}|${lineNumber}`);
    const sameFingerprint = fingerprintKeys.some((key) => duplicateFingerprints.has(key));
    const sameDocument = !row.sku && duplicateDocs.has(docKey);
    if (!sameFingerprint && !sameLine && !sameDocument) continue;
    const conflict = row.sku
      ? Boolean(row.fingerprint && conflictFingerprints.has(row.fingerprint))
      : conflictDocs.has(docKey);
    row.disposition = "duplicate";
    row.reason = conflict
      ? "Stored values differ from this report. Existing financial values were kept."
      : row.sku
        ? "This source line is already stored for this customer."
        : "This document is already stored for this customer.";
  }
}

const REJECTED_PAGE_SIZE = 25;

function pageRejectedRows(rows: CustomerSalesHistoryRow[], page?: number, pageSize?: number) {
  const size = Math.min(50, Math.max(1, Math.floor(pageSize ?? REJECTED_PAGE_SIZE)));
  const rejectedPages = Math.max(1, Math.ceil(rows.length / size));
  const rejectedPage = Math.min(rejectedPages, Math.max(1, Math.floor(page ?? 1)));
  const start = (rejectedPage - 1) * size;
  return {
    rejectedExamples: rows.slice(start, start + size),
    rejectedTotal: rows.length,
    rejectedPage,
    rejectedPages,
  };
}

export async function prepareCustomerSalesHistory(
  actorUserId: string,
  input: { companyId: string; text561l?: string; textSlrb?: string; filename561l?: string; filenameSlrb?: string },
  options?: { bounded?: boolean; sampleLimit?: number; rejectedPage?: number; rejectedPageSize?: number },
) {
  await requireHistoryImporter(actorUserId);
  if (
    !options?.bounded &&
    ((input.text561l?.length ?? 0) > MAX_REPORT_CHARS || (input.textSlrb?.length ?? 0) > MAX_REPORT_CHARS)
  ) {
    throw new AuthError("Report is too large to preview.", "VALIDATION", 400);
  }
  const target = await loadCustomerSalesHistoryTarget(input.companyId);
  if (!input.text561l?.trim() && !input.textSlrb?.trim()) {
    throw new AuthError("Choose a 561L report, an SLRB report, or both.", "VALIDATION", 400);
  }
  for (const [label, text] of [
    ["561L", input.text561l],
    ["SLRB", input.textSlrb],
  ] as const) {
    if (!text?.trim()) continue;
    const kind = classifyCustomerSalesReport(text);
    if (kind === "504" || kind === "TRM21QC") {
      throw new AuthError(`${label} upload looks like an ongoing 504 or TRM21QC report.`, "VALIDATION", 400);
    }
  }
  const planned = planHistory({
    ...(input.text561l ? { text561l: input.text561l } : {}),
    ...(input.textSlrb ? { textSlrb: input.textSlrb } : {}),
    codes: target.codes,
    ...(options?.sampleLimit ? { sampleLimit: options.sampleLimit } : {}),
  });
  await markExisting(target, planned);
  const sortedDates = [...planned.dates].sort();
  const hasExceptions = planned.counts.rejected > 0;
  const canCommit = planned.counts.import + planned.counts.ledger + planned.counts.rejected > 0;
  const cutover = await prisma.customerSalesCutover.findUnique({
    where: { companyId: target.companyId },
    select: { historyStatus: true },
  });
  const rejected = pageRejectedRows(planned.rejectedRows, options?.rejectedPage, options?.rejectedPageSize);
  const preview: CustomerSalesHistoryPreview = {
    canCommit,
    companyId: target.companyId,
    companyName: target.companyName,
    accountCodes: target.codes,
    message: hasExceptions
      ? "Preview shows proposed changes and does not create sales records. These reports contain rejected, malformed, or unowned rows. Valid rows can be stored. Cutover stays in review until a member of staff accepts the exceptions. This is not a zero-history account."
      : canCommit
        ? "Preview shows proposed changes and does not create sales records."
        : "Preview does not create sales records. Nothing new in these reports belongs to this customer's verified accounts.",
    counts: planned.counts,
    rejectionGroups: planned.rejectionGroups,
    rows: planned.rows,
    ...rejected,
    dateFrom: sortedDates[0] ?? null,
    dateTo: sortedDates[sortedDates.length - 1] ?? null,
    historyStatus: cutover?.historyStatus ?? "NOT_STARTED",
    completion: hasExceptions ? "REVIEW" : "COMPLETE",
  };
  return { target, planned, preview };
}

export async function previewCustomerSalesHistory(
  actorUserId: string,
  input: { companyId: string; text561l?: string; textSlrb?: string; filename561l?: string; filenameSlrb?: string },
  options?: { bounded?: boolean; sampleLimit?: number; rejectedPage?: number; rejectedPageSize?: number },
): Promise<CustomerSalesHistoryPreview> {
  const prepared = await prepareCustomerSalesHistory(actorUserId, input, options);
  const { target, planned, preview } = prepared;
  await recordAuditEvent({
    action: "autopart.customer_sales_history_previewed",
    entityType: "Company",
    entityId: target.companyId,
    actorUserId,
    metadata: {
      filename561l: input.filename561l ?? null,
      filenameSlrb: input.filenameSlrb ?? null,
      counts: planned.counts,
      canCommit: preview.canCommit,
    },
  });
  return preview;
}

const STORED_HISTORY_ROW_LIMIT = 100;

export async function listStoredCustomerSalesHistory(actorUserId: string, companyId: string) {
  await requireHistoryImporter(actorUserId);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  });
  if (!company) throw new AuthError("Customer not found", "NOT_FOUND", 404);
  const where = { companyId: company.id, source: "561L" as const };
  const [productLines, datedProductLines, paymentDocuments, saleDocuments, net, rows, cutover] =
    await Promise.all([
      prisma.autopartSalesLine.count({ where }),
      prisma.autopartSalesLine.count({
        where: { ...where, document: { is: { documentDate: { not: null } } } },
      }),
      prisma.autopartSalesDocument.count({
        where: { companyId: company.id, documentType: "PAYMENT" },
      }),
      prisma.autopartSalesDocument.count({
        where: {
          companyId: company.id,
          source: { in: ["561L", "SLRB"] },
          documentType: { in: ["INVOICE", "CREDIT"] },
        },
      }),
      prisma.autopartSalesLine.aggregate({
        where: { ...where, documentType: { in: ["INVOICE", "CREDIT"] } },
        _sum: { salesNet: true },
      }),
      prisma.autopartSalesLine.findMany({
        where,
        orderBy: [{ documentReference: "asc" }, { lineNumber: "asc" }],
        take: STORED_HISTORY_ROW_LIMIT,
        select: {
          documentReference: true,
          documentType: true,
          sku: true,
          units: true,
          salesNet: true,
          source: true,
          document: { select: { documentDate: true } },
        },
      }),
      prisma.customerSalesCutover.findUnique({
        where: { companyId: company.id },
        select: { historyStatus: true },
      }),
    ]);
  return {
    kind: "stored" as const,
    companyId: company.id,
    historyStatus: cutover?.historyStatus ?? "NOT_STARTED",
    productLines,
    datedProductLines,
    undatedProductLines: productLines - datedProductLines,
    saleDocuments,
    paymentDocuments,
    productNet: net._sum.salesNet?.toString() ?? "0",
    truncated: productLines > rows.length,
    rows: rows.map((row) => ({
      document: row.documentReference,
      type: row.documentType,
      date: row.document?.documentDate?.toISOString().slice(0, 10) ?? null,
      sku: row.sku,
      quantity: row.units.toString(),
      amount: row.salesNet.toString(),
      source: row.source,
    })),
  };
}

export async function confirmCustomerSalesHistory(
  actorUserId: string,
  input: { companyId: string; text561l?: string; textSlrb?: string; filename561l?: string; filenameSlrb?: string },
  options?: {
    bounded?: boolean;
    sourceSha256561l?: string | null;
    sourceSha256Slrb?: string | null;
    rowsRead?: number;
    otherCustomerRows?: number;
  },
) {
  const prepared = await prepareCustomerSalesHistory(actorUserId, input, options);
  await recordAuditEvent({
    action: "autopart.customer_sales_history_previewed",
    entityType: "Company",
    entityId: prepared.target.companyId,
    actorUserId,
    metadata: {
      filename561l: input.filename561l ?? null,
      filenameSlrb: input.filenameSlrb ?? null,
      counts: prepared.planned.counts,
      canCommit: prepared.preview.canCommit,
    },
  });
  const preview = prepared.preview;
  if (!preview.canCommit && preview.counts.duplicate === 0) {
    throw new AuthError(preview.message ?? "Nothing can be imported.", "VALIDATION", 400);
  }
  if (!preview.canCommit) {
    const cutover = await prisma.customerSalesCutover.findUnique({ where: { companyId: preview.companyId } });
    return {
      runId: null,
      rowsImported: 0,
      duplicates: preview.counts.duplicate,
      historyFrom: cutover?.historyFrom?.toISOString().slice(0, 10) ?? preview.dateFrom,
      historyTo: cutover?.historyTo?.toISOString().slice(0, 10) ?? preview.dateTo,
      historyStatus: cutover?.historyStatus ?? preview.historyStatus,
    };
  }
  const jobs = await import("./customer-sales-history-job");
  return jobs.publishPreparedCustomerSalesHistory({
    actorUserId,
    input,
    ...(options ? { options } : {}),
    prepared,
  });
}

export async function acknowledgeCustomerSalesHistoryReview(actorUserId: string, companyId: string) {
  await requireHistoryImporter(actorUserId);
  const target = await loadCustomerSalesHistoryTarget(companyId);
  const existing = await prisma.customerSalesCutover.findUnique({ where: { companyId: target.companyId } });
  if (existing?.historyStatus !== "REVIEW") {
    throw new AuthError(
      "There is no historical import waiting for review. A zero-history account is recorded separately.",
      "VALIDATION",
      400,
    );
  }
  const prior = existing.evidence && typeof existing.evidence === "object" && !Array.isArray(existing.evidence)
    ? existing.evidence
    : {};
  await prisma.customerSalesCutover.update({
    where: { companyId: target.companyId },
    data: {
      historyStatus: "COMPLETE",
      completedAt: new Date(),
      completedById: actorUserId,
      evidence: { ...prior, resolution: "EXCEPTIONS_ACCEPTED" },
    },
  });
  await recordAuditEvent({
    action: "autopart.customer_sales_history_reviewed",
    entityType: "Company",
    entityId: target.companyId,
    actorUserId,
    metadata: { resolution: "EXCEPTIONS_ACCEPTED" },
  });
  return { companyId: target.companyId, historyStatus: "COMPLETE" as const };
}

function evidenceKind(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const kind = (evidence as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

export async function completeCustomerSalesCutoverWithoutHistory(actorUserId: string, companyId: string) {
  await requireHistoryImporter(actorUserId);
  const target = await loadCustomerSalesHistoryTarget(companyId);
  const existing = await prisma.customerSalesCutover.findUnique({ where: { companyId: target.companyId } });
  if (existing?.historyStatus === "REVIEW") {
    throw new AuthError(
      "Historical import has exceptions waiting for review. This is not a zero-history account.",
      "VALIDATION",
      400,
    );
  }
  if (existing?.historyStatus === "COMPLETE") {
    if (evidenceKind(existing.evidence) === PRELAUNCH_HISTORY_DISCARDED) {
      throw new AuthError(
        "This account has a new sales baseline after discarded pre-launch history. That is not a record of no historical sales.",
        "VALIDATION",
        400,
      );
    }
    return { companyId: target.companyId, historyStatus: "COMPLETE" as const, alreadyComplete: true };
  }
  const existingSales = await prisma.autopartSalesDocument.count({ where: { companyId: target.companyId } });
  if (existingSales > 0) {
    throw new AuthError(
      "This customer already has imported sales. Record a reviewed history import instead of zero history.",
      "VALIDATION",
      400,
    );
  }
  await prisma.customerSalesCutover.upsert({
    where: { companyId: target.companyId },
    create: {
      companyId: target.companyId,
      historyStatus: "COMPLETE",
      completedAt: new Date(),
      completedById: actorUserId,
      evidence: { kind: "NO_HISTORICAL_SALES" },
    },
    update: {
      historyStatus: "COMPLETE",
      completedAt: new Date(),
      completedById: actorUserId,
      evidence: { kind: "NO_HISTORICAL_SALES" },
    },
  });
  await recordAuditEvent({
    action: "autopart.customer_sales_cutover_completed",
    entityType: "Company",
    entityId: target.companyId,
    actorUserId,
    metadata: { kind: "NO_HISTORICAL_SALES" },
  });
  return { companyId: target.companyId, historyStatus: "COMPLETE" as const, alreadyComplete: false };
}

/**
 * Completes cutover after the pre-launch discard. This is not a claim that the
 * customer never had historical sales.
 */
export async function startCustomerSalesHistoryBaseline(actorUserId: string, companyId: string) {
  await requireHistoryImporter(actorUserId);
  const target = await loadCustomerSalesHistoryTarget(companyId);
  const existing = await prisma.customerSalesCutover.findUnique({ where: { companyId: target.companyId } });
  const kind = evidenceKind(existing?.evidence);
  if (existing?.historyStatus === "REVIEW") {
    throw new AuthError(
      "Historical import has exceptions waiting for review. This is not a new sales baseline.",
      "VALIDATION",
      400,
    );
  }
  if (existing?.historyStatus === "COMPLETE" && kind === PRELAUNCH_HISTORY_DISCARDED) {
    return {
      companyId: target.companyId,
      historyStatus: "COMPLETE" as const,
      alreadyComplete: true,
      kind: PRELAUNCH_HISTORY_DISCARDED,
    };
  }
  if (existing?.historyStatus === "COMPLETE") {
    throw new AuthError(
      kind === "NO_HISTORICAL_SALES"
        ? "This account is recorded as having no historical sales. That is not a discarded pre-launch baseline."
        : "Historical sales were already recorded. Do not replace them with a discarded baseline.",
      "VALIDATION",
      400,
    );
  }
  const existingSales = await prisma.autopartSalesDocument.count({ where: { companyId: target.companyId } });
  if (existingSales > 0) {
    throw new AuthError(
      "This customer already has imported sales. Import or review that history instead of starting a discarded baseline.",
      "VALIDATION",
      400,
    );
  }
  const evidence = {
    kind: PRELAUNCH_HISTORY_DISCARDED,
    note: "Pre-launch imported sales history was discarded. This does not mean the customer never had historical sales.",
  };
  await prisma.customerSalesCutover.upsert({
    where: { companyId: target.companyId },
    create: {
      companyId: target.companyId,
      historyStatus: "COMPLETE",
      completedAt: new Date(),
      completedById: actorUserId,
      evidence,
    },
    update: {
      historyStatus: "COMPLETE",
      completedAt: new Date(),
      completedById: actorUserId,
      evidence,
    },
  });
  await recordAuditEvent({
    action: "autopart.customer_sales_baseline_started",
    entityType: "Company",
    entityId: target.companyId,
    actorUserId,
    metadata: { kind: PRELAUNCH_HISTORY_DISCARDED },
  });
  return {
    companyId: target.companyId,
    historyStatus: "COMPLETE" as const,
    alreadyComplete: false,
    kind: PRELAUNCH_HISTORY_DISCARDED,
  };
}
