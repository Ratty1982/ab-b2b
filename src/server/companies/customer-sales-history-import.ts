/**
 * Import Sales History for one Active customer.
 * 561L supplies product lines. SLRB supplies document and ledger evidence.
 * The retired global historical importer is not used.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants } from "@/server/rbac/access";
import { parseAutopart561l } from "@/domain/autopart-561l";
import { parseAutopartSlrb } from "@/domain/autopart-slrb";
import {
  historicalDocumentIsSale,
  signedHistoricalMeasure,
  type HistoricalDocumentType,
} from "@/domain/customer-sales-history";
import { classifyCustomerSalesReport } from "@/domain/customer-sales-import";
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
};

export type CustomerSalesHistoryPreview = {
  canCommit: boolean;
  companyId: string;
  companyName: string;
  accountCodes: string[];
  message: string | null;
  counts: { import: number; duplicate: number; ledger: number; rejected: number };
  rows: CustomerSalesHistoryRow[];
  dateFrom: string | null;
  dateTo: string | null;
};

type HistoryTarget = {
  companyId: string;
  companyName: string;
  codes: string[];
};

async function requireHistoryImporter(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!grants(profile, "admin.access", "orders.edit")) {
    throw new AuthError("Not permitted to import customer sales history", "FORBIDDEN", 403);
  }
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

function emptyCounts(): CustomerSalesHistoryPreview["counts"] {
  return { import: 0, duplicate: 0, ledger: 0, rejected: 0 };
}

function pushRow(
  rows: CustomerSalesHistoryRow[],
  counts: CustomerSalesHistoryPreview["counts"],
  row: CustomerSalesHistoryRow,
) {
  counts[row.disposition] += 1;
  if (rows.length < PREVIEW_ROW_LIMIT) rows.push(row);
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
};

function planHistory(input: {
  text561l?: string;
  textSlrb?: string;
  codes: string[];
}) {
  const authorised = new Set(input.codes.map((code) => code.toUpperCase()));
  const documents = new Map<string, PlannedDocument>();
  const lines: PlannedLine[] = [];
  const rows: CustomerSalesHistoryRow[] = [];
  const counts = emptyCounts();
  const dates: string[] = [];
  const lineKeys = new Set<string>();

  if (input.textSlrb?.trim()) {
    const parsed = parseAutopartSlrb(input.textSlrb);
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
        pushRow(rows, counts, {
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
        pushRow(rows, counts, {
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
      });
      lineKeys.add(`doc|${key}`);
      if (row.documentDate) dates.push(row.documentDate);
      pushRow(rows, counts, {
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
    const nextLine = new Map<string, number>();
    for (const row of parsed.lines) {
      if (row.classification !== "LINE" || !row.documentReference || !row.accountCode || !row.partNumber) {
        if (row.classification === "MALFORMED" || row.issue) {
          pushRow(rows, counts, {
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
        pushRow(rows, counts, {
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
      if (!units || !salesNet) {
        pushRow(rows, counts, {
          document: row.documentReference,
          type: documentType,
          date: null,
          account,
          amount: row.salesNet,
          sku: row.partNumber,
          quantity: row.units == null ? null : String(row.units),
          disposition: "rejected",
          reason: "Quantity or sales amount is missing.",
        });
        continue;
      }
      const skuKey = `${documentType}|${row.documentReference}|${row.partNumber.toUpperCase()}`;
      if (lineKeys.has(skuKey)) {
        pushRow(rows, counts, {
          document: row.documentReference,
          type: documentType,
          date: null,
          account,
          amount: salesNet,
          sku: row.partNumber,
          quantity: units,
          disposition: "duplicate",
          reason: "This product line is already in the selected report.",
        });
        continue;
      }
      const docKey = `${documentType}|${row.documentReference}`;
      const lineNumber = row.sourceLineNumber && row.sourceLineNumber > 0
        ? row.sourceLineNumber
        : (nextLine.get(docKey) ?? 0) + 1;
      nextLine.set(docKey, Math.max(nextLine.get(docKey) ?? 0, lineNumber));
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
      });
      lineKeys.add(skuKey);
      pushRow(rows, counts, {
        document: row.documentReference,
        type: documentType,
        date: null,
        account,
        amount: salesNet,
        sku: row.partNumber,
        quantity: units,
        disposition: "import",
        reason: "561L product-sales evidence.",
      });
    }
  }

  return { documents: [...documents.values()], lines, rows, counts, dates };
}

async function markExisting(target: HistoryTarget, planned: ReturnType<typeof planHistory>) {
  const refs = [...new Set(planned.documents.map((doc) => doc.documentReference))];
  const storedDocs = refs.length
    ? await prisma.autopartSalesDocument.findMany({
        where: { companyId: target.companyId, documentReference: { in: refs } },
        select: { documentType: true, documentReference: true },
      })
    : [];
  const storedLines = refs.length
    ? await prisma.autopartSalesLine.findMany({
        where: { companyId: target.companyId, documentReference: { in: refs } },
        select: { documentType: true, documentReference: true, sku: true },
      })
    : [];
  const docKeys = new Set(storedDocs.map((doc) => `${doc.documentType}|${doc.documentReference}`));
  const lineKeys = new Set(
    storedLines.map((line) => `${line.documentType}|${line.documentReference}|${line.sku.toUpperCase()}`),
  );
  for (const row of planned.rows) {
    if (row.disposition !== "import" && row.disposition !== "ledger") continue;
    const docKey = `${row.type}|${row.document}`;
    const lineKey = row.sku ? `${docKey}|${row.sku.toUpperCase()}` : null;
    if ((lineKey && lineKeys.has(lineKey)) || (!row.sku && docKeys.has(docKey))) {
      planned.counts[row.disposition] -= 1;
      row.disposition = "duplicate";
      planned.counts.duplicate += 1;
      row.reason = row.sku
        ? "This product line is already stored for this customer."
        : "This document is already stored for this customer.";
    }
  }
}

export async function previewCustomerSalesHistory(
  actorUserId: string,
  input: { companyId: string; text561l?: string; textSlrb?: string; filename561l?: string; filenameSlrb?: string },
): Promise<CustomerSalesHistoryPreview> {
  await requireHistoryImporter(actorUserId);
  if ((input.text561l?.length ?? 0) > MAX_REPORT_CHARS || (input.textSlrb?.length ?? 0) > MAX_REPORT_CHARS) {
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
  });
  await markExisting(target, planned);
  const sortedDates = [...planned.dates].sort();
  const canCommit = planned.counts.import + planned.counts.ledger > 0;
  const preview: CustomerSalesHistoryPreview = {
    canCommit,
    companyId: target.companyId,
    companyName: target.companyName,
    accountCodes: target.codes,
    message: canCommit
      ? null
      : "Nothing new in these reports belongs to this customer's verified accounts.",
    counts: planned.counts,
    rows: planned.rows,
    dateFrom: sortedDates[0] ?? null,
    dateTo: sortedDates[sortedDates.length - 1] ?? null,
  };
  await recordAuditEvent({
    action: "autopart.customer_sales_history_previewed",
    entityType: "Company",
    entityId: target.companyId,
    actorUserId,
    metadata: {
      filename561l: input.filename561l ?? null,
      filenameSlrb: input.filenameSlrb ?? null,
      counts: planned.counts,
      canCommit,
    },
  });
  return preview;
}

export async function confirmCustomerSalesHistory(
  actorUserId: string,
  input: { companyId: string; text561l?: string; textSlrb?: string; filename561l?: string; filenameSlrb?: string },
) {
  const preview = await previewCustomerSalesHistory(actorUserId, input);
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
    };
  }
  const target = await loadCustomerSalesHistoryTarget(input.companyId);
  const planned = planHistory({
    ...(input.text561l ? { text561l: input.text561l } : {}),
    ...(input.textSlrb ? { textSlrb: input.textSlrb } : {}),
    codes: target.codes,
  });
  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: target.companyId,
      type: "HISTORY_561L_SLRB",
      status: "PROCESSING",
      filename: input.filename561l ?? null,
      filenameSlrb: input.filenameSlrb ?? null,
      fileHash: hashText(input.text561l),
      fileHashSlrb: hashText(input.textSlrb),
      dryRun: false,
      createdById: actorUserId,
      rowsRead: planned.documents.length + planned.lines.length,
    },
  });

  let imported = 0;
  let duplicates = 0;
  const writtenDates: Date[] = [];
  try {
    for (const doc of planned.documents) {
      const existing = await prisma.autopartSalesDocument.findFirst({
        where: {
          companyId: target.companyId,
          documentType: doc.documentType,
          documentReference: doc.documentReference,
        },
      });
      const date = utcNoon(doc.documentDate);
      if (existing) {
        duplicates += 1;
        if (doc.source === "SLRB" && historicalDocumentIsSale(doc.documentType)) {
          await prisma.autopartSalesDocument.update({
            where: { id: existing.id },
            data: {
              documentDate: date ?? existing.documentDate,
              goodsNet: doc.goodsNet ?? existing.goodsNet,
              vat: doc.vat ?? existing.vat,
              grossTotal: doc.grossTotal ?? existing.grossTotal,
            },
          });
        }
        if (date) writtenDates.push(date);
        continue;
      }
      await prisma.autopartSalesDocument.create({
        data: {
          companyId: target.companyId,
          autopartCustomerCode: doc.account,
          documentType: doc.documentType,
          documentReference: doc.documentReference,
          documentDate: date,
          goodsNet: doc.goodsNet,
          vat: doc.vat,
          grossTotal: historicalDocumentIsSale(doc.documentType) ? doc.grossTotal : doc.grossTotal,
          source: doc.source,
          importRunId: run.id,
          has504: false,
          hasTrm21qc: false,
        },
      });
      imported += 1;
      if (date) writtenDates.push(date);
    }

    for (const line of planned.lines) {
      const sameSku = await prisma.autopartSalesLine.findFirst({
        where: {
          companyId: target.companyId,
          documentType: line.documentType,
          documentReference: line.documentReference,
          sku: { equals: line.sku, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (sameSku) {
        duplicates += 1;
        continue;
      }
      const document = await prisma.autopartSalesDocument.findFirst({
        where: {
          companyId: target.companyId,
          documentType: line.documentType,
          documentReference: line.documentReference,
        },
        select: { id: true },
      });
      const variant = await prisma.productVariant.findFirst({
        where: { sku: { equals: line.sku, mode: "insensitive" } },
        select: { id: true },
      });
      await prisma.autopartSalesLine.create({
        data: {
          companyId: target.companyId,
          documentId: document?.id ?? null,
          autopartCustomerCode: line.account,
          documentType: line.documentType,
          documentReference: line.documentReference,
          lineNumber: line.lineNumber,
          sku: line.sku,
          descriptionSnapshot: line.description,
          units: line.units,
          salesNet: line.salesNet,
          matchedVariantId: variant?.id ?? null,
          matchStatus: variant ? "MATCHED" : "NOT_IN_AB_CATALOGUE",
          rawInvAndLn: line.rawInvAndLn,
          source: "561L",
          importRunId: run.id,
        },
      });
      imported += 1;
    }
  } catch (error) {
    await prisma.autopartCustomerImportRun.update({
      where: { id: run.id },
      data: { status: "FAILED", completedAt: new Date(), issues: { error: error instanceof Error ? error.message : "import failed" } },
    });
    throw error;
  }

  const historyFrom = writtenDates.length ? new Date(Math.min(...writtenDates.map((date) => date.getTime()))) : null;
  const historyTo = writtenDates.length ? new Date(Math.max(...writtenDates.map((date) => date.getTime()))) : null;
  const evidence = {
    kind: "561L_SLRB",
    filename561l: input.filename561l ?? null,
    filenameSlrb: input.filenameSlrb ?? null,
    sha256561l: hashText(input.text561l),
    sha256Slrb: hashText(input.textSlrb),
    imported,
    duplicates,
    rejected: planned.counts.rejected,
  };
  await prisma.customerSalesCutover.upsert({
    where: { companyId: target.companyId },
    create: {
      companyId: target.companyId,
      historyStatus: "COMPLETE",
      historyFrom,
      historyTo,
      completedAt: new Date(),
      completedById: actorUserId,
      evidence,
    },
    update: {
      historyStatus: "COMPLETE",
      historyFrom,
      historyTo,
      completedAt: new Date(),
      completedById: actorUserId,
      evidence,
    },
  });
  const finished = await prisma.autopartCustomerImportRun.update({
    where: { id: run.id },
    data: {
      status: "COMMITTED",
      completedAt: new Date(),
      rowsImported: imported,
      rowsSkipped: duplicates + planned.counts.rejected,
      rowsValid: imported,
    },
  });
  await recordAuditEvent({
    action: "autopart.customer_sales_history_committed",
    entityType: "AutopartCustomerImportRun",
    entityId: run.id,
    actorUserId,
    metadata: { companyId: target.companyId, imported, duplicates, evidence },
  });
  return {
    runId: finished.id,
    rowsImported: imported,
    duplicates,
    historyFrom: historyFrom?.toISOString().slice(0, 10) ?? null,
    historyTo: historyTo?.toISOString().slice(0, 10) ?? null,
  };
}

export async function completeCustomerSalesCutoverWithoutHistory(actorUserId: string, companyId: string) {
  await requireHistoryImporter(actorUserId);
  const target = await loadCustomerSalesHistoryTarget(companyId);
  const existing = await prisma.customerSalesCutover.findUnique({ where: { companyId: target.companyId } });
  if (existing?.historyStatus === "COMPLETE" && existing.evidence && typeof existing.evidence === "object") {
    const kind = (existing.evidence as { kind?: string }).kind;
    if (kind === "561L_SLRB") {
      return { companyId: target.companyId, historyStatus: "COMPLETE" as const, alreadyComplete: true };
    }
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
