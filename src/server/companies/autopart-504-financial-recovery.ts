/**
 * Authorised correction of truncated 504 goods / VAT / gross totals.
 *
 * Dry-run is the default. Apply writes only AutopartSalesDocument money and the
 * derived 504↔TRM reconciliation fields, plus an audit row.
 *
 * This module must not trigger 504/TRM fulfilment, change order statuses,
 * consume or release stock, generate invoices, queue customer email, replay
 * older reports, or modify documents that have no 504 provenance.
 */

import { prisma } from "@/infra/database/client";
import { recordAuditEvent, recordAuditEventInTransaction } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants } from "@/server/rbac/access";
import { autopart504MinorUnits, autopart504TripleBalances } from "@/domain/autopart-504";
import { reconcile504GoodsToTrmSales } from "@/domain/autopart-504-trm21qc-reconcile";
import {
  assertAutopart504FinancialRecoveryAuthorised,
  planAutopart504FinancialRecovery,
  type RecoveryAction,
  type RecoveryPlan,
  type Stored504FinancialDocument,
} from "@/domain/autopart-504-financial-recovery";

export type FinancialRecoveryRunResult = {
  dryRun: boolean;
  plan: RecoveryPlan;
  applied: Array<{ documentId: string; documentReference: string }>;
  skipped: Array<{ documentId: string; documentReference: string; reason: string }>;
};

function moneyString(value: { toString(): string } | null | undefined): string | null {
  if (value == null) return null;
  const minor = autopart504MinorUnits(value.toString());
  if (minor == null) return null;
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function isoDate(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

async function requireRecoveryAdmin(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!grants(profile, "admin.access", "orders.edit")) {
    throw new AuthError("Not permitted to correct Autopart 504 amounts", "FORBIDDEN", 403);
  }
  return profile;
}

function sameMoney(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = autopart504MinorUnits(a);
  const right = autopart504MinorUnits(b);
  return left != null && left === right;
}

export async function runAutopart504FinancialRecovery(
  actorUserId: string,
  input: {
    reports: Array<{ filename: string; text: string }>;
    authorise: boolean;
    /** Defaults to true. Financial rows change only when this is false and confirmation matches. */
    dryRun?: boolean;
    confirmation?: string | null;
    window?: { from: string; to: string };
  },
): Promise<FinancialRecoveryRunResult> {
  await requireRecoveryAdmin(actorUserId);
  const dryRun = input.dryRun !== false;
  assertAutopart504FinancialRecoveryAuthorised({
    authorise: input.authorise,
    dryRun,
    ...(input.confirmation != null ? { confirmation: input.confirmation } : {}),
  });

  const rows = await prisma.autopartSalesDocument.findMany({
    where: { has504: true },
    select: {
      id: true,
      companyId: true,
      autopartCustomerCode: true,
      documentType: true,
      documentReference: true,
      documentDate: true,
      goodsNet: true,
      vat: true,
      grossTotal: true,
      source: true,
      has504: true,
      hasTrm21qc: true,
      customerOrderNumber: true,
      customerNameSnapshot: true,
      abOrderId: true,
      abOrderNumber: true,
      reconciliationStatus: true,
      fulfilmentStatus: true,
      lines: { select: { salesNet: true } },
    },
  });

  const documents: Stored504FinancialDocument[] = rows.map((row) => ({
    id: row.id,
    documentReference: row.documentReference,
    documentType: row.documentType,
    documentDate: isoDate(row.documentDate),
    companyId: row.companyId,
    autopartCustomerCode: row.autopartCustomerCode,
    customerNameSnapshot: row.customerNameSnapshot,
    customerOrderNumber: row.customerOrderNumber,
    abOrderId: row.abOrderId,
    abOrderNumber: row.abOrderNumber,
    has504: row.has504,
    hasTrm21qc: row.hasTrm21qc,
    source: row.source,
    goodsNet: moneyString(row.goodsNet),
    vat: moneyString(row.vat),
    grossTotal: moneyString(row.grossTotal),
    reconciliationStatus: row.reconciliationStatus,
    fulfilmentStatus: row.fulfilmentStatus,
    trmSalesNets: row.lines.map((line) => line.salesNet.toString()),
  }));

  const plan = planAutopart504FinancialRecovery({
    documents,
    reports: input.reports,
    ...(input.window ? { window: input.window } : {}),
  });

  if (dryRun) {
    await recordAuditEvent({
      action: "autopart.504_financial_recovery_previewed",
      entityType: "AutopartSalesDocument",
      entityId: null,
      actorUserId,
      metadata: {
        dryRun: true,
        applyCount: plan.applyCount,
        manualReviewCount: plan.manualReviewCount,
        unchangedCount: plan.unchangedCount,
        salesImpact: plan.salesImpact,
        reports: input.reports.map((report) => report.filename),
      },
    });
    return { dryRun: true, plan, applied: [], skipped: [] };
  }

  const applied: FinancialRecoveryRunResult["applied"] = [];
  const skipped: FinancialRecoveryRunResult["skipped"] = [];

  for (const action of plan.actions) {
    if (action.disposition !== "APPLY" || !action.verified) continue;
    const outcome = await applyOne(actorUserId, action);
    if (outcome.applied) applied.push({ documentId: action.documentId, documentReference: action.documentReference });
    else skipped.push({ documentId: action.documentId, documentReference: action.documentReference, reason: outcome.reason });
  }

  await recordAuditEvent({
    action: "autopart.504_financial_recovery_applied",
    entityType: "AutopartSalesDocument",
    entityId: null,
    actorUserId,
    metadata: {
      dryRun: false,
      applied: applied.map((row) => row.documentReference),
      skipped,
      salesImpact: plan.salesImpact,
    },
  });

  return { dryRun: false, plan, applied, skipped };
}

async function applyOne(
  actorUserId: string,
  action: RecoveryAction,
): Promise<{ applied: boolean; reason: string }> {
  const verified = action.verified;
  if (!verified || !autopart504TripleBalances(verified.goods, verified.vat, verified.value)) {
    return { applied: false, reason: "Verified triple does not balance" };
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.autopartSalesDocument.findUnique({
      where: { id: action.documentId },
      include: { lines: { select: { salesNet: true } } },
    });
    if (!current || !current.has504) {
      return { applied: false, reason: "Document is missing or is not a 504 document" };
    }
    if (
      current.documentReference !== action.preserved.documentReference ||
      current.documentType !== action.preserved.documentType ||
      current.companyId !== action.preserved.companyId ||
      current.abOrderId !== action.preserved.abOrderId ||
      (current.abOrderNumber ?? null) !== action.preserved.abOrderNumber ||
      current.source !== action.preserved.source
    ) {
      return { applied: false, reason: "Document identity changed since the dry-run; no financial write" };
    }

    const stored = {
      goods: moneyString(current.goodsNet),
      vat: moneyString(current.vat),
      value: moneyString(current.grossTotal),
    };
    if (sameMoney(stored.goods, verified.goods) && sameMoney(stored.vat, verified.vat) && sameMoney(stored.value, verified.value)) {
      return { applied: false, reason: "Amounts already match the verified triple" };
    }
    if (
      !sameMoney(stored.goods, action.stored.goods) ||
      !sameMoney(stored.vat, action.stored.vat) ||
      !sameMoney(stored.value, action.stored.value)
    ) {
      return { applied: false, reason: "Stored amounts changed since the dry-run; no financial write" };
    }

    const reconciled = reconcile504GoodsToTrmSales({
      goods504: verified.goods,
      trmSalesNets: current.lines.map((line) => line.salesNet.toString()),
      has504: current.has504,
      hasTrm21qc: current.hasTrm21qc,
    });
    let reconciliationStatus: string = reconciled.status;
    if (current.documentType === "UNKNOWN") reconciliationStatus = "UNKNOWN_DOCUMENT_TYPE";
    else if (!current.companyId) reconciliationStatus = "UNMAPPED_CUSTOMER";
    else if (reconciled.status === "MATCHED" && current.has504 && current.hasTrm21qc) reconciliationStatus = "COMPLETE";

    await tx.autopartSalesDocument.update({
      where: { id: current.id },
      data: {
        goodsNet: verified.goods,
        vat: verified.vat,
        grossTotal: verified.value,
        reconciliationStatus: reconciliationStatus as never,
        linesNetSum: reconciled.linesNetSum,
        valueMismatchMinor: reconciled.mismatchMinor,
      },
    });
    await recordAuditEventInTransaction(tx, {
      action: "autopart.504_financial_amounts_corrected",
      entityType: "AutopartSalesDocument",
      entityId: current.id,
      actorUserId,
      companyId: current.companyId,
      before: stored,
      after: verified,
      metadata: {
        documentReference: current.documentReference,
        documentType: current.documentType,
        abOrderNumber: current.abOrderNumber,
        evidence: action.evidence.map((row) => ({
          filename: row.filename,
          lineNumber: row.lineNumber,
        })),
        reconciliationStatus,
        fulfilmentNotChanged: true,
      },
    });
    return { applied: true, reason: "corrected" };
  });
}
