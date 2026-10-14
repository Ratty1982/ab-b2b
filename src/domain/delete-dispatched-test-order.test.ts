import { describe, expect, it } from "vitest";
import {
  canOfferDispatchedTestOrderDelete,
  dispatchedTestOrderDeletionBlockers,
  validateDeleteDispatchedTestOrderConfirmation,
  type DispatchedTestOrderDeletionEvidence,
} from "@/domain/delete-dispatched-test-order";

function evidence(
  overrides: Partial<DispatchedTestOrderDeletionEvidence> = {},
): DispatchedTestOrderDeletionEvidence {
  return {
    status: "DISPATCHED",
    externalRef: null,
    autopartExportStatus: "NOT_EXPORTED",
    autopartExportCount: 0,
    autopartExportBatchReference: null,
    invoices: [],
    autopartDocuments: [],
    fulfilmentEvents: [
      { kind: "ORDER_RECEIVED", source: "ORDER_PLACE", summary: "Order received" },
    ],
    despatchedQty: 0,
    ...overrides,
  };
}

describe("dispatched test order deletion rules", () => {
  it("offers the action only to Super Admin on a dispatched order", () => {
    expect(
      canOfferDispatchedTestOrderDelete({ systemRoles: ["SUPER_ADMIN"], status: "DISPATCHED" }),
    ).toBe(true);
    expect(
      canOfferDispatchedTestOrderDelete({
        systemRoles: ["ADMIN", "SUPER_ADMIN"],
        status: "DISPATCHED",
      }),
    ).toBe(true);
    expect(
      canOfferDispatchedTestOrderDelete({ systemRoles: ["MANAGEMENT"], status: "DISPATCHED" }),
    ).toBe(false);
    expect(
      canOfferDispatchedTestOrderDelete({ systemRoles: ["SALES_MANAGER"], status: "DISPATCHED" }),
    ).toBe(false);
    expect(
      canOfferDispatchedTestOrderDelete({
        systemRoles: ["SALES_REPRESENTATIVE"],
        status: "DISPATCHED",
      }),
    ).toBe(false);
    expect(
      canOfferDispatchedTestOrderDelete({ systemRoles: ["ADMIN"], status: "DISPATCHED" }),
    ).toBe(false);
    expect(
      canOfferDispatchedTestOrderDelete({ systemRoles: ["SUPER_ADMIN"], status: "DELIVERED" }),
    ).toBe(false);
    expect(
      canOfferDispatchedTestOrderDelete({ systemRoles: ["SUPER_ADMIN"], status: "SUBMITTED" }),
    ).toBe(false);
  });

  it("accepts an internal test order and refuses financial or shipment evidence", () => {
    expect(dispatchedTestOrderDeletionBlockers(evidence())).toEqual([]);
    expect(
      dispatchedTestOrderDeletionBlockers(
        evidence({
          invoices: [{ invoiceNumber: "INV-1", status: "PART_PAID", autopartDocumentKind: "CREDIT" }],
        }),
      ).join(" "),
    ).toMatch(/credit note INV-1/);
    expect(
      dispatchedTestOrderDeletionBlockers(
        evidence({
          fulfilmentEvents: [{ kind: "DESPATCHED", source: "MANUAL", summary: "Left the warehouse" }],
        }),
      ).join(" "),
    ).toMatch(/DESPATCHED/);
    expect(
      dispatchedTestOrderDeletionBlockers(evidence({ despatchedQty: 4 })).join(" "),
    ).toMatch(/Despatched quantity of 4/);
    expect(
      dispatchedTestOrderDeletionBlockers(
        evidence({ autopartExportStatus: "EXPORTED", autopartExportCount: 1 }),
      ).join(" "),
    ).toMatch(/exported to Autopart/);
    expect(dispatchedTestOrderDeletionBlockers(evidence({ status: "DELIVERED" })).join(" ")).toMatch(
      /Delivered orders cannot/,
    );
  });

  it("requires a reason, test-data confirmation, and the exact order number", () => {
    expect(
      validateDeleteDispatchedTestOrderConfirmation({
        reason: "   ",
        confirmTestData: true,
        confirmOrderNumber: "AB-000001",
        expectedOrderNumber: "AB-000001",
      }).ok,
    ).toBe(false);
    expect(
      validateDeleteDispatchedTestOrderConfirmation({
        reason: "Internal test",
        confirmTestData: false,
        confirmOrderNumber: "AB-000001",
        expectedOrderNumber: "AB-000001",
      }),
    ).toMatchObject({ code: "TEST_DATA_CONFIRMATION_REQUIRED" });
    expect(
      validateDeleteDispatchedTestOrderConfirmation({
        reason: "Internal test",
        confirmTestData: true,
        confirmOrderNumber: "AB-000002",
        expectedOrderNumber: "AB-000001",
      }),
    ).toMatchObject({ code: "ORDER_NUMBER_MISMATCH" });
    expect(
      validateDeleteDispatchedTestOrderConfirmation({
        reason: "  Internal test  ",
        confirmTestData: true,
        confirmOrderNumber: "AB-000001",
        expectedOrderNumber: "AB-000001",
      }),
    ).toEqual({ ok: true, reason: "Internal test" });
  });
});
