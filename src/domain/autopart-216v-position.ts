/**
 * SKU-level Autopart stock cover for 216V backorders.
 *
 * Avail = 231PO3NEW sellable quantity (not a reservation).
 * Incoming = 231PO3NEW P/Ord Qty. No ETA is invented.
 *
 * Line-level cover is indicative only — multiple backorders share the same Avail.
 */

export const AUTOPART_216V_STOCK_POSITIONS = [
  "STOCK_AVAILABLE",
  "PART_STOCK_AVAILABLE",
  "INCOMING_COVERS",
  "INCOMING_PART_COVERS",
  "NO_STOCK_NO_INCOMING",
  "PRODUCT_NOT_IN_CURRENT_STOCK_FEED",
] as const;

export type Autopart216vStockPosition = (typeof AUTOPART_216V_STOCK_POSITIONS)[number];

export const AUTOPART_216V_STOCK_POSITION_LABEL: Record<Autopart216vStockPosition, string> = {
  STOCK_AVAILABLE: "STOCK AVAILABLE",
  PART_STOCK_AVAILABLE: "PART STOCK AVAILABLE",
  INCOMING_COVERS: "INCOMING COVERS",
  INCOMING_PART_COVERS: "INCOMING PART COVERS",
  NO_STOCK_NO_INCOMING: "NO STOCK / NO INCOMING",
  PRODUCT_NOT_IN_CURRENT_STOCK_FEED: "PRODUCT NOT IN CURRENT STOCK FEED",
};

export type Autopart216vSkuCover = {
  position: Autopart216vStockPosition;
  outstandingQty: number;
  availQty: number | null;
  incomingQty: number | null;
  /** Shared Avail vs total outstanding for this SKU — not an allocation. */
  coverSummary: string;
  incomingHasEta: false;
};

export function resolveAutopart216vSkuCover(input: {
  outstandingQty: number;
  availQty: number | null;
  incomingQty: number | null;
  presentInLatestFeed: boolean;
}): Autopart216vSkuCover {
  const outstanding = Number.isFinite(input.outstandingQty) ? Math.max(0, input.outstandingQty) : 0;
  const incomingHasEta = false as const;
  if (!input.presentInLatestFeed || input.availQty == null) {
    return {
      position: "PRODUCT_NOT_IN_CURRENT_STOCK_FEED",
      outstandingQty: outstanding,
      availQty: input.availQty,
      incomingQty: input.incomingQty,
      coverSummary: "Not in the current Autopart stock feed",
      incomingHasEta,
    };
  }
  const avail = Math.max(0, input.availQty);
  const incoming = input.incomingQty == null ? 0 : Math.max(0, input.incomingQty);
  const coverSummary = `${avail.toLocaleString("en-GB")} available against ${outstanding.toLocaleString("en-GB")} backordered (indicative — not a reservation)`;

  if (avail > 0 && avail >= outstanding) {
    return {
      position: "STOCK_AVAILABLE",
      outstandingQty: outstanding,
      availQty: avail,
      incomingQty: input.incomingQty,
      coverSummary,
      incomingHasEta,
    };
  }
  if (avail > 0 && avail < outstanding) {
    return {
      position: "PART_STOCK_AVAILABLE",
      outstandingQty: outstanding,
      availQty: avail,
      incomingQty: input.incomingQty,
      coverSummary,
      incomingHasEta,
    };
  }
  if (incoming > 0 && incoming >= outstanding) {
    return {
      position: "INCOMING_COVERS",
      outstandingQty: outstanding,
      availQty: avail,
      incomingQty: input.incomingQty,
      coverSummary: `${incoming.toLocaleString("en-GB")} incoming against ${outstanding.toLocaleString("en-GB")} backordered — arrival date is not available`,
      incomingHasEta,
    };
  }
  if (incoming > 0 && incoming < outstanding) {
    return {
      position: "INCOMING_PART_COVERS",
      outstandingQty: outstanding,
      availQty: avail,
      incomingQty: input.incomingQty,
      coverSummary: `${incoming.toLocaleString("en-GB")} incoming against ${outstanding.toLocaleString("en-GB")} backordered — arrival date is not available`,
      incomingHasEta,
    };
  }
  return {
    position: "NO_STOCK_NO_INCOMING",
    outstandingQty: outstanding,
    availQty: avail,
    incomingQty: input.incomingQty,
    coverSummary: "No sellable stock and no incoming quantity",
    incomingHasEta,
  };
}

export function firstSeenAgeDays(firstSeenAt: Date, now = new Date()): number {
  const ms = now.getTime() - firstSeenAt.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

export function firstSeenAgeLabel(days: number): string {
  const n = Math.max(1, Math.trunc(days));
  return n === 1 ? "Seen for 1 day" : `Seen for ${n} days`;
}

export const AUTOPART_216V_CHANGE_STATUS_LABEL: Record<
  "NEW" | "UNCHANGED" | "QUANTITY_REDUCED" | "QUANTITY_INCREASED" | "CLEARED",
  string
> = {
  NEW: "NEW",
  UNCHANGED: "UNCHANGED",
  QUANTITY_REDUCED: "QUANTITY REDUCED",
  QUANTITY_INCREASED: "QUANTITY INCREASED",
  CLEARED: "CLEARED",
};

/** Visible, deterministic attention rules — not a black-box score. */
export const AUTOPART_216V_HIGH_VALUE_GBP = 250;
export const AUTOPART_216V_LONG_STANDING_DAYS = 7;

export const AUTOPART_216V_ATTENTION_RULES = [
  {
    id: "STOCK_NOW_AVAILABLE" as const,
    label: "STOCK NOW AVAILABLE",
    rule: "Autopart Avail > 0 for the SKU. Stock available in Autopart — review allocation/despatch. This is not a reservation and does not confirm the order can be fulfilled.",
  },
  {
    id: "NO_STOCK_NO_INCOMING" as const,
    label: "NO STOCK / NO INCOMING",
    rule: "SKU-level Avail is 0 and Incoming (P/Ord Qty) is 0 (or missing). Arrival dates are not inferred.",
  },
  {
    id: "INCOMING_DOES_NOT_COVER" as const,
    label: "INCOMING DOES NOT COVER TOTAL BACKORDER",
    rule: "SKU-level Incoming is greater than 0 but less than total outstanding backorder quantity, and Avail does not cover the rest.",
  },
  {
    id: "LONG_STANDING" as const,
    label: "LONG-STANDING BACKORDER",
    rule: `First seen ${AUTOPART_216V_LONG_STANDING_DAYS}+ days ago in 216V snapshot history. This is backorder first-seen age, not Autopart order date.`,
  },
  {
    id: "HIGH_VALUE" as const,
    label: "HIGH OUTSTANDING VALUE",
    rule: `Line outstanding value is £${AUTOPART_216V_HIGH_VALUE_GBP}+ (216V O/S Val, not Latest Cost).`,
  },
] as const;

export type Autopart216vAttentionId = (typeof AUTOPART_216V_ATTENTION_RULES)[number]["id"];

export function attentionIdsForBackorder(input: {
  ageDays: number;
  outstandingValue: number;
  skuPosition: Autopart216vStockPosition;
  skuAvailQty: number | null;
}): Autopart216vAttentionId[] {
  const ids: Autopart216vAttentionId[] = [];
  if ((input.skuAvailQty ?? 0) > 0 && input.skuPosition !== "PRODUCT_NOT_IN_CURRENT_STOCK_FEED") {
    ids.push("STOCK_NOW_AVAILABLE");
  }
  if (input.skuPosition === "NO_STOCK_NO_INCOMING") ids.push("NO_STOCK_NO_INCOMING");
  if (input.skuPosition === "INCOMING_PART_COVERS") ids.push("INCOMING_DOES_NOT_COVER");
  if (input.ageDays >= AUTOPART_216V_LONG_STANDING_DAYS) ids.push("LONG_STANDING");
  if (input.outstandingValue >= AUTOPART_216V_HIGH_VALUE_GBP) ids.push("HIGH_VALUE");
  return ids;
}
