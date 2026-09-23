/**
 * Phase 6A ordering validation — builds on case-ordering + stock contracts.
 * Browser never supplies price, stock, case size, or availability.
 */

import {
  customerOrderIncrement,
  isPositiveInt,
  isValidCustomerOrderQuantity,
  minimumCustomerOrderQuantity,
} from "@/domain/case-ordering";
import { getSellableQuantity, type VariantStock } from "@/domain/stock";

export type BasketLineIssue =
  | "VALID"
  | "PRICE_UNAVAILABLE"
  | "QUANTITY_UNAVAILABLE"
  | "PRODUCT_UNAVAILABLE"
  | "CASE_CONFIGURATION_CHANGED"
  | "INSUFFICIENT_FULL_CASE";

export type OrderingRules = {
  caseQty: number;
  minimumOrderQty: number;
  increment: number;
  orderable: true;
};

export type OrderingRulesUnavailable = {
  caseQty: number | null;
  minimumOrderQty: number | null;
  increment: null;
  orderable: false;
  reason: "MISSING_CASE_QTY" | "INVALID_CASE_QTY";
};

export function getOrderingRules(input: {
  caseQty?: number | null;
  minimumOrderQty?: number | null;
}): OrderingRules | OrderingRulesUnavailable {
  const increment = customerOrderIncrement(input.caseQty);
  if (increment == null) {
    return {
      caseQty: input.caseQty ?? null,
      minimumOrderQty: isPositiveInt(input.minimumOrderQty) ? input.minimumOrderQty : null,
      increment: null,
      orderable: false,
      reason: input.caseQty == null || input.caseQty === 0 ? "MISSING_CASE_QTY" : "INVALID_CASE_QTY",
    };
  }
  const minimumOrderQty = minimumCustomerOrderQuantity({
    caseQty: increment,
    ...(input.minimumOrderQty !== undefined ? { minimumOrderQty: input.minimumOrderQty } : {}),
  })!;
  return {
    caseQty: increment,
    minimumOrderQty,
    increment,
    orderable: true,
  };
}

/** Alias used by Phase 6A docs / UI. */
export function getMinimumOrderQuantity(input: {
  caseQty?: number | null;
  minimumOrderQty?: number | null;
}): number | null {
  return minimumCustomerOrderQuantity(input);
}

export function caseCountForQuantity(quantity: number, caseQty: number): number | null {
  if (!isPositiveInt(caseQty) || !Number.isInteger(quantity) || quantity <= 0) return null;
  if (quantity % caseQty !== 0) return null;
  return quantity / caseQty;
}

export function formatCaseCountLabel(cases: number): string {
  return cases === 1 ? "1 case" : `${cases} cases`;
}

/**
 * Largest case-multiple quantity that can be ordered from current sellable stock
 * and MOQ. Null when no full case can be ordered. Never expose this as raw stock.
 */
export function maxOrderableQuantity(input: {
  caseQty?: number | null;
  minimumOrderQty?: number | null;
  sellableQty: number;
}): number | null {
  const rules = getOrderingRules(input);
  if (!rules.orderable) return null;
  const sellable = Math.max(0, Math.trunc(input.sellableQty));
  if (sellable < rules.minimumOrderQty) return null;
  const maxCases = Math.floor(sellable / rules.increment);
  if (maxCases < 1) return null;
  const maxQty = maxCases * rules.increment;
  return maxQty >= rules.minimumOrderQty ? maxQty : null;
}

export function canIncrementQuantity(input: {
  currentQuantity: number;
  caseQty?: number | null;
  minimumOrderQty?: number | null;
  sellableQty: number;
}): boolean {
  const rules = getOrderingRules(input);
  if (!rules.orderable) return false;
  const next = input.currentQuantity + rules.increment;
  const max = maxOrderableQuantity(input);
  return max != null && next <= max && isValidCustomerOrderQuantity(next, rules.caseQty);
}

export function canDecrementQuantity(input: {
  currentQuantity: number;
  caseQty?: number | null;
  minimumOrderQty?: number | null;
}): boolean {
  const rules = getOrderingRules(input);
  if (!rules.orderable) return false;
  return input.currentQuantity - rules.increment >= rules.minimumOrderQty;
}

export type OrderQuantityValidation =
  | { ok: true; quantity: number; caseQty: number; caseCount: number }
  | {
      ok: false;
      code:
        | "NOT_ORDERABLE"
        | "INVALID_MULTIPLE"
        | "BELOW_MINIMUM"
        | "INSUFFICIENT_STOCK"
        | "INSUFFICIENT_FULL_CASE";
      message: string;
    };

/**
 * Full server-side quantity validation for basket mutations.
 * Uses exact sellable qty internally; messages never include that number.
 */
export function validateOrderQuantity(input: {
  requestedQuantity: number;
  caseQty?: number | null;
  minimumOrderQty?: number | null;
  sellableQty: number;
  /** When stock is stale and positive bands are withheld, block ordering. */
  orderableByStockPolicy?: boolean;
}): OrderQuantityValidation {
  const rules = getOrderingRules(input);
  if (!rules.orderable) {
    return {
      ok: false,
      code: "NOT_ORDERABLE",
      message: "This product is not available for online ordering.",
    };
  }
  if (input.orderableByStockPolicy === false) {
    return {
      ok: false,
      code: "INSUFFICIENT_STOCK",
      message: "Stock is currently unavailable for ordering.",
    };
  }
  const qty = input.requestedQuantity;
  if (!Number.isInteger(qty) || qty < 1) {
    return {
      ok: false,
      code: "INVALID_MULTIPLE",
      message: `Order in multiples of ${rules.increment}.`,
    };
  }
  if (qty < rules.minimumOrderQty) {
    return {
      ok: false,
      code: "BELOW_MINIMUM",
      message: `Minimum order is ${rules.minimumOrderQty} units.`,
    };
  }
  if (!isValidCustomerOrderQuantity(qty, rules.caseQty)) {
    return {
      ok: false,
      code: "INVALID_MULTIPLE",
      message: `Order in multiples of ${rules.increment}.`,
    };
  }
  const sellable = getSellableQuantity({ sellableQty: input.sellableQty });
  const max = maxOrderableQuantity({
    caseQty: rules.caseQty,
    minimumOrderQty: rules.minimumOrderQty,
    sellableQty: sellable,
  });
  if (max == null) {
    return {
      ok: false,
      code: "INSUFFICIENT_FULL_CASE",
      message: "Insufficient stock for a full case",
    };
  }
  if (qty > max) {
    return {
      ok: false,
      code: "INSUFFICIENT_STOCK",
      message: "Quantity no longer available. Please reduce the quantity.",
    };
  }
  return {
    ok: true,
    quantity: qty,
    caseQty: rules.caseQty,
    caseCount: qty / rules.caseQty,
  };
}

export function assessBasketLineQuantity(input: {
  quantity: number;
  caseQty?: number | null;
  minimumOrderQty?: number | null;
  sellableQty: number;
  productActive: boolean;
  tradeVisible: boolean;
  orderableByStockPolicy?: boolean;
  hasTradePrice: boolean;
}): BasketLineIssue {
  if (!input.productActive || !input.tradeVisible) return "PRODUCT_UNAVAILABLE";
  if (!input.hasTradePrice) return "PRICE_UNAVAILABLE";
  const rules = getOrderingRules(input);
  if (!rules.orderable) return "CASE_CONFIGURATION_CHANGED";
  if (!isValidCustomerOrderQuantity(input.quantity, rules.caseQty)) {
    return "CASE_CONFIGURATION_CHANGED";
  }
  if (input.quantity < rules.minimumOrderQty) return "CASE_CONFIGURATION_CHANGED";
  const result = validateOrderQuantity({
    requestedQuantity: input.quantity,
    caseQty: rules.caseQty,
    minimumOrderQty: rules.minimumOrderQty,
    sellableQty: input.sellableQty,
    ...(input.orderableByStockPolicy !== undefined
      ? { orderableByStockPolicy: input.orderableByStockPolicy }
      : {}),
  });
  if (result.ok) return "VALID";
  if (result.code === "INSUFFICIENT_FULL_CASE") return "INSUFFICIENT_FULL_CASE";
  if (result.code === "INSUFFICIENT_STOCK") return "QUANTITY_UNAVAILABLE";
  return "CASE_CONFIGURATION_CHANGED";
}

export function basketLineIssueMessage(issue: BasketLineIssue): string | null {
  switch (issue) {
    case "VALID":
      return null;
    case "PRODUCT_UNAVAILABLE":
      return "No longer available";
    case "PRICE_UNAVAILABLE":
      return "Price unavailable";
    case "QUANTITY_UNAVAILABLE":
      return "Quantity no longer available. Please reduce the quantity.";
    case "INSUFFICIENT_FULL_CASE":
      return "Insufficient stock for a full case";
    case "CASE_CONFIGURATION_CHANGED":
      return "Case size changed. Please update the quantity.";
    default:
      return "Please review this line";
  }
}

/** Stock policy for ordering: stale positive stock is not orderable (matches Phase 5 public hide). */
export function isOrderableByStockPolicy(stock: Pick<VariantStock, "sellableQty" | "stale" | "availability">): boolean {
  if (stock.stale && stock.sellableQty > 0) return false;
  return stock.sellableQty > 0;
}
