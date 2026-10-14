import { describe, expect, it } from "vitest";
import { planReservationReconcile } from "@/domain/order-reservation-plan";

describe("reservation reconcile plan", () => {
  it("reserves only the extra available units and leaves the existing hold", () => {
    const plan = planReservationReconcile({
      consumedCount: 0,
      active: [{ id: "r1", variantId: "v1", quantity: 3, orderItemId: "old" }],
      targets: [{ variantId: "v1", orderItemId: "new", quantity: 5 }],
    });
    expect(plan).toMatchObject({
      ok: true,
      releases: [],
      reserves: [{ variantId: "v1", orderItemId: "new", quantity: 2 }],
      retargets: [{ reservationId: "r1", orderItemId: "new" }],
    });
  });

  it("releases the difference when the available allocation falls", () => {
    const plan = planReservationReconcile({
      consumedCount: 0,
      active: [
        { id: "r1", variantId: "v1", quantity: 3, orderItemId: "old" },
        { id: "r2", variantId: "v1", quantity: 2, orderItemId: "old" },
      ],
      targets: [{ variantId: "v1", orderItemId: "new", quantity: 4 }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.releases).toEqual([{ reservationId: "r1", releaseQty: 1, close: false }]);
    expect(plan.reserves).toEqual([]);
    expect(plan.retargets.map((row) => row.reservationId).sort()).toEqual(["r1", "r2"]);
  });

  it("releases a removed line and does not hold backordered units", () => {
    const plan = planReservationReconcile({
      consumedCount: 0,
      active: [{ id: "r1", variantId: "v1", quantity: 4, orderItemId: "old" }],
      targets: [{ variantId: "v1", orderItemId: "new", quantity: 0 }],
    });
    expect(plan).toMatchObject({
      ok: true,
      releases: [{ reservationId: "r1", releaseQty: 4, close: true }],
      reserves: [],
      retargets: [],
    });
  });

  it("refuses to plan a change when any reservation is consumed", () => {
    const plan = planReservationReconcile({
      consumedCount: 1,
      active: [{ id: "r1", variantId: "v1", quantity: 1, orderItemId: "old" }],
      targets: [{ variantId: "v1", orderItemId: "new", quantity: 2 }],
    });
    expect(plan).toEqual({ ok: false, code: "CONSUMED" });
  });
});
