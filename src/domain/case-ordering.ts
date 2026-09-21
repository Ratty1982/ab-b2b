/**
 * Automotive Brands B2B ordering: FULL CASES ONLY.
 *
 * Authoritative customer multiple is ProductVariant.caseQty when populated.
 * packQty is the sale-unit contents; it is not the customer order step.
 * Stored orderIncrement remains internal catalogue data and must not be used
 * as the public/customer increment when caseQty exists. Do not bulk-rewrite
 * orderIncrement in this phase.
 *
 * Phase 6 (not implemented here) must enforce the same rule on quantity
 * steppers, manual input, basket, checkout, and API:
 *   requestedQuantity % caseQty === 0
 *   initial / + / − steps = caseQty
 * Clients cannot bypass this; the server must re-validate independently.
 */

export const FULL_CASE_ORDERING = {
  rule: "FULL_CASE_ONLY",
  customerIncrementField: "caseQty",
  packQtyMeaning: "sale-unit contents, not the customer order multiple",
  caseQtyMeaning: "number of sale units in a trade case; customer order multiple",
} as const;

export function isPositiveInt(value: number | null | undefined): value is number {
  return value != null && Number.isInteger(value) && value >= 1;
}

/** Customer order step. Null when caseQty is unknown — never invent a case size. */
export function customerOrderIncrement(caseQty: number | null | undefined): number | null {
  return isPositiveInt(caseQty) ? caseQty : null;
}

/**
 * Smallest valid case multiple that also satisfies minimumOrderQty.
 * Example: case 6 / MOQ 6 → 6; case 6 / MOQ 12 → 12; case 6 / MOQ 10 → 12.
 */
export function minimumCustomerOrderQuantity(input: {
  caseQty?: number | null;
  minimumOrderQty?: number | null;
}): number | null {
  const increment = customerOrderIncrement(input.caseQty);
  if (increment == null) return isPositiveInt(input.minimumOrderQty) ? input.minimumOrderQty : null;
  const moq = isPositiveInt(input.minimumOrderQty) ? input.minimumOrderQty : increment;
  return Math.ceil(moq / increment) * increment;
}

/** Phase 6 quantity contract. Does not inspect inventory. */
export function isValidCustomerOrderQuantity(
  requestedQuantity: number,
  caseQty: number | null | undefined,
): boolean {
  const increment = customerOrderIncrement(caseQty);
  if (increment == null) return false;
  return Number.isInteger(requestedQuantity) && requestedQuantity >= increment && requestedQuantity % increment === 0;
}

export function publicOrderingFromVariant(variant: {
  packQty?: number | null;
  caseQty?: number | null;
  minOrderQty?: number | null;
  orderIncrement?: number | null;
  inventory?: Array<{ qtyOnHand?: number }>;
} | null | undefined): {
  packQty: number | null;
  caseQty: number | null;
  minimumOrderQty: number | null;
  orderIncrement: number | null;
} {
  return {
    packQty: isPositiveInt(variant?.packQty) ? variant!.packQty! : null,
    caseQty: isPositiveInt(variant?.caseQty) ? variant!.caseQty! : null,
    minimumOrderQty: isPositiveInt(variant?.minOrderQty) ? variant!.minOrderQty! : null,
    orderIncrement: isPositiveInt(variant?.orderIncrement) ? variant!.orderIncrement! : null,
  };
}

/** Public Ordering Information: case size and the case-derived multiple only. */
export function formatPublicCaseOrderingRows(
  caseQty: number | null | undefined,
): Array<{ label: string; value: string }> {
  const card = publicTradeOrderingCopy(caseQty);
  if (!card) return [];
  return [
    { label: card.title, value: card.subtitle },
  ];
}

export function publicTradeOrderingCopy(
  caseQty: number | null | undefined,
): { title: string; subtitle: string } | null {
  const increment = customerOrderIncrement(caseQty);
  if (increment == null) return null;
  if (increment === 1) {
    return { title: "Single unit", subtitle: "Sold individually" };
  }
  return {
    title: `Case of ${increment}`,
    subtitle: `Sold in multiples of ${increment}`,
  };
}

/**
 * Phase 6 ProductOrderPanel — documentation-only plan.
 * Do not render these controls until the ordering engine exists.
 *
 * Example: unitTradePrice £8.70, caseQty 2, VAT 20%
 *   hero: £8.70 YOUR PRICE · EACH · EX VAT
 *   panel: 1 case · 2 units → £17.40 ex VAT / £20.88 inc VAT
 */
export const PRODUCT_ORDER_PANEL_PLAN = {
  component: "ProductOrderPanel",
  mount: "product-hero-after-short-description",
  headlinePrice: "unit-trade-price",
  quantityRule: "FULL_CASE_ONLY",
  incrementField: "caseQty",
  serverMustValidate: true,
  ui: {
    heading: "TRADE ORDERING",
    caseCopyWhenQty2: "CASE OF 2",
    soldIn: "Sold in full cases",
    quantityStepper: true,
    addToBasket: true,
  },
} as const;
