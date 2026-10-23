import { describe, expect, it } from "vitest";
import {
  assessAdministrativeClose,
  assessManualFulfilment,
  manualFulfilmentFingerprint,
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

  it("treats the same manual fulfilment as a no-op and rejects a different one", () => {
    const fingerprint = manualFulfilmentFingerprint([{ orderItemId: "line-1", despatchedQty: 4 }]);
    const again = assessManualFulfilment({
      status: "PARTIALLY_DESPATCHED",
      resolutionKind: "FULFILLED_MANUALLY",
      storedFingerprint: fingerprint,
      lines: [{ orderItemId: "line-1", qty: 10, despatchedQty: 4 }],
      requested: [{ orderItemId: "line-1", despatchedQty: 4 }],
    });
    expect(again).toMatchObject({ ok: true, idempotent: true });
    const changed = assessManualFulfilment({
      status: "PARTIALLY_DESPATCHED",
      resolutionKind: "FULFILLED_MANUALLY",
      storedFingerprint: fingerprint,
      lines: [{ orderItemId: "line-1", qty: 10, despatchedQty: 4 }],
      requested: [{ orderItemId: "line-1", despatchedQty: 10 }],
    });
    expect(changed.ok).toBe(false);
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
