import { describe, expect, it } from "vitest";
import {
  assessAdministrativeClose,
  assessManualFulfilment,
  manualFulfilmentFingerprint,
  planReservationConsumption,
} from "@/domain/manual-order-resolution";

const lines = [{ orderItemId: "line-1", qty: 10, despatchedQty: 0 }];

describe("manual order resolution rules", () => {
  it("accepts a partial quantity and a full quantity", () => {
    const partial = assessManualFulfilment({
      status: "CONFIRMED",
      resolutionKind: "NONE",
      storedFingerprint: null,
      lines,
      requested: [{ orderItemId: "line-1", despatchedQty: 4 }],
    });
    expect(partial).toEqual({ ok: true, idempotent: false, fullyComplete: false });
    const full = assessManualFulfilment({
      status: "CONFIRMED",
      resolutionKind: "NONE",
      storedFingerprint: null,
      lines,
      requested: [{ orderItemId: "line-1", despatchedQty: 10 }],
    });
    expect(full).toEqual({ ok: true, idempotent: false, fullyComplete: true });
  });

  it("treats the same manual fulfilment as a no-op and allows the remaining balance", () => {
    const fingerprint = manualFulfilmentFingerprint([{ orderItemId: "line-1", despatchedQty: 4 }]);
    const again = assessManualFulfilment({
      status: "PARTIALLY_DESPATCHED",
      resolutionKind: "FULFILLED_MANUALLY",
      storedFingerprint: fingerprint,
      lines: [{ orderItemId: "line-1", qty: 10, despatchedQty: 4 }],
      requested: [{ orderItemId: "line-1", despatchedQty: 4 }],
    });
    expect(again).toMatchObject({ ok: true, idempotent: true });
    const balance = assessManualFulfilment({
      status: "PARTIALLY_DESPATCHED",
      resolutionKind: "FULFILLED_MANUALLY",
      storedFingerprint: fingerprint,
      lines: [{ orderItemId: "line-1", qty: 10, despatchedQty: 4 }],
      requested: [{ orderItemId: "line-1", despatchedQty: 10 }],
    });
    expect(balance).toEqual({ ok: true, idempotent: false, fullyComplete: true });
    const reduced = assessManualFulfilment({
      status: "PARTIALLY_DESPATCHED",
      resolutionKind: "FULFILLED_MANUALLY",
      storedFingerprint: fingerprint,
      lines: [{ orderItemId: "line-1", qty: 10, despatchedQty: 4 }],
      requested: [{ orderItemId: "line-1", despatchedQty: 2 }],
    });
    expect(reduced.ok).toBe(false);
  });

  it("consumes only the supplied quantity from each line's hold", () => {
    const taken = planReservationConsumption(
      [
        { id: "a", orderItemId: "line-1", variantId: "v1", quantity: 10 },
        { id: "b", orderItemId: "line-2", variantId: "v2", quantity: 5 },
      ],
      [
        { orderItemId: "line-1", variantId: "v1", quantity: 4 },
        { orderItemId: "line-2", variantId: "v2", quantity: 0 },
      ],
    );
    expect(taken.get("a")).toBe(4);
    expect(taken.has("b")).toBe(false);
    const again = planReservationConsumption(
      [{ id: "a", orderItemId: "line-1", variantId: "v1", quantity: 6 }],
      [{ orderItemId: "line-1", variantId: "v1", quantity: 6 }],
    );
    expect(again.get("a")).toBe(6);
    const untied = planReservationConsumption(
      [{ id: "pool", orderItemId: null, variantId: "v1", quantity: 3 }],
      [{ orderItemId: "line-1", variantId: "v1", quantity: 8 }],
    );
    expect(untied.get("pool")).toBe(3);
  });

  it("refuses cancelled and already despatched orders", () => {
    for (const status of ["CANCELLED", "DISPATCHED", "DELIVERED", "DRAFT"]) {
      const result = assessManualFulfilment({
        status,
        resolutionKind: "NONE",
        storedFingerprint: null,
        lines,
        requested: [{ orderItemId: "line-1", despatchedQty: 10 }],
      });
      expect(result.ok).toBe(false);
    }
  });

  it("closes an open order without pretending a repeat close is new work", () => {
    expect(assessAdministrativeClose({ status: "CONFIRMED", resolutionKind: "NONE" })).toEqual({
      ok: true,
      idempotent: false,
    });
    expect(
      assessAdministrativeClose({ status: "ADMINISTRATIVELY_CLOSED", resolutionKind: "CLOSED_ADMINISTRATIVELY" }),
    ).toEqual({ ok: true, idempotent: true });
    expect(assessAdministrativeClose({ status: "CANCELLED", resolutionKind: "NONE" }).ok).toBe(false);
    expect(assessAdministrativeClose({ status: "PARTIALLY_DESPATCHED", resolutionKind: "FULFILLED_MANUALLY" }).ok).toBe(
      false,
    );
  });
});
