/**
 * 216V movement drill-down semantics.
 *
 * Movement always describes the transition from the previous COMMITTED 216V snapshot into the
 * current COMMITTED snapshot. Classification is the change status persisted by the import
 * (hardened identity matching) — this module never re-matches lines.
 */

export const AUTOPART_216V_MOVEMENTS = ["NEW", "INCREASED", "REDUCED", "CLEARED"] as const;
export type Autopart216vMovement = (typeof AUTOPART_216V_MOVEMENTS)[number];

export type Autopart216vMovementChangeStatus = "NEW" | "QUANTITY_INCREASED" | "QUANTITY_REDUCED" | "CLEARED";

export const AUTOPART_216V_MOVEMENT_CHANGE_STATUS: Record<Autopart216vMovement, Autopart216vMovementChangeStatus> = {
  NEW: "NEW",
  INCREASED: "QUANTITY_INCREASED",
  REDUCED: "QUANTITY_REDUCED",
  CLEARED: "CLEARED",
};

export const AUTOPART_216V_MOVEMENT_LABEL: Record<Autopart216vMovement, string> = {
  NEW: "New today",
  INCREASED: "Increased",
  REDUCED: "Reduced",
  CLEARED: "Cleared",
};

export function isAutopart216vMovement(value: unknown): value is Autopart216vMovement {
  return typeof value === "string" && (AUTOPART_216V_MOVEMENTS as readonly string[]).includes(value);
}

export function autopart216vMovementEmptyCopy(movement: Autopart216vMovement): string {
  if (movement === "NEW") return "No new backorders in this snapshot.";
  if (movement === "INCREASED") return "No increased backorders in this snapshot.";
  if (movement === "REDUCED") return "No reduced backorders in this snapshot.";
  return "No cleared backorders in this snapshot.";
}

/** Filters that describe current outstanding state and cannot apply to the selected movement. */
export type Autopart216vMovementFilterKey = "status" | "position" | "ageDays";

export function autopart216vMovementIgnoredFilters(
  movement: Autopart216vMovement,
): Autopart216vMovementFilterKey[] {
  if (movement === "CLEARED") return ["status", "position", "ageDays"];
  return ["status"];
}

export type Autopart216vMovementQuantities = {
  previousQty: number | null;
  /** Null for CLEARED: the line is no longer outstanding, so no current quantity exists. */
  currentQty: number | null;
  changeQty: number | null;
};

export function autopart216vMovementQuantities(input: {
  movement: Autopart216vMovement;
  outstandingQty: number;
  previousQty: number | null;
}): Autopart216vMovementQuantities {
  if (input.movement === "NEW") {
    return { previousQty: null, currentQty: input.outstandingQty, changeQty: input.outstandingQty };
  }
  if (input.movement === "CLEARED") {
    return { previousQty: input.previousQty, currentQty: null, changeQty: null };
  }
  const previousQty = input.previousQty;
  return {
    previousQty,
    currentQty: input.outstandingQty,
    changeQty: previousQty == null ? null : input.outstandingQty - previousQty,
  };
}

export function formatAutopart216vChangeQty(change: number | null): string {
  if (change == null || !Number.isFinite(change)) return "—";
  if (change > 0) return `+${change.toLocaleString("en-GB")}`;
  if (change < 0) return `−${Math.abs(change).toLocaleString("en-GB")}`;
  return "0";
}
