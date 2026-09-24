/**
 * Phase 6A ordering validation — builds on case-ordering + stock contracts.
 * Browser never supplies price, stock, case size, or availability.
 *
 * NORMAL CASE ORDERING: customers order full case multiples of caseQty (MOQ-aware).
 *
 * FINAL PART-CASE STOCK EXCEPTION: when 0 < sellable < caseQty (and stock policy
 * allows ordering), remaining units may be ordered 1..sellable in steps of 1.
 * This overrides MOQ. Do not use ProductVariant.orderIncrement.
 * Do not allow part-cases while at least one complete case remains.
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

export type CustomerOrderMode = "CASE" | "FINAL_PART_CASE" | "NOT_ORDERABLE";

/**
 * Central customer ordering state for a SKU given current sellable stock.
 * Callers that expose `maximumQuantity` / remaining stock must honour privacy:
 * exact remaining is only intended for authenticated, order-eligible trade
 * actors when mode is FINAL_PART_CASE.
 */
export type CustomerOrderingState = {
  mode: CustomerOrderMode;
  caseQty: number | null;
  /** Minimum selectable quantity in the active mode (1 in final part-case). */
  minimumQuantity: number | null;
  /** Stepper increment: caseQty in CASE mode, 1 in FINAL_PART_CASE. */
  step: number | null;
  /**
   * Maximum orderable quantity for the active mode.
   * In FINAL_PART_CASE this equals remaining sellable (privacy-sensitive).
   * In CASE mode this is the largest valid case multiple ≤ sellable.
   */
  maximumQuantity: number | null;
  isFinalPartCase: boolean;
  /**
   * Exact remaining sellable when in FINAL_PART_CASE; otherwise null.
   * Never serialise to anonymous responses.
   */
  remainingSellable: number | null;
  /** Default quantity for UI: MOQ case multiple, or all remaining in final mode. */
  defaultQuantity: number | null;
  reason: "MISSING_CASE_QTY" | "INVALID_CASE_QTY" | "NO_STOCK" | "STOCK_POLICY" | "BELOW_MOQ" | null;
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

function notOrderableState(
  partial: Partial<CustomerOrderingState> & {
    reason: CustomerOrderingState["reason"];
    caseQty?: number | null;
  },
): CustomerOrderingState {
  return {
    mode: "NOT_ORDERABLE",
    caseQty: partial.caseQty ?? null,
    minimumQuantity: null,
    step: null,
    maximumQuantity: null,
    isFinalPartCase: false,
    remainingSellable: null,
    defaultQuantity: null,
    reason: partial.reason,
  };
}

/**
 * Resolve CASE vs FINAL_PART_CASE vs NOT_ORDERABLE from case rules + sellable stock.
 * Single source of truth for PDP, catalogue quick order, basket, and admin trade test.
 */
export function resolveCustomerOrdering(input: {
  caseQty?: number | null;
  minimumOrderQty?: number | null;
  sellableQty: number;
  /** When stock is stale and positive bands are withheld, block ordering. */
  orderableByStockPolicy?: boolean;
}): CustomerOrderingState {
  const rules = getOrderingRules(input);
  if (!rules.orderable) {
    return notOrderableState({
      caseQty: rules.caseQty,
      reason: rules.reason,
    });
  }

  if (input.orderableByStockPolicy === false) {
    return notOrderableState({
      caseQty: rules.caseQty,
      reason: "STOCK_POLICY",
    });
  }

  const sellable = getSellableQuantity({ sellableQty: input.sellableQty });
  if (sellable <= 0) {
    return notOrderableState({
      caseQty: rules.caseQty,
      reason: "NO_STOCK",
    });
  }

  // FINAL PART-CASE STOCK EXCEPTION — only when remaining is below one complete case.
  if (sellable < rules.caseQty) {
    return {
      mode: "FINAL_PART_CASE",
      caseQty: rules.caseQty,
      minimumQuantity: 1,
      step: 1,
      maximumQuantity: sellable,
      isFinalPartCase: true,
      remainingSellable: sellable,
      defaultQuantity: sellable,
      reason: null,
    };
  }

  const maxCases = Math.floor(sellable / rules.increment);
  const maxQty = maxCases * rules.increment;
  if (maxCases < 1 || maxQty < rules.minimumOrderQty) {
    return notOrderableState({
      caseQty: rules.caseQty,
      reason: "BELOW_MOQ",
    });
  }

  return {
    mode: "CASE",
    caseQty: rules.caseQty,
    minimumQuantity: rules.minimumOrderQty,
    step: rules.increment,
    maximumQuantity: maxQty,
    isFinalPartCase: false,
    remainingSellable: null,
    defaultQuantity: rules.minimumOrderQty,
    reason: null,
  };
}

/**
 * Largest quantity that can be ordered from current sellable stock under the
 * active mode (case multiples, or remaining units in final part-case).
 * Null when nothing can be ordered. In CASE mode this is never raw Avail.
 */
export function maxOrderableQuantity(input: {
  caseQty?: number | null;
  minimumOrderQty?: number | null;
  sellableQty: number;
  orderableByStockPolicy?: boolean;
}): number | null {
  const state = resolveCustomerOrdering(input);
  if (state.mode === "NOT_ORDERABLE") return null;
  return state.maximumQuantity;
}

export function canIncrementQuantity(input: {
  currentQuantity: number;
  caseQty?: number | null;
  minimumOrderQty?: number | null;
  sellableQty: number;
  orderableByStockPolicy?: boolean;
}): boolean {
  const state = resolveCustomerOrdering(input);
  if (state.mode === "NOT_ORDERABLE" || state.step == null || state.maximumQuantity == null) {
    return false;
  }
  const next = input.currentQuantity + state.step;
  return next <= state.maximumQuantity && isQuantityValidForOrderingState(next, state);
}

export function canDecrementQuantity(input: {
  currentQuantity: number;
  caseQty?: number | null;
  minimumOrderQty?: number | null;
  sellableQty?: number;
  orderableByStockPolicy?: boolean;
}): boolean {
  // When sellable is provided, use the full mode resolver (final part-case step=1).
  if (input.sellableQty !== undefined) {
    const state = resolveCustomerOrdering({
      ...(input.caseQty !== undefined ? { caseQty: input.caseQty } : {}),
      ...(input.minimumOrderQty !== undefined ? { minimumOrderQty: input.minimumOrderQty } : {}),
      sellableQty: input.sellableQty,
      ...(input.orderableByStockPolicy !== undefined
        ? { orderableByStockPolicy: input.orderableByStockPolicy }
        : {}),
    });
    if (state.mode === "NOT_ORDERABLE" || state.step == null || state.minimumQuantity == null) {
      return false;
    }
    return input.currentQuantity - state.step >= state.minimumQuantity;
  }
  const rules = getOrderingRules(input);
  if (!rules.orderable) return false;
  return input.currentQuantity - rules.increment >= rules.minimumOrderQty;
}

function isQuantityValidForOrderingState(qty: number, state: CustomerOrderingState): boolean {
  if (!Number.isInteger(qty) || qty < 1) return false;
  if (state.mode === "FINAL_PART_CASE") {
    return (
      state.maximumQuantity != null &&
      qty >= 1 &&
      qty <= state.maximumQuantity
    );
  }
  if (state.mode === "CASE" && state.caseQty != null && state.minimumQuantity != null) {
    return qty >= state.minimumQuantity && isValidCustomerOrderQuantity(qty, state.caseQty);
  }
  return false;
}

export type OrderQuantityValidation =
  | {
      ok: true;
      quantity: number;
      caseQty: number;
      caseCount: number | null;
      isFinalPartCase: boolean;
      mode: "CASE" | "FINAL_PART_CASE";
    }
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
 * Uses exact sellable qty internally; messages never include that number
 * except callers may reveal remaining only when already in final-part-case mode.
 */
export function validateOrderQuantity(input: {
  requestedQuantity: number;
  caseQty?: number | null;
  minimumOrderQty?: number | null;
  sellableQty: number;
  /** When stock is stale and positive bands are withheld, block ordering. */
  orderableByStockPolicy?: boolean;
}): OrderQuantityValidation {
  const state = resolveCustomerOrdering(input);
  if (state.mode === "NOT_ORDERABLE" || state.caseQty == null) {
    if (state.reason === "STOCK_POLICY") {
      return {
        ok: false,
        code: "INSUFFICIENT_STOCK",
        message: "Stock is currently unavailable for ordering.",
      };
    }
    if (state.reason === "NO_STOCK" || state.reason === "BELOW_MOQ") {
      return {
        ok: false,
        code: "INSUFFICIENT_FULL_CASE",
        message: "Insufficient stock for a full case",
      };
    }
    return {
      ok: false,
      code: "NOT_ORDERABLE",
      message: "This product is not available for online ordering.",
    };
  }

  const qty = input.requestedQuantity;
  if (!Number.isInteger(qty) || qty < 1) {
    return {
      ok: false,
      code: "INVALID_MULTIPLE",
      message:
        state.mode === "FINAL_PART_CASE"
          ? "Enter a whole number of units."
          : `Order in multiples of ${state.step}.`,
    };
  }

  if (state.mode === "FINAL_PART_CASE") {
    if (qty > (state.maximumQuantity ?? 0)) {
      return {
        ok: false,
        code: "INSUFFICIENT_STOCK",
        message: "Quantity no longer available. Please reduce the quantity.",
      };
    }
    return {
      ok: true,
      quantity: qty,
      caseQty: state.caseQty,
      caseCount: null,
      isFinalPartCase: true,
      mode: "FINAL_PART_CASE",
    };
  }

  // CASE mode — existing caseQty / MOQ rules.
  if (state.minimumQuantity != null && qty < state.minimumQuantity) {
    return {
      ok: false,
      code: "BELOW_MINIMUM",
      message: `Minimum order is ${state.minimumQuantity} units.`,
    };
  }
  if (!isValidCustomerOrderQuantity(qty, state.caseQty)) {
    return {
      ok: false,
      code: "INVALID_MULTIPLE",
      message: `Order in multiples of ${state.step}.`,
    };
  }
  if (state.maximumQuantity != null && qty > state.maximumQuantity) {
    return {
      ok: false,
      code: "INSUFFICIENT_STOCK",
      message: "Quantity no longer available. Please reduce the quantity.",
    };
  }
  return {
    ok: true,
    quantity: qty,
    caseQty: state.caseQty,
    caseCount: qty / state.caseQty,
    isFinalPartCase: false,
    mode: "CASE",
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

  const rules = getOrderingRules({
    ...(input.caseQty !== undefined ? { caseQty: input.caseQty } : {}),
    ...(input.minimumOrderQty !== undefined ? { minimumOrderQty: input.minimumOrderQty } : {}),
  });
  if (!rules.orderable) return "CASE_CONFIGURATION_CHANGED";

  const state = resolveCustomerOrdering({
    caseQty: rules.caseQty,
    minimumOrderQty: rules.minimumOrderQty,
    sellableQty: input.sellableQty,
    ...(input.orderableByStockPolicy !== undefined
      ? { orderableByStockPolicy: input.orderableByStockPolicy }
      : {}),
  });

  // When at least one full case of stock exists (or would, if MOQ blocked), a
  // non-case quantity from a prior final-part-case sale is a config change —
  // never silently rewrite the line.
  const sellable = getSellableQuantity({ sellableQty: input.sellableQty });
  if (
    input.orderableByStockPolicy !== false &&
    sellable >= rules.caseQty &&
    !isValidCustomerOrderQuantity(input.quantity, rules.caseQty)
  ) {
    return "CASE_CONFIGURATION_CHANGED";
  }
  if (
    input.orderableByStockPolicy !== false &&
    sellable >= rules.caseQty &&
    input.quantity < rules.minimumOrderQty
  ) {
    return "CASE_CONFIGURATION_CHANGED";
  }

  if (state.mode === "NOT_ORDERABLE") {
    if (state.reason === "NO_STOCK" || state.reason === "STOCK_POLICY") {
      return "QUANTITY_UNAVAILABLE";
    }
    if (state.reason === "BELOW_MOQ") {
      return "INSUFFICIENT_FULL_CASE";
    }
    return "CASE_CONFIGURATION_CHANGED";
  }

  if (state.mode === "CASE") {
    if (!isValidCustomerOrderQuantity(input.quantity, state.caseQty)) {
      return "CASE_CONFIGURATION_CHANGED";
    }
    if (state.minimumQuantity != null && input.quantity < state.minimumQuantity) {
      return "CASE_CONFIGURATION_CHANGED";
    }
  }

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

/** Presentation copy for final-part-case Trade Ordering (authenticated only). */
export function finalPartCaseOrderingCopy(caseQty: number): {
  title: string;
  subtitle: string;
} {
  if (caseQty === 1) {
    return { title: "Single unit", subtitle: "Sold individually" };
  }
  return {
    title: `Case of ${caseQty}`,
    subtitle: `Normally sold in multiples of ${caseQty}`,
  };
}
