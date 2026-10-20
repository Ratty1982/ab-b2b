/**
 * Read-only plan for correcting 504 goods/VAT/gross that were stored from
 * truncated fixed-width amounts.
 *
 * Arithmetic imbalance flags a document. It does not prove the original goods
 * value. A correction is proposed only when every supplied 504 report agrees
 * on one verified Goods + VAT = Value triple.
 *
 * Applying the plan is a separate authorised step. This module does not import
 * orders, stock, fulfilment, or mail.
 */

import {
  autopart504MinorUnits,
  autopart504TripleBalances,
  isAutopart504ArtefactRow,
  isAutopart504ImportableRow,
  parseAutopart504Report,
} from "@/domain/autopart-504";
import { reconcile504GoodsToTrmSales } from "@/domain/autopart-504-trm21qc-reconcile";

export const AUTOPART_504_FINANCIAL_INCIDENT = {
  from: "2026-10-06",
  to: "2026-10-19",
  affectedDocuments: 123,
  invoices: 105,
  credits: 18,
  exampleReport: "504_20261019.txt",
  exampleReportDocuments: 60,
  exampleReportCredits: 2,
  exampleReportTruncatedDocuments: 8,
  exampleReportGoods: "2958.30",
  exampleReportVat: "591.54",
  exampleReportTotal: "3549.84",
} as const;

export const AUTOPART_504_FINANCIAL_RECOVERY_CONFIRMATION = "CORRECT_504_FINANCIAL_AMOUNTS";

export const AUTOPART_504_RECOVERY_PROHIBITED_EFFECTS = [
  "trigger 504/TRM fulfilment",
  "change order statuses",
  "consume or release stock reservations",
  "generate invoices",
  "queue customer despatch emails",
  "replay older reports",
  "modify unrelated historical sales",
] as const;

export type Stored504FinancialDocument = {
  id: string;
  documentReference: string;
  documentType: "INVOICE" | "CREDIT" | "PAYMENT" | "JOURNAL" | "UNKNOWN";
  documentDate: string | null;
  companyId: string | null;
  autopartCustomerCode: string;
  customerNameSnapshot: string | null;
  customerOrderNumber: string | null;
  abOrderId: string | null;
  abOrderNumber: string | null;
  has504: boolean;
  hasTrm21qc: boolean;
  source: string;
  goodsNet: string | null;
  vat: string | null;
  grossTotal: string | null;
  reconciliationStatus: string | null;
  fulfilmentStatus: string | null;
  trmSalesNets: string[];
};

export type RecoveryDisposition = "APPLY" | "UNCHANGED" | "MANUAL_REVIEW" | "OUT_OF_SCOPE";

export type RecoveryMoney = { goods: string; vat: string; value: string };

export type RecoverySourceEvidence = {
  filename: string;
  lineNumber: number;
  verified: boolean;
  goods: string | null;
  vat: string | null;
  value: string | null;
  documentDate: string | null;
  customerOrderNumber: string;
  abOrderNumber: string | null;
  diagnostic: string | null;
};

export type RecoveryAction = {
  documentId: string;
  documentReference: string;
  documentType: Stored504FinancialDocument["documentType"];
  documentDate: string | null;
  companyId: string | null;
  autopartCustomerCode: string;
  customerNameSnapshot: string | null;
  abOrderId: string | null;
  abOrderNumber: string | null;
  has504: boolean;
  hasTrm21qc: boolean;
  source: string;
  historicalProvenance: boolean;
  disposition: RecoveryDisposition;
  reason: string;
  stored: { goods: string | null; vat: string | null; value: string | null };
  verified: RecoveryMoney | null;
  evidence: RecoverySourceEvidence[];
  arithmeticImbalanceMinor: number | null;
  salesImpact: { goodsMinor: number; vatMinor: number; grossMinor: number } | null;
  currentReconciliationStatus: string | null;
  expectedReconciliationStatus: string | null;
  expectedLinesNetSum: string | null;
  expectedMismatchMinor: number | null;
  postCorrectionFulfilmentReview: boolean;
  /** Identity fields the correction must leave unchanged. */
  preserved: {
    companyId: string | null;
    documentReference: string;
    documentType: Stored504FinancialDocument["documentType"];
    abOrderId: string | null;
    abOrderNumber: string | null;
    source: string;
  };
};

export type RecoveryPlan = {
  incident: typeof AUTOPART_504_FINANCIAL_INCIDENT;
  window: { from: string; to: string };
  prohibitedEffects: typeof AUTOPART_504_RECOVERY_PROHIBITED_EFFECTS;
  scannedDocuments: number;
  unbalancedDocuments: number;
  invoiceCount: number;
  creditCount: number;
  dateRange: { earliest: string | null; latest: string | null };
  applyCount: number;
  unchangedCount: number;
  manualReviewCount: number;
  outOfScopeCount: number;
  missingSourceEvidence: number;
  balancedWithoutSource: number;
  salesImpact: { goodsMinor: number; vatMinor: number; grossMinor: number };
  affectedAbOrders: string[];
  fulfilmentReviewDocumentReferences: string[];
  expectedReconciliation: Record<string, number>;
  actions: RecoveryAction[];
};

export function assertAutopart504FinancialRecoveryAuthorised(input: {
  authorise: boolean;
  dryRun: boolean;
  confirmation?: string | null;
}): void {
  if (!input.authorise) {
    throw new Error("504 financial recovery requires explicit authorisation");
  }
  if (!input.dryRun && input.confirmation !== AUTOPART_504_FINANCIAL_RECOVERY_CONFIRMATION) {
    throw new Error(
      `Applying 504 financial corrections requires confirmation ${AUTOPART_504_FINANCIAL_RECOVERY_CONFIRMATION}`,
    );
  }
}

function sameMoney(a: string | null | undefined, b: string | null | undefined): boolean {
  return autopart504MinorUnits(a) != null && autopart504MinorUnits(a) === autopart504MinorUnits(b);
}

function minorDelta(next: string, prev: string | null): number {
  return (autopart504MinorUnits(next) ?? 0) - (autopart504MinorUnits(prev) ?? 0);
}

function imbalanceMinor(doc: Stored504FinancialDocument): number | null {
  const goods = autopart504MinorUnits(doc.goodsNet);
  const vat = autopart504MinorUnits(doc.vat);
  const value = autopart504MinorUnits(doc.grossTotal);
  if (goods == null || vat == null || value == null) return null;
  return goods + vat - value;
}

function inWindow(date: string | null, window: { from: string; to: string }): boolean {
  return date != null && date >= window.from && date <= window.to;
}

function expectedReconciliation(doc: Stored504FinancialDocument, goods: string) {
  const result = reconcile504GoodsToTrmSales({
    goods504: goods,
    trmSalesNets: doc.trmSalesNets,
    has504: doc.has504,
    hasTrm21qc: doc.hasTrm21qc,
  });
  let status: string = result.status;
  if (doc.documentType === "UNKNOWN") status = "UNKNOWN_DOCUMENT_TYPE";
  else if (!doc.companyId) status = "UNMAPPED_CUSTOMER";
  else if (result.status === "MATCHED" && doc.has504 && doc.hasTrm21qc) status = "COMPLETE";
  return {
    status,
    linesNetSum: result.linesNetSum,
    mismatchMinor: result.mismatchMinor,
  };
}

function collectEvidence(reports: Array<{ filename: string; text: string }>): Map<string, RecoverySourceEvidence[]> {
  const byRef = new Map<string, RecoverySourceEvidence[]>();
  for (const report of reports) {
    const parsed = parseAutopart504Report(report.text);
    for (const row of parsed.rows) {
      if (!row.documentNumber || isAutopart504ArtefactRow(row) || row.classification === "BLANK") continue;
      const verified =
        isAutopart504ImportableRow(row) &&
        autopart504TripleBalances(row.goods, row.vat, row.value) &&
        row.goods != null &&
        row.value != null;
      const evidence: RecoverySourceEvidence = {
        filename: report.filename,
        lineNumber: row.lineNumber,
        verified,
        goods: row.goods,
        vat: row.vat,
        value: row.value,
        documentDate: row.documentDate,
        customerOrderNumber: row.customerOrderNumber,
        abOrderNumber: row.abOrderNumber,
        diagnostic: row.malformedReason ?? null,
      };
      const list = byRef.get(row.documentNumber) ?? [];
      list.push(evidence);
      byRef.set(row.documentNumber, list);
    }
  }
  return byRef;
}

function agreedVerified(evidence: RecoverySourceEvidence[]): RecoveryMoney | null {
  const verified = evidence.filter((row) => row.verified && row.goods != null && row.vat != null && row.value != null);
  if (verified.length === 0 || verified.length !== evidence.length) return null;
  const first = verified[0]!;
  const agrees = verified.every(
    (row) => sameMoney(row.goods, first.goods) && sameMoney(row.vat, first.vat) && sameMoney(row.value, first.value),
  );
  if (!agrees) return null;
  return { goods: first.goods!, vat: first.vat!, value: first.value! };
}

function preservedOf(doc: Stored504FinancialDocument): RecoveryAction["preserved"] {
  return {
    companyId: doc.companyId,
    documentReference: doc.documentReference,
    documentType: doc.documentType,
    abOrderId: doc.abOrderId,
    abOrderNumber: doc.abOrderNumber,
    source: doc.source,
  };
}

function baseAction(
  doc: Stored504FinancialDocument,
  evidence: RecoverySourceEvidence[],
  disposition: RecoveryDisposition,
  reason: string,
  verified: RecoveryMoney | null,
): RecoveryAction {
  const impact =
    disposition === "APPLY" && verified
      ? {
          goodsMinor: minorDelta(verified.goods, doc.goodsNet),
          vatMinor: minorDelta(verified.vat, doc.vat),
          grossMinor: minorDelta(verified.value, doc.grossTotal),
        }
      : null;
  const expected = verified ? expectedReconciliation(doc, verified.goods) : null;
  return {
    documentId: doc.id,
    documentReference: doc.documentReference,
    documentType: doc.documentType,
    documentDate: doc.documentDate,
    companyId: doc.companyId,
    autopartCustomerCode: doc.autopartCustomerCode,
    customerNameSnapshot: doc.customerNameSnapshot,
    abOrderId: doc.abOrderId,
    abOrderNumber: doc.abOrderNumber,
    has504: doc.has504,
    hasTrm21qc: doc.hasTrm21qc,
    source: doc.source,
    historicalProvenance: doc.source === "SLRB" || doc.source === "561L" || doc.source.includes("561L"),
    disposition,
    reason,
    stored: { goods: doc.goodsNet, vat: doc.vat, value: doc.grossTotal },
    verified,
    evidence,
    arithmeticImbalanceMinor: imbalanceMinor(doc),
    salesImpact: impact,
    currentReconciliationStatus: doc.reconciliationStatus,
    expectedReconciliationStatus: expected?.status ?? null,
    expectedLinesNetSum: expected?.linesNetSum ?? null,
    expectedMismatchMinor: expected?.mismatchMinor ?? null,
    postCorrectionFulfilmentReview: doc.fulfilmentStatus != null,
    preserved: preservedOf(doc),
  };
}

export function planAutopart504FinancialRecovery(input: {
  documents: Stored504FinancialDocument[];
  reports: Array<{ filename: string; text: string }>;
  window?: { from: string; to: string };
}): RecoveryPlan {
  const window = input.window ?? {
    from: AUTOPART_504_FINANCIAL_INCIDENT.from,
    to: AUTOPART_504_FINANCIAL_INCIDENT.to,
  };
  const evidenceByRef = collectEvidence(input.reports);
  const actions: RecoveryAction[] = [];
  let balancedWithoutSource = 0;

  for (const doc of input.documents) {
    const evidence = evidenceByRef.get(doc.documentReference) ?? [];
    const imbalance = imbalanceMinor(doc);
    const unbalanced = imbalance != null && Math.abs(imbalance) > 1;
    const missingMoney = doc.goodsNet == null || doc.vat == null || doc.grossTotal == null;
    const affected = unbalanced || missingMoney || evidence.length > 0;
    if (!doc.has504) {
      if (affected) {
        actions.push(
          baseAction(
            doc,
            evidence,
            "OUT_OF_SCOPE",
            "Document has no 504 provenance. Historical sales are not modified by this recovery.",
            null,
          ),
        );
      }
      continue;
    }
    if (!affected) {
      if (inWindow(doc.documentDate, window)) balancedWithoutSource += 1;
      continue;
    }

    const verified = agreedVerified(evidence);
    const windowed = inWindow(doc.documentDate, window);
    const financialType = doc.documentType === "INVOICE" || doc.documentType === "CREDIT";

    if (!financialType) {
      actions.push(
        baseAction(doc, evidence, "MANUAL_REVIEW", "Document type is not an invoice or credit note.", verified),
      );
      continue;
    }
    if (evidence.length === 0) {
      actions.push(
        baseAction(
          doc,
          evidence,
          "MANUAL_REVIEW",
          "No original 504 report was supplied. An arithmetic imbalance does not prove the original goods value.",
          null,
        ),
      );
      continue;
    }
    if (!verified) {
      actions.push(
        baseAction(
          doc,
          evidence,
          "MANUAL_REVIEW",
          "Original 504 evidence is missing, unbalanced, or disagrees across reports.",
          null,
        ),
      );
      continue;
    }
    const already =
      sameMoney(doc.goodsNet, verified.goods) &&
      sameMoney(doc.vat, verified.vat) &&
      sameMoney(doc.grossTotal, verified.value);
    if (already) {
      actions.push(baseAction(doc, evidence, "UNCHANGED", "Stored amounts already match the verified 504 triple.", verified));
      continue;
    }
    if (!windowed) {
      actions.push(
        baseAction(
          doc,
          evidence,
          "MANUAL_REVIEW",
          `Verified 504 amounts differ, and the document date is outside ${window.from} to ${window.to}.`,
          verified,
        ),
      );
      continue;
    }
    actions.push(
      baseAction(
        doc,
        evidence,
        "APPLY",
        "Replace stored goods, VAT, and gross with the verified 504 triple. Order, customer, and fulfilment fields stay unchanged.",
        verified,
      ),
    );
  }

  const tally = (disposition: RecoveryDisposition) => actions.filter((row) => row.disposition === disposition);
  const apply = tally("APPLY");
  const salesImpact = apply.reduce(
    (acc, row) => {
      acc.goodsMinor += row.salesImpact?.goodsMinor ?? 0;
      acc.vatMinor += row.salesImpact?.vatMinor ?? 0;
      acc.grossMinor += row.salesImpact?.grossMinor ?? 0;
      return acc;
    },
    { goodsMinor: 0, vatMinor: 0, grossMinor: 0 },
  );
  const considered = actions.filter((row) => row.disposition !== "OUT_OF_SCOPE");
  const dates = considered.map((row) => row.documentDate).filter((date): date is string => Boolean(date)).sort();
  const expectedReconciliation: Record<string, number> = {};
  for (const row of apply) {
    const key = row.expectedReconciliationStatus ?? "UNKNOWN";
    expectedReconciliation[key] = (expectedReconciliation[key] ?? 0) + 1;
  }
  const abOrders = [
    ...new Set(
      considered
        .filter((row) => row.disposition === "APPLY" || row.disposition === "MANUAL_REVIEW")
        .map((row) => row.abOrderNumber)
        .filter((order): order is string => Boolean(order)),
    ),
  ].sort();

  return {
    incident: AUTOPART_504_FINANCIAL_INCIDENT,
    window,
    prohibitedEffects: AUTOPART_504_RECOVERY_PROHIBITED_EFFECTS,
    scannedDocuments: input.documents.length,
    unbalancedDocuments: input.documents.filter((doc) => {
      const gap = imbalanceMinor(doc);
      return gap != null && Math.abs(gap) > 1;
    }).length,
    invoiceCount: considered.filter((row) => row.documentType === "INVOICE").length,
    creditCount: considered.filter((row) => row.documentType === "CREDIT").length,
    dateRange: { earliest: dates[0] ?? null, latest: dates[dates.length - 1] ?? null },
    applyCount: apply.length,
    unchangedCount: tally("UNCHANGED").length,
    manualReviewCount: tally("MANUAL_REVIEW").length,
    outOfScopeCount: tally("OUT_OF_SCOPE").length,
    missingSourceEvidence: tally("MANUAL_REVIEW").filter((row) => row.evidence.length === 0).length,
    balancedWithoutSource,
    salesImpact,
    affectedAbOrders: abOrders,
    fulfilmentReviewDocumentReferences: apply
      .filter((row) => row.postCorrectionFulfilmentReview)
      .map((row) => row.documentReference)
      .sort(),
    expectedReconciliation,
    actions,
  };
}
