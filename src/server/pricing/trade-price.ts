/**
 * Phase 3 pricing boundary.
 *
 * Catalogue stores a base trade price on ProductVariant.tradePrice (kept in
 * sync with QuantityBreak minQty=1). CustomerPrice / PriceList / QuantityBreak
 * / Promotion engines belong to Phase 4 — call this module instead of reading
 * `product.tradePrice` in UI.
 */

export type PriceViewer =
  | { kind: "anonymous" }
  | { kind: "trade"; canViewPricing: boolean }
  | { kind: "internal"; canViewPricing: boolean };

export type DisplayPrice = {
  currency: "GBP";
  rrp: number | null;
  /** Null for anonymous visitors and anyone without pricing.view / products.view. */
  trade: number | null;
  source: "hidden" | "base_catalogue";
};

export function moneyNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && "toNumber" in value && typeof (value as { toNumber: () => number }).toNumber === "function") {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function resolveDisplayPrice(input: {
  viewer: PriceViewer;
  tradePrice: unknown;
  rrp: unknown;
}): DisplayPrice {
  const rrp = moneyNumber(input.rrp);
  const trade = moneyNumber(input.tradePrice);
  const canSeeTrade =
    input.viewer.kind !== "anonymous" && input.viewer.canViewPricing;
  if (!canSeeTrade) {
    return { currency: "GBP", rrp, trade: null, source: "hidden" };
  }
  return { currency: "GBP", rrp, trade, source: "base_catalogue" };
}

export function viewerFromAccess(input: {
  signedIn: boolean;
  actorType?: "INTERNAL" | "TRADE" | null;
  permissions?: ReadonlySet<string> | readonly string[];
}): PriceViewer {
  if (!input.signedIn) return { kind: "anonymous" };
  const perms = Array.isArray(input.permissions)
    ? new Set(input.permissions)
    : input.permissions instanceof Set
      ? input.permissions
      : new Set<string>();
  const canViewPricing = perms.has("pricing.view") || perms.has("products.view") || perms.has("admin.access");
  if (input.actorType === "INTERNAL") {
    return { kind: "internal", canViewPricing };
  }
  return { kind: "trade", canViewPricing };
}
