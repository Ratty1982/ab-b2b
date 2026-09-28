/**
 * Phase 6C — controlled trade backorders.
 *
 * Authority:
 * - TradeOrderingSettings.defaultBackorderPolicy (global; production default ALLOW)
 * - ProductVariant.backorderPolicy INHERIT | ALLOW | DENY
 * - resolveBackorderPolicy() is the single effective-policy helper
 * - Allocation snapshots on OrderItem (historical; never recompute from live stock)
 * - AB reservations reserve ONLY available sellable units
 *
 * Autopart CSV still exports the full ordered quantity.
 */

/** Stored on ProductVariant. */
export type VariantBackorderPolicy = "INHERIT" | "ALLOW" | "DENY";

/** Global setting and resolved effective decision. */
export type EffectiveBackorderPolicy = "ALLOW" | "DENY";

/** @deprecated Prefer VariantBackorderPolicy / EffectiveBackorderPolicy. */
export type BackorderPolicyValue = EffectiveBackorderPolicy;

/** Global production default when settings row is missing. */
export const DEFAULT_GLOBAL_BACKORDER_POLICY: EffectiveBackorderPolicy = "ALLOW";

/** Variant column default. */
export const DEFAULT_VARIANT_BACKORDER_POLICY: VariantBackorderPolicy = "INHERIT";

/**
 * @deprecated Use DEFAULT_GLOBAL_BACKORDER_POLICY / resolveBackorderPolicy.
 * Kept as ALLOW so omitted policy no longer silently blocks ordering.
 */
export const DEFAULT_BACKORDER_POLICY: EffectiveBackorderPolicy = DEFAULT_GLOBAL_BACKORDER_POLICY;

/**
 * Single authoritative effective-policy resolver.
 * variant ALLOW/DENY win; INHERIT (or null/unknown) uses global.
 */
export function resolveBackorderPolicy(input: {
  globalPolicy?: EffectiveBackorderPolicy | null | undefined;
  variantPolicy?: VariantBackorderPolicy | string | null | undefined;
}): EffectiveBackorderPolicy {
  const variant = String(input.variantPolicy ?? "INHERIT").toUpperCase();
  if (variant === "ALLOW") return "ALLOW";
  if (variant === "DENY") return "DENY";
  // INHERIT or legacy/unknown → global (default ALLOW for AB production).
  return input.globalPolicy === "DENY" ? "DENY" : "ALLOW";
}

export function isBackorderAllowed(
  policy: EffectiveBackorderPolicy | VariantBackorderPolicy | null | undefined,
): boolean {
  if (policy === "ALLOW") return true;
  if (policy === "DENY") return false;
  // INHERIT / null without global context — treat as allowed only via resolveBackorderPolicy.
  // Callers must resolve first; this returns false for INHERIT to avoid silent wrong ALLOW
  // when global was not loaded. Prefer resolveBackorderPolicy + isBackorderAllowed(effective).
  return false;
}

export function isEffectiveBackorderAllowed(
  policy: EffectiveBackorderPolicy | null | undefined,
): boolean {
  return policy === "ALLOW";
}

/**
 * Split an accepted order quantity into available allocation vs backorder.
 * Call only after quantity validation has accepted the line.
 */
export function allocateOrderLineQuantities(input: {
  orderedQty: number;
  sellableQty: number;
}): {
  orderedQty: number;
  availableQtyAtOrder: number;
  backorderQtyAtOrder: number;
  reserveQty: number;
} {
  const ordered = Math.max(0, Math.trunc(input.orderedQty));
  const sellable = Math.max(0, Math.trunc(input.sellableQty));
  const availableQtyAtOrder = Math.min(ordered, sellable);
  const backorderQtyAtOrder = Math.max(0, ordered - availableQtyAtOrder);
  return {
    orderedQty: ordered,
    availableQtyAtOrder,
    backorderQtyAtOrder,
    /** AB may reserve only what is actually sellable — never backordered units. */
    reserveQty: availableQtyAtOrder,
  };
}

export type LineBackorderPresentation = {
  orderedQty: number;
  availableQty: number;
  backorderQty: number;
  /** True when any units will be / were backordered. */
  hasBackorder: boolean;
  /** Entire line is backordered (nothing allocated from stock). */
  fullyBackordered: boolean;
  /** Some stock allocated, remainder backordered. */
  partiallyBackordered: boolean;
};

export function presentLineBackorder(input: {
  orderedQty: number;
  sellableQty: number;
}): LineBackorderPresentation {
  const split = allocateOrderLineQuantities(input);
  return {
    orderedQty: split.orderedQty,
    availableQty: split.availableQtyAtOrder,
    backorderQty: split.backorderQtyAtOrder,
    hasBackorder: split.backorderQtyAtOrder > 0,
    fullyBackordered: split.backorderQtyAtOrder > 0 && split.availableQtyAtOrder === 0,
    partiallyBackordered: split.backorderQtyAtOrder > 0 && split.availableQtyAtOrder > 0,
  };
}

/** Historical snapshot presentation from OrderItem fields. */
export function presentOrderItemBackorder(item: {
  qty: number;
  availableQtyAtOrder?: number | null;
  backorderQtyAtOrder?: number | null;
}): LineBackorderPresentation {
  const orderedQty = Math.max(0, Math.trunc(item.qty));
  const backorderQty = Math.max(0, Math.trunc(item.backorderQtyAtOrder ?? 0));
  const availableQty =
    item.availableQtyAtOrder != null
      ? Math.max(0, Math.trunc(item.availableQtyAtOrder))
      : Math.max(0, orderedQty - backorderQty);
  return {
    orderedQty,
    availableQty,
    backorderQty,
    hasBackorder: backorderQty > 0,
    fullyBackordered: backorderQty > 0 && availableQty === 0,
    partiallyBackordered: backorderQty > 0 && availableQty > 0,
  };
}

export function orderContainsBackorder(
  items: Array<{ backorderQtyAtOrder?: number | null }>,
): boolean {
  return items.some((i) => (i.backorderQtyAtOrder ?? 0) > 0);
}

export function orderIsFullyBackordered(
  items: Array<{
    qty: number;
    backorderQtyAtOrder?: number | null;
    availableQtyAtOrder?: number | null;
  }>,
): boolean {
  if (!items.length) return false;
  return items.every((i) => {
    const p = presentOrderItemBackorder(i);
    return (
      p.fullyBackordered ||
      (p.orderedQty > 0 && p.availableQty === 0 && p.backorderQty === p.orderedQty)
    );
  });
}

/** Customer-facing notice when any line is backordered. */
export const BACKORDER_CUSTOMER_NOTICE =
  "Backordered items will be supplied when stock becomes available.";

export const BACKORDER_CHECKOUT_HEADING = "BACKORDER ITEMS";

export const BACKORDER_CHECKOUT_BODY =
  "Some items in this order are not currently available from stock and will be supplied when stock becomes available.";

export const BACKORDER_PDP_EXPLANATION =
  "This item is currently awaiting stock but can still be ordered. It will be supplied when stock becomes available.";

export const BACKORDER_AVAILABILITY_COPY =
  "Available to order. This item will be supplied when stock becomes available.";

/**
 * 504C safety: order-level invoice evidence must not claim full despatch when
 * known backordered quantity remains. Returns true when PARTIALLY_DESPATCHED
 * (or equivalent) should be used instead of DISPATCHED.
 */
export function shouldPartialDespatchFrom504c(input: {
  items: Array<{ backorderQtyAtOrder?: number | null }>;
  /** AB merchandise+delivery net expected on 504C Goods, when known. */
  expectedGoodsNet?: number | null;
  /** 504C invoice Goods amount, when known. */
  invoiceGoods?: number | null;
}): boolean {
  if (!orderContainsBackorder(input.items)) return false;
  // Known backorder on the order — never invent full despatch certainty from order-level 504C.
  if (input.expectedGoodsNet == null || input.invoiceGoods == null) return true;
  // Financial shortfall is additional evidence of partial fulfilment.
  if (input.invoiceGoods + 0.009 < input.expectedGoodsNet) return true;
  // Invoice may match totals while SKU-level backorders remain — still partial.
  return true;
}

/** Admin inventory: outstanding AB backorder demand for open/processing lines. */
export const OUTSTANDING_BACKORDER_ORDER_STATUSES = [
  "SUBMITTED",
  "CONFIRMED",
  "PICKING",
  "PARTIALLY_DESPATCHED",
  "ON_HOLD",
] as const;

export function effectiveBackorderPolicyLabel(policy: EffectiveBackorderPolicy): string {
  return policy === "ALLOW" ? "Allowed" : "Not allowed";
}

export function variantBackorderPolicyLabel(policy: VariantBackorderPolicy): string {
  switch (policy) {
    case "ALLOW":
      return "Allow";
    case "DENY":
      return "Do not allow";
    default:
      return "Use global setting";
  }
}
