/**
 * Ongoing Autopart 504 + TRM21QC sales feeds.
 *
 * Manual upload and email ingestion share this pipeline.
 * Writes AutopartSalesDocument / AutopartSalesLine for Sales Intelligence.
 * AB-order despatch reuses Invoice.externalRef idempotency with 504C.
 */

import type { AutopartHistoricDocumentType, Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { recordAuditEvent } from "@/server/audit/record";
import {
  describeAutopart504Malformed,
  isAutopart504ArtefactRow,
  isAutopart504ImportableRow,
  isAutopart504Report,
  parseAutopart504Report,
  type Autopart504Row,
} from "@/domain/autopart-504";
import {
  assignStableTrm21qcLineNumbers,
  isAutopartTrm21qcReport,
  parseAutopartTrm21qcReport,
  trm21qcMalformedToReasonCode,
} from "@/domain/autopart-trm21qc";
import { reconcile504GoodsToTrmSales } from "@/domain/autopart-504-trm21qc-reconcile";
import { ongoingSalesReportContentHash } from "@/domain/autopart-ongoing-sales-attachment";
import {
  decimalStringsEqual,
  makeDiagnostic,
  type AutopartImportDiagnosticDraft,
} from "@/domain/autopart-import-diagnostics";
import {
  countsFromDrafts,
  persistImportDiagnostics,
} from "@/server/companies/autopart-ongoing-sales-diagnostics";
import { applyAutopart504cFile } from "@/server/orders/autopart-504c";
import { format504cDataRow, AUTOPART_504C_HEADER, AUTOPART_504C_SEPARATOR } from "@/domain/autopart-504c-fixture";
import {
  read504TrmFulfilmentSettings,
  run504TrmFulfilmentAfterImport,
  shouldBridge504To504c,
} from "@/server/orders/autopart-504-trm-fulfilment";

export {
  getOngoingSalesImportRunDetail,
  listOngoingSalesImportDiagnostics,
  exportOngoingSalesImportDiagnosticsCsv,
} from "@/server/companies/autopart-ongoing-sales-diagnostics";

async function requireOngoingSalesAdmin(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!hasPermission(profile, "admin.access") && !hasPermission(profile, "orders.edit")) {
    throw new AuthError("Not permitted to manage Autopart sales feeds", "FORBIDDEN", 403);
  }
  return profile;
}

/** Manual admin paths require a user; EMAIL/SCHEDULE may pass null after settings gate. */
async function assertOngoingImportActor(userId: string | null) {
  if (userId) await requireOngoingSalesAdmin(userId);
}

function fileHash(text: string): string {
  return ongoingSalesReportContentHash(text);
}

function utcNoon(dateOnly: string | null): Date | null {
  if (!dateOnly) return null;
  return new Date(`${dateOnly}T12:00:00.000Z`);
}

async function resolveCompanyByAutopartCode(code: string): Promise<{
  companyId: string;
  code: string;
} | null> {
  const normalised = code.trim().toUpperCase();
  if (!normalised) return null;
  const direct = await prisma.company.findFirst({
    where: { autopartCustomerCode: { equals: normalised, mode: "insensitive" } },
    select: { id: true, autopartCustomerCode: true },
  });
  if (direct?.autopartCustomerCode) {
    return { companyId: direct.id, code: direct.autopartCustomerCode };
  }
  const alias = await prisma.autopartCustomerAccountAlias.findFirst({
    where: { alias: normalised },
    select: { companyId: true, company: { select: { autopartCustomerCode: true } } },
  });
  if (alias) {
    return {
      companyId: alias.companyId,
      code: alias.company.autopartCustomerCode ?? normalised,
    };
  }
  return null;
}

async function resolveSkuMap(skus: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const variants = await prisma.productVariant.findMany({
    where: { OR: unique.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })) },
    select: { id: true, sku: true },
  });
  for (const v of variants) map.set(v.sku.toUpperCase(), v.id);
  return map;
}

export async function getOngoingSalesFeedSettings(actorUserId: string) {
  await requireOngoingSalesAdmin(actorUserId);
  return getOrCreateOngoingSettings();
}

async function getOrCreateOngoingSettings() {
  return prisma.autopartOngoingSalesFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

export async function updateOngoingSalesFeedSettings(
  actorUserId: string,
  raw: { enabled?: boolean; configured?: boolean; allowedSender?: string | null },
) {
  await requireOngoingSalesAdmin(actorUserId);
  const current = await getOrCreateOngoingSettings();
  const nextConfigured = raw.configured ?? current.configured;
  const nextEnabled = raw.enabled ?? current.enabled;
  if (nextEnabled && !nextConfigured) {
    throw new AuthError(
      "Mark Autopart email as configured before enabling automatic polling",
      "VALIDATION",
      400,
    );
  }
  return prisma.autopartOngoingSalesFeedSettings.update({
    where: { id: "default" },
    data: {
      enabled: nextEnabled,
      configured: nextConfigured,
      ...(raw.allowedSender !== undefined ? { allowedSender: raw.allowedSender } : {}),
      updatedByUserId: actorUserId,
    },
  });
}

export type Ongoing504Preview = {
  headerFound: boolean;
  errors: string[];
  documents: number;
  invoices: number;
  credits: number;
  unknown: number;
  abMatches: number;
  nonAb: number;
  unmatchedAbLooking: number;
  netGoods: string;
  vat: string;
  grossValue: string;
  existingDocuments: number;
  newDocuments: number;
  invalidRows: number;
  wouldInsert: number;
  wouldUpdate: number;
  wouldSkip: number;
  warningCount: number;
  errorCount: number;
  diagnostics: AutopartImportDiagnosticDraft[];
  rows: Array<{
    document: string;
    type: string;
    date: string | null;
    time: string | null;
    customer: string;
    goods: string | null;
    vat: string | null;
    value: string | null;
    customerOrderNumber: string;
    abMatch: string;
    status: string;
    reasonCode: string;
  }>;
};

export async function previewAutopart504Import(
  actorUserId: string,
  raw: { text: string; filename?: string },
): Promise<Ongoing504Preview> {
  await requireOngoingSalesAdmin(actorUserId);
  if (!isAutopart504Report(raw.text)) {
    throw new AuthError("File does not look like an Autopart 504 report", "VALIDATION", 400);
  }
  const parsed = parseAutopart504Report(raw.text);
  const docs = parsed.rows.filter(isAutopart504ImportableRow);
  const refs = docs.map((d) => d.documentNumber);
  const existing = refs.length
    ? await prisma.autopartSalesDocument.findMany({
        where: { documentReference: { in: refs } },
        select: { documentReference: true, goodsNet: true, vat: true, grossTotal: true },
      })
    : [];
  const existingByRef = new Map(existing.map((e) => [e.documentReference, e]));
  let netGoods = 0;
  let vat = 0;
  let gross = 0;
  for (const r of docs) {
    netGoods += Number(r.goods ?? 0);
    vat += Number(r.vat ?? 0);
    gross += Number(r.value ?? 0);
  }
  const unmatchedAbLooking = docs.filter(
    (r) => r.isAbOrderReference && r.classification !== "AB_INVOICE" && r.classification !== "AB_CREDIT",
  ).length;

  const diagnostics: AutopartImportDiagnosticDraft[] = [];
  for (const row of parsed.rows) {
    if (row.classification === "BLANK") {
      diagnostics.push(
        makeDiagnostic({
          status: "SKIPPED",
          reasonCode: "BLANK_ROW",
          rowNumber: row.lineNumber,
        }),
      );
      continue;
    }
    if (row.classification === "HEADER" || row.classification === "PAGE") {
      continue;
    }
    if (row.classification === "SUBTOTAL" || row.classification === "TOTAL") {
      diagnostics.push(
        makeDiagnostic({
          status: "SKIPPED",
          reasonCode: "UNRECOGNISED_ROW_TYPE",
          rowNumber: row.lineNumber,
          salesNet: row.goods,
          reason: `Line ${row.lineNumber}: ${row.classification.toLowerCase()} ignored (not a document)`,
        }),
      );
      continue;
    }
    if (!row.documentNumber || row.classification === "MALFORMED") {
      diagnostics.push(
        makeDiagnostic({
          status: "ERROR",
          reasonCode: row.documentNumber ? "MALFORMED_ROW" : "MISSING_DOCUMENT",
          rowNumber: row.lineNumber,
          documentReference: row.documentNumber || null,
          documentDate: row.documentDate,
          customerOrderNumber: row.customerOrderNumber || null,
          abOrderReference: row.abOrderNumber,
          salesNet: row.goods,
          reason: describeAutopart504Malformed(row),
        }),
      );
      continue;
    }
    const prev = existingByRef.get(row.documentNumber);
    if (!prev) {
      diagnostics.push(
        makeDiagnostic({
          status: "INSERTED",
          reasonCode: "INSERTED",
          rowNumber: row.lineNumber,
          documentReference: row.documentNumber,
          documentDate: row.documentDate,
          customerOrderNumber: row.customerOrderNumber || null,
          abOrderReference: row.abOrderNumber,
          salesNet: row.goods,
        }),
      );
    } else if (
      decimalStringsEqual(prev.goodsNet?.toString(), row.goods) &&
      decimalStringsEqual(prev.vat?.toString(), row.vat) &&
      decimalStringsEqual(prev.grossTotal?.toString(), row.value)
    ) {
      diagnostics.push(
        makeDiagnostic({
          status: "UNCHANGED",
          reasonCode: "ALREADY_IMPORTED",
          rowNumber: row.lineNumber,
          documentReference: row.documentNumber,
          documentDate: row.documentDate,
          customerOrderNumber: row.customerOrderNumber || null,
          abOrderReference: row.abOrderNumber,
          salesNet: row.goods,
        }),
      );
    } else {
      diagnostics.push(
        makeDiagnostic({
          status: "UPDATED",
          reasonCode: "UPDATED",
          rowNumber: row.lineNumber,
          documentReference: row.documentNumber,
          documentDate: row.documentDate,
          customerOrderNumber: row.customerOrderNumber || null,
          abOrderReference: row.abOrderNumber,
          salesNet: row.goods,
        }),
      );
    }
  }
  const counts = countsFromDrafts(diagnostics);

  await recordAuditEvent({
    action: "autopart.ongoing_504_previewed",
    entityType: "AutopartCustomerImportRun",
    entityId: null,
    actorUserId,
    metadata: {
      filename: raw.filename ?? null,
      documents: docs.length,
      wouldInsert: counts.inserted,
      wouldUpdate: counts.updated,
      wouldSkip: counts.skipped,
    },
  });

  return {
    headerFound: parsed.headerFound,
    errors: [...parsed.errors, ...parsed.warnings],
    documents: new Set(docs.map((d) => d.documentNumber)).size,
    invoices: parsed.invoiceRows.length,
    credits: parsed.creditRows.length,
    unknown: docs.filter((d) => d.kind === "UNKNOWN").length,
    abMatches: parsed.abInvoiceRows.length + parsed.abCreditRows.length,
    nonAb: parsed.nonAbRows,
    unmatchedAbLooking,
    netGoods: netGoods.toFixed(2),
    vat: vat.toFixed(2),
    grossValue: gross.toFixed(2),
    existingDocuments: docs.filter((d) => existingByRef.has(d.documentNumber)).length,
    newDocuments: docs.filter((d) => !existingByRef.has(d.documentNumber)).length,
    invalidRows: parsed.malformedRows,
    wouldInsert: counts.inserted,
    wouldUpdate: counts.updated + counts.unchanged,
    wouldSkip: counts.skipped + counts.errors,
    warningCount: counts.warnings,
    errorCount: counts.errors,
    diagnostics: diagnostics.filter((d) => d.reasonCode !== "BLANK_ROW").slice(0, 300),
    rows: docs.slice(0, 100).map((r) => {
      const d = diagnostics.find(
        (x) => x.rowNumber === r.lineNumber && x.documentReference === r.documentNumber,
      );
      return {
        document: r.documentNumber,
        type: r.kind,
        date: r.documentDate,
        time: r.documentTime,
        customer: r.customerName,
        goods: r.goods,
        vat: r.vat,
        value: r.value,
        customerOrderNumber: r.customerOrderNumber,
        abMatch: r.abOrderNumber ?? (r.isAbOrderReference ? "UNMATCHED" : "NON_AB"),
        status: d?.status ?? "INSERTED",
        reasonCode: d?.reasonCode ?? "INSERTED",
      };
    }),
  };
}

export type OngoingTrmPreview = {
  headerFound: boolean;
  errors: string[];
  rows: number;
  documents: number;
  invoiceLines: number;
  creditLines: number;
  netSales: string;
  signedQty: string;
  matchedSkus: number;
  notInCatalogue: number;
  matchedCustomers: number;
  unmatchedCustomers: number;
  existingLines: number;
  newLines: number;
  invalidRows: number;
  wouldInsert: number;
  wouldUpdate: number;
  wouldSkip: number;
  warningCount: number;
  errorCount: number;
  diagnostics: AutopartImportDiagnosticDraft[];
  sample: Array<{
    customerAccount: string;
    document: string;
    date: string | null;
    sku: string;
    description: string | null;
    qty: string | null;
    salesNet: string | null;
    productMatch: string;
    customerMatch: string;
    status: string;
    reasonCode: string;
  }>;
};

export async function previewAutopartTrm21qcImport(
  actorUserId: string,
  raw: { text: string; filename?: string },
): Promise<OngoingTrmPreview> {
  await requireOngoingSalesAdmin(actorUserId);
  if (!isAutopartTrm21qcReport(raw.text)) {
    throw new AuthError("File does not look like an Autopart TRM21QC report", "VALIDATION", 400);
  }
  const parsed = parseAutopartTrm21qcReport(raw.text);
  const ok = parsed.rows.filter((r) => r.classification === "OK");
  const skuMap = await resolveSkuMap(ok.map((r) => r.partNumber));
  const accountCache = new Map<string, Awaited<ReturnType<typeof resolveCompanyByAutopartCode>>>();
  async function mappedAccount(code: string) {
    const key = code.trim().toUpperCase();
    if (!accountCache.has(key)) accountCache.set(key, await resolveCompanyByAutopartCode(key));
    return accountCache.get(key) ?? null;
  }
  const accounts = [...new Set(ok.map((r) => r.customerAccount.toUpperCase()))];
  let matchedCustomers = 0;
  let unmatchedCustomers = 0;
  for (const acct of accounts) {
    if (await mappedAccount(acct)) matchedCustomers += 1;
    else unmatchedCustomers += 1;
  }
  let netSales = 0;
  let signedQty = 0;
  let matchedSkus = 0;
  for (const r of ok) {
    netSales += Number(r.salesNet ?? 0);
    signedQty += Number(r.qty ?? 0);
    if (skuMap.has(r.partNumber.toUpperCase())) matchedSkus += 1;
  }
  const stable = assignStableTrm21qcLineNumbers(ok);
  const diagnostics: AutopartImportDiagnosticDraft[] = [];
  for (const row of parsed.rows) {
    if (row.classification === "BLANK") {
      diagnostics.push(
        makeDiagnostic({
          status: "SKIPPED",
          reasonCode: "BLANK_ROW",
          rowNumber: row.lineNumber,
        }),
      );
    } else if (row.classification === "MALFORMED") {
      diagnostics.push(
        makeDiagnostic({
          status: "ERROR",
          reasonCode: trm21qcMalformedToReasonCode(row.malformedReason),
          rowNumber: row.lineNumber,
          customerAccount: row.customerAccount || null,
          documentReference: row.documentNumber || null,
          sku: row.partNumber || null,
          description: row.description,
          quantity: row.qty,
          // Never invent Sales — only persist when the parser produced a value.
          salesNet: row.salesNet,
        }),
      );
    }
  }
  let existingLines = 0;
  let newLines = 0;
  for (const r of stable) {
    const mapped = await mappedAccount(r.customerAccount);
    const inCatalogue = skuMap.has(r.partNumber.toUpperCase());
    if (!mapped) {
      const found =
        (await prisma.autopartSalesLine.findFirst({
          where: {
            companyId: null,
            documentType: r.kind === "CREDIT" ? "CREDIT" : "INVOICE",
            documentReference: r.documentNumber,
            lineNumber: r.stableLineNumber,
          },
          select: { id: true, units: true, salesNet: true, sku: true },
        })) ??
        (await prisma.autopartSalesLine.findFirst({
          where: { documentReference: r.documentNumber, sku: r.partNumber, lineNumber: r.stableLineNumber },
          select: { id: true, units: true, salesNet: true, sku: true },
        }));
      if (found) {
        existingLines += 1;
        const identical =
          decimalStringsEqual(found.units.toString(), r.qty) &&
          decimalStringsEqual(found.salesNet.toString(), r.salesNet) &&
          found.sku.toUpperCase() === r.partNumber.toUpperCase();
        diagnostics.push(
          makeDiagnostic({
            status: identical ? "UNCHANGED" : "UPDATED",
            reasonCode: identical ? "ALREADY_IMPORTED" : "UPDATED",
            rowNumber: r.lineNumber,
            customerAccount: r.customerAccount,
            documentReference: r.documentNumber,
            documentDate: r.documentDate,
            sku: r.partNumber,
            description: r.description,
            quantity: r.qty,
            salesNet: r.salesNet,
            isWarning: true,
          }),
        );
      } else {
        newLines += 1;
        diagnostics.push(
          makeDiagnostic({
            status: "INSERTED",
            reasonCode: "UNMAPPED_CUSTOMER",
            rowNumber: r.lineNumber,
            customerAccount: r.customerAccount,
            documentReference: r.documentNumber,
            documentDate: r.documentDate,
            sku: r.partNumber,
            description: r.description,
            quantity: r.qty,
            salesNet: r.salesNet,
            isWarning: true,
          }),
        );
      }
      continue;
    }
    const found = await prisma.autopartSalesLine.findUnique({
      where: {
        companyId_documentType_documentReference_lineNumber: {
          companyId: mapped.companyId,
          documentType: r.kind === "CREDIT" ? "CREDIT" : "INVOICE",
          documentReference: r.documentNumber,
          lineNumber: r.stableLineNumber,
        },
      },
      select: { id: true, units: true, salesNet: true, sku: true },
    });
    if (found) {
      existingLines += 1;
      const identical =
        decimalStringsEqual(found.units.toString(), r.qty) &&
        decimalStringsEqual(found.salesNet.toString(), r.salesNet) &&
        found.sku.toUpperCase() === r.partNumber.toUpperCase();
      diagnostics.push(
        makeDiagnostic({
          status: identical ? "UNCHANGED" : "UPDATED",
          reasonCode: identical ? "ALREADY_IMPORTED" : "UPDATED",
          rowNumber: r.lineNumber,
          customerAccount: r.customerAccount,
          documentReference: r.documentNumber,
          documentDate: r.documentDate,
          sku: r.partNumber,
          description: r.description,
          quantity: r.qty,
          salesNet: r.salesNet,
          companyId: mapped.companyId,
          isWarning: !inCatalogue,
        }),
      );
    } else {
      newLines += 1;
      diagnostics.push(
        makeDiagnostic({
          status: "INSERTED",
          reasonCode: inCatalogue ? "INSERTED" : "NOT_IN_AB_CATALOGUE",
          rowNumber: r.lineNumber,
          customerAccount: r.customerAccount,
          documentReference: r.documentNumber,
          documentDate: r.documentDate,
          sku: r.partNumber,
          description: r.description,
          quantity: r.qty,
          salesNet: r.salesNet,
          companyId: mapped.companyId,
          isWarning: !inCatalogue,
        }),
      );
    }
  }
  const counts = countsFromDrafts(diagnostics);

  await recordAuditEvent({
    action: "autopart.ongoing_trm21qc_previewed",
    entityType: "AutopartCustomerImportRun",
    entityId: null,
    actorUserId,
    metadata: {
      filename: raw.filename ?? null,
      rows: ok.length,
      wouldInsert: counts.inserted,
      wouldUpdate: counts.updated,
      wouldSkip: counts.skipped,
    },
  });

  return {
    headerFound: parsed.headerFound,
    errors: parsed.errors,
    rows: ok.length,
    documents: parsed.documents.length,
    invoiceLines: parsed.invoiceLines.length,
    creditLines: parsed.creditLines.length,
    netSales: netSales.toFixed(2),
    signedQty: signedQty.toFixed(3),
    matchedSkus,
    notInCatalogue: ok.length - matchedSkus,
    matchedCustomers,
    unmatchedCustomers,
    existingLines,
    newLines,
    invalidRows: parsed.malformedRows,
    wouldInsert: counts.inserted,
    wouldUpdate: counts.updated + counts.unchanged,
    wouldSkip: counts.skipped + counts.errors,
    warningCount: counts.warnings,
    errorCount: counts.errors,
    diagnostics: diagnostics.filter((d) => d.reasonCode !== "BLANK_ROW").slice(0, 300),
    sample: diagnostics
      .filter((d) => d.reasonCode !== "BLANK_ROW")
      .slice(0, 80)
      .map((d) => ({
        customerAccount: d.customerAccount ?? "",
        document: d.documentReference ?? "",
        date: d.documentDate ?? null,
        sku: d.sku ?? "",
        description: d.description ?? null,
        qty: d.quantity ?? null,
        salesNet: d.salesNet ?? null,
        productMatch: d.reasonCode === "NOT_IN_AB_CATALOGUE" || d.isWarning
          ? "NOT_IN_AB_CATALOGUE"
          : d.sku
            ? "MATCHED"
            : "—",
        customerMatch: d.reasonCode === "UNMAPPED_CUSTOMER" ? "UNMAPPED" : "MATCHED",
        status: d.status,
        reasonCode: d.reasonCode,
      })),
  };
}

function historicTypeFrom504(row: Autopart504Row): AutopartHistoricDocumentType {
  if (row.kind === "CREDIT") return "CREDIT";
  if (row.kind === "INVOICE") return "INVOICE";
  return "UNKNOWN";
}

async function refreshDocumentReconciliation(documentId: string) {
  const doc = await prisma.autopartSalesDocument.findUnique({
    where: { id: documentId },
    include: { lines: { select: { salesNet: true } } },
  });
  if (!doc) return;
  const result = reconcile504GoodsToTrmSales({
    goods504: doc.goodsNet?.toString() ?? null,
    trmSalesNets: doc.lines.map((l) => l.salesNet.toString()),
    has504: doc.has504,
    hasTrm21qc: doc.hasTrm21qc,
  });
  let status: Prisma.AutopartSalesDocumentUpdateInput["reconciliationStatus"] = result.status;
  if (doc.documentType === "UNKNOWN") status = "UNKNOWN_DOCUMENT_TYPE";
  else if (!doc.companyId) status = "UNMAPPED_CUSTOMER";
  else if (result.status === "MATCHED" && doc.has504 && doc.hasTrm21qc) status = "COMPLETE";

  await prisma.autopartSalesDocument.update({
    where: { id: documentId },
    data: {
      reconciliationStatus: status as never,
      linesNetSum: result.linesNetSum,
      valueMismatchMinor: result.mismatchMinor,
    },
  });
}

/**
 * Build a minimal 504C-shaped text so we can reuse AB invoice despatch apply
 * for AB-matching 504 invoice/credit rows without rewriting proven logic.
 */
function build504cBridgeText(rows: Autopart504Row[]): string {
  const abRows = rows.filter(
    (r) =>
      (r.classification === "AB_INVOICE" || r.classification === "AB_CREDIT") && r.abOrderNumber,
  );
  const lines = [
    "LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)",
    AUTOPART_504C_HEADER,
    AUTOPART_504C_SEPARATOR,
    ...abRows.map((r) =>
      format504cDataRow({
        document: r.documentNumber,
        date: r.documentDate
          ? `${r.documentDate.slice(8, 10)}/${r.documentDate.slice(5, 7)}/${r.documentDate.slice(0, 4)}`
          : "01/01/2026",
        time: r.documentTime ?? "12:00",
        account: "AB504",
        customer: r.customerName.slice(0, 28) || "CUSTOMER",
        goods: r.goods ?? "0.00",
        vat: r.vat ?? "0.00",
        value: r.value ?? "0.00",
        inits: (r.initials ?? "XX").slice(0, 4),
        orderNumber: r.abOrderNumber!,
      }),
    ),
    "*** END OF REPORT ***",
  ];
  return lines.join("\n");
}

export async function confirmAutopart504Import(
  actorUserId: string | null,
  raw: { text: string; filename?: string; source?: "MANUAL" | "EMAIL" | "SCHEDULE" },
) {
  await assertOngoingImportActor(actorUserId);
  if (!isAutopart504Report(raw.text)) {
    throw new AuthError("File does not look like an Autopart 504 report", "VALIDATION", 400);
  }
  const parsed = parseAutopart504Report(raw.text);
  const hash = fileHash(raw.text);
  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      type: "ONGOING_504",
      status: "PROCESSING",
      filename: raw.filename ?? "504.csv",
      fileHash: hash,
      dryRun: false,
      createdById: actorUserId,
      rowsRead: parsed.rows.length,
      diagnostics: {
        source: raw.source ?? "MANUAL",
        headerFound: parsed.headerFound,
        layoutMode: parsed.layoutMode,
        errors: parsed.errors,
        warnings: parsed.warnings,
      },
    },
  });

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  const diagnosticDrafts: AutopartImportDiagnosticDraft[] = [];
  const touchedDocIds: string[] = [];

  try {
    for (const row of parsed.rows) {
      if (row.classification === "BLANK") {
        skipped += 1;
        diagnosticDrafts.push(
          makeDiagnostic({
            status: "SKIPPED",
            reasonCode: "BLANK_ROW",
            rowNumber: row.lineNumber,
          }),
        );
        continue;
      }
      if (row.classification === "HEADER" || row.classification === "PAGE") {
        continue;
      }
      if (isAutopart504ArtefactRow(row)) {
        skipped += 1;
        diagnosticDrafts.push(
          makeDiagnostic({
            status: "SKIPPED",
            reasonCode: "UNRECOGNISED_ROW_TYPE",
            rowNumber: row.lineNumber,
            salesNet: row.goods,
            reason: `Line ${row.lineNumber}: ${row.classification.toLowerCase()} ignored (not a document)`,
          }),
        );
        continue;
      }
      if (!row.documentNumber || row.classification === "MALFORMED") {
        skipped += 1;
        diagnosticDrafts.push(
          makeDiagnostic({
            status: "ERROR",
            reasonCode: row.documentNumber ? "MALFORMED_ROW" : "MISSING_DOCUMENT",
            rowNumber: row.lineNumber,
            documentReference: row.documentNumber || null,
            documentDate: row.documentDate,
            customerOrderNumber: row.customerOrderNumber || null,
            abOrderReference: row.abOrderNumber,
            salesNet: row.goods,
            reason: describeAutopart504Malformed(row),
          }),
        );
        continue;
      }
      const documentType = historicTypeFrom504(row);
      let companyId: string | null = null;
      let autopartCustomerCode = "UNKNOWN";
      let abOrderId: string | null = null;

      if (row.abOrderNumber) {
        const order = await prisma.order.findUnique({
          where: { orderNumber: row.abOrderNumber },
          select: {
            id: true,
            companyId: true,
            company: { select: { autopartCustomerCode: true } },
          },
        });
        if (order) {
          companyId = order.companyId;
          abOrderId = order.id;
          autopartCustomerCode = order.company.autopartCustomerCode ?? "UNKNOWN";
        }
      }

      // Prefer existing historic/ongoing row for this Autopart document number.
      // Never create a second financial sale for the same Autopart document.
      const existing =
        (companyId
          ? await prisma.autopartSalesDocument.findFirst({
              where: {
                companyId,
                documentReference: row.documentNumber,
              },
              orderBy: { createdAt: "asc" },
            })
          : null) ??
        (await prisma.autopartSalesDocument.findFirst({
          where: { documentReference: row.documentNumber },
          orderBy: [{ has504: "desc" }, { createdAt: "asc" }],
        }));

      if (existing) {
        const identical =
          decimalStringsEqual(existing.goodsNet?.toString(), row.goods) &&
          decimalStringsEqual(existing.vat?.toString(), row.vat) &&
          decimalStringsEqual(existing.grossTotal?.toString(), row.value);
        await prisma.autopartSalesDocument.update({
          where: { id: existing.id },
          data: {
            companyId: companyId ?? existing.companyId,
            autopartCustomerCode:
              autopartCustomerCode !== "UNKNOWN" ? autopartCustomerCode : existing.autopartCustomerCode,
            documentDate: utcNoon(row.documentDate) ?? existing.documentDate,
            goodsNet: row.goods ?? existing.goodsNet?.toString() ?? null,
            vat: row.vat ?? existing.vat?.toString() ?? null,
            grossTotal: row.value ?? existing.grossTotal?.toString() ?? null,
            source: existing.source.includes("ONGOING")
              ? existing.source
              : existing.source === "561L" || existing.source === "SLRB"
                ? existing.source
                : "ONGOING_504",
            importRunId: run.id,
            has504: true,
            customerOrderNumber: row.customerOrderNumber || existing.customerOrderNumber,
            customerNameSnapshot: row.customerName || existing.customerNameSnapshot,
            initialsSnapshot: row.initials,
            reportType504: row.reportType,
            abOrderId: abOrderId ?? existing.abOrderId,
            abOrderNumber: row.abOrderNumber ?? existing.abOrderNumber,
            // Preserve historic type when already classified; otherwise apply 504 evidence.
            documentType:
              existing.documentType !== "UNKNOWN" ? existing.documentType : documentType,
          },
        });
        if (companyId) {
          await prisma.autopartSalesLine.updateMany({
            where: { documentId: existing.id, companyId: null },
            data: { companyId },
          });
        }
        touchedDocIds.push(existing.id);
        if (identical) {
          unchanged += 1;
          diagnosticDrafts.push(
            makeDiagnostic({
              status: "UNCHANGED",
              reasonCode: "ALREADY_IMPORTED",
              rowNumber: row.lineNumber,
              documentReference: row.documentNumber,
              documentDate: row.documentDate,
              customerOrderNumber: row.customerOrderNumber || null,
              abOrderReference: row.abOrderNumber,
              companyId: companyId ?? existing.companyId,
              abOrderId: abOrderId ?? existing.abOrderId,
              salesNet: row.goods,
            }),
          );
        } else {
          updated += 1;
          diagnosticDrafts.push(
            makeDiagnostic({
              status: "UPDATED",
              reasonCode: "UPDATED",
              rowNumber: row.lineNumber,
              documentReference: row.documentNumber,
              documentDate: row.documentDate,
              customerOrderNumber: row.customerOrderNumber || null,
              abOrderReference: row.abOrderNumber,
              companyId: companyId ?? existing.companyId,
              abOrderId: abOrderId ?? existing.abOrderId,
              salesNet: row.goods,
            }),
          );
        }
      } else {
        const created = await prisma.autopartSalesDocument.create({
          data: {
            companyId,
            autopartCustomerCode,
            documentType,
            documentReference: row.documentNumber,
            documentDate: utcNoon(row.documentDate),
            goodsNet: row.goods,
            vat: row.vat,
            grossTotal: row.value,
            source: "ONGOING_504",
            importRunId: run.id,
            has504: true,
            hasTrm21qc: false,
            customerOrderNumber: row.customerOrderNumber || null,
            customerNameSnapshot: row.customerName || null,
            initialsSnapshot: row.initials,
            reportType504: row.reportType,
            abOrderId,
            abOrderNumber: row.abOrderNumber,
            reconciliationStatus: companyId ? "AWAITING_LINES" : "UNMAPPED_CUSTOMER",
          },
        });
        touchedDocIds.push(created.id);
        imported += 1;
        diagnosticDrafts.push(
          makeDiagnostic({
            status: "INSERTED",
            reasonCode: "INSERTED",
            rowNumber: row.lineNumber,
            documentReference: row.documentNumber,
            documentDate: row.documentDate,
            customerOrderNumber: row.customerOrderNumber || null,
            abOrderReference: row.abOrderNumber,
            companyId,
            abOrderId,
            salesNet: row.goods,
          }),
        );
      }
    }

    for (const id of [...new Set(touchedDocIds)]) {
      await refreshDocumentReconciliation(id);
    }

    const fulfilmentSettings = await read504TrmFulfilmentSettings();
    // Legacy 504C bridge remains only while 504/TRM fulfilment is OFF.
    // PREVIEW/ACTIVE must not let 504C mutate the same orders.
    if (shouldBridge504To504c(fulfilmentSettings.fulfilmentMode)) {
      const bridge = build504cBridgeText(parsed.rows);
      if (bridge.includes(AUTOPART_504C_SEPARATOR) && parsed.abInvoiceRows.length + parsed.abCreditRows.length > 0) {
        try {
          await applyAutopart504cFile(actorUserId, {
            text: bridge,
            filename: `bridge-from-504-${raw.filename ?? "504.csv"}`,
            source: "ONGOING_504_BRIDGE",
            allowApply: true,
          });
        } catch (err) {
          await recordAuditEvent({
            action: "autopart.ongoing_504_despatch_bridge_failed",
            entityType: "AutopartCustomerImportRun",
            entityId: run.id,
            actorUserId: actorUserId ?? null,
            metadata: { error: err instanceof Error ? err.message : "unknown" },
          });
        }
      }
    } else {
      await run504TrmFulfilmentAfterImport(actorUserId).catch((err) =>
        recordAuditEvent({
          action: "autopart.504_trm_fulfilment_failed",
          entityType: "AutopartCustomerImportRun",
          entityId: run.id,
          actorUserId: actorUserId ?? null,
          metadata: { error: err instanceof Error ? err.message : "unknown", feed: "504" },
        }),
      );
    }

    await persistImportDiagnostics(run.id, diagnosticDrafts);
    const counts = countsFromDrafts(diagnosticDrafts);

    const finished = await prisma.autopartCustomerImportRun.update({
      where: { id: run.id },
      data: {
        status: "COMMITTED",
        completedAt: new Date(),
        rowsImported: imported,
        rowsUpdated: updated,
        rowsSkipped: skipped,
        rowsValid: imported + updated + unchanged,
        diagnostics: {
          source: raw.source ?? "MANUAL",
          headerFound: parsed.headerFound,
          layoutMode: parsed.layoutMode,
          errors: parsed.errors,
          warnings: parsed.warnings,
          grandTotal: parsed.grandTotal,
          abInvoices: parsed.abInvoiceRows.length,
          abCredits: parsed.abCreditRows.length,
          counts,
          hasRowDiagnostics: true,
        },
      },
    });

    await prisma.autopartOngoingSalesFeedSettings.update({
      where: { id: "default" },
      data: { lastSuccess504At: new Date() },
    }).catch(() => undefined);

    await recordAuditEvent({
      action: "autopart.ongoing_504_imported",
      entityType: "AutopartCustomerImportRun",
      entityId: run.id,
      actorUserId: actorUserId ?? null,
      metadata: {
        imported,
        updated,
        unchanged,
        skipped,
        filename: raw.filename ?? null,
      },
    });

    return finished;
  } catch (error) {
    await prisma.autopartCustomerImportRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        issues: { error: error instanceof Error ? error.message : "import failed" },
      },
    });
    throw error;
  }
}

export async function confirmAutopartTrm21qcImport(
  actorUserId: string | null,
  raw: { text: string; filename?: string; source?: "MANUAL" | "EMAIL" | "SCHEDULE" },
) {
  await assertOngoingImportActor(actorUserId);
  if (!isAutopartTrm21qcReport(raw.text)) {
    throw new AuthError("File does not look like an Autopart TRM21QC report", "VALIDATION", 400);
  }
  const parsed = parseAutopartTrm21qcReport(raw.text);
  const hash = fileHash(raw.text);
  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      type: "ONGOING_TRM21QC",
      status: "PROCESSING",
      filename: raw.filename ?? "TRM21QC.csv",
      fileHash: hash,
      dryRun: false,
      createdById: actorUserId,
      rowsRead: parsed.rows.length,
      diagnostics: {
        source: raw.source ?? "MANUAL",
        headerFound: parsed.headerFound,
        errors: parsed.errors,
      },
    },
  });

  const ok = parsed.rows.filter((r) => r.classification === "OK");
  const stable = assignStableTrm21qcLineNumbers(ok);
  const skuMap = await resolveSkuMap(ok.map((r) => r.partNumber));
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  let unmatchedCustomers = 0;
  const diagnosticDrafts: AutopartImportDiagnosticDraft[] = [];
  const touchedDocIds = new Set<string>();

  try {
    for (const row of parsed.rows) {
      if (row.classification === "BLANK") {
        diagnosticDrafts.push(
          makeDiagnostic({
            status: "SKIPPED",
            reasonCode: "BLANK_ROW",
            rowNumber: row.lineNumber,
          }),
        );
      } else if (row.classification === "MALFORMED") {
        skipped += 1;
        diagnosticDrafts.push(
          makeDiagnostic({
            status: "ERROR",
            reasonCode: trm21qcMalformedToReasonCode(row.malformedReason),
            rowNumber: row.lineNumber,
            customerAccount: row.customerAccount || null,
            documentReference: row.documentNumber || null,
            sku: row.partNumber || null,
            description: row.description,
            quantity: row.qty,
            salesNet: row.salesNet,
          }),
        );
      }
    }

    // Group by document for header upsert
    const byDoc = new Map<string, typeof stable>();
    for (const row of stable) {
      const list = byDoc.get(row.documentNumber) ?? [];
      list.push(row);
      byDoc.set(row.documentNumber, list);
    }

    for (const [documentNumber, lines] of byDoc) {
      const first = lines[0]!;
      const mapped = await resolveCompanyByAutopartCode(first.customerAccount);

      const creditNet = lines
        .filter((l) => l.kind === "CREDIT")
        .reduce((s, l) => s + Number(l.salesNet ?? 0), 0);
      const invoiceNet = lines
        .filter((l) => l.kind === "INVOICE")
        .reduce((s, l) => s + Number(l.salesNet ?? 0), 0);
      // TRM21QC lines for a credit document are all negative — classify from first line.
      const documentType: AutopartHistoricDocumentType =
        first.kind === "CREDIT" || (creditNet < 0 && invoiceNet === 0) ? "CREDIT" : "INVOICE";

      let doc =
        (mapped
          ? await prisma.autopartSalesDocument.findFirst({
              where: {
                companyId: mapped.companyId,
                documentReference: documentNumber,
              },
              orderBy: { createdAt: "asc" },
            })
          : null) ??
        (await prisma.autopartSalesDocument.findFirst({
          where: { documentReference: documentNumber },
          orderBy: [{ hasTrm21qc: "desc" }, { has504: "desc" }, { createdAt: "asc" }],
        }));

      // Prefer exact Cust mapping; fall back to company already linked via 504/AB order.
      const companyId = mapped?.companyId ?? doc?.companyId ?? null;
      const autopartCustomerCode =
        mapped?.code ??
        (first.customerAccount.toUpperCase() || doc?.autopartCustomerCode || "UNKNOWN");

      if (!companyId || !mapped) unmatchedCustomers += 1;

      if (doc) {
        const preserveHistoric =
          doc.source === "561L" || doc.source === "SLRB" || doc.source.includes("HISTORIC");
        doc = await prisma.autopartSalesDocument.update({
          where: { id: doc.id },
          data: {
            companyId,
            autopartCustomerCode,
            documentDate: utcNoon(first.documentDate) ?? doc.documentDate,
            hasTrm21qc: true,
            source: preserveHistoric
              ? doc.source
              : doc.has504
                ? "ONGOING_504"
                : "ONGOING_TRM21QC",
            importRunId: run.id,
            documentType: doc.documentType !== "UNKNOWN" ? doc.documentType : documentType,
            ...(!mapped ? { reconciliationStatus: "UNMAPPED_CUSTOMER" as const } : {}),
          },
        });
      } else {
        doc = await prisma.autopartSalesDocument.create({
          data: {
            companyId,
            autopartCustomerCode,
            documentType,
            documentReference: documentNumber,
            documentDate: utcNoon(first.documentDate),
            source: "ONGOING_TRM21QC",
            importRunId: run.id,
            has504: false,
            hasTrm21qc: true,
            reconciliationStatus: mapped ? "AWAITING_504" : "UNMAPPED_CUSTOMER",
          },
        });
      }
      touchedDocIds.add(doc.id);

      for (const line of lines) {
        const variantId = skuMap.get(line.partNumber.toUpperCase()) ?? null;
        const data = {
          companyId,
          documentId: doc.id,
          autopartCustomerCode,
          documentType: doc.documentType,
          documentReference: documentNumber,
          lineNumber: line.stableLineNumber,
          sku: line.partNumber,
          descriptionSnapshot: line.description,
          units: line.qty ?? "0",
          salesNet: line.salesNet ?? "0",
          matchedVariantId: variantId,
          matchStatus: variantId ? ("MATCHED" as const) : ("NOT_IN_AB_CATALOGUE" as const),
          sourceFingerprint: line.sourceFingerprint,
          sourceCost: line.cost,
          sourceMargin: line.margin,
          sourcePerc: line.perc,
          source: "ONGOING_TRM21QC",
          importRunId: run.id,
        };
        const existingLine =
          (await prisma.autopartSalesLine.findUnique({
            where: {
              documentId_lineNumber: {
                documentId: doc.id,
                lineNumber: line.stableLineNumber,
              },
            },
          })) ??
          (companyId
            ? await prisma.autopartSalesLine.findUnique({
                where: {
                  companyId_documentType_documentReference_lineNumber: {
                    companyId,
                    documentType: doc.documentType,
                    documentReference: documentNumber,
                    lineNumber: line.stableLineNumber,
                  },
                },
              })
            : await prisma.autopartSalesLine.findFirst({
                where: {
                  companyId: null,
                  documentType: doc.documentType,
                  documentReference: documentNumber,
                  lineNumber: line.stableLineNumber,
                },
              }));
        if (existingLine) {
          const identical =
            decimalStringsEqual(existingLine.units.toString(), line.qty) &&
            decimalStringsEqual(existingLine.salesNet.toString(), line.salesNet) &&
            existingLine.sku.toUpperCase() === line.partNumber.toUpperCase();
          await prisma.autopartSalesLine.update({ where: { id: existingLine.id }, data });
          if (identical) {
            unchanged += 1;
            diagnosticDrafts.push(
              makeDiagnostic({
                status: "UNCHANGED",
                reasonCode: "ALREADY_IMPORTED",
                rowNumber: line.lineNumber,
                customerAccount: line.customerAccount,
                documentReference: documentNumber,
                documentDate: line.documentDate,
                sku: line.partNumber,
                description: line.description,
                quantity: line.qty,
                salesNet: line.salesNet,
                companyId,
                isWarning: !mapped || !variantId,
              }),
            );
          } else {
            updated += 1;
            diagnosticDrafts.push(
              makeDiagnostic({
                status: "UPDATED",
                reasonCode: "UPDATED",
                rowNumber: line.lineNumber,
                customerAccount: line.customerAccount,
                documentReference: documentNumber,
                documentDate: line.documentDate,
                sku: line.partNumber,
                description: line.description,
                quantity: line.qty,
                salesNet: line.salesNet,
                companyId,
                isWarning: !mapped || !variantId,
              }),
            );
          }
        } else {
          await prisma.autopartSalesLine.create({ data });
          imported += 1;
          diagnosticDrafts.push(
            makeDiagnostic({
              status: "INSERTED",
              reasonCode: !mapped ? "UNMAPPED_CUSTOMER" : variantId ? "INSERTED" : "NOT_IN_AB_CATALOGUE",
              rowNumber: line.lineNumber,
              customerAccount: line.customerAccount,
              documentReference: documentNumber,
              documentDate: line.documentDate,
              sku: line.partNumber,
              description: line.description,
              quantity: line.qty,
              salesNet: line.salesNet,
              companyId,
              isWarning: !mapped || !variantId,
            }),
          );
        }
      }
    }

    for (const id of touchedDocIds) {
      await refreshDocumentReconciliation(id);
    }

    await persistImportDiagnostics(run.id, diagnosticDrafts);
    const counts = countsFromDrafts(diagnosticDrafts);

    const finished = await prisma.autopartCustomerImportRun.update({
      where: { id: run.id },
      data: {
        status: "COMMITTED",
        completedAt: new Date(),
        rowsImported: imported,
        rowsUpdated: updated,
        rowsSkipped: skipped,
        rowsValid: imported + updated + unchanged,
        rowsUnmatched: unmatchedCustomers,
        diagnostics: {
          source: raw.source ?? "MANUAL",
          headerFound: parsed.headerFound,
          errors: parsed.errors,
          unmatchedCustomers,
          documents: parsed.documents.length,
          counts,
          hasRowDiagnostics: true,
        },
      },
    });

    await prisma.autopartOngoingSalesFeedSettings.update({
      where: { id: "default" },
      data: { lastSuccessTrm21qcAt: new Date() },
    }).catch(() => undefined);

    await recordAuditEvent({
      action: "autopart.ongoing_trm21qc_imported",
      entityType: "AutopartCustomerImportRun",
      entityId: run.id,
      actorUserId: actorUserId ?? null,
      metadata: {
        imported,
        updated,
        unchanged,
        skipped,
        unmatchedCustomers,
        filename: raw.filename ?? null,
      },
    });

    const fulfilmentSettings = await read504TrmFulfilmentSettings();
    if (!shouldBridge504To504c(fulfilmentSettings.fulfilmentMode)) {
      await run504TrmFulfilmentAfterImport(actorUserId).catch((err) =>
        recordAuditEvent({
          action: "autopart.504_trm_fulfilment_failed",
          entityType: "AutopartCustomerImportRun",
          entityId: run.id,
          actorUserId: actorUserId ?? null,
          metadata: { error: err instanceof Error ? err.message : "unknown", feed: "TRM21QC" },
        }),
      );
    }

    return finished;
  } catch (error) {
    await prisma.autopartCustomerImportRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        issues: { error: error instanceof Error ? error.message : "import failed" },
      },
    });
    throw error;
  }
}

export async function listOngoingSalesImportRuns(actorUserId: string, limit = 25) {
  await requireOngoingSalesAdmin(actorUserId);
  const runs = await prisma.autopartCustomerImportRun.findMany({
    where: { type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] } },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, limit)),
    select: {
      id: true,
      type: true,
      status: true,
      filename: true,
      createdAt: true,
      completedAt: true,
      rowsRead: true,
      rowsImported: true,
      rowsUpdated: true,
      rowsSkipped: true,
      rowsUnmatched: true,
      diagnostics: true,
      dryRun: true,
      _count: { select: { rowDiagnostics: true } },
    },
  });
  return runs.map((run) => {
    const diag = (run.diagnostics ?? {}) as Record<string, unknown>;
    const counts = diag["counts"] as
      | {
          inserted?: number;
          updated?: number;
          unchanged?: number;
          skipped?: number;
          warnings?: number;
          errors?: number;
        }
      | undefined;
    return {
      id: run.id,
      type: run.type,
      feed: run.type === "ONGOING_504" ? "504" : "TRM21QC",
      status: run.status,
      filename: run.filename,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      rowsRead: run.rowsRead,
      rowsImported: run.rowsImported,
      rowsUpdated: run.rowsUpdated,
      rowsSkipped: run.rowsSkipped,
      rowsUnmatched: run.rowsUnmatched,
      rowsUnchanged: counts?.unchanged ?? 0,
      warnings: counts?.warnings ?? 0,
      errors: counts?.errors ?? 0,
      source:
        diag["source"] === "EMAIL" || diag["source"] === "EMAIL_POLL"
          ? "EMAIL_POLL"
          : diag["source"] === "SCHEDULE" || diag["source"] === "SCHEDULED_POLL"
            ? "SCHEDULED_POLL"
            : "MANUAL_UPLOAD",
      hasRowDiagnostics: run._count.rowDiagnostics > 0 || Boolean(diag["hasRowDiagnostics"]),
      dryRun: run.dryRun,
    };
  });
}

export async function getOngoingSalesFreshness(actorUserId: string) {
  await requireOngoingSalesAdmin(actorUserId);
  return readOngoingSalesFreshness();
}

/** Freshness for Sales Intelligence (internal viewers — not admin-only). */
export async function getSalesDataFreshnessForIntelligence(actorUserId: string) {
  await requireSystemPermission(actorUserId, "sales_intelligence.view");
  return readOngoingSalesFreshness();
}

async function readOngoingSalesFreshness() {
  const settings = await getOrCreateOngoingSettings();
  const last504 = settings.lastSuccess504At;
  const lastTrm = settings.lastSuccessTrm21qcAt;
  const latest =
    last504 && lastTrm
      ? last504 > lastTrm
        ? last504
        : lastTrm
      : last504 ?? lastTrm ?? null;
  const bothPresent = Boolean(last504 && lastTrm);
  const skewMinutes =
    last504 && lastTrm
      ? Math.abs(last504.getTime() - lastTrm.getTime()) / 60_000
      : null;
  return {
    lastSuccess504At: last504?.toISOString() ?? null,
    lastSuccessTrm21qcAt: lastTrm?.toISOString() ?? null,
    salesDataUpdatedAt: latest?.toISOString() ?? null,
    feedsAligned: bothPresent && (skewMinutes == null || skewMinutes <= 120),
    enabled: settings.enabled,
    configured: settings.configured,
    scheduleHours: JSON.parse(settings.scheduleHoursJson) as number[],
  };
}

/** Detect and import supported attachments from IMAP poll batch. */
export async function ingestOngoingSalesAttachment(
  actorUserId: string | null,
  input: { filename: string; text: string; source?: "MANUAL" | "EMAIL" | "SCHEDULE" },
): Promise<{ report: "504" | "TRM21QC" | "UNKNOWN"; runId?: string }> {
  const name = input.filename;
  if (isAutopart504Report(input.text) && !name.toUpperCase().includes("504C")) {
    // Prefer content; exclude 504C by content detector inside isAutopart504Report
    const run = await confirmAutopart504Import(actorUserId, {
      text: input.text,
      filename: name,
      source: input.source ?? "EMAIL",
    });
    return { report: "504", runId: run.id };
  }
  if (isAutopartTrm21qcReport(input.text) || name.toUpperCase().includes("TRM21QC")) {
    if (!isAutopartTrm21qcReport(input.text)) {
      return { report: "UNKNOWN" };
    }
    const run = await confirmAutopartTrm21qcImport(actorUserId, {
      text: input.text,
      filename: name,
      source: input.source ?? "EMAIL",
    });
    return { report: "TRM21QC", runId: run.id };
  }
  return { report: "UNKNOWN" };
}
