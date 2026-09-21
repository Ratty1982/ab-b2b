import {
  applyVatInc,
  clampNonNegative,
  isLowerMoney,
  moneyFromUnknown,
  moneyToString,
  mulRatio,
  parseMoney,
  roundGbpDisplay,
  vatRateForCodes,
  type Money,
} from "@/domain/money";

export const TRADE_PRICE_SOURCES = [
  "BASE",
  "PRICE_LIST",
  "CUSTOMER",
  "QUANTITY_BREAK",
  "PROMOTION",
  "NONE",
] as const;

export type TradePriceSource = (typeof TRADE_PRICE_SOURCES)[number];

export type PromotionKind = "PERCENT" | "FIXED" | "QUANTITY_DEAL";

export type PriceResolutionFacts = {
  variantId: string;
  sku: string;
  baseTradePrice: unknown;
  vatCode: string | null;
  quantity: number;
  at: Date;
  company: {
    id: string;
    taxStatus: string;
    priceListId: string | null;
    priceListName: string | null;
  } | null;
  customerPrice: {
    id: string;
    unitPrice: unknown;
    startsAt: Date | null;
    endsAt: Date | null;
  } | null;
  priceListItem: {
    id: string;
    unitPrice: unknown;
    priceListId: string;
    priceListName: string;
  } | null;
  quantityBreaks: Array<{ id: string; minQty: number; unitPrice: unknown }>;
  promotions: Array<{
    id: string;
    code: string;
    name: string;
    type: PromotionKind;
    value: unknown;
    startsAt: Date | null;
    endsAt: Date | null;
    isActive: boolean;
    variantIds: string[] | null;
    skus: string[] | null;
  }>;
};

export type TradePriceExplanation = {
  baseTradePrice: string | null;
  priceListPrice: string | null;
  priceListName: string | null;
  customerOverride: string | null;
  quantityBreak: string | null;
  promotion: string | null;
  commercialPrice: string | null;
  resolvedPrice: string | null;
};

export type TradePriceResolution = {
  currency: "GBP";
  quantity: number;
  resolvedAt: string;
  unitPriceExVat: string;
  unitPriceExVatDisplay: string;
  vatRate: string;
  vatPercent: number;
  unitPriceIncVat: string;
  source: TradePriceSource;
  sourceId: string | null;
  quantityBreakApplied: { id: string; minQty: number } | null;
  promotionApplied: { id: string; code: string } | null;
  explanation: TradePriceExplanation;
};

export function inValidityWindow(at: Date, startsAt: Date | null, endsAt: Date | null): boolean {
  if (startsAt && at < startsAt) return false;
  if (endsAt && at > endsAt) return false;
  return true;
}

function fmt(value: Money | null): string | null {
  return value ? moneyToString(value) : null;
}

function display(value: Money): string {
  return moneyToString(roundGbpDisplay(value), 2);
}

/**
 * QuantityBreak.minQty = 1 is the catalogue base-price mirror, not a volume break.
 */
export function selectQuantityBreak(
  breaks: PriceResolutionFacts["quantityBreaks"],
  quantity: number,
): { id: string; minQty: number; price: Money } | null {
  const eligible = breaks
    .filter((row) => row.minQty > 1 && row.minQty <= quantity)
    .map((row) => ({ row, price: moneyFromUnknown(row.unitPrice) }))
    .filter((row): row is { row: (typeof breaks)[number]; price: Money } => row.price != null)
    .sort((a, b) => b.row.minQty - a.row.minQty || a.row.id.localeCompare(b.row.id));
  const hit = eligible[0];
  if (!hit) return null;
  return { id: hit.row.id, minQty: hit.row.minQty, price: hit.price };
}

export function promotionApplies(
  promo: PriceResolutionFacts["promotions"][number],
  facts: Pick<PriceResolutionFacts, "variantId" | "sku" | "at">,
): boolean {
  if (!promo.isActive) return false;
  if (promo.type === "QUANTITY_DEAL") return false;
  if (!inValidityWindow(facts.at, promo.startsAt, promo.endsAt)) return false;
  const hasScope = (promo.variantIds && promo.variantIds.length > 0) || (promo.skus && promo.skus.length > 0);
  if (hasScope) {
    if (promo.variantIds?.includes(facts.variantId)) return true;
    if (promo.skus?.includes(facts.sku)) return true;
    return false;
  }
  return true;
}

export function applyPromotion(
  unit: Money,
  promo: PriceResolutionFacts["promotions"][number],
): Money | null {
  const value = moneyFromUnknown(promo.value);
  if (!value) return null;
  if (promo.type === "PERCENT") {
    // value 10.0000 → 10% off → multiply by (10000-10)/100 = wait value is 10 at 4dp = 100000 minor
    // percent points: minor/10000 = 10. Off ratio = (100 - 10)/100 = 90/100
    const hundred = 100n * 10n ** 4n;
    const remain = hundred - value.minor;
    if (remain < 0n) return moneyFromUnknown("0");
    return mulRatio(unit, remain, hundred);
  }
  if (promo.type === "FIXED") {
    return clampNonNegative({ minor: unit.minor - value.minor });
  }
  return null;
}

function promotionTieBreak(
  a: PriceResolutionFacts["promotions"][number],
  b: PriceResolutionFacts["promotions"][number],
): number {
  const aStart = a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bStart = b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aStart !== bStart) return aStart - bStart;
  const code = a.code.localeCompare(b.code);
  if (code !== 0) return code;
  return a.id.localeCompare(b.id);
}

export function resolveTradePriceFromFacts(facts: PriceResolutionFacts): TradePriceResolution {
  const quantity = Number.isFinite(facts.quantity) && facts.quantity > 0 ? facts.quantity : 1;
  const base = moneyFromUnknown(facts.baseTradePrice);
  const customer =
    facts.customerPrice && inValidityWindow(facts.at, facts.customerPrice.startsAt, facts.customerPrice.endsAt)
      ? moneyFromUnknown(facts.customerPrice.unitPrice)
      : null;
  const list = facts.priceListItem ? moneyFromUnknown(facts.priceListItem.unitPrice) : null;

  let commercial: Money | null = null;
  let commercialSource: TradePriceSource = "NONE";
  let sourceId: string | null = null;

  if (customer) {
    commercial = customer;
    commercialSource = "CUSTOMER";
    sourceId = facts.customerPrice!.id;
  } else if (list) {
    commercial = list;
    commercialSource = "PRICE_LIST";
    sourceId = facts.priceListItem!.id;
  } else if (base) {
    commercial = base;
    commercialSource = "BASE";
    sourceId = facts.variantId;
  }

  let unit = commercial;
  let source: TradePriceSource = commercialSource;
  let quantityBreakApplied: TradePriceResolution["quantityBreakApplied"] = null;
  const breakHit = unit ? selectQuantityBreak(facts.quantityBreaks, quantity) : null;
  if (unit && breakHit && isLowerMoney(breakHit.price, unit)) {
    unit = breakHit.price;
    source = "QUANTITY_BREAK";
    sourceId = breakHit.id;
    quantityBreakApplied = { id: breakHit.id, minQty: breakHit.minQty };
  }

  let promotionApplied: TradePriceResolution["promotionApplied"] = null;
  if (unit) {
    const candidates = facts.promotions
      .filter((promo) => promotionApplies(promo, facts))
      .map((promo) => {
        const next = applyPromotion(unit!, promo);
        return next ? { promo, next } : null;
      })
      .filter((row): row is { promo: PriceResolutionFacts["promotions"][number]; next: Money } => row != null)
      .filter((row) => isLowerMoney(row.next, unit!))
      .sort((a, b) => {
        if (a.next.minor !== b.next.minor) return a.next.minor < b.next.minor ? -1 : 1;
        return promotionTieBreak(a.promo, b.promo);
      });
    const winner = candidates[0];
    if (winner) {
      unit = winner.next;
      source = "PROMOTION";
      sourceId = winner.promo.id;
      promotionApplied = { id: winner.promo.id, code: winner.promo.code };
    }
  }

  const vat = vatRateForCodes({
    vatCode: facts.vatCode,
    companyTaxStatus: facts.company?.taxStatus ?? null,
  });

  const explanation: TradePriceExplanation = {
    baseTradePrice: fmt(base),
    priceListPrice: fmt(list),
    priceListName: facts.priceListItem?.priceListName ?? facts.company?.priceListName ?? null,
    customerOverride: fmt(customer),
    quantityBreak: breakHit ? moneyToString(breakHit.price) : null,
    promotion: promotionApplied?.code ?? null,
    commercialPrice: fmt(commercial),
    resolvedPrice: unit ? moneyToString(unit) : null,
  };

  if (!unit) {
    return {
      currency: "GBP",
      quantity,
      resolvedAt: facts.at.toISOString(),
      unitPriceExVat: "0.0000",
      unitPriceExVatDisplay: "0.00",
      vatRate: moneyToString(vat.rate),
      vatPercent: vat.percent,
      unitPriceIncVat: "0.00",
      source: "NONE",
      sourceId: null,
      quantityBreakApplied: null,
      promotionApplied: null,
      explanation,
    };
  }

  const inc = applyVatInc(unit, vat.rate);
  return {
    currency: "GBP",
    quantity,
    resolvedAt: facts.at.toISOString(),
    unitPriceExVat: moneyToString(unit),
    unitPriceExVatDisplay: display(unit),
    vatRate: moneyToString(vat.rate),
    vatPercent: vat.percent,
    unitPriceIncVat: moneyToString(inc, 2),
    source,
    sourceId,
    quantityBreakApplied,
    promotionApplied,
    explanation,
  };
}

export const PUBLIC_PRICE_SOURCE = {
  BASE: "base_catalogue",
  PRICE_LIST: "price_list",
  CUSTOMER: "customer",
  QUANTITY_BREAK: "quantity_break",
  PROMOTION: "promotion",
  NONE: "hidden",
} as const;

export type PublicTradeSource = (typeof PUBLIC_PRICE_SOURCE)[keyof typeof PUBLIC_PRICE_SOURCE];
