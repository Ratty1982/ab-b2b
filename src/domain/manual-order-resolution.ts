/**
 * Pure rules for staff manual order resolution.
 * Fulfilment quantities are absolute targets, never invented invoices.
 */

export const MANUAL_FULFILMENT_STATUSES = [
  "SUBMITTED",
  "CONFIRMED",
  "PICKING",
  "PARTIALLY_DESPATCHED",
  "ON_HOLD",
] as const;

export const MANUAL_TERMINAL_STATUSES = [
  "DRAFT",
  "CANCELLED",
  "DELIVERED",
  "DISPATCHED",
  "ADMINISTRATIVELY_CLOSED",
] as const;

export type ManualResolutionKind = "NONE" | "FULFILLED_MANUALLY" | "CLOSED_ADMINISTRATIVELY";
export type InvoiceEvidenceChoice = "OUTSTANDING" | "UNAVAILABLE";

export function manualFulfilmentFingerprint(
  lines: Array<{ orderItemId: string; despatchedQty: number }>,
): string {
  return [...lines]
    .map((line) => `${line.orderItemId}:${line.despatchedQty}`)
    .sort()
    .join("|");
}

export function assessManualFulfilment(input: {
  status: string;
  resolutionKind: ManualResolutionKind;
  storedFingerprint: string | null;
  lines: Array<{ orderItemId: string; qty: number; despatchedQty: number }>;
  requested: Array<{ orderItemId: string; despatchedQty: number }>;
}):
  | { ok: true; idempotent: boolean; fullyComplete: boolean }
  | { ok: false; message: string } {
  if (input.resolutionKind === "CLOSED_ADMINISTRATIVELY" || input.status === "ADMINISTRATIVELY_CLOSED") {
    return { ok: false, message: "This order was closed administratively. Goods were not recorded as despatched." };
  }
  if ((MANUAL_TERMINAL_STATUSES as readonly string[]).includes(input.status) && input.resolutionKind === "NONE") {
    return { ok: false, message: "This order is already finished and cannot be completed again." };
  }
  if (
    input.resolutionKind === "NONE" &&
    !(MANUAL_FULFILMENT_STATUSES as readonly string[]).includes(input.status)
  ) {
    return { ok: false, message: "This order cannot be fulfilled manually from its current status." };
  }

  const byId = new Map(input.lines.map((line) => [line.orderItemId, line]));
  const seen = new Set<string>();
  let anyIncrease = false;
  for (const request of input.requested) {
    if (seen.has(request.orderItemId)) {
      return { ok: false, message: "Each order line can be confirmed only once." };
    }
    seen.add(request.orderItemId);
    const line = byId.get(request.orderItemId);
    if (!line) return { ok: false, message: "A confirmed line does not belong to this order." };
    if (!Number.isInteger(request.despatchedQty) || request.despatchedQty < 0) {
      return { ok: false, message: "Fulfilled quantities must be whole numbers." };
    }
    if (request.despatchedQty > line.qty) {
      return { ok: false, message: "Fulfilled quantity cannot exceed the ordered quantity." };
    }
    if (request.despatchedQty < line.despatchedQty) {
      return { ok: false, message: "Fulfilled quantity cannot be reduced." };
    }
    if (request.despatchedQty > line.despatchedQty) anyIncrease = true;
  }
  if (seen.size !== input.lines.length) {
    return { ok: false, message: "Confirm a fulfilled quantity for every order line." };
  }

  const fingerprint = manualFulfilmentFingerprint(input.requested);
  if (input.resolutionKind === "FULFILLED_MANUALLY") {
    if (input.storedFingerprint === fingerprint) {
      return { ok: true, idempotent: true, fullyComplete: input.lines.every((line) => line.despatchedQty >= line.qty) };
    }
    if (!anyIncrease) {
      return { ok: false, message: "Fulfilled quantity cannot be reduced." };
    }
    const fullyComplete = input.requested.every((request) => {
      const line = byId.get(request.orderItemId);
      return line != null && request.despatchedQty >= line.qty;
    });
    return { ok: true, idempotent: false, fullyComplete };
  }

  if (!anyIncrease) {
    return { ok: false, message: "Enter the fulfilled quantity for at least one line." };
  }
  const fullyComplete = input.requested.every((request) => {
    const line = byId.get(request.orderItemId);
    return line != null && request.despatchedQty >= line.qty;
  });
  return { ok: true, idempotent: false, fullyComplete };
}

export type ReservationHold = {
  id: string;
  orderItemId: string | null;
  variantId: string;
  quantity: number;
};

export type DespatchDelta = {
  orderItemId: string;
  variantId: string | null;
  quantity: number;
};

/**
 * Units to take from each active hold. A hold is used only for its own line,
 * or for a matching product when the hold was not tied to a line.
 * The plan never takes more than the hold, and leftover quantity stays active.
 */
export function planReservationConsumption(holds: ReservationHold[], deltas: DespatchDelta[]): Map<string, number> {
  const available = new Map(holds.map((hold) => [hold.id, Math.max(0, hold.quantity)]));
  const taken = new Map<string, number>();
  for (const delta of deltas) {
    let left = Math.max(0, Math.trunc(delta.quantity));
    if (left === 0) continue;
    const candidates = holds.filter((hold) => {
      if (hold.orderItemId) return hold.orderItemId === delta.orderItemId;
      return delta.variantId != null && hold.variantId === delta.variantId;
    });
    for (const hold of candidates) {
      if (left <= 0) break;
      const remaining = available.get(hold.id) ?? 0;
      if (remaining <= 0) continue;
      const take = Math.min(left, remaining);
      available.set(hold.id, remaining - take);
      taken.set(hold.id, (taken.get(hold.id) ?? 0) + take);
      left -= take;
    }
  }
  return taken;
}

export function assessAdministrativeClose(input: {
  status: string;
  resolutionKind: ManualResolutionKind;
}): { ok: true; idempotent: boolean } | { ok: false; message: string } {
  if (input.resolutionKind === "CLOSED_ADMINISTRATIVELY" || input.status === "ADMINISTRATIVELY_CLOSED") {
    return { ok: true, idempotent: true };
  }
  if (input.resolutionKind === "FULFILLED_MANUALLY") {
    return {
      ok: false,
      message: "This order was already fulfilled manually. Close is not used to undo that despatch.",
    };
  }
  if ((MANUAL_TERMINAL_STATUSES as readonly string[]).includes(input.status)) {
    return { ok: false, message: "This order is already finished and cannot be closed again." };
  }
  if (!(MANUAL_FULFILMENT_STATUSES as readonly string[]).includes(input.status)) {
    return { ok: false, message: "This order cannot be closed administratively from its current status." };
  }
  return { ok: true, idempotent: false };
}
