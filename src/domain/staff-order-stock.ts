/**
 * Sellable stock for staff sales order entry.
 * Free stock is Autopart availability less every ACTIVE B2B reservation.
 * Stale or missing Autopart stock is not confirmed available.
 * An order being edited keeps the units it already holds.
 */

export function staffOrderStockAvailability(input: {
  /** max(0, Autopart Avail − all ACTIVE reservations), before the stale rule. */
  freeSellableQty: number;
  stale: boolean;
  /** False when no Autopart inventory row exists. */
  stockKnown: boolean;
  /** ACTIVE units already reserved by the order being edited. */
  ownActiveReservedQty?: number;
}): { sellableQty: number; stockConfirmed: boolean } {
  const untrusted = input.stale || !input.stockKnown;
  const free = Math.max(0, Math.trunc(input.freeSellableQty));
  const trustedFree = untrusted && free > 0 ? 0 : free;
  const ownHeld = Math.max(0, Math.trunc(input.ownActiveReservedQty ?? 0));
  return {
    sellableQty: trustedFree + ownHeld,
    stockConfirmed: input.stockKnown && !input.stale,
  };
}

/** Staff-facing available-stock label. Never prints an unconfirmed positive quantity. */
export function staffOrderAvailableLabel(input: {
  sellableQty: number;
  stockConfirmed: boolean;
}): string {
  if (!input.stockConfirmed) return "Stock not confirmed";
  return `${input.sellableQty} available`;
}
