import { describe, expect, it } from "vitest";
import { assessSalesOrderEditEligibility } from "@/domain/order-edit";

const open = {
  status: "SUBMITTED",
  archivedAt: null,
  autopartExportStatus: "NOT_EXPORTED",
  autopartExportCount: 0,
  autopartExportedAt: null,
  externalRef: null,
  invoiceCount: 0,
  fulfilmentKinds: ["ORDER_RECEIVED"],
  consumedReservationCount: 0,
};

describe("sales order edit eligibility", () => {
  it("allows a submitted order before export, invoice, or despatch", () => {
    expect(assessSalesOrderEditEligibility(open)).toEqual({ allowed: true, reason: null });
  });

  it.each([
    [{ autopartExportStatus: "EXPORTED" }, "exported to Autopart"],
    [{ autopartExportCount: 1 }, "exported to Autopart"],
    [{ invoiceCount: 1 }, "invoice"],
    [{ fulfilmentKinds: ["EXPORTED_FOR_PROCESSING"] }, "Fulfilment has started"],
    [{ fulfilmentKinds: ["DESPATCHED"] }, "Fulfilment has started"],
    [{ consumedReservationCount: 1 }, "consumed"],
    [{ status: "DISPATCHED" }, "submitted orders"],
    [{ status: "CONFIRMED" }, "submitted orders"],
    [{ archivedAt: new Date() }, "Archived"],
    [{ externalRef: "MAM-1" }, "external record"],
  ])("blocks a locked order (%s)", (patch, text) => {
    const result = assessSalesOrderEditEligibility({ ...open, ...patch });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(text);
  });
});
