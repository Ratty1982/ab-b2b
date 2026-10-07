import { normalizeStockSku, skuMatchKey } from "@/domain/stock";
import { parseLatestCostCell, parseOptionalQuantityCell } from "@/domain/stock-parse-cost";
import {
  MAX_STOCK_FEED_BYTES,
  parseAvailCell,
  parseIncomingCell,
  type StagedStockRow,
  type StagedUsageFields,
  type StockParseFailure,
  type StockParseSuccess,
} from "@/domain/stock-parse-types";

const NEW_TITLE_RE = /\(\s*231PO3NEW\s*\)/i;

const SPACED_NUMERIC_QUINT_RE =
  /(-?\d+\.\d{2})\s+(-?\d+\.\d{4})\s+(-?\d+\.\d{4})\s+(-?\d+\.\d{4})\s+(-?\d+\.\d{4})/;

const MASHED_NUMERIC_QUINT_RE =
  /(-?\d+\.\d{2})(-?\d+\.\d{4})\s+(-?\d+\.\d{4})\s+(-?\d+\.\d{4})\s+(-?\d+\.\d{4})/;

const FORBIDDEN_SKU_TOKENS = new Set([
  "SUM",
  "TOTAL",
  "SUBTOTAL",
  "GROUP",
  "PAGE",
  "STOCK",
  "USAGES",
  "REORDER",
  "INFORMATION",
  "BRANCH",
  "SELECT",
  "AUTOPART",
  "SYSTEM",
]);

export type Po3ReportKind = "LEGACY_231PO3" | "231PO3NEW" | "UNKNOWN";

export function detect231Po3ReportKind(text: string): Po3ReportKind {
  if (!text) return "UNKNOWN";
  if (NEW_TITLE_RE.test(text)) return "231PO3NEW";
  const lines = normaliseReportLines(text);
  for (const line of lines) {
    if (!/Part\s*Number/i.test(line)) continue;
    const hasStk = /\bStk\b/i.test(line);
    const hasAvail = /\bAvail\b/i.test(line);
    const hasPickQty = /Pick\s*Qty/i.test(line);
    if (hasStk && hasAvail && hasPickQty) return "231PO3NEW";
    if (hasStk && !hasAvail) return "LEGACY_231PO3";
  }
  return "UNKNOWN";
}

export function is231Po3NewReport(text: string): boolean {
  return detect231Po3ReportKind(text) === "231PO3NEW";
}

export function normaliseReportLines(text: string): string[] {
  return text.replace(/\uFEFF/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function findHeaderLine(lines: string[]): string | null {
  for (const line of lines) {
    if (!/Part\s*Number/i.test(line)) continue;
    if (!/\bStk\b/i.test(line)) continue;
    if (!/\bAvail\b/i.test(line)) continue;
    if (!/Pick\s*Qty/i.test(line)) continue;
    return line;
  }
  return null;
}

function findLabelStart(header: string, label: string): number {
  return findLabelStartFrom(header, label, 0);
}

function findLabelStartFrom(header: string, label: string, from: number): number {
  const escaped = label
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  const re = new RegExp(escaped, "i");
  const slice = from > 0 ? header.slice(from) : header;
  const match = re.exec(slice);
  return match ? from + match.index : -1;
}

function sliceField(line: string, start: number, end: number): string {
  if (start < 0 || end <= start) return "";
  if (start >= line.length) return "";
  return line.slice(start, Math.min(end, line.length));
}

/** Slice the P/Ord Qty fixed-width region. Do not skip leftover digits from earlier columns. */
function sliceIncomingValue(line: string, start: number, end: number): string {
  const regionEnd = Number.isFinite(end) ? Math.min(end, line.length) : line.length;
  return sliceField(line, start, regionEnd).trim();
}

export function looksLikeSkuToken(raw: string): boolean {
  const s = raw.trim();
  if (!s || s.length > 64) return false;
  return /^[A-Za-z0-9][A-Za-z0-9./\-]*$/.test(s);
}

function isDashedOrSeparatorLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return /^[-_=.\s]+$/.test(t) && (t.includes("-") || t.includes("="));
}

function classifyNonProductLine(line: string): string | null {
  if (!line.trim()) return "BLANK";
  const t = line.trim();
  if (/^Page\s*:/i.test(t)) return "BANNER";
  if (/AUTOPART SYSTEM/i.test(t)) return "BANNER";
  if (/STOCK USAGES/i.test(t)) return "BANNER";
  if (/\(231PO3NEW\)/i.test(t)) return "BANNER";
  if (/\[Branch/i.test(t) || /\[Select\s+Group/i.test(t)) return "BANNER";
  if (/^Select\s+Group/i.test(t)) return "BANNER";
  if (/^\s*Branch\s+Group\s+Part\s+Number/i.test(line)) return "HEADER";
  if (/^\s*Group\s+Part\s+Number/i.test(line)) return "HEADER";
  if (isDashedOrSeparatorLine(line)) return "SEPARATOR";
  if (/^\s*Total\b/i.test(t) || /^\s*Sub\s*Total/i.test(t) || /^\s*Subtotal/i.test(t)) return "SUBTOTAL";
  if (/^\S+\s+SUM\b/i.test(t) && !/\d+\.\d{4}/.test(t)) return "SUMMARY";
  return null;
}

type QuintMatch = {
  costStart: number;
  costEnd: number;
  stkStart: number;
  stkEnd: number;
  availStart: number;
  availEnd: number;
  pickStart: number;
  pickEnd: number;
  physStart: number;
  physEnd: number;
  mashed: boolean;
};

function quintFromSpacedMatch(match: RegExpExecArray, regionBase: number): QuintMatch {
  const full = match[0]!;
  const cost = match[1]!;
  const stk = match[2]!;
  const avail = match[3]!;
  const pick = match[4]!;
  const phys = match[5]!;
  const base = regionBase + (match.index ?? 0);
  const costInFull = full.indexOf(cost);
  const stkInFull = full.indexOf(stk, costInFull + cost.length);
  const availInFull = full.indexOf(avail, stkInFull + stk.length);
  const pickInFull = full.indexOf(pick, availInFull + avail.length);
  const physInFull = full.indexOf(phys, pickInFull + pick.length);
  return {
    costStart: base + costInFull,
    costEnd: base + costInFull + cost.length,
    stkStart: base + stkInFull,
    stkEnd: base + stkInFull + stk.length,
    availStart: base + availInFull,
    availEnd: base + availInFull + avail.length,
    pickStart: base + pickInFull,
    pickEnd: base + pickInFull + pick.length,
    physStart: base + physInFull,
    physEnd: base + physInFull + phys.length,
    mashed: false,
  };
}

function quintFromMashedMatch(match: RegExpExecArray, regionBase: number): QuintMatch {
  const full = match[0]!;
  const cost = match[1]!;
  const stk = match[2]!;
  const avail = match[3]!;
  const pick = match[4]!;
  const phys = match[5]!;
  const base = regionBase + (match.index ?? 0);
  const afterMash = full.slice(cost.length + stk.length);
  const availInFull = cost.length + stk.length + afterMash.indexOf(avail);
  const afterAvail = full.slice(availInFull + avail.length);
  const pickInFull = availInFull + avail.length + afterAvail.indexOf(pick);
  const afterPick = full.slice(pickInFull + pick.length);
  const physInFull = pickInFull + pick.length + afterPick.indexOf(phys);
  return {
    costStart: base,
    costEnd: base + cost.length,
    stkStart: base + cost.length,
    stkEnd: base + cost.length + stk.length,
    availStart: base + availInFull,
    availEnd: base + availInFull + avail.length,
    pickStart: base + pickInFull,
    pickEnd: base + pickInFull + pick.length,
    physStart: base + physInFull,
    physEnd: base + physInFull + phys.length,
    mashed: true,
  };
}

function findAllNumericQuintsInRegion(region: string, regionBase: number): QuintMatch[] {
  const out: QuintMatch[] = [];
  const spacedRe = new RegExp(SPACED_NUMERIC_QUINT_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = spacedRe.exec(region)) != null) out.push(quintFromSpacedMatch(m, regionBase));
  const mashedRe = new RegExp(MASHED_NUMERIC_QUINT_RE.source, "g");
  while ((m = mashedRe.exec(region)) != null) out.push(quintFromMashedMatch(m, regionBase));
  return out;
}

function selectBestNumericQuint(matches: QuintMatch[], preferredCostStart?: number | null): QuintMatch | null {
  if (!matches.length) return null;
  if (preferredCostStart != null && Number.isFinite(preferredCostStart)) {
    const near = matches
      .map((q) => ({ q, dist: Math.abs(q.costStart - preferredCostStart) }))
      .filter((x) => x.dist <= 24)
      .sort((a, b) => a.dist - b.dist || b.q.costStart - a.q.costStart);
    if (near.length) return near[0]!.q;
  }
  return matches.reduce((best, cur) => (cur.costStart >= best.costStart ? cur : best));
}

function modeInt(values: number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

type IdentityOffsets = {
  hasBranch: boolean;
  groupStart: number;
  groupEnd: number;
  partNumberStart: number;
  partNumberEnd: number;
  descriptionStart: number;
  /** Header index of the C label. Null when the report has no C column — do not guess. */
  conditionColumn: number | null;
};

type NumericLayout = {
  latestCostStart: number;
  stkStart: number;
  availStart: number;
  availEnd: number;
  pickQtyStart: number;
  physicalStkStart: number;
  physicalStkEnd: number;
};

/**
 * Optional usage columns after Physical Stk.
 * Labels mirror Autopart source headers — do not reinterpret as calendar months.
 */
type UsageLayout = {
  ryrStart: number | null;
  currStart: number | null;
  mthStarts: Array<number | null>;
};

function detectUsageLayout(headerLine: string, _physicalStkEnd: number): UsageLayout {
  const ryrStart = findLabelStart(headerLine, "Ryr");
  const currStart = findLabelStart(headerLine, "Curr");
  const mthStarts: Array<number | null> = [];
  for (let i = 1; i <= 12; i += 1) {
    const idx = findLabelStart(headerLine, `Mth${i}`);
    mthStarts.push(idx >= 0 ? idx : null);
  }
  return {
    ryrStart: ryrStart >= 0 ? ryrStart : null,
    currStart: currStart >= 0 ? currStart : null,
    mthStarts,
  };
}

const P_ORD_QTY_LABEL_RE = /P\s*\/\s*Ord\s*Qty/i;

/**
 * Outstanding PO qty is the 231PO3NEW **P/Ord Qty** column.
 * Never use the field after Physical Stk (that is Ryr / usage history).
 * Never invent Incoming from a positional fallback if P/Ord Qty is absent.
 * Tolerates concatenated fixed-width labels such as `P/Ord QtySub Grp`.
 */
function detectIncomingLayout(
  headerLine: string,
  availStart: number,
): { start: number; end: number } | null {
  const match = P_ORD_QTY_LABEL_RE.exec(headerLine);
  if (!match) return null;
  const start = match.index;
  if (availStart >= 0 && start < availStart) return null;
  const after = start + match[0]!.length;
  const subGrp = findLabelStartFrom(headerLine, "Sub Grp", after);
  const group = findLabelStartFrom(headerLine, "GROUP", after);
  const ends = [subGrp, group].filter((idx) => idx > start);
  const end = ends.length ? Math.min(...ends) : Number.POSITIVE_INFINITY;
  return { start, end };
}

function sliceOptionalQty(line: string, start: number | null, end: number | null): string | null {
  if (start == null || start < 0) return null;
  const raw = end != null && end > start ? sliceField(line, start, end) : line.slice(start).trim().split(/\s+/)[0] ?? "";
  return parseOptionalQuantityCell(raw);
}

function detectIdentity(headerLine: string): IdentityOffsets | null {
  const hasBranch = /^\s*Branch[\s\t]+Group[\s\t]+Part[\s\t]+Number/i.test(headerLine);
  const groupStart = findLabelStart(headerLine, "Group");
  const partStart = findLabelStart(headerLine, "Part Number");
  const descStart = findLabelStart(headerLine, "Description");
  if (groupStart < 0 || partStart < 0 || descStart < 0) return null;
  let statusStart = -1;
  let conditionColumn: number | null = null;
  const between = headerLine.slice(partStart, descStart);
  const cMatch = /\sC\s/.exec(between);
  if (cMatch && cMatch.index != null) {
    statusStart = partStart + cMatch.index + cMatch[0]!.indexOf("C");
    conditionColumn = statusStart;
  } else {
    statusStart = descStart - 2;
  }
  return {
    hasBranch,
    groupStart,
    groupEnd: partStart,
    partNumberStart: partStart,
    partNumberEnd: Math.max(partStart + 1, statusStart),
    descriptionStart: descStart,
    conditionColumn,
  };
}

/** Group column between Branch and Part Number. Blank is null. Never inferred. */
function extractGroupCode(line: string, start: number, end: number): string | null {
  const raw = sliceField(line, start, end).replace(/\s+/g, "");
  if (!raw) return null;
  return raw.toUpperCase();
}

/** Read the single C-column character. Blank is null. Never inferred from Description. */
function extractConditionCode(line: string, column: number | null): string | null {
  if (column == null || column < 0) return null;
  const ch = line.charAt(column);
  if (!ch || /\s/.test(ch)) return null;
  return ch.toUpperCase();
}

function detectNumericLayout(lines: string[], identity: IdentityOffsets): NumericLayout | null {
  const costStarts: number[] = [];
  const stkStarts: number[] = [];
  const availStarts: number[] = [];
  const availEnds: number[] = [];
  const pickStarts: number[] = [];
  const physStarts: number[] = [];
  const physEnds: number[] = [];
  const collect = (allowMashed: boolean) => {
    let samples = 0;
    for (const line of lines) {
      if (classifyNonProductLine(line)) continue;
      if (line.length < identity.descriptionStart + 40) continue;
      const regionBase = identity.descriptionStart;
      const quint = selectBestNumericQuint(findAllNumericQuintsInRegion(line.slice(regionBase), regionBase));
      if (!quint) continue;
      if (!allowMashed && quint.mashed) continue;
      costStarts.push(quint.costStart);
      stkStarts.push(quint.stkStart);
      availStarts.push(quint.availStart);
      availEnds.push(quint.availEnd);
      pickStarts.push(quint.pickStart);
      physStarts.push(quint.physStart);
      physEnds.push(quint.physEnd);
      samples += 1;
      if (samples >= 40) break;
    }
    return samples;
  };
  let samples = collect(false);
  if (samples < 3) samples = collect(true);
  const latestCostStart = modeInt(costStarts);
  const stkStart = modeInt(stkStarts);
  const availStart = modeInt(availStarts);
  const availEnd = modeInt(availEnds);
  const pickQtyStart = modeInt(pickStarts);
  const physicalStkStart = modeInt(physStarts);
  const physicalStkEnd = modeInt(physEnds);
  if (
    samples < 1 ||
    latestCostStart == null ||
    stkStart == null ||
    availStart == null ||
    availEnd == null ||
    pickQtyStart == null ||
    physicalStkStart == null ||
    physicalStkEnd == null
  ) {
    return null;
  }
  const clustered = availStarts.filter((v) => Math.abs(v - availStart) <= 2).length;
  if (clustered < Math.max(1, Math.floor(samples * 0.5))) return null;
  return { latestCostStart, stkStart, availStart, availEnd, pickQtyStart, physicalStkStart, physicalStkEnd };
}

function extractNumericQuint(line: string, identity: IdentityOffsets, numeric: NumericLayout): QuintMatch | null {
  const region = line.slice(identity.descriptionStart);
  return selectBestNumericQuint(
    findAllNumericQuintsInRegion(region, identity.descriptionStart),
    numeric.latestCostStart,
  );
}

function extractAvail(line: string, identity: IdentityOffsets, numeric: NumericLayout): { raw: string; value: number } | null {
  const quint = extractNumericQuint(line, identity, numeric);
  if (quint) {
    const raw = line.slice(quint.availStart, quint.availEnd);
    const parsed = parseAvailCell(raw);
    if (parsed.ok) return { raw: parsed.raw, value: parsed.value };
  }
  const sliced = sliceField(line, numeric.availStart, numeric.pickQtyStart);
  const parsed = parseAvailCell(sliced);
  if (!parsed.ok) return null;
  return { raw: parsed.raw, value: parsed.value };
}

function extractCommercialFields(
  line: string,
  identity: IdentityOffsets,
  numeric: NumericLayout,
  usageLayout: UsageLayout,
): {
  latestCost: ReturnType<typeof parseLatestCostCell>;
  usage: StagedUsageFields;
} {
  const quint = extractNumericQuint(line, identity, numeric);
  const costRaw = quint
    ? line.slice(quint.costStart, quint.costEnd)
    : sliceField(line, numeric.latestCostStart, numeric.stkStart);
  const stkRaw = quint
    ? line.slice(quint.stkStart, quint.stkEnd)
    : sliceField(line, numeric.stkStart, numeric.availStart);
  const pickRaw = quint
    ? line.slice(quint.pickStart, quint.pickEnd)
    : sliceField(line, numeric.pickQtyStart, numeric.physicalStkStart);
  const physRaw = quint
    ? line.slice(quint.physStart, quint.physEnd)
    : sliceField(line, numeric.physicalStkStart, numeric.physicalStkEnd);

  const mthEnds = usageLayout.mthStarts.map((start, idx) => {
    if (start == null) return null;
    const next = usageLayout.mthStarts.slice(idx + 1).find((s) => s != null) ?? null;
    return next;
  });

  return {
    latestCost: parseLatestCostCell(costRaw),
    usage: {
      stk: parseOptionalQuantityCell(stkRaw),
      pickQty: parseOptionalQuantityCell(pickRaw),
      physicalStk: parseOptionalQuantityCell(physRaw),
      ryr: sliceOptionalQty(line, usageLayout.ryrStart, usageLayout.currStart),
      curr: sliceOptionalQty(
        line,
        usageLayout.currStart,
        usageLayout.mthStarts.find((s) => s != null) ?? null,
      ),
      mth: usageLayout.mthStarts.map((start, idx) => sliceOptionalQty(line, start, mthEnds[idx] ?? null)),
    },
  };
}

const AVAIL_FAIL: StockParseFailure = {
  code: "MISSING_AVAIL_HEADER",
  message: "231PO3NEW was detected, but the Avail column could not be parsed reliably. No stock was changed.",
};

/**
 * Native printed 231PO3NEW report. Sellable quantity is Avail only — never Stk, Pick Qty, or Physical Stk.
 */
export function parseNative231Po3New(text: string, byteLength?: number): StockParseSuccess | StockParseFailure {
  if (byteLength != null && byteLength > MAX_STOCK_FEED_BYTES) {
    return { code: "TOO_LARGE", message: `Feed exceeds ${MAX_STOCK_FEED_BYTES} bytes` };
  }
  if (!is231Po3NewReport(text)) {
    return { code: "MISSING_AVAIL_HEADER", message: "Not a 231PO3NEW report" };
  }
  const lines = normaliseReportLines(text);
  const headerLine = findHeaderLine(lines);
  if (!headerLine) return AVAIL_FAIL;
  const identity = detectIdentity(headerLine);
  if (!identity) return AVAIL_FAIL;
  const numeric = detectNumericLayout(lines, identity);
  if (!numeric) return AVAIL_FAIL;
  const usageLayout = detectUsageLayout(headerLine, numeric.physicalStkEnd);
  const incomingLayout = detectIncomingLayout(headerLine, findLabelStart(headerLine, "Avail"));

  const rows: StagedStockRow[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (classifyNonProductLine(line)) continue;
    const sku = normalizeStockSku(sliceField(line, identity.partNumberStart, identity.partNumberEnd));
    const skuUpper = sku.toUpperCase();
    if (!sku || FORBIDDEN_SKU_TOKENS.has(skuUpper) || !looksLikeSkuToken(sku)) continue;
    const descEnd = numeric.latestCostStart;
    const description = sliceField(line, identity.descriptionStart, descEnd).trim() || null;
    const conditionAuthoritative = identity.conditionColumn != null;
    const conditionCode = conditionAuthoritative ? extractConditionCode(line, identity.conditionColumn) : null;
    const groupCode = extractGroupCode(line, identity.groupStart, identity.groupEnd);
    const extracted = extractAvail(line, identity, numeric);
    const availRaw = extracted?.raw ?? "";
    const avail = extracted
      ? { ok: true as const, value: extracted.value, raw: extracted.raw }
      : parseAvailCell("");
    const commercial = extractCommercialFields(line, identity, numeric, usageLayout);
    const incoming = incomingLayout
      ? parseIncomingCell(sliceIncomingValue(line, incomingLayout.start, incomingLayout.end))
      : undefined;
    rows.push({
      line: i + 1,
      sku,
      matchKey: skuMatchKey(sku),
      description,
      availRaw,
      avail,
      latestCost: commercial.latestCost,
      usage: commercial.usage,
      ...(incoming ? { incoming } : {}),
      conditionAuthoritative,
      conditionCode,
      groupAuthoritative: true,
      groupCode,
    });
  }

  if (!rows.length) return AVAIL_FAIL;
  return {
    delimiter: "native",
    skuHeader: "Part Number",
    availHeader: "Avail",
    incomingHeader: incomingLayout ? "P/Ord Qty" : null,
    rows,
  };
}
