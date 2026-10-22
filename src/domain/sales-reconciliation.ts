/**
 * Read-only rules for the Sales Enquiry reconciliation investigation.
 * These labels describe what a person should correct. They never change a record.
 */
import { unifiedReasonLabel, UNIFIED_SOURCES, UNIFIED_UNRECONCILED_REASONS } from "@/domain/unified-sales";

export const RECONCILIATION_ACTIONS = ["AUTOPART_SOURCE", "ACCOUNT_MAPPING", "IMPORT_PROCESSING"] as const;
export type ReconciliationAction = (typeof RECONCILIATION_ACTIONS)[number];

export const AMBIGUOUS_ACCOUNT_REASON = "AMBIGUOUS_ACCOUNT";

export const RECONCILIATION_REASONS = [...UNIFIED_UNRECONCILED_REASONS, AMBIGUOUS_ACCOUNT_REASON] as const;
export type ReconciliationReason = (typeof RECONCILIATION_REASONS)[number];

export const RECONCILIATION_DOCUMENT_TYPES = ["INVOICE", "CREDIT", "UNKNOWN"] as const;
export type ReconciliationDocumentType = (typeof RECONCILIATION_DOCUMENT_TYPES)[number];

export const RECONCILIATION_SOURCES = UNIFIED_SOURCES;

/** Default investigation lines are the ones that explain the document gap. */
export const LINE_COMPARISON_VIEWS = ["DIFFERENCES", "ALL", "MATCHING", "DUPLICATES"] as const;
export type LineComparisonView = (typeof LINE_COMPARISON_VIEWS)[number];

export const LINE_COMPARISON_VIEW_LABELS: Record<LineComparisonView, string> = {
  DIFFERENCES: "Differences",
  ALL: "All lines",
  MATCHING: "Matching lines",
  DUPLICATES: "Duplicates",
};

export const COMPARISON_KINDS = [
  "MATCH",
  "MISSING",
  "QTY_CHANGED",
  "NET_CHANGED",
  "QTY_AND_NET_CHANGED",
  "REPEATED",
  "HELD",
] as const;
export type ComparisonKind = (typeof COMPARISON_KINDS)[number];

export const COMPARISON_KIND_LABELS: Record<ComparisonKind, string> = {
  MATCH: "Matching line",
  MISSING: "Missing line",
  QTY_CHANGED: "Quantity changed",
  NET_CHANGED: "Signed net changed",
  QTY_AND_NET_CHANGED: "Quantity and signed net changed",
  REPEATED: "Repeated entry",
  HELD: "Held line",
};

/** Certification still prefers TRM21QC, then the company import, then 561L history. */
const SOURCE_PRIORITY = ["TRM21QC_FEED", "COMPANY_561L_SLRB", "HISTORICAL_561L", "ONGOING_504"];

export type ComparisonSourceLine = {
  lineId: string;
  source: string;
  sku: string;
  qty: string;
  net: string;
  reason: string;
};

export type ComparisonSourceTotal = {
  source: string;
  sourceLabel: string;
  lineCount: number;
  net: string;
};

export type ComparedOccurrence = {
  id: string;
  kind: ComparisonKind;
  label: string;
  sku: string;
  /** 1-based index of this SKU so identical product lines stay separate. */
  occurrence: number;
  sources: Array<{
    source: string;
    sourceLabel: string;
    lineId: string | null;
    qty: string | null;
    net: string | null;
    missing: boolean;
  }>;
  qtyDifference: string | null;
  netDifference: string | null;
};

export type DocumentLineComparison = {
  rows: ComparedOccurrence[];
  matching: number;
  missing: number;
  quantityChanged: number;
  netChanged: number;
  repeated: number;
  held: number;
  summary: string;
  totalDifference: string | null;
  totalDifferenceSummary: string | null;
};

export const RECONCILIATION_ACTION_LABELS: Record<ReconciliationAction, string> = {
  AUTOPART_SOURCE: "Correct Autopart source data",
  ACCOUNT_MAPPING: "Correct account mapping",
  IMPORT_PROCESSING: "Correct import processing",
};

export const RECONCILIATION_ACTION_GUIDANCE: Record<ReconciliationAction, string> = {
  AUTOPART_SOURCE:
    "Correct the Autopart source data so the document, quantities and goods total agree. This screen does not change those records.",
  ACCOUNT_MAPPING:
    "Correct the account mapping so this code belongs to one CRM company. This screen does not change the link.",
  IMPORT_PROCESSING:
    "Correct import processing for the repeated 561L row. This screen does not delete the stored row.",
};

export const RECONCILIATION_READ_ONLY_NOTE =
  "Read only. This investigation does not rewrite financial records, delete duplicates, override certification, or mark anything reconciled.";

const ACTION_PRIORITY: ReconciliationAction[] = ["ACCOUNT_MAPPING", "IMPORT_PROCESSING", "AUTOPART_SOURCE"];

export function reconciliationReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Unreconciled";
  if (reason === AMBIGUOUS_ACCOUNT_REASON) {
    return "This account code is linked to more than one CRM company, so its sales stay out of certified totals.";
  }
  return unifiedReasonLabel(reason) ?? reason;
}

export function reconciliationActionForReason(reason: string): ReconciliationAction {
  if (reason === AMBIGUOUS_ACCOUNT_REASON) return "ACCOUNT_MAPPING";
  if (reason === "REPEATED_SOURCE_ROW") return "IMPORT_PROCESSING";
  return "AUTOPART_SOURCE";
}

/** Stable order so account mapping is not hidden behind a source discrepancy on the same document. */
export function reconciliationActions(reasons: string[]): ReconciliationAction[] {
  const present = new Set(reasons.map(reconciliationActionForReason));
  return ACTION_PRIORITY.filter((action) => present.has(action));
}

function toPence(value: string): number {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const [poundsRaw, fraction = ""] = trimmed.replace("-", "").split(".");
  const pounds = Number(poundsRaw || "0");
  const pence = Number((fraction + "00").slice(0, 2));
  if (!Number.isFinite(pounds) || !Number.isFinite(pence)) return 0;
  const total = pounds * 100 + pence;
  return negative ? -total : total;
}

function fromPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 504 goods total minus the product-line net. Null when there is no 504 header. */
export function goodsAgainstLinesDifference(goodsNet: string | null, productLineNet: string): string | null {
  if (goodsNet == null) return null;
  return fromPence(toPence(goodsNet) - toPence(productLineNet));
}

/** Gap between the highest and lowest source totals on one document. */
export function sourceSpread(nets: string[]): string | null {
  if (nets.length < 2) return null;
  const values = nets.map(toPence);
  return fromPence(Math.max(...values) - Math.min(...values));
}

/**
 * Difference shown on a line.
 * A 504 mismatch uses the document goods gap.
 * A SKU that exists on another source uses this net minus that other net.
 * Every other held line shows its own net, the amount kept out of the certified total.
 */
export function lineMatchesComparisonView(kind: ComparisonKind, view: LineComparisonView): boolean {
  if (view === "ALL") return true;
  if (view === "MATCHING") return kind === "MATCH";
  if (view === "DUPLICATES") return kind === "REPEATED";
  return kind !== "MATCH";
}

function normaliseQty(value: string): string {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const [wholeRaw, fraction = ""] = trimmed.replace("-", "").split(".");
  const whole = Number(wholeRaw || "0");
  const thousandths = Number((fraction + "000").slice(0, 3));
  if (!Number.isFinite(whole) || !Number.isFinite(thousandths)) return "0.000";
  const total = whole * 1000 + thousandths;
  const signed = negative ? -total : total;
  const sign = signed < 0 ? "-" : "";
  const abs = Math.abs(signed);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, "0")}`;
}

function preferredProductSource(sources: string[]): string | null {
  const product = sources.filter((source) => source !== "ONGOING_504");
  if (product.length === 0) return null;
  return [...product].sort((left, right) => {
    const leftRank = SOURCE_PRIORITY.indexOf(left);
    const rightRank = SOURCE_PRIORITY.indexOf(right);
    return (leftRank === -1 ? 99 : leftRank) - (rightRank === -1 ? 99 : rightRank);
  })[0]!;
}

/** Highest source total minus the lowest. Source totals are not certified sales. */
export function describeSourceTotalDifference(
  sources: ComparisonSourceTotal[],
): { totalDifference: string | null; summary: string | null } {
  const product = sources.filter((source) => source.source !== "ONGOING_504");
  if (product.length < 2) return { totalDifference: null, summary: null };
  const sorted = [...product].sort((left, right) => toPence(left.net) - toPence(right.net));
  const low = sorted[0]!;
  const high = sorted[sorted.length - 1]!;
  const totalDifference = fromPence(toPence(high.net) - toPence(low.net));
  if (totalDifference === "0.00") {
    return {
      totalDifference,
      summary: "Source totals agree. These totals are not certified sales.",
    };
  }
  return {
    totalDifference,
    summary: `${high.sourceLabel} (${high.lineCount} lines, ${high.net}) is ${totalDifference} higher than ${low.sourceLabel} (${low.lineCount} lines, ${low.net}). These source totals are not certified sales.`,
  };
}

type WorkingLine = ComparisonSourceLine & { qtyKey: string; netKey: string };

function sourceRank(source: string): number {
  const rank = SOURCE_PRIORITY.indexOf(source);
  return rank === -1 ? 99 : rank;
}

function heldKind(reason: string): ComparisonKind {
  if (reason === "REPEATED_SOURCE_ROW") return "REPEATED";
  return "HELD";
}

function isHeldReason(reason: string): boolean {
  return (
    reason === "NO_DOCUMENT_REFERENCE" ||
    reason === "UNKNOWN_DOCUMENT_TYPE" ||
    reason === AMBIGUOUS_ACCOUNT_REASON ||
    reason === "REPEATED_SOURCE_ROW"
  );
}

/**
 * Pair product-line occurrences across sources.
 * Identical lines are matched one occurrence at a time, so two genuine copies of the
 * same SKU, quantity and net stay as two lines instead of collapsing into one.
 */
export function compareDocumentLines(input: {
  lines: ComparisonSourceLine[];
  sources: ComparisonSourceTotal[];
}): DocumentLineComparison {
  const productSourceNames = [
    ...new Set(
      input.sources
        .map((source) => source.source)
        .filter((source) => source !== "ONGOING_504")
        .concat(input.lines.map((line) => line.source).filter((source) => source !== "ONGOING_504")),
    ),
  ].sort((left, right) => sourceRank(left) - sourceRank(right) || left.localeCompare(right));
  const labels = new Map(input.sources.map((source) => [source.source, source.sourceLabel]));
  const labelFor = (source: string) => labels.get(source) ?? source;
  const preferred = preferredProductSource(productSourceNames);
  const rows: ComparedOccurrence[] = [];
  const occurrenceBySku = new Map<string, number>();
  const nextOccurrence = (sku: string) => {
    const next = (occurrenceBySku.get(sku) ?? 0) + 1;
    occurrenceBySku.set(sku, next);
    return next;
  };

  const repeated = input.lines.filter((line) => line.reason === "REPEATED_SOURCE_ROW" && line.source !== "ONGOING_504");
  const product = input.lines
    .filter((line) => line.source !== "ONGOING_504" && line.reason !== "REPEATED_SOURCE_ROW")
    .map((line) => ({ ...line, qtyKey: normaliseQty(line.qty), netKey: normaliseNet(line.net) }));

  const pushRow = (row: Omit<ComparedOccurrence, "id" | "label">) => {
    rows.push({ ...row, id: `${row.kind}|${row.sku}|${row.occurrence}|${row.sources.map((cell) => cell.lineId ?? "missing").join("|")}`, label: COMPARISON_KIND_LABELS[row.kind] });
  };

  if (productSourceNames.length < 2) {
    for (const line of [...product, ...repeated.map((line) => ({ ...line, qtyKey: normaliseQty(line.qty), netKey: normaliseNet(line.net) }))]) {
      if (!isHeldReason(line.reason) && line.reason !== "REPEATED_SOURCE_ROW") continue;
      const kind = heldKind(line.reason);
      pushRow({
        kind,
        sku: line.sku,
        occurrence: nextOccurrence(line.sku),
        sources: [
          {
            source: line.source,
            sourceLabel: labelFor(line.source),
            lineId: line.lineId,
            qty: line.qtyKey,
            net: line.netKey,
            missing: false,
          },
        ],
        qtyDifference: null,
        netDifference: line.netKey,
      });
    }
  } else {
    const bySku = new Map<string, WorkingLine[]>();
    for (const line of product) {
      const list = bySku.get(line.sku) ?? [];
      list.push(line);
      bySku.set(line.sku, list);
    }
    for (const sku of [...bySku.keys()].sort()) {
      const skuLines = bySku.get(sku) ?? [];
      const remaining = new Map<string, WorkingLine[]>();
      for (const source of productSourceNames) {
        remaining.set(
          source,
          skuLines.filter((line) => line.source === source).sort((left, right) => left.lineId.localeCompare(right.lineId)),
        );
      }
      const signatures = [
        ...new Set(skuLines.map((line) => `${line.qtyKey}|${line.netKey}`)),
      ].sort();
      for (const signature of signatures) {
        const buckets = productSourceNames.map((source) =>
          (remaining.get(source) ?? []).filter((line) => `${line.qtyKey}|${line.netKey}` === signature),
        );
        const pairCount = Math.min(...buckets.map((bucket) => bucket.length));
        for (let index = 0; index < pairCount; index += 1) {
          const chosen = buckets.map((bucket) => bucket[index]!);
          for (const source of productSourceNames) {
            const list = remaining.get(source) ?? [];
            const chosenLine = chosen[productSourceNames.indexOf(source)]!;
            remaining.set(
              source,
              list.filter((line) => line.lineId !== chosenLine.lineId),
            );
          }
          pushRow(buildPairedRow(sku, nextOccurrence(sku), productSourceNames, chosen, labelFor, preferred));
        }
      }
      const leftovers = productSourceNames.map((source) =>
        (remaining.get(source) ?? []).sort((left, right) =>
          left.qtyKey.localeCompare(right.qtyKey) || left.netKey.localeCompare(right.netKey) || left.lineId.localeCompare(right.lineId),
        ),
      );
      const maxLeft = Math.max(...leftovers.map((list) => list.length));
      for (let index = 0; index < maxLeft; index += 1) {
        const chosen = leftovers.map((list) => list[index] ?? null);
        pushRow(buildPairedRow(sku, nextOccurrence(sku), productSourceNames, chosen, labelFor, preferred));
      }
    }
    for (const line of repeated.sort((left, right) => left.sku.localeCompare(right.sku) || left.lineId.localeCompare(right.lineId))) {
      const netKey = normaliseNet(line.net);
      const qtyKey = normaliseQty(line.qty);
      pushRow({
        kind: "REPEATED",
        sku: line.sku,
        occurrence: nextOccurrence(line.sku),
        sources: productSourceNames.map((source) => ({
          source,
          sourceLabel: labelFor(source),
          lineId: source === line.source ? line.lineId : null,
          qty: source === line.source ? qtyKey : null,
          net: source === line.source ? netKey : null,
          missing: source !== line.source,
        })),
        qtyDifference: qtyGap(productSourceNames, preferred, line.source, qtyKey),
        netDifference: netGap(productSourceNames, preferred, line.source, netKey),
      });
    }
  }

  const headerOnly = input.lines.filter((line) => line.source === "ONGOING_504" && product.length === 0 && repeated.length === 0);
  for (const line of headerOnly) {
    pushRow({
      kind: "HELD",
      sku: line.sku,
      occurrence: nextOccurrence(line.sku || "504"),
      sources: [
        {
          source: line.source,
          sourceLabel: labelFor(line.source),
          lineId: line.lineId,
          qty: normaliseQty(line.qty),
          net: normaliseNet(line.net),
          missing: false,
        },
      ],
      qtyDifference: null,
      netDifference: normaliseNet(line.net),
    });
  }

  const counts = countComparison(rows);
  const described = describeSourceTotalDifference(input.sources);
  return {
    rows,
    ...counts,
    summary: comparisonSummary(counts),
    totalDifference: described.totalDifference,
    totalDifferenceSummary: described.summary,
  };
}

function buildPairedRow(
  sku: string,
  occurrence: number,
  sourceNames: string[],
  chosen: Array<WorkingLine | null>,
  labelFor: (source: string) => string,
  preferred: string | null,
): Omit<ComparedOccurrence, "id" | "label"> {
  const present = chosen.filter((line): line is WorkingLine => line != null);
  const qtyKeys = new Set(present.map((line) => line.qtyKey));
  const netKeys = new Set(present.map((line) => line.netKey));
  const allPresent = present.length === sourceNames.length && sourceNames.length > 0;
  let kind: ComparisonKind;
  if (!allPresent) kind = "MISSING";
  else if (qtyKeys.size > 1 && netKeys.size > 1) kind = "QTY_AND_NET_CHANGED";
  else if (qtyKeys.size > 1) kind = "QTY_CHANGED";
  else if (netKeys.size > 1) kind = "NET_CHANGED";
  else kind = "MATCH";
  const cells = sourceNames.map((source, index) => {
    const line = chosen[index];
    return {
      source,
      sourceLabel: labelFor(source),
      lineId: line?.lineId ?? null,
      qty: line?.qtyKey ?? null,
      net: line?.netKey ?? null,
      missing: line == null,
    };
  });
  return {
    kind,
    sku,
    occurrence,
    sources: cells,
    qtyDifference: kind === "MATCH" ? "0.000" : signedGap(cells, preferred, "qty"),
    netDifference: kind === "MATCH" ? "0.00" : signedGap(cells, preferred, "net"),
  };
}

function signedGap(
  cells: ComparedOccurrence["sources"],
  preferred: string | null,
  field: "qty" | "net",
): string | null {
  if (!preferred) return null;
  const baseline = cells.find((cell) => cell.source === preferred);
  const other = cells.find((cell) => cell.source !== preferred);
  if (!other && cells.length < 2) return null;
  const baselineValue = baseline?.missing || baseline?.[field] == null ? (field === "qty" ? "0.000" : "0.00") : baseline[field]!;
  const otherValue = !other || other.missing || other[field] == null ? (field === "qty" ? "0.000" : "0.00") : other[field]!;
  if (field === "qty") return qtySubtract(otherValue, baselineValue);
  return fromPence(toPence(otherValue) - toPence(baselineValue));
}

function qtySubtract(value: string, baseline: string): string {
  return fromThousandths(toThousandths(value) - toThousandths(baseline));
}

function toThousandths(value: string): number {
  const normalised = normaliseQty(value);
  const negative = normalised.startsWith("-");
  const [whole, fraction = "0"] = normalised.replace("-", "").split(".");
  const total = Number(whole) * 1000 + Number(fraction);
  return negative ? -total : total;
}

function fromThousandths(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, "0")}`;
}

function qtyGap(sourceNames: string[], preferred: string | null, presentSource: string, qty: string): string | null {
  if (!preferred || sourceNames.length < 2) return null;
  return presentSource === preferred ? qtySubtract("0.000", qty) : qtySubtract(qty, "0.000");
}

function netGap(sourceNames: string[], preferred: string | null, presentSource: string, net: string): string | null {
  if (!preferred || sourceNames.length < 2) return null;
  return presentSource === preferred ? fromPence(0 - toPence(net)) : fromPence(toPence(net));
}

function normaliseNet(value: string): string {
  return fromPence(toPence(value));
}

function countComparison(rows: ComparedOccurrence[]): Pick<
  DocumentLineComparison,
  "matching" | "missing" | "quantityChanged" | "netChanged" | "repeated" | "held"
> {
  return {
    matching: rows.filter((row) => row.kind === "MATCH").length,
    missing: rows.filter((row) => row.kind === "MISSING").length,
    quantityChanged: rows.filter((row) => row.kind === "QTY_CHANGED" || row.kind === "QTY_AND_NET_CHANGED").length,
    netChanged: rows.filter((row) => row.kind === "NET_CHANGED" || row.kind === "QTY_AND_NET_CHANGED").length,
    repeated: rows.filter((row) => row.kind === "REPEATED").length,
    held: rows.filter((row) => row.kind === "HELD").length,
  };
}

function comparisonSummary(counts: ReturnType<typeof countComparison>): string {
  return `${counts.missing} missing, ${counts.quantityChanged} quantity changes, ${counts.netChanged} signed net changes, ${counts.repeated} repeated. ${counts.matching} matching lines are not part of the difference.`;
}

export function investigationLineDifference(input: {
  reason: string;
  net: string;
  sku: string;
  source: string;
  documentDifference: string | null;
  peers: Array<{ sku: string; source: string; net: string }>;
}): string {
  if (input.reason === "DOCUMENT_GOODS_MISMATCH" && input.documentDifference != null) {
    return input.documentDifference;
  }
  const others = input.peers.filter((peer) => peer.sku === input.sku && peer.source !== input.source);
  if (others.length > 0) {
    const baseline = others.map((peer) => toPence(peer.net)).sort((left, right) => left - right)[0]!;
    return fromPence(toPence(input.net) - baseline);
  }
  return fromPence(toPence(input.net));
}
