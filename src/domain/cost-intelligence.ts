/**
 * Catalogue Cost Intelligence workspace — URL state, labels, period helpers.
 * Reuses AutopartProductCostPosition / Snapshot semantics (no second history system).
 */
import {
  addDaysIso,
  isDateOnlyIso,
  todayLondonDateOnly,
  type DateOnlyRange,
} from "@/domain/sales-history-period";
import { parseMoney, moneyToString, type Money } from "@/domain/money";

export const COST_PERIODS = ["7D", "30D", "90D", "12M", "ALL", "CUSTOM"] as const;
export type CostPeriod = (typeof COST_PERIODS)[number];

export const COST_MOVEMENTS = [
  "ALL",
  "INCREASED",
  "DECREASED",
  "FIRST_SEEN",
  "UNCHANGED",
  "NO_COST",
] as const;
export type CostMovement = (typeof COST_MOVEMENTS)[number];

export const COST_VIEWS = [
  "ALL",
  "RECENT",
  "INCREASES",
  "DECREASES",
  "REPEATED",
  "PRICE_REVIEW",
] as const;
export type CostView = (typeof COST_VIEWS)[number];

export const COST_SORTS = [
  "LATEST_CHANGE",
  "PCT_INCREASE",
  "PCT_DECREASE",
  "GBP_INCREASE",
  "GBP_DECREASE",
  "NAME_AZ",
  "SKU",
  "COST_HIGH",
  "COST_LOW",
] as const;
export type CostSort = (typeof COST_SORTS)[number];

export const COST_MAGNITUDE_PRESETS = ["ANY", "PCT_1", "PCT_5", "PCT_10", "CUSTOM"] as const;
export type CostMagnitudePreset = (typeof COST_MAGNITUDE_PRESETS)[number];

/** Default Price Review threshold when no project setting exists. */
export const DEFAULT_PRICE_REVIEW_PCT = 5;

export type CostIntelligenceSearch = {
  period: CostPeriod;
  from?: string;
  to?: string;
  movement: CostMovement;
  view: CostView;
  brandId?: string;
  categoryId?: string;
  magnitude: CostMagnitudePreset;
  minPct?: string;
  minGbp?: string;
  q?: string;
  sort: CostSort;
  page: number;
  pageSize: number;
  catalogue: "CATALOGUE" | "UNMATCHED" | "ALL";
};

export function parseCostIntelligenceSearch(
  raw: Record<string, unknown>,
): CostIntelligenceSearch {
  const period = (COST_PERIODS as readonly string[]).includes(String(raw["period"] ?? ""))
    ? (raw["period"] as CostPeriod)
    : "30D";
  const movement = (COST_MOVEMENTS as readonly string[]).includes(String(raw["movement"] ?? ""))
    ? (raw["movement"] as CostMovement)
    : "ALL";
  const view = (COST_VIEWS as readonly string[]).includes(String(raw["view"] ?? ""))
    ? (raw["view"] as CostView)
    : "ALL";
  const sort = (COST_SORTS as readonly string[]).includes(String(raw["sort"] ?? ""))
    ? (raw["sort"] as CostSort)
    : "LATEST_CHANGE";
  const magnitude = (COST_MAGNITUDE_PRESETS as readonly string[]).includes(
    String(raw["magnitude"] ?? ""),
  )
    ? (raw["magnitude"] as CostMagnitudePreset)
    : "ANY";
  const page = Math.max(1, Number(raw["page"] ?? 1) || 1);
  const pageSizeRaw = Number(raw["pageSize"] ?? 50) || 50;
  const pageSize = [25, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : 50;
  const catalogue =
    raw["catalogue"] === "UNMATCHED" || raw["catalogue"] === "ALL"
      ? raw["catalogue"]
      : "CATALOGUE";

  const out: CostIntelligenceSearch = {
    period,
    movement,
    view,
    magnitude,
    sort,
    page,
    pageSize,
    catalogue,
  };
  if (typeof raw["from"] === "string" && isDateOnlyIso(raw["from"])) out.from = raw["from"];
  if (typeof raw["to"] === "string" && isDateOnlyIso(raw["to"])) out.to = raw["to"];
  if (typeof raw["brandId"] === "string" && raw["brandId"]) out.brandId = raw["brandId"];
  if (typeof raw["categoryId"] === "string" && raw["categoryId"]) out.categoryId = raw["categoryId"];
  if (typeof raw["minPct"] === "string" && raw["minPct"].trim()) out.minPct = raw["minPct"].trim();
  if (typeof raw["minGbp"] === "string" && raw["minGbp"].trim()) out.minGbp = raw["minGbp"].trim();
  if (typeof raw["q"] === "string" && raw["q"].trim()) out.q = raw["q"].trim();
  return out;
}

export function resolveCostPeriodRange(
  period: CostPeriod,
  from: string | null | undefined,
  to: string | null | undefined,
  today = todayLondonDateOnly(),
): DateOnlyRange | null {
  if (period === "ALL") return null;
  if (period === "CUSTOM") {
    if (from && to && isDateOnlyIso(from) && isDateOnlyIso(to) && from <= to) {
      return { from, to };
    }
    // Incomplete custom → last 30 days
    return { from: addDaysIso(today, -29), to: today };
  }
  if (period === "7D") return { from: addDaysIso(today, -6), to: today };
  if (period === "30D") return { from: addDaysIso(today, -29), to: today };
  if (period === "90D") return { from: addDaysIso(today, -89), to: today };
  // 12M
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCFullYear(dt.getUTCFullYear() - 1);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return { from: dt.toISOString().slice(0, 10), to: today };
}

/** Instant → Europe/London civil YYYY-MM-DD. */
export function londonDateOnlyFromInstant(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function dateInInclusiveRange(
  londonDate: string,
  range: DateOnlyRange | null,
): boolean {
  if (!range) return true;
  return londonDate >= range.from && londonDate <= range.to;
}

export type CostChangeDto = {
  absolute: string;
  percent: string | null;
  /** Absolute percent magnitude for threshold checks (2dp string). */
  absPercent: string | null;
  direction: "up" | "down" | "flat";
};

export function computeCostChange(current: Money, previous: Money | null): CostChangeDto | null {
  if (!previous) return null;
  const delta = current.minor - previous.minor;
  const direction: CostChangeDto["direction"] =
    delta > 0n ? "up" : delta < 0n ? "down" : "flat";
  const absolute = moneyToString({ minor: delta }, 4);
  let percent: string | null = null;
  let absPercent: string | null = null;
  if (previous.minor !== 0n) {
    const bps = (delta * 10000n) / previous.minor;
    const sign = bps < 0n ? "-" : bps > 0n ? "+" : "";
    const absBps = bps < 0n ? -bps : bps;
    const whole = absBps / 100n;
    const frac = (absBps % 100n).toString().padStart(2, "0");
    percent = `${sign}${whole.toString()}.${frac}`;
    absPercent = `${whole.toString()}.${frac}`;
  }
  return { absolute, percent, absPercent, direction };
}

export function parseCostMoney(value: string | null | undefined): Money | null {
  if (value == null || value === "") return null;
  return parseMoney(value);
}

export function movementLabel(m: CostMovement | "FIRST_SEEN" | string): string {
  switch (m) {
    case "INCREASED":
      return "↑ Increased";
    case "DECREASED":
      return "↓ Decreased";
    case "FIRST_SEEN":
      return "First Seen";
    case "UNCHANGED":
      return "— Unchanged";
    case "NO_COST":
      return "No Cost Data";
    default:
      return m;
  }
}

export function costPeriodLabel(p: CostPeriod): string {
  switch (p) {
    case "7D":
      return "7 days";
    case "30D":
      return "30 days";
    case "90D":
      return "90 days";
    case "12M":
      return "12 months";
    case "ALL":
      return "All history";
    case "CUSTOM":
      return "Custom";
  }
}

export function resolveMagnitudeThreshold(input: {
  magnitude: CostMagnitudePreset;
  minPct?: string | null | undefined;
  minGbp?: string | null | undefined;
}): { minPctBps: bigint | null; minGbpMinor: bigint | null } {
  if (input.magnitude === "ANY") return { minPctBps: null, minGbpMinor: null };
  if (input.magnitude === "PCT_1") return { minPctBps: 100n, minGbpMinor: null };
  if (input.magnitude === "PCT_5") return { minPctBps: 500n, minGbpMinor: null };
  if (input.magnitude === "PCT_10") return { minPctBps: 1000n, minGbpMinor: null };
  let minPctBps: bigint | null = null;
  let minGbpMinor: bigint | null = null;
  if (input.minPct?.trim()) {
    const n = Number(input.minPct);
    if (Number.isFinite(n) && n >= 0) minPctBps = BigInt(Math.round(n * 100));
  }
  if (input.minGbp?.trim()) {
    const m = parseMoney(input.minGbp.trim());
    if (m) minGbpMinor = m.minor < 0n ? -m.minor : m.minor;
  }
  return { minPctBps, minGbpMinor };
}

function absPercentToBps(absPercent: string): bigint {
  const [w, f] = absPercent.split(".");
  return BigInt(w!) * 100n + BigInt((f ?? "00").padEnd(2, "0").slice(0, 2));
}

export function meetsMagnitude(
  change: CostChangeDto | null,
  threshold: { minPctBps: bigint | null; minGbpMinor: bigint | null },
): boolean {
  if (threshold.minPctBps == null && threshold.minGbpMinor == null) return true;
  if (!change || change.direction === "flat") return false;
  const pctOk =
    threshold.minPctBps != null &&
    change.absPercent != null &&
    absPercentToBps(change.absPercent) >= threshold.minPctBps;
  let gbpOk = false;
  if (threshold.minGbpMinor != null) {
    const m = parseMoney(change.absolute);
    if (m) {
      const abs = m.minor < 0n ? -m.minor : m.minor;
      gbpOk = abs >= threshold.minGbpMinor;
    }
  }
  if (threshold.minPctBps != null && threshold.minGbpMinor != null) return pctOk || gbpOk;
  if (threshold.minPctBps != null) return pctOk;
  return gbpOk;
}

/** Count distinct cost transitions in an ordered cost series (identical repeats = 0). */
export function countDistinctCostMovements(costs: Array<string | null | undefined>): number {
  let count = 0;
  let prev: bigint | null = null;
  for (const c of costs) {
    const m = parseMoney(c ?? "");
    if (!m) continue;
    if (prev != null && m.minor !== prev) count += 1;
    prev = m.minor;
  }
  return count;
}

export function classifyPositionMovement(input: {
  previousCost: string | null;
  latestCost: string;
  firstObservedAt: Date;
  lastChangedAt: Date | null;
  range: DateOnlyRange | null;
}): CostMovement {
  const first = londonDateOnlyFromInstant(input.firstObservedAt);
  const changed = input.lastChangedAt
    ? londonDateOnlyFromInstant(input.lastChangedAt)
    : null;
  const firstInPeriod = dateInInclusiveRange(first, input.range);
  const changedInPeriod = changed ? dateInInclusiveRange(changed, input.range) : false;

  if (input.previousCost == null) {
    return firstInPeriod || !input.range ? "FIRST_SEEN" : "UNCHANGED";
  }

  const latest = parseMoney(input.latestCost);
  const previous = parseMoney(input.previousCost);
  if (!latest || !previous) return "UNCHANGED";

  if (changedInPeriod) {
    if (latest.minor > previous.minor) return "INCREASED";
    if (latest.minor < previous.minor) return "DECREASED";
    return "UNCHANGED";
  }

  // Changed outside period (or never after first): unchanged within period
  // First-seen outside period with no previous stays UNCHANGED for bounded periods.
  return "UNCHANGED";
}
