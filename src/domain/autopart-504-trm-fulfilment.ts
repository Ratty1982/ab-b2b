/**
 * 504 + TRM21QC B2B fulfilment evaluation (pure).
 *
 * 504 = document/invoice event (header). TRM = product quantities.
 * Join is Autopart document number only. AB order match is exact AB-######.
 *
 * Credits stay signed for sales reporting. Fulfilment uses positive invoice units
 * and does not reverse physical despatch when a later credit arrives.
 */

import { AB_ORDER_NUMBER_PATTERN, isAbOrderNumber, normaliseAbOrderNumber } from "@/domain/order-status";
import { reconcile504GoodsToTrmSales } from "@/domain/autopart-504-trm21qc-reconcile";

export const AUTOPART_504_TRM_FULFILMENT_MODES = ["OFF", "PREVIEW", "ACTIVE"] as const;
export type Autopart504TrmFulfilmentMode = (typeof AUTOPART_504_TRM_FULFILMENT_MODES)[number];

export const AUTOPART_504C_RUNTIME_MODES = ["ACTIVE", "RETIRED"] as const;
export type Autopart504cRuntimeMode = (typeof AUTOPART_504C_RUNTIME_MODES)[number];

export const AUTOPART_DOCUMENT_FULFILMENT_STATUSES = [
  "WAITING_FOR_504",
  "WAITING_FOR_TRM",
  "MATCHED",
  "VALUE_MISMATCH",
  "LINE_MATCH_REVIEW",
  "FULFILMENT_APPLIED",
  "REVIEW_REQUIRED",
  "SKIPPED_CREDIT",
  "SKIPPED_TERMINAL",
  "SKIPPED_BEFORE_FROM",
  "NOT_AB_ORDER",
] as const;
export type AutopartDocumentFulfilmentStatus =
  (typeof AUTOPART_DOCUMENT_FULFILMENT_STATUSES)[number];

export const FULFILMENT_ELIGIBLE_ORDER_STATUSES = [
  "CONFIRMED",
  "PICKING",
  "PARTIALLY_DESPATCHED",
] as const;

export const FULFILMENT_TERMINAL_ORDER_STATUSES = ["CANCELLED", "ON_HOLD", "DRAFT", "SUBMITTED"] as const;

export const OVER_FULFILMENT_WARNING = "OVER-FULFILMENT / ORDER DIFFERENCE";
export const LINE_MATCH_REVIEW_WARNING = "FULFILMENT REVIEW REQUIRED";
export const FINANCIAL_MISMATCH_WARNING = "REVIEW REQUIRED";
export const WAITING_FOR_LINE_DETAIL = "WAITING FOR LINE DETAIL";
export const WAITING_FOR_504_DETAIL = "WAITING FOR 504";

export type FulfilmentOrderItemInput = {
  id: string;
  sku: string;
  name: string;
  qty: number;
};

export type FulfilmentTrmLineInput = {
  sku: string;
  units: string | number;
  salesNet?: string | number | null;
  documentType?: string;
};

export type FulfilmentDocumentInput = {
  id: string;
  documentReference: string;
  documentType: string;
  documentDate: Date | null;
  createdAt: Date;
  has504: boolean;
  hasTrm21qc: boolean;
  goodsNet: string | null;
  customerOrderNumber: string | null;
  abOrderNumber: string | null;
  abOrderId: string | null;
  lines: FulfilmentTrmLineInput[];
};

export type SkuMatchResult =
  | { ok: true; orderItemId: string; sku: string }
  | { ok: false; sku: string; reason: "UNMATCHED_SKU" | "AMBIGUOUS_SKU" };

export function parseExactAbOrderReference(value: string | null | undefined): string | null {
  const normalised = normaliseAbOrderNumber(String(value ?? ""));
  if (!normalised || !isAbOrderNumber(normalised)) return null;
  if (!AB_ORDER_NUMBER_PATTERN.test(normalised)) return null;
  return normalised;
}

/** Exact AB-###### only. Trim + case normalisation. Never substring / numeric / name guess. */
export function matchAbOrderNumber(
  customerOrderNumber: string | null | undefined,
  knownOrderNumber: string,
): boolean {
  const incoming = parseExactAbOrderReference(customerOrderNumber);
  const expected = parseExactAbOrderReference(knownOrderNumber);
  return Boolean(incoming && expected && incoming === expected);
}

export function positiveInvoiceUnits(units: string | number | null | undefined): number {
  const n = typeof units === "number" ? units : Number(String(units ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

export function isCreditDocument(documentType: string, lines: FulfilmentTrmLineInput[]): boolean {
  if (documentType === "CREDIT") return true;
  if (documentType === "INVOICE") return false;
  const net = lines.reduce((sum, line) => sum + Number(line.units ?? 0), 0);
  return net < 0;
}

export function utcDateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0, 0));
}

/**
 * Documents dated on/after the activation calendar day are eligible.
 * Missing documentDate falls back to createdAt.
 */
export function isAfterFulfilmentFrom(
  documentDate: Date | null,
  createdAt: Date,
  fulfilmentFrom: Date | null,
): boolean {
  if (!fulfilmentFrom) return false;
  const point = documentDate ?? createdAt;
  return utcDateOnly(point).getTime() >= utcDateOnly(fulfilmentFrom).getTime();
}

export function matchTrmSkuToOrderItem(
  sku: string,
  items: FulfilmentOrderItemInput[],
): SkuMatchResult {
  const needle = sku.trim().toUpperCase();
  if (!needle) return { ok: false, sku, reason: "UNMATCHED_SKU" };
  const hits = items.filter((item) => item.sku.trim().toUpperCase() === needle);
  if (hits.length === 1) return { ok: true, orderItemId: hits[0]!.id, sku: hits[0]!.sku };
  if (hits.length > 1) return { ok: false, sku, reason: "AMBIGUOUS_SKU" };
  return { ok: false, sku, reason: "UNMATCHED_SKU" };
}

export function documentFinancialStatus(doc: FulfilmentDocumentInput): {
  status: AutopartDocumentFulfilmentStatus;
  mismatchMinor: number | null;
} {
  if (isCreditDocument(doc.documentType, doc.lines)) {
    return { status: "SKIPPED_CREDIT", mismatchMinor: null };
  }
  const recon = reconcile504GoodsToTrmSales({
    goods504: doc.goodsNet,
    trmSalesNets: doc.lines.map((l) => (l.salesNet == null ? null : String(l.salesNet))),
    has504: doc.has504,
    hasTrm21qc: doc.hasTrm21qc && doc.lines.length > 0,
  });
  if (recon.status === "AWAITING_504") return { status: "WAITING_FOR_504", mismatchMinor: null };
  if (recon.status === "AWAITING_LINES") return { status: "WAITING_FOR_TRM", mismatchMinor: null };
  if (recon.status === "VALUE_MISMATCH") {
    return { status: "VALUE_MISMATCH", mismatchMinor: recon.mismatchMinor };
  }
  return { status: "MATCHED", mismatchMinor: recon.mismatchMinor };
}

export type OrderLineFulfilment = {
  orderItemId: string;
  sku: string;
  name: string;
  orderedQty: number;
  invoicedQty: number;
  despatchedQty: number;
  remainingQty: number;
  overFulfilled: boolean;
};

export type DocumentLineContribution = {
  sku: string;
  units: number;
  matchedOrderItemId: string | null;
  unmatched: boolean;
};

export type EvaluatedDocument = {
  id: string;
  documentReference: string;
  documentType: string;
  documentDate: Date | null;
  goodsNet: string | null;
  status: AutopartDocumentFulfilmentStatus;
  warning: string | null;
  contributions: DocumentLineContribution[];
  includedInFulfilment: boolean;
};

export type OrderFulfilmentEvaluation = {
  orderId: string;
  orderNumber: string;
  previousStatus: string;
  nextStatus: "CONFIRMED" | "PICKING" | "PARTIALLY_DESPATCHED" | "DISPATCHED" | null;
  conceptually: "NO_AUTOPART_FULFILMENT" | "PARTIALLY_DESPATCHED" | "DISPATCHED" | "REVIEW_ONLY";
  lines: OrderLineFulfilment[];
  documents: EvaluatedDocument[];
  warnings: string[];
  overFulfilment: boolean;
  lineMatchReview: boolean;
  financialReview: boolean;
  waitingFor504: boolean;
  waitingForTrm: boolean;
  canApply: boolean;
  newInvoiceDocumentNumbers: string[];
};

export function evaluateOrder504TrmFulfilment(input: {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  items: FulfilmentOrderItemInput[];
  documents: FulfilmentDocumentInput[];
  fulfilmentFrom: Date | null;
  alreadyAppliedDocumentNumbers?: string[];
}): OrderFulfilmentEvaluation {
  const warnings: string[] = [];
  const documents: EvaluatedDocument[] = [];
  const invoicedByItem = new Map<string, number>();
  for (const item of input.items) invoicedByItem.set(item.id, 0);

  const already = new Set(
    (input.alreadyAppliedDocumentNumbers ?? []).map((n) => n.trim().toUpperCase()),
  );

  const terminal = (FULFILMENT_TERMINAL_ORDER_STATUSES as readonly string[]).includes(
    input.orderStatus,
  );
  const eligibleForward = (FULFILMENT_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(
    input.orderStatus,
  );
  const alreadyComplete =
    input.orderStatus === "DISPATCHED" || input.orderStatus === "DELIVERED";

  for (const doc of input.documents) {
    const abRef = parseExactAbOrderReference(doc.customerOrderNumber ?? doc.abOrderNumber);
    if (!abRef || !matchAbOrderNumber(abRef, input.orderNumber)) {
      documents.push({
        id: doc.id,
        documentReference: doc.documentReference,
        documentType: doc.documentType,
        documentDate: doc.documentDate,
        goodsNet: doc.goodsNet,
        status: "NOT_AB_ORDER",
        warning: null,
        contributions: [],
        includedInFulfilment: false,
      });
      continue;
    }

    if (!isAfterFulfilmentFrom(doc.documentDate, doc.createdAt, input.fulfilmentFrom)) {
      documents.push({
        id: doc.id,
        documentReference: doc.documentReference,
        documentType: doc.documentType,
        documentDate: doc.documentDate,
        goodsNet: doc.goodsNet,
        status: "SKIPPED_BEFORE_FROM",
        warning: null,
        contributions: [],
        includedInFulfilment: false,
      });
      continue;
    }

    if (isCreditDocument(doc.documentType, doc.lines)) {
      documents.push({
        id: doc.id,
        documentReference: doc.documentReference,
        documentType: doc.documentType,
        documentDate: doc.documentDate,
        goodsNet: doc.goodsNet,
        status: "SKIPPED_CREDIT",
        warning: null,
        contributions: [],
        includedInFulfilment: false,
      });
      continue;
    }

    const financial = documentFinancialStatus(doc);
    const contributions: DocumentLineContribution[] = [];
    let unmatchedSku = false;
    let ambiguousSku = false;

    if (financial.status === "MATCHED") {
      for (const line of doc.lines) {
        const units = positiveInvoiceUnits(line.units);
        if (units <= 0) continue;
        const match = matchTrmSkuToOrderItem(line.sku, input.items);
        if (!match.ok) {
          unmatchedSku = true;
          if (match.reason === "AMBIGUOUS_SKU") ambiguousSku = true;
          contributions.push({
            sku: line.sku,
            units,
            matchedOrderItemId: null,
            unmatched: true,
          });
          continue;
        }
        contributions.push({
          sku: match.sku,
          units,
          matchedOrderItemId: match.orderItemId,
          unmatched: false,
        });
        invoicedByItem.set(match.orderItemId, (invoicedByItem.get(match.orderItemId) ?? 0) + units);
      }
    }

    let status = financial.status;
    let warning: string | null = null;
    let included = financial.status === "MATCHED";

    if (financial.status === "VALUE_MISMATCH") {
      warning = FINANCIAL_MISMATCH_WARNING;
      included = false;
    } else if (financial.status === "WAITING_FOR_TRM") {
      warning = WAITING_FOR_LINE_DETAIL;
      included = false;
    } else if (financial.status === "WAITING_FOR_504") {
      warning = WAITING_FOR_504_DETAIL;
      included = false;
    } else if (unmatchedSku || ambiguousSku) {
      status = "LINE_MATCH_REVIEW";
      warning = LINE_MATCH_REVIEW_WARNING;
      // Matched SKU quantities still count; unmatched SKUs never assume fulfilment.
    }

    if (terminal) {
      status = "SKIPPED_TERMINAL";
      included = false;
      warning = warning ?? "Order is not eligible for Autopart fulfilment mutation";
    }

    documents.push({
      id: doc.id,
      documentReference: doc.documentReference,
      documentType: doc.documentType,
      documentDate: doc.documentDate,
      goodsNet: doc.goodsNet,
      status,
      warning,
      contributions,
      includedInFulfilment: included,
    });
  }

  const lines: OrderLineFulfilment[] = input.items.map((item) => {
    const invoicedQty = invoicedByItem.get(item.id) ?? 0;
    const overFulfilled = invoicedQty > item.qty;
    const despatchedQty = Math.min(item.qty, invoicedQty);
    return {
      orderItemId: item.id,
      sku: item.sku,
      name: item.name,
      orderedQty: item.qty,
      invoicedQty,
      despatchedQty,
      remainingQty: Math.max(0, item.qty - despatchedQty),
      overFulfilled,
    };
  });

  const overFulfilment = lines.some((l) => l.overFulfilled);
  const lineMatchReview = documents.some((d) => d.status === "LINE_MATCH_REVIEW");
  const financialReview = documents.some((d) => d.status === "VALUE_MISMATCH");
  const waitingFor504 = documents.some((d) => d.status === "WAITING_FOR_504");
  const waitingForTrm = documents.some((d) => d.status === "WAITING_FOR_TRM");
  const anyIncluded = documents.some((d) => d.includedInFulfilment);
  const anyDespatched = lines.some((l) => l.despatchedQty > 0);
  const allCovered = lines.length > 0 && lines.every((l) => l.remainingQty === 0 && l.orderedQty > 0);

  if (overFulfilment) warnings.push(OVER_FULFILMENT_WARNING);
  if (lineMatchReview) warnings.push(LINE_MATCH_REVIEW_WARNING);
  if (financialReview) warnings.push(FINANCIAL_MISMATCH_WARNING);

  let conceptually: OrderFulfilmentEvaluation["conceptually"] = "NO_AUTOPART_FULFILMENT";
  let nextStatus: OrderFulfilmentEvaluation["nextStatus"] = null;
  let canApply = false;

  if (terminal) {
    conceptually = "REVIEW_ONLY";
  } else if (anyIncluded && allCovered) {
    conceptually = "DISPATCHED";
    canApply = eligibleForward || alreadyComplete;
    nextStatus = alreadyComplete ? null : "DISPATCHED";
  } else if (anyIncluded && anyDespatched) {
    conceptually = "PARTIALLY_DESPATCHED";
    canApply = eligibleForward;
    nextStatus = eligibleForward ? "PARTIALLY_DESPATCHED" : null;
  } else if (financialReview || lineMatchReview) {
    conceptually = "REVIEW_ONLY";
  }

  // Do not auto-apply when the only evidence is financially unmatched (incomplete TRM).
  if (financialReview && !anyIncluded) {
    canApply = false;
    nextStatus = null;
  }

  const newInvoiceDocumentNumbers = documents
    .filter((d) => d.includedInFulfilment)
    .map((d) => d.documentReference)
    .filter((ref) => !already.has(ref.trim().toUpperCase()));

  return {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    previousStatus: input.orderStatus,
    nextStatus,
    conceptually,
    lines,
    documents,
    warnings,
    overFulfilment,
    lineMatchReview,
    financialReview,
    waitingFor504,
    waitingForTrm,
    canApply,
    newInvoiceDocumentNumbers,
  };
}

export function fulfilmentFingerprint(evaluation: OrderFulfilmentEvaluation): string {
  const lines = evaluation.lines
    .map((l) => `${l.sku.toUpperCase()}:${l.invoicedQty}`)
    .sort()
    .join("|");
  const docs = evaluation.documents
    .filter((d) => d.includedInFulfilment)
    .map((d) => d.documentReference.toUpperCase())
    .sort()
    .join(",");
  return `${evaluation.conceptually}#${docs}#${lines}`;
}

export function describeCreditsHandling(): string {
  return [
    "Credits remain signed on AutopartSalesLine (negative units / sales).",
    "Despatch calculation uses positive invoice quantities only.",
    "A later credit does not reverse physical despatch and does not pretend goods were never physically despatched.",
    "Credit documents are recorded as SKIPPED_CREDIT for fulfilment and never reverse OrderItem.despatchedQty.",
  ].join(" ");
}
