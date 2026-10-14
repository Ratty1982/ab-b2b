/**
 * Plan how ACTIVE order reservations move to a new set of line quantities.
 * Backordered units are not holds: the target quantity is the available allocation only.
 * CONSUMED rows are never released. Physical stock (qtyOnHand) is never part of this plan.
 */

export type ActiveReservationSnapshot = {
  id: string;
  variantId: string;
  quantity: number;
  orderItemId: string | null;
};

export type ReservationTarget = {
  variantId: string;
  orderItemId: string;
  /** Units that should stay on an ACTIVE hold. Never the backordered remainder. */
  quantity: number;
};

export type ReservationRelease = {
  reservationId: string;
  releaseQty: number;
  close: boolean;
};

export type ReservationRetarget = {
  reservationId: string;
  orderItemId: string;
};

export type ReservationReserve = {
  variantId: string;
  orderItemId: string;
  quantity: number;
};

export type ReservationReconcilePlan =
  | { ok: false; code: "CONSUMED" }
  | {
      ok: true;
      releases: ReservationRelease[];
      retargets: ReservationRetarget[];
      reserves: ReservationReserve[];
    };

export function planReservationReconcile(input: {
  consumedCount: number;
  active: ActiveReservationSnapshot[];
  targets: ReservationTarget[];
}): ReservationReconcilePlan {
  if (input.consumedCount > 0) return { ok: false, code: "CONSUMED" };

  const targets = new Map<string, { orderItemId: string; quantity: number }>();
  for (const target of input.targets) {
    const quantity = Math.max(0, Math.trunc(target.quantity));
    const prev = targets.get(target.variantId);
    targets.set(target.variantId, {
      orderItemId: target.orderItemId,
      quantity: (prev?.quantity ?? 0) + quantity,
    });
  }

  const byVariant = new Map<string, ActiveReservationSnapshot[]>();
  for (const row of input.active) {
    const list = byVariant.get(row.variantId) ?? [];
    list.push(row);
    byVariant.set(row.variantId, list);
  }

  const releases: ReservationRelease[] = [];
  const retargets: ReservationRetarget[] = [];
  const reserves: ReservationReserve[] = [];
  const variantIds = [...new Set([...byVariant.keys(), ...targets.keys()])].sort();

  for (const variantId of variantIds) {
    const rows = [...(byVariant.get(variantId) ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const target = targets.get(variantId);
    const targetQty = target?.quantity ?? 0;
    const current = rows.reduce((sum, row) => sum + row.quantity, 0);
    const closed = new Set<string>();

    if (targetQty < current) {
      let remaining = current - targetQty;
      for (const row of rows) {
        if (remaining <= 0) break;
        const releaseQty = Math.min(row.quantity, remaining);
        const close = releaseQty >= row.quantity;
        releases.push({ reservationId: row.id, releaseQty, close });
        if (close) closed.add(row.id);
        remaining -= releaseQty;
      }
    } else if (target && targetQty > current) {
      reserves.push({
        variantId,
        orderItemId: target.orderItemId,
        quantity: targetQty - current,
      });
    }

    if (target) {
      for (const row of rows) {
        if (closed.has(row.id)) continue;
        if (row.orderItemId !== target.orderItemId) {
          retargets.push({ reservationId: row.id, orderItemId: target.orderItemId });
        }
      }
    }
  }

  return { ok: true, releases, retargets, reserves };
}
