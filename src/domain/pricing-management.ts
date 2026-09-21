import {
  moneyFromUnknown,
  moneyToString,
  parseMoney,
  roundGbpDisplay,
  subMoney,
  type Money,
} from "@/domain/money";
import { applyPromotion, inValidityWindow, type PromotionKind } from "@/domain/trade-price-resolution";

export type WindowStatus = "scheduled" | "active" | "expired";
export type PromotionDisplayState = "scheduled" | "active" | "expired" | "disabled";

export function commercialWindowStatus(
  at: Date,
  startsAt: Date | null,
  endsAt: Date | null,
): WindowStatus {
  if (startsAt && at < startsAt) return "scheduled";
  if (endsAt && at > endsAt) return "expired";
  if (inValidityWindow(at, startsAt, endsAt)) return "active";
  return "expired";
}

export function promotionDisplayState(
  at: Date,
  isActive: boolean,
  startsAt: Date | null,
  endsAt: Date | null,
): PromotionDisplayState {
  if (!isActive) return "disabled";
  return commercialWindowStatus(at, startsAt, endsAt);
}

/** First full-case quantity that meets a stored break threshold. Does not change the threshold. */
export function firstOrderableQuantity(minQty: number, caseQty: number | null | undefined): number {
  if (!Number.isFinite(minQty) || minQty < 1) return 1;
  const pack = caseQty && caseQty > 1 ? caseQty : 1;
  return Math.ceil(minQty / pack) * pack;
}

export function caseBreakNote(minQty: number, caseQty: number | null | undefined): string | null {
  if (!caseQty || caseQty < 2) return null;
  const orderable = firstOrderableQuantity(minQty, caseQty);
  const cases = orderable / caseQty;
  return `First orderable quantity meeting this break: ${orderable} units (${cases} case${cases === 1 ? "" : "s"}).`;
}

export function formatGbpFromUnknown(value: unknown): string | null {
  const money = moneyFromUnknown(value);
  if (!money) return null;
  return `£${moneyToString(roundGbpDisplay(money), 2)}`;
}

export type PriceDifference = {
  absolute: string;
  absoluteDisplay: string;
  percentTenths: string;
  percentLabel: string;
  signedDisplay: string;
};

/**
 * Admin-only list-vs-base comparison using scaled money.
 * Not used by the trade-price resolver.
 */
export function priceDifferenceFromUnknown(base: unknown, list: unknown): PriceDifference | null {
  const baseMoney = moneyFromUnknown(base);
  const listMoney = moneyFromUnknown(list);
  if (!baseMoney || !listMoney) return null;
  const delta = subMoney(listMoney, baseMoney);
  const absDisplay = moneyToString(roundGbpDisplay(delta), 2);
  const percent = percentOfBase(delta, baseMoney);
  const signed = absDisplay.startsWith("-") ? absDisplay : delta.minor === 0n ? absDisplay : `+${absDisplay}`;
  return {
    absolute: moneyToString(delta),
    absoluteDisplay: absDisplay,
    percentTenths: percent,
    percentLabel: `${percent}%`,
    signedDisplay: `£${signed} (${percent}%)`,
  };
}

function percentOfBase(delta: Money, base: Money): string {
  if (base.minor === 0n) return "0.0";
  const sign = delta.minor < 0n ? -1n : 1n;
  const absDelta = delta.minor < 0n ? -delta.minor : delta.minor;
  const absBase = base.minor < 0n ? -base.minor : base.minor;
  const prod = absDelta * 1000n;
  const q = prod / absBase;
  const rem = prod % absBase;
  const up = rem * 2n >= absBase ? q + 1n : q;
  const tenths = sign * up;
  const neg = tenths < 0n;
  const abs = neg ? -tenths : tenths;
  const whole = abs / 10n;
  const frac = (abs % 10n).toString();
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

export function parsePromotionMetadata(metadata: unknown): {
  variantIds: string[];
  skus: string[];
  catalogueWide: boolean;
} {
  if (!metadata || typeof metadata !== "object") {
    return { variantIds: [], skus: [], catalogueWide: true };
  }
  const rec = metadata as Record<string, unknown>;
  const variantIds = Array.isArray(rec["variantIds"])
    ? rec["variantIds"].filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const skus = Array.isArray(rec["skus"])
    ? rec["skus"].filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return {
    variantIds,
    skus,
    catalogueWide: variantIds.length === 0 && skus.length === 0,
  };
}

export function promotionTypeLabel(type: PromotionKind): string {
  if (type === "PERCENT") return "Percent off the commercial unit price";
  if (type === "FIXED") return "Fixed amount off per unit";
  return "Quantity deal (stored, not applied by the pricing engine)";
}

export function previewPromotionUnit(input: {
  unitPrice: unknown;
  type: PromotionKind;
  value: unknown;
}): { applied: boolean; result: string | null; resultDisplay: string | null; note: string } {
  if (input.type === "QUANTITY_DEAL") {
    return {
      applied: false,
      result: null,
      resultDisplay: null,
      note: "QUANTITY_DEAL is not currently applied by the pricing engine.",
    };
  }
  const unit = moneyFromUnknown(input.unitPrice);
  if (!unit) {
    return { applied: false, result: null, resultDisplay: null, note: "Enter a current unit price to preview." };
  }
  const next = applyPromotion(unit, {
    id: "preview",
    code: "PREVIEW",
    name: "Preview",
    type: input.type,
    value: input.value,
    startsAt: null,
    endsAt: null,
    isActive: true,
    variantIds: null,
    skus: null,
  });
  if (!next) {
    return { applied: false, result: null, resultDisplay: null, note: "Promotion cannot be applied to this price." };
  }
  return {
    applied: next.minor < unit.minor,
    result: moneyToString(next),
    resultDisplay: moneyToString(roundGbpDisplay(next), 2),
    note: next.minor < unit.minor ? "Preview only — the server resolves the live price." : "This promotion would not reduce the unit price.",
  };
}

export type PriceListCsvIssue = {
  line: number;
  sku: string;
  message: string;
  kind: "unknown_sku" | "duplicate_sku" | "invalid_price" | "invalid_row";
};

export type PriceListCsvRow = {
  line: number;
  sku: string;
  price: string;
};

export function parsePriceListImportCsv(text: string): {
  rows: PriceListCsvRow[];
  issues: PriceListCsvIssue[];
} {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const rows: PriceListCsvRow[] = [];
  const issues: PriceListCsvIssue[] = [];
  if (!lines.length) return { rows, issues };

  let start = 0;
  const header = (lines[0] ?? "").trim().toLowerCase();
  if (header.includes("sku") && (header.includes("price") || header.includes("unit"))) {
    start = 1;
  }

  const seen = new Map<string, number>();
  for (let i = start; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (!raw.trim()) continue;
    const cols = splitCsvLine(raw);
    const sku = (cols[0] ?? "").trim();
    const priceRaw = (cols[1] ?? "").trim();
    const line = i + 1;
    if (!sku) {
      issues.push({ line, sku: "", message: "Missing SKU", kind: "invalid_row" });
      continue;
    }
    const money = parseMoney(priceRaw.replace(/£/g, ""));
    if (!money || money.minor <= 0n) {
      issues.push({ line, sku, message: "Invalid price", kind: "invalid_price" });
      continue;
    }
    const key = sku.toUpperCase();
    const previous = seen.get(key);
    if (previous) {
      issues.push({ line, sku, message: `Duplicate SKU (also on line ${previous})`, kind: "duplicate_sku" });
      continue;
    }
    seen.set(key, line);
    rows.push({ line, sku, price: moneyToString(money) });
  }
  return { rows, issues };
}

export function priceListExportCsv(rows: Array<{
  sku: string;
  productName: string;
  baseTradePrice: string;
  priceListPrice: string;
}>): string {
  const header = "sku,productName,baseTradePrice,priceListPrice";
  const body = rows.map((row) =>
    [csvCell(row.sku), csvCell(row.productName), csvCell(row.baseTradePrice), csvCell(row.priceListPrice)].join(","),
  );
  return [header, ...body].join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function commercialAuditLabel(action: string): string {
  const labels: Record<string, string> = {
    "pricing.price_list.created": "Price list created",
    "pricing.price_list.updated": "Price list updated",
    "pricing.price_list_item.created": "Product added to price list",
    "pricing.price_list_item.updated": "Price list price changed",
    "pricing.price_list_item.removed": "Product removed from price list",
    "pricing.customer_price.created": "Customer override added",
    "pricing.customer_price.updated": "Customer override changed",
    "pricing.customer_price.removed": "Customer override removed",
    "pricing.quantity_break.created": "Quantity break added",
    "pricing.quantity_break.updated": "Quantity break changed",
    "pricing.quantity_break.removed": "Quantity break removed",
    "pricing.promotion.created": "Promotion created",
    "pricing.promotion.updated": "Promotion updated",
    "company.updated": "Company commercial details updated",
  };
  return labels[action] ?? action.replace(/^pricing\./, "").replace(/_/g, " ");
}

export function winningRuleLabel(source: string): string {
  switch (source) {
    case "CUSTOMER":
      return "Customer Override";
    case "PRICE_LIST":
      return "Price List";
    case "QUANTITY_BREAK":
      return "Quantity Break";
    case "PROMOTION":
      return "Promotion";
    case "BASE":
      return "Base Trade Price";
    default:
      return "None";
  }
}
