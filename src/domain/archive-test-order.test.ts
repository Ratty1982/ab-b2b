import { describe, expect, it } from "vitest";
import {
  canOfferArchiveTestOrder,
  canOfferRestoreTestOrder,
  validateArchiveTestOrdersConfirmation,
  validateRestoreTestOrderConfirmation,
} from "@/domain/archive-test-order";

describe("archive test order confirmation", () => {
  it("offers archive and restore only to Super Admin", () => {
    expect(canOfferArchiveTestOrder({ systemRoles: ["SUPER_ADMIN"], archivedAt: null })).toBe(true);
    expect(canOfferArchiveTestOrder({ systemRoles: ["MANAGEMENT"], archivedAt: null })).toBe(false);
    expect(canOfferArchiveTestOrder({ systemRoles: ["SUPER_ADMIN"], archivedAt: "2026-10-14T00:00:00.000Z" })).toBe(
      false,
    );
    expect(
      canOfferRestoreTestOrder({ systemRoles: ["SUPER_ADMIN"], archivedAt: "2026-10-14T00:00:00.000Z" }),
    ).toBe(true);
    expect(canOfferRestoreTestOrder({ systemRoles: ["SALES_REPRESENTATIVE"], archivedAt: "2026-10-14" })).toBe(
      false,
    );
  });

  it("requires a reason, test-data confirmation, and the exact order numbers", () => {
    const expected = ["AB-000007", "AB-000008"];
    expect(
      validateArchiveTestOrdersConfirmation({
        reason: "  Internal labelling test.  ",
        confirmTestData: true,
        confirmOrderNumbers: "AB-000008, AB-000007",
        expectedOrderNumbers: expected,
      }),
    ).toMatchObject({ ok: true, reason: "Internal labelling test.", orderNumbers: ["AB-000007", "AB-000008"] });

    expect(
      validateArchiveTestOrdersConfirmation({
        reason: "",
        confirmTestData: true,
        confirmOrderNumbers: "AB-000007",
        expectedOrderNumbers: ["AB-000007"],
      }).ok,
    ).toBe(false);
    expect(
      validateArchiveTestOrdersConfirmation({
        reason: "Test",
        confirmTestData: false,
        confirmOrderNumbers: "AB-000007",
        expectedOrderNumbers: ["AB-000007"],
      }),
    ).toMatchObject({ code: "TEST_DATA_CONFIRMATION_REQUIRED" });
    expect(
      validateArchiveTestOrdersConfirmation({
        reason: "Test",
        confirmTestData: true,
        confirmOrderNumbers: "AB-000001",
        expectedOrderNumbers: ["AB-000007"],
      }),
    ).toMatchObject({ code: "ORDER_NUMBER_MISMATCH" });
    expect(
      validateRestoreTestOrderConfirmation({
        confirmOrderNumber: "AB-000007",
        expectedOrderNumber: "AB-000007",
      }).ok,
    ).toBe(true);
  });
});
