/**
 * Amazon FBA UK replenishment forecast.
 *
 * OIN Autopart documents are replenishment into FBA, not consumer sales.
 * Sell-through comes only from an Amazon sales extract. Missing sales stay
 * insufficient — a weekly rate is never invented from OIN cadence.
 */

import type { Autopart504Row } from "@/domain/autopart-504";
import type { AutopartTrm21qcRow } from "@/domain/autopart-trm21qc";
import { addDaysIso } from "@/domain/sales-history-period";

export const FBA_RECOMMENDATIONS = [
  "SEND_NOW",
  "SEND_SOON",
  "HEALTHY",
  "OVERSTOCKED",
  "INSUFFICIENT_DATA",
] as const;

export type FbaRecommendation = (typeof FBA_RECOMMENDATIONS)[number];

export const FBA_RECOMMENDATION_LABEL: Record<FbaRecommendation, string> = {
  SEND_NOW: "Send Now",
  SEND_SOON: "Send Soon",
  HEALTHY: "Healthy",
  OVERSTOCKED: "Overstocked",
  INSUFFICIENT_DATA: "Insufficient Data",
};

export const FBA_INBOUND_STATUSES = [
  "PLANNED",
  "CONFIRMED_IN_TRANSIT",
  "RECEIVED",
  "CANCELLED",
] as const;

export type FbaInboundStatus = (typeof FBA_INBOUND_STATUSES)[number];

/** Only stock that is confirmed in transit and not yet in the FBA snapshot. */
export function eligibleFbaInboundQty(rows: Array<{ status: string; qty: number }>): number {
  return rows.reduce((sum, row) => {
    if (row.status !== "CONFIRMED_IN_TRANSIT") return sum;
    if (!Number.isFinite(row.qty) || row.qty <= 0) return sum;
    return sum + row.qty;
  }, 0);
}

/** Parsed Autopart document number, not the raw fixed-width cell. */
export function isOinReplenishmentReference(documentNumber: string | null | undefined): boolean {
  const ref = (documentNumber ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^OIN[A-Z0-9]+$/.test(ref);
}

export function roundUpToCaseMultiple(qty: number, multiple: number | null): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  const whole = Math.ceil(qty);
  if (multiple == null || !Number.isFinite(multiple) || multiple <= 1) return whole;
  return Math.ceil(whole / multiple) * multiple;
}

/** Whole cases that can actually leave the warehouse. A remainder is not a shipment. */
export function roundDownToCaseMultiple(qty: number, multiple: number | null): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  const whole = Math.floor(qty);
  if (multiple == null || !Number.isFinite(multiple) || multiple <= 1) return whole;
  return Math.floor(whole / multiple) * multiple;
}

export type FbaForecastInput = {
  /** Null when OPTIMUS has never been imported for this SKU. */
  fbaAvailable: number | null;
  fbaStockKnown: boolean;
  fbaStockStale: boolean;
  /** Null when Studley Avail is not on the current warehouse feed. */
  studleyAvailable: number | null;
  confirmedInboundQty: number;
  /** True only when the 30-day Amazon window is covered by a complete extract. */
  salesSupported: boolean;
  /** Net Amazon units in that 30-day window. Ignored when salesSupported is false. */
  amazonNetUnits30: number | null;
  leadTimeDays: number;
  targetCoverWeeks: number;
  safetyStockQty: number;
  caseMultiple: number | null;
  overstockCoverWeeks: number;
  today: string;
};

export type FbaForecastResult = {
  recommendation: FbaRecommendation;
  recommendationLabel: string;
  reason: string;
  confidence: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  assumptions: string[];
  weeklyRate: number | null;
  projectedRequiredQty: number | null;
  rawSendQty: number | null;
  suggestedSendQty: number | null;
  dispatchableQty: number | null;
  /** Studley units below one full case. They stay in the warehouse and are not a shipment. */
  looseStudleyQty: number | null;
  studleyShortfallQty: number | null;
  coverWeeks: number | null;
  stockoutDate: string | null;
  nextSendDate: string | null;
  fbaStockVerified: boolean;
};

function insufficient(reason: string, assumptions: string[]): FbaForecastResult {
  return {
    recommendation: "INSUFFICIENT_DATA",
    recommendationLabel: FBA_RECOMMENDATION_LABEL.INSUFFICIENT_DATA,
    reason,
    confidence: "NONE",
    assumptions,
    weeklyRate: null,
    projectedRequiredQty: null,
    rawSendQty: null,
    suggestedSendQty: null,
    dispatchableQty: null,
    looseStudleyQty: null,
    studleyShortfallQty: null,
    coverWeeks: null,
    stockoutDate: null,
    nextSendDate: null,
    fbaStockVerified: false,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Suggested FBA send from verified sell-through.
 * OIN quantities must not be passed in as amazonNetUnits30.
 */
export function projectFbaShipment(input: FbaForecastInput): FbaForecastResult {
  const assumptions = [
    "Demand is Amazon UK sell-through. OIN replenishment invoices are not consumer sales.",
    "Suggested quantity is not an order and does not move stock.",
    "Invoice creation is not treated as stock in transit.",
  ];
  if (!input.salesSupported || input.amazonNetUnits30 == null) {
    return insufficient(
      "No complete Amazon UK sales extract covers the last 30 days. A weekly rate is not estimated from OIN dispatches.",
      assumptions,
    );
  }
  if (!input.fbaStockKnown || input.fbaAvailable == null) {
    return insufficient(
      "No OPTIMUS FBA stock snapshot exists for this SKU. Stale or missing stock is not treated as zero sellable units.",
      assumptions,
    );
  }
  if (input.fbaStockStale) {
    return insufficient(
      "The OPTIMUS FBA snapshot is stale and is not verified sellable inventory. No shipment quantity is suggested from it.",
      [...assumptions, "FBA stock older than 14 days is stale."],
    );
  }
  if (input.leadTimeDays <= 0 || input.targetCoverWeeks < 0) {
    return insufficient(
      "Replenishment lead time and target cover must be configured before a shipment is suggested.",
      assumptions,
    );
  }

  const net = input.amazonNetUnits30;
  const weeklyRate = Math.max(0, net) * (7 / 30);
  if (net < 0) {
    assumptions.push(
      "Returns exceeded sales in the last 30 days. Replenishment demand is zero rather than a negative shipment.",
    );
  }
  assumptions.push(
    `Weekly rate = max(0, ${round1(net)} net units over 30 days) × 7/30 = ${round1(weeklyRate)}.`,
  );
  assumptions.push(
    `Lead time ${input.leadTimeDays} days includes shipping and receiving. Target cover after arrival is ${input.targetCoverWeeks} weeks. Safety stock is ${input.safetyStockQty}.`,
  );

  const daily = weeklyRate / 7;
  const leadDemand = daily * input.leadTimeDays;
  const coverAfterArrival = weeklyRate * input.targetCoverWeeks;
  const projectedRequired = leadDemand + coverAfterArrival + Math.max(0, input.safetyStockQty);
  const inbound = Math.max(0, input.confirmedInboundQty);
  const raw = Math.max(0, projectedRequired - input.fbaAvailable - inbound);
  const suggested = roundUpToCaseMultiple(raw, input.caseMultiple);
  assumptions.push(
    `Required = lead-time demand ${round1(leadDemand)} + cover after arrival ${round1(coverAfterArrival)} + safety ${Math.max(0, input.safetyStockQty)} = ${round1(projectedRequired)}.`,
  );
  assumptions.push(
    `Send = max(0, required − FBA available ${input.fbaAvailable} − confirmed inbound ${inbound}) = ${round1(raw)}, then rounded up to the case multiple.`,
  );
  if (input.caseMultiple != null && input.caseMultiple > 1) {
    assumptions.push(
      `Shipments use complete cases of ${input.caseMultiple}. ` +
        "Dispatchable stock is rounded down to that multiple. Units left over are not dispatch-ready.",
    );
  }

  const studley = input.studleyAvailable;
  const onHand = studley == null || !Number.isFinite(studley) ? null : Math.max(0, studley);
  const capped = onHand == null ? null : Math.min(suggested, onHand);
  const dispatchable =
    capped == null ? null : roundDownToCaseMultiple(capped, input.caseMultiple);
  const loose =
    capped == null || dispatchable == null
      ? null
      : Math.round((capped - dispatchable) * 1000) / 1000;
  const shortfall = onHand == null ? null : Math.max(0, suggested - onHand);
  if (onHand == null) {
    assumptions.push(
      "Studley stock is not on the current warehouse feed, so dispatchable quantity is unknown.",
    );
  } else {
    if (loose != null && loose > 0) {
      assumptions.push(
        `Studley has ${onHand} against suggested ${suggested}. ` +
          `${dispatchable} can ship as complete cases. ` +
          `${loose} is loose stock and is not dispatch-ready.`,
      );
    }
    if (shortfall != null && shortfall > 0) {
      assumptions.push(
        `Buying ${shortfall} more reaches the suggested ${suggested}. ` +
          "That shortfall is a purchasing requirement, not a shipment.",
      );
    }
  }

  const coverWeeks = weeklyRate > 0 ? round1(input.fbaAvailable / weeklyRate) : null;
  const coverWithInbound =
    weeklyRate > 0 ? round1((input.fbaAvailable + inbound) / weeklyRate) : null;
  const stockoutDate =
    weeklyRate <= 0
      ? null
      : input.fbaAvailable <= 0
        ? input.today
        : addDaysIso(input.today, Math.floor(input.fbaAvailable / daily));
  let nextSendDate: string | null = null;
  if (weeklyRate > 0) {
    const daysOfSupply = (input.fbaAvailable + inbound) / daily;
    const daysUntilSend = daysOfSupply - input.leadTimeDays - input.targetCoverWeeks * 7;
    nextSendDate =
      daysUntilSend <= 0 ? input.today : addDaysIso(input.today, Math.floor(daysUntilSend));
  }

  let recommendation: FbaRecommendation = "HEALTHY";
  let reason =
    "Verified FBA stock and confirmed inbound cover the lead time, target cover and safety stock.";
  if (weeklyRate <= 0 && input.fbaAvailable > 0) {
    recommendation = "OVERSTOCKED";
    reason = "Amazon net sell-through is zero and FBA stock is still on hand.";
  } else if (
    coverWithInbound != null &&
    coverWithInbound >= input.overstockCoverWeeks &&
    suggested === 0
  ) {
    recommendation = "OVERSTOCKED";
    reason = `Cover including confirmed inbound is ${coverWithInbound} weeks, at or above the ${input.overstockCoverWeeks}-week overstock line.`;
  } else if (suggested > 0 && (coverWeeks == null || coverWeeks <= input.leadTimeDays / 7)) {
    recommendation = "SEND_NOW";
    reason =
      "FBA cover is inside the replenishment lead time. A shipment is suggested from verified sell-through.";
  } else if (suggested > 0) {
    recommendation = "SEND_SOON";
    reason =
      "A shipment is suggested so stock arrives with the target cover, and current cover is still beyond the lead time.";
  }

  const confidence = weeklyRate >= 0 && input.salesSupported ? "MEDIUM" : "NONE";
  return {
    recommendation,
    recommendationLabel: FBA_RECOMMENDATION_LABEL[recommendation],
    reason,
    confidence,
    assumptions,
    weeklyRate: round1(weeklyRate),
    projectedRequiredQty: Math.ceil(projectedRequired),
    rawSendQty: Math.ceil(raw),
    suggestedSendQty: suggested,
    dispatchableQty: dispatchable,
    looseStudleyQty: loose,
    studleyShortfallQty: shortfall,
    coverWeeks,
    stockoutDate,
    nextSendDate,
    fbaStockVerified: true,
  };
}

export type OinExceptionCode =
  | "DUPLICATE_OIN"
  | "ORPHAN_TRM_LINE"
  | "NO_PRODUCT_LINES"
  | "CREDIT_CORRECTION"
  | "MISMATCHED_INVOICE_VALUE"
  | "DUPLICATE_LINE"
  | "AMBIGUOUS_LINE";

export type OinException = {
  code: OinExceptionCode;
  documentReference: string | null;
  message: string;
};

export type OinLedgerDocument = {
  documentReference: string;
  documentType: "INVOICE" | "CREDIT";
  documentDate: string | null;
  customerAccount: string;
  customerName: string;
  goodsNet: string | null;
  lines: Array<{
    lineKey: string;
    sku: string;
    description: string | null;
    qty: string;
    salesNet: string | null;
  }>;
};

export function buildOinReplenishmentBatch(input: {
  headers: Autopart504Row[];
  lines: AutopartTrm21qcRow[];
}): { documents: OinLedgerDocument[]; exceptions: OinException[] } {
  const exceptions: OinException[] = [];
  const headers = new Map<string, Autopart504Row>();
  for (const row of input.headers) {
    if (row.kind !== "INVOICE" && row.kind !== "CREDIT") continue;
    if (!isOinReplenishmentReference(row.documentNumber)) continue;
    const key = `${row.kind}:${row.documentNumber.trim().toUpperCase()}`;
    if (headers.has(key)) {
      exceptions.push({
        code: "DUPLICATE_OIN",
        documentReference: row.documentNumber.trim().toUpperCase(),
        message: `Document ${row.documentNumber} appears more than once. The first row is kept.`,
      });
      continue;
    }
    headers.set(key, row);
  }

  const linesByDoc = new Map<string, AutopartTrm21qcRow[]>();
  for (const line of input.lines) {
    if (line.classification !== "OK") continue;
    if (!isOinReplenishmentReference(line.documentNumber)) continue;
    const ref = line.documentNumber.trim().toUpperCase();
    const kind = line.kind === "CREDIT" ? "CREDIT" : line.kind === "INVOICE" ? "INVOICE" : null;
    if (!kind) continue;
    const key = `${kind}:${ref}`;
    if (!headers.has(key)) {
      exceptions.push({
        code: "ORPHAN_TRM_LINE",
        documentReference: ref,
        message: `TRM21QC line for ${ref} has no matching OIN ${kind.toLowerCase()} header in this pair of files.`,
      });
      continue;
    }
    const list = linesByDoc.get(key) ?? [];
    list.push(line);
    linesByDoc.set(key, list);
  }

  const documents: OinLedgerDocument[] = [];
  for (const [key, header] of headers) {
    const ref = header.documentNumber.trim().toUpperCase();
    const rawLines = linesByDoc.get(key) ?? [];
    if (rawLines.length === 0) {
      exceptions.push({
        code: "NO_PRODUCT_LINES",
        documentReference: ref,
        message: `${ref} is an OIN ${header.kind.toLowerCase()} with no TRM21QC product lines in this import.`,
      });
    }
    if (header.kind === "CREDIT") {
      exceptions.push({
        code: "CREDIT_CORRECTION",
        documentReference: ref,
        message: `${ref} is an OIN credit. It reduces replenishment quantity and is not an Amazon customer return.`,
      });
    }
    const seenKeys = new Set<string>();
    const lines = rawLines.flatMap((line) => {
      const lineKey = line.sourceFingerprint || `${line.partNumber}:${line.lineNumber}`;
      if (seenKeys.has(lineKey)) {
        exceptions.push({
          code: "DUPLICATE_LINE",
          documentReference: ref,
          message: `Duplicate TRM line identity on ${ref} for ${line.partNumber}. The first line is kept.`,
        });
        return [];
      }
      seenKeys.add(lineKey);
      return [
        {
          lineKey,
          sku: line.partNumber.trim(),
          description: line.description,
          qty: line.qty ?? "0",
          salesNet: line.salesNet,
        },
      ];
    });
    const salesSum = lines.reduce(
      (sum, line) => sum + (line.salesNet == null ? 0 : Number(line.salesNet)),
      0,
    );
    if (
      header.goods != null &&
      lines.length > 0 &&
      Math.abs(salesSum - Number(header.goods)) > 0.01
    ) {
      exceptions.push({
        code: "MISMATCHED_INVOICE_VALUE",
        documentReference: ref,
        message: `${ref} TRM net ${salesSum.toFixed(2)} does not match 504 goods ${header.goods}. Both figures are kept for review.`,
      });
    }
    const account =
      rawLines.find((line) => line.customerAccount.trim())?.customerAccount.trim() ?? "";
    documents.push({
      documentReference: ref,
      documentType: header.kind === "CREDIT" ? "CREDIT" : "INVOICE",
      documentDate: header.documentDate,
      customerAccount: account.toUpperCase(),
      customerName: header.customerName.trim(),
      goodsNet: header.goods,
      lines,
    });
  }
  return { documents, exceptions };
}

/**
 * Effective completeness. A checkbox, or min/max sale dates, is not enough.
 * Gaps stay incomplete unless the file declares that omitted days are zero FBA sales.
 */
export function amazonExtractIsComplete(input: {
  declaredComplete: boolean;
  operatorAttestedComplete: boolean;
  fbaOnlyAttested: boolean;
  fulfilmentScope: string;
  coverageHasGaps: boolean;
  zerosOmitted: boolean;
}): boolean {
  if (!input.declaredComplete || !input.operatorAttestedComplete || !input.fbaOnlyAttested)
    return false;
  if (input.fulfilmentScope !== "FBA") return false;
  if (input.coverageHasGaps && !input.zerosOmitted) return false;
  return true;
}

/** A normalized file with no fulfilment column is stored only after an explicit FBA-only attestation. */
export function rejectUnprovenFbaSales(input: {
  normalizedFbaOnly: boolean;
  fbaOnlyAttested: boolean;
}): string | null {
  if (input.normalizedFbaOnly && !input.fbaOnlyAttested) {
    return "This file has no fulfilment_channel column. Attest that every row is Amazon FBA (AFN), or add the column. MFN and FBM rows are rejected and are not stored.";
  }
  return null;
}

/** A file with no marketplace column is stored only after an explicit Amazon UK attestation. */
export function rejectUnprovenUkMarketplace(input: {
  normalizedUkOnly: boolean;
  ukMarketplaceAttested: boolean;
}): string | null {
  if (input.normalizedUkOnly && !input.ukMarketplaceAttested) {
    return (
      "This file has no marketplace column. " +
      "Attest that every row is Amazon UK, or add a marketplace column. " +
      "Other marketplaces are not stored as UK demand."
    );
  }
  return null;
}

/** A complete FBA extract covers a window when its declared range, scope and extraction date support it. */
export function amazonWindowSupported(input: {
  completeDaily: boolean;
  fulfilmentScope: string | null;
  marketplace: string | null;
  coverageFrom: string | null;
  coverageTo: string | null;
  extractedOn: string | null;
  windowFrom: string;
  windowTo: string;
  today: string;
}): boolean {
  if (!input.completeDaily || !input.coverageFrom || !input.coverageTo || !input.extractedOn)
    return false;
  if (input.fulfilmentScope !== "FBA") return false;
  if (input.marketplace !== "AMAZON_UK") return false;
  if (input.extractedOn < input.coverageTo || input.extractedOn > input.today) return false;
  if (input.coverageFrom > input.windowFrom) return false;
  if (input.coverageTo >= input.windowTo) return true;
  const latestClosed = addDaysIso(input.today, -1);
  return input.coverageTo >= latestClosed && input.coverageTo >= addDaysIso(input.windowTo, -1);
}

export type OinActiveLine = { id: string; lineKey: string; matchKey: string };

export type OinIncomingLine = {
  lineKey: string;
  matchKey: string;
  sku: string;
  description: string | null;
  qty: string;
  salesNet: string | null;
};

/**
 * Replace lines for SKUs present in a revised document. Other SKUs on the document stay.
 * Two different line identities for one SKU in the same file are ambiguous and change nothing.
 */
export function reconcileOinDocumentLines(input: {
  documentReference: string;
  existing: OinActiveLine[];
  incoming: OinIncomingLine[];
}): { upsert: OinIncomingLine[]; supersedeIds: string[]; exceptions: OinException[] } {
  const bySku = new Map<string, OinIncomingLine[]>();
  for (const line of input.incoming) {
    const list = bySku.get(line.matchKey) ?? [];
    list.push(line);
    bySku.set(line.matchKey, list);
  }
  const upsert: OinIncomingLine[] = [];
  const supersedeIds: string[] = [];
  const exceptions: OinException[] = [];
  for (const [matchKey, lines] of bySku) {
    const distinct = new Map(lines.map((line) => [line.lineKey, line]));
    if (distinct.size > 1) {
      exceptions.push({
        code: "AMBIGUOUS_LINE",
        documentReference: input.documentReference,
        message: `${input.documentReference} has more than one TRM line for ${matchKey} in this file. Stored lines for that SKU were left unchanged.`,
      });
      continue;
    }
    const next = [...distinct.values()][0]!;
    upsert.push(next);
    for (const existing of input.existing) {
      if (existing.matchKey === matchKey && existing.lineKey !== next.lineKey)
        supersedeIds.push(existing.id);
    }
  }
  return { upsert, supersedeIds, exceptions };
}

/** Provisional OIN dispatch cadence. Never a substitute for Amazon sell-through. */
export function provisionalReplenishmentWeekly(netUnits: number, days: number): number | null {
  if (!Number.isFinite(netUnits) || !Number.isFinite(days) || days <= 0) return null;
  return Math.round((netUnits / (days / 7)) * 10) / 10;
}
