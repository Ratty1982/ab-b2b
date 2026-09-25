/**
 * Automotive Brands standard trade delivery charge.
 *
 * Threshold is GOODS subtotal ex VAT (before delivery).
 * Delivery net is VATable via company tax status + STANDARD vat code.
 *
 * Server-side authority — never trust a browser-supplied delivery amount.
 */

import {
  addMoney,
  applyVatInc,
  isLowerMoney,
  moneyToString,
  moneyZero,
  parseMoney,
  subMoney,
  vatRateForCodes,
  type Money,
} from "@/domain/money";

/** Free delivery when goods net (ex VAT) is at or above this amount. */
export const TRADE_FREE_DELIVERY_THRESHOLD_EX_VAT = parseMoney("150.00")!;

/** Flat carriage when goods net is below the free-delivery threshold. */
export const TRADE_DELIVERY_CHARGE_EX_VAT = parseMoney("5.95")!;

export type TradeDeliveryBreakdown = {
  goodsNet: Money;
  goodsVat: Money;
  deliveryNet: Money;
  deliveryVat: Money;
  vatTotal: Money;
  grandTotal: Money;
  freeDelivery: boolean;
  /** Remaining goods net needed to reach free delivery; null when already free. */
  amountToFreeDelivery: Money | null;
  deliveryVatPercent: number;
};

/**
 * Delivery net ex VAT from goods subtotal ex VAT.
 * £0.00–£149.99 → £5.95; £150.00+ → £0.00.
 */
export function calculateTradeDeliveryNet(goodsNetExVat: Money): Money {
  if (goodsNetExVat.minor < 0n) {
    return TRADE_DELIVERY_CHARGE_EX_VAT;
  }
  if (isLowerMoney(goodsNetExVat, TRADE_FREE_DELIVERY_THRESHOLD_EX_VAT)) {
    return TRADE_DELIVERY_CHARGE_EX_VAT;
  }
  return moneyZero();
}

/**
 * Full order totals: goods + delivery + VAT.
 * Goods VAT is supplied (sum of line VATs). Delivery VAT uses STANDARD rate
 * unless the company tax status zeroes VAT.
 */
export function calculateTradeOrderTotals(input: {
  goodsNet: Money;
  goodsVat: Money;
  companyTaxStatus?: string | null;
}): TradeDeliveryBreakdown {
  const deliveryNet = calculateTradeDeliveryNet(input.goodsNet);
  const freeDelivery = deliveryNet.minor === 0n;
  const vat = vatRateForCodes({
    vatCode: "STANDARD",
    companyTaxStatus: input.companyTaxStatus ?? "STANDARD",
  });
  const deliveryGross = applyVatInc(deliveryNet, vat.rate);
  const deliveryVat = subMoney(deliveryGross, deliveryNet);
  const vatTotal = addMoney(input.goodsVat, deliveryVat);
  const grandTotal = addMoney(addMoney(input.goodsNet, deliveryNet), vatTotal);

  const amountToFreeDelivery = freeDelivery
    ? null
    : clampToThresholdRemaining(input.goodsNet);

  return {
    goodsNet: input.goodsNet,
    goodsVat: input.goodsVat,
    deliveryNet,
    deliveryVat,
    vatTotal,
    grandTotal,
    freeDelivery,
    amountToFreeDelivery,
    deliveryVatPercent: vat.percent,
  };
}

function clampToThresholdRemaining(goodsNet: Money): Money {
  const remaining = subMoney(TRADE_FREE_DELIVERY_THRESHOLD_EX_VAT, goodsNet);
  return remaining.minor > 0n ? remaining : moneyZero();
}

/** String DTO for API / UI (2dp displays). */
export function tradeDeliveryTotalsDto(breakdown: TradeDeliveryBreakdown) {
  return {
    subtotal: moneyToString(breakdown.goodsNet, 2),
    deliveryTotal: moneyToString(breakdown.deliveryNet, 2),
    vatTotal: moneyToString(breakdown.vatTotal, 2),
    grandTotal: moneyToString(breakdown.grandTotal, 2),
    freeDelivery: breakdown.freeDelivery,
    amountToFreeDelivery: breakdown.amountToFreeDelivery
      ? moneyToString(breakdown.amountToFreeDelivery, 2)
      : null,
    deliveryLabel: breakdown.freeDelivery
      ? "FREE"
      : `£${moneyToString(breakdown.deliveryNet, 2)}`,
    currency: "GBP" as const,
  };
}
