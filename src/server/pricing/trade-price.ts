/**
 * Public display adapter over the Phase 4 trade-price engine.
 * Authoritative resolution lives in `@/domain/trade-price-resolution`.
 * Never read ProductVariant.tradePrice in UI for a logged-in customer price.
 */

import { moneyToNumber, parseMoney } from "@/domain/money";
import {
  PUBLIC_PRICE_SOURCE,
  type TradePriceResolution,
} from "@/domain/trade-price-resolution";

export type PriceViewer =
  | { kind: "anonymous" }
  | { kind: "trade"; canViewPricing: boolean }
  | { kind: "internal"; canViewPricing: boolean };

export type DisplayPrice = {
  currency: "GBP";
  rrp: number | null;
  /** Null for anonymous visitors and anyone without pricing.view / products.view. */
  trade: number | null;
  source: "hidden" | "base_catalogue" | "price_list" | "customer" | "quantity_break" | "promotion";
};

export function moneyNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && "toNumber" in value && typeof (value as { toNumber: () => number }).toNumber === "function") {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const parsed = parseMoney(String(value));
  return parsed ? moneyToNumber(parsed) : null;
}

export function canViewTrade(viewer: PriceViewer): boolean {
  return viewer.kind !== "anonymous" && viewer.canViewPricing;
}

export function toDisplayPrice(input: {
  viewer: PriceViewer;
  rrp: unknown;
  resolution: TradePriceResolution | null;
}): DisplayPrice {
  const rrp = moneyNumber(input.rrp);
  if (!canViewTrade(input.viewer) || !input.resolution || input.resolution.source === "NONE") {
    return { currency: "GBP", rrp, trade: null, source: "hidden" };
  }
  return {
    currency: "GBP",
    rrp,
    trade: Number(input.resolution.unitPriceExVat),
    source: PUBLIC_PRICE_SOURCE[input.resolution.source],
  };
}

/** Base-catalogue-only adapter used by unit tests and non-company callers. */
export function resolveDisplayPrice(input: {
  viewer: PriceViewer;
  tradePrice: unknown;
  rrp: unknown;
}): DisplayPrice {
  const rrp = moneyNumber(input.rrp);
  const trade = moneyNumber(input.tradePrice);
  if (!canViewTrade(input.viewer)) {
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
