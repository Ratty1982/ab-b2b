/**
 * Confirmed-stock contract for catalogue orderability.
 *
 * Unknown / unsynced stock is never sellable and never backorderable,
 * even when the effective backorder policy is ALLOW.
 */

import type { PublicAvailability } from "@/domain/availability";
import { publicAvailabilityFromStock } from "@/domain/availability";
import type { EffectiveBackorderPolicy } from "@/domain/backorder";
import { isEffectiveBackorderAllowed } from "@/domain/backorder";

/** Administrative stock confirmation state. */
export type StockConfirmationState =
  | "UNSYNCED"
  | "CONFIRMED_ZERO"
  | "CONFIRMED_POSITIVE"
  | "STALE"
  | "MANUAL_OVERRIDE";

export type StockSourceMode = "AUTOPART" | "MANUAL";

export const STOCK_CONFIRMATION_LABEL: Record<StockConfirmationState, string> = {
  UNSYNCED: "Stock not confirmed",
  CONFIRMED_ZERO: "Out of Stock",
  CONFIRMED_POSITIVE: "Confirmed stock",
  STALE: "Stock stale",
  MANUAL_OVERRIDE: "Manual override",
};

export function resolveStockConfirmationState(input: {
  hasInventoryRow: boolean;
  stockSource: StockSourceMode;
  /** Effective on-hand before reservations (manual qty or Autopart Avail). */
  onHandQty: number;
  stale: boolean;
}): StockConfirmationState {
  if (!input.hasInventoryRow) return "UNSYNCED";
  if (input.stockSource === "MANUAL") return "MANUAL_OVERRIDE";
  if (input.stale && input.onHandQty > 0) return "STALE";
  if (input.onHandQty <= 0) return "CONFIRMED_ZERO";
  return "CONFIRMED_POSITIVE";
}

/**
 * Customer-facing band. Unknown never becomes In Stock / Backorder.
 * Confirmed zero + ALLOW → Available to Backorder.
 */
export function publicAvailabilityFromConfirmation(input: {
  state: StockConfirmationState;
  sellableQty: number;
  stale: boolean;
  backorderAllowed: boolean;
}): PublicAvailability | null {
  if (input.state === "UNSYNCED") return null;
  if (input.state === "STALE" && input.sellableQty > 0) return null;
  return publicAvailabilityFromStock({
    sellableQty: input.sellableQty,
    stale: input.stale,
    unknown: false,
    backorderAllowed: input.backorderAllowed,
  });
}

export function adminStockStatusLabel(input: {
  state: StockConfirmationState;
  sellableQty: number;
  backorderAllowed: boolean;
  availability: PublicAvailability | null;
}): string {
  if (input.state === "UNSYNCED") return "Stock not confirmed";
  if (input.state === "STALE" && input.sellableQty > 0) return "Stale";
  if (input.sellableQty <= 0 && input.backorderAllowed) return "Available to Backorder";
  if (input.availability === "in") return "In Stock";
  if (input.availability === "low") return "Low Stock";
  if (input.availability === "out") return "Out of Stock";
  if (input.availability === "backorder") return "Available to Backorder";
  if (input.availability === "partial") return "Partially Available";
  if (input.state === "MANUAL_OVERRIDE") return "Manual override";
  return "Out of Stock";
}

/**
 * Server-side orderability. Unknown stock is always blocked.
 * Confirmed stock uses the normal sellable + backorder rules.
 */
export function isOrderableWithConfirmedStock(input: {
  stockConfirmed: boolean;
  sellableQty: number;
  stale: boolean;
  backorderPolicy: EffectiveBackorderPolicy;
}): boolean {
  if (!input.stockConfirmed) return false;
  const allowBackorder = isEffectiveBackorderAllowed(input.backorderPolicy);
  if (input.stale && input.sellableQty > 0) return allowBackorder;
  if (input.sellableQty > 0) return true;
  return allowBackorder;
}

/** Autopart master is usable for first-time inventory initialisation. */
export function isTrustedAutopartMasterForReconcile(input: {
  presentInLatestFeed: boolean;
  lastSeenAt: Date | null | undefined;
  now?: Date;
  staleHours?: number;
}): boolean {
  if (input.presentInLatestFeed) return true;
  if (!input.lastSeenAt) return false;
  const hours = input.staleHours ?? 36;
  if (!Number.isFinite(hours) || hours <= 0) return false;
  const now = input.now ?? new Date();
  return now.getTime() - input.lastSeenAt.getTime() <= hours * 60 * 60 * 1000;
}
