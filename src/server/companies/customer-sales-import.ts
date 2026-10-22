/**
 * Manual Autopart sales import for one customer.
 * Writes only through the ongoing 504 and TRM21QC importers, with a customer
 * scope that rejects every other account. Fulfilment, stock, and email stay off.
 * Historical 561L and SLRB reports are refused.
 */

import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants } from "@/server/rbac/access";
import {
  isAutopart504ImportableRow,
  parseAutopart504Report,
} from "@/domain/autopart-504";
import { parseAutopartTrm21qcReport } from "@/domain/autopart-trm21qc";
import {
  CUSTOMER_SALES_IMPORT_EFFECTS,
  CUSTOMER_SALES_SOURCE_ASSESSMENT,
  accountInCustomerScope,
  classifyCustomerSalesReport,
  type CustomerSalesReportKind,
  type CustomerSalesScope,
} from "@/domain/customer-sales-import";
import {
  confirmAutopart504Import,
  confirmAutopartTrm21qcImport,
} from "@/server/companies/autopart-ongoing-sales";

const MAX_REPORT_CHARS = 5_000_000;
const PREVIEW_ROW_LIMIT = 100;

export type CustomerSalesPreviewRow = {
  document: string;
  type: string;
  date: string | null;
  account: string;
  amount: string | null;
  disposition: "import" | "update" | "duplicate" | "skipped" | "rejected";
  reason: string;
};

export type CustomerSalesPreview = {
  canCommit: boolean;
  kind: CustomerSalesReportKind;
  assessment: string;
  effects: typeof CUSTOMER_SALES_IMPORT_EFFECTS;
  companyId: string;
  companyName: string;
  accountCode: string;
  message: string | null;
  counts: {
    import: number;
    update: number;
    duplicate: number;
    skipped: number;
    rejected: number;
  };
  rows: CustomerSalesPreviewRow[];
  rowCount: number;
};

async function requireCustomerSalesImporter(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!grants(profile, "admin.access", "orders.edit")) {
    throw new AuthError("Not permitted to import customer sales", "FORBIDDEN", 403);
  }
}

async function loadCustomerSalesTarget(companyId: string, accountCode: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      status: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      autopartAccountAliases: { select: { alias: true } },
      salesCutover: { select: { historyStatus: true } },
    },
  });
  if (!company) throw new AuthError("Customer not found", "NOT_FOUND", 404);
  if (company.status !== "ACTIVE") {
    throw new AuthError("Ongoing sales are stored only for an Active customer.", "VALIDATION", 400);
  }
  if (company.salesCutover?.historyStatus !== "COMPLETE") {
    throw new AuthError(
      "Complete Import Sales History, or record that this customer has no historical sales, before importing 504 or TRM21QC.",
      "VALIDATION",
      400,
    );
  }
  if (!company.autopartCustomerCode || !company.autopartCustomerCodeVerifiedAt) {
    throw new AuthError(
      "Verify this customer's Autopart account before importing sales.",
      "VALIDATION",
      400,
    );
  }
  const selected = accountCode.trim().toUpperCase();
  const canonical = company.autopartCustomerCode.trim().toUpperCase();
  const aliases = company.autopartAccountAliases.map((alias) => alias.alias.trim().toUpperCase());
  if (selected !== canonical && !aliases.includes(selected)) {
    throw new AuthError(
      "That Autopart account is not verified for this customer.",
      "VALIDATION",
      400,
    );
  }
  const scope: CustomerSalesScope = { companyId: company.id, accountCodes: [selected] };
  return { company, scope, accountCode: selected };
}

function moneyKey(value: { toString(): string } | string | null | undefined): string {
  if (value == null) return "";
  const raw = typeof value === "string" ? value : value.toString();
  if (!raw.trim()) return "";
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount.toFixed(2) : raw.trim();
}

function emptyCounts(): CustomerSalesPreview["counts"] {
  return { import: 0, update: 0, duplicate: 0, skipped: 0, rejected: 0 };
}

function pushRow(
  rows: CustomerSalesPreviewRow[],
  counts: CustomerSalesPreview["counts"],
  row: CustomerSalesPreviewRow,
) {
  counts[row.disposition] += 1;
  if (rows.length < PREVIEW_ROW_LIMIT) rows.push(row);
}

export async function listCustomerSalesAccounts(actorUserId: string, companyId: string) {
  await requireCustomerSalesImporter(actorUserId);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      status: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      autopartAccountAliases: { select: { alias: true }, orderBy: { alias: "asc" } },
      salesCutover: { select: { historyStatus: true, historyFrom: true, historyTo: true } },
    },
  });
  if (!company) throw new AuthError("Customer not found", "NOT_FOUND", 404);
  const verified = Boolean(company.autopartCustomerCode && company.autopartCustomerCodeVerifiedAt);
  const accounts = [
    ...(company.autopartCustomerCode
      ? [{ code: company.autopartCustomerCode, kind: "primary" as const, verified }]
      : []),
    ...company.autopartAccountAliases.map((alias) => ({
      code: alias.alias,
      kind: "alias" as const,
      verified: true,
    })),
  ];
  return {
    companyId: company.id,
    companyName: company.name,
    verified,
    accounts,
    assessment: CUSTOMER_SALES_SOURCE_ASSESSMENT,
    effects: CUSTOMER_SALES_IMPORT_EFFECTS,
    status: company.status,
    historyStatus: company.salesCutover?.historyStatus ?? "NOT_STARTED",
    historyFrom: company.salesCutover?.historyFrom?.toISOString().slice(0, 10) ?? null,
    historyTo: company.salesCutover?.historyTo?.toISOString().slice(0, 10) ?? null,
  };
}

export async function previewCustomerSalesImport(
  actorUserId: string,
  input: { companyId: string; accountCode: string; text: string; filename?: string },
): Promise<CustomerSalesPreview> {
  await requireCustomerSalesImporter(actorUserId);
  if (input.text.length > MAX_REPORT_CHARS) {
    throw new AuthError("Report is too large to preview.", "VALIDATION", 400);
  }
  const target = await loadCustomerSalesTarget(input.companyId, input.accountCode);
  const kind = classifyCustomerSalesReport(input.text);
  const counts = emptyCounts();
  const rows: CustomerSalesPreviewRow[] = [];
  let message: string | null = null;
  let canCommit = false;

  if (kind === "HISTORICAL_561L_SLRB") {
    message =
      "561L and SLRB belong in Import Sales History. This upload accepts ongoing 504 and TRM21QC reports only.";
    pushRow(rows, counts, {
      document: "",
      type: "HISTORICAL",
      date: null,
      account: target.accountCode,
      amount: null,
      disposition: "rejected",
      reason: message,
    });
  } else if (kind === "UNKNOWN") {
    message = "File is not an Autopart 504 or TRM21QC report.";
    pushRow(rows, counts, {
      document: "",
      type: "UNKNOWN",
      date: null,
      account: target.accountCode,
      amount: null,
      disposition: "rejected",
      reason: message,
    });
  } else if (kind === "TRM21QC") {
    canCommit = true;
    await previewTrm(target.scope, input.text, rows, counts);
  } else {
    canCommit = true;
    await preview504(target.scope, input.text, rows, counts);
  }

  if (canCommit && counts.import + counts.update + counts.duplicate === 0) {
    canCommit = false;
    message = "Nothing in this report can be imported for the selected Autopart account.";
  }

  const preview: CustomerSalesPreview = {
    canCommit,
    kind,
    assessment: CUSTOMER_SALES_SOURCE_ASSESSMENT,
    effects: CUSTOMER_SALES_IMPORT_EFFECTS,
    companyId: target.company.id,
    companyName: target.company.name,
    accountCode: target.accountCode,
    message,
    counts,
    rows,
    rowCount: counts.import + counts.update + counts.duplicate + counts.skipped + counts.rejected,
  };
  await recordAuditEvent({
    action: "autopart.customer_sales_import_previewed",
    entityType: "Company",
    entityId: target.company.id,
    actorUserId,
    metadata: {
      filename: input.filename ?? null,
      accountCode: target.accountCode,
      kind,
      counts,
      canCommit,
    },
  });
  return preview;
}

async function previewTrm(
  scope: CustomerSalesScope,
  text: string,
  rows: CustomerSalesPreviewRow[],
  counts: CustomerSalesPreview["counts"],
) {
  const parsed = parseAutopartTrm21qcReport(text);
  const refs = [...new Set(parsed.rows.map((row) => row.documentNumber).filter(Boolean))];
  const existing = refs.length
    ? await prisma.autopartSalesLine.findMany({
        where: { companyId: scope.companyId, documentReference: { in: refs } },
        select: { documentReference: true, sku: true, salesNet: true, documentType: true },
      })
    : [];
  const seen = new Set(
    existing.map(
      (line) => `${line.documentReference}|${line.sku.toUpperCase()}|${moneyKey(line.salesNet)}`,
    ),
  );
  for (const row of parsed.rows) {
    if (row.classification === "BLANK") {
      pushRow(rows, counts, {
        document: row.documentNumber,
        type: row.kind,
        date: row.documentDate,
        account: row.customerAccount,
        amount: row.salesNet,
        disposition: "skipped",
        reason: "Blank row.",
      });
      continue;
    }
    if (row.classification === "MALFORMED" || !row.documentNumber || !row.partNumber) {
      pushRow(rows, counts, {
        document: row.documentNumber,
        type: row.kind,
        date: row.documentDate,
        account: row.customerAccount,
        amount: row.salesNet,
        disposition: "skipped",
        reason: "Product line is missing a document, part number, or a valid amount.",
      });
      continue;
    }
    if (!accountInCustomerScope(row.customerAccount, scope)) {
      pushRow(rows, counts, {
        document: row.documentNumber,
        type: row.kind,
        date: row.documentDate,
        account: row.customerAccount,
        amount: row.salesNet,
        disposition: "rejected",
        reason: "Customer code is not the verified Autopart account selected for this customer.",
      });
      continue;
    }
    const key = `${row.documentNumber}|${row.partNumber.toUpperCase()}|${moneyKey(row.salesNet)}`;
    const duplicate = seen.has(key);
    pushRow(rows, counts, {
      document: row.documentNumber,
      type: row.kind,
      date: row.documentDate,
      account: row.customerAccount,
      amount: row.salesNet,
      disposition: duplicate ? "duplicate" : "import",
      reason: duplicate
        ? "This product line is already stored for this customer."
        : "Product line will be stored against this customer.",
    });
    seen.add(key);
  }
}

async function preview504(
  scope: CustomerSalesScope,
  text: string,
  rows: CustomerSalesPreviewRow[],
  counts: CustomerSalesPreview["counts"],
) {
  const parsed = parseAutopart504Report(text);
  const importable = parsed.rows.filter(isAutopart504ImportableRow);
  const orderNumbers = [...new Set(importable.map((row) => row.abOrderNumber).filter((value): value is string => Boolean(value)))];
  const orders = orderNumbers.length
    ? await prisma.order.findMany({
        where: { orderNumber: { in: orderNumbers } },
        select: { orderNumber: true, companyId: true },
      })
    : [];
  const orderCompany = new Map(orders.map((order) => [order.orderNumber, order.companyId]));
  const refs = [...new Set(importable.map((row) => row.documentNumber))];
  const documents = refs.length
    ? await prisma.autopartSalesDocument.findMany({
        where: { documentReference: { in: refs }, companyId: scope.companyId },
        select: { documentReference: true, documentType: true, goodsNet: true, vat: true, grossTotal: true },
      })
    : [];
  for (const row of parsed.rows) {
    if (!isAutopart504ImportableRow(row)) {
      if (row.classification === "BLANK" || row.classification === "HEADER" || row.classification === "PAGE") {
        continue;
      }
      pushRow(rows, counts, {
        document: row.documentNumber,
        type: row.kind,
        date: row.documentDate,
        account: "",
        amount: row.value,
        disposition: "skipped",
        reason: "Row is not an invoice or credit document.",
      });
      continue;
    }
    const owner = row.abOrderNumber ? orderCompany.get(row.abOrderNumber) : undefined;
    const stored = documents.find((doc) => doc.documentReference === row.documentNumber);
    if (owner && owner !== scope.companyId) {
      pushRow(rows, counts, {
        document: row.documentNumber,
        type: row.kind,
        date: row.documentDate,
        account: "",
        amount: row.value,
        disposition: "rejected",
        reason: "AB order belongs to another customer.",
      });
      continue;
    }
    if (!owner && !stored) {
      pushRow(rows, counts, {
        document: row.documentNumber,
        type: row.kind,
        date: row.documentDate,
        account: "",
        amount: row.value,
        disposition: "rejected",
        reason: "504 reports have no Autopart account code. This document is not linked to the selected customer.",
      });
      continue;
    }
    const sameMoney =
      stored != null &&
      moneyKey(stored.goodsNet) === moneyKey(row.goods) &&
      moneyKey(stored.vat) === moneyKey(row.vat) &&
      moneyKey(stored.grossTotal) === moneyKey(row.value);
    pushRow(rows, counts, {
      document: row.documentNumber,
      type: row.kind,
      date: row.documentDate,
      account: scope.accountCodes[0] ?? "",
      amount: row.value,
      disposition: sameMoney ? "duplicate" : stored ? "update" : "import",
      reason: sameMoney
        ? "Invoice or credit values are already stored for this customer."
        : stored
          ? "Stored invoice or credit values will be refreshed for this customer."
          : "Invoice or credit will be stored against this customer.",
    });
  }
}

export async function confirmCustomerSalesImport(
  actorUserId: string,
  input: { companyId: string; accountCode: string; text: string; filename?: string },
) {
  const preview = await previewCustomerSalesImport(actorUserId, input);
  if (!preview.canCommit) {
    throw new AuthError(preview.message ?? "This report cannot be imported.", "VALIDATION", 400);
  }
  const scope: CustomerSalesScope = {
    companyId: preview.companyId,
    accountCodes: [preview.accountCode],
  };
  const payload = {
    text: input.text,
    source: "MANUAL" as const,
    customerScope: scope,
    ...(input.filename ? { filename: input.filename } : {}),
  };
  const run =
    preview.kind === "504"
      ? await confirmAutopart504Import(actorUserId, payload)
      : await confirmAutopartTrm21qcImport(actorUserId, payload);
  await recordAuditEvent({
    action: "autopart.customer_sales_import_committed",
    entityType: "AutopartCustomerImportRun",
    entityId: run.id,
    actorUserId,
    metadata: {
      companyId: preview.companyId,
      accountCode: preview.accountCode,
      kind: preview.kind,
      filename: input.filename ?? null,
      rowsImported: run.rowsImported,
      rowsUpdated: run.rowsUpdated,
      rowsSkipped: run.rowsSkipped,
      effects: CUSTOMER_SALES_IMPORT_EFFECTS,
    },
  });
  return {
    runId: run.id,
    status: run.status,
    kind: preview.kind,
    companyId: preview.companyId,
    accountCode: preview.accountCode,
    rowsImported: run.rowsImported,
    rowsUpdated: run.rowsUpdated,
    rowsSkipped: run.rowsSkipped,
    effects: CUSTOMER_SALES_IMPORT_EFFECTS,
  };
}
