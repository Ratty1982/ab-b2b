import { describe, expect, it } from "vitest";
import { orderAmendmentConfirmationMessage } from "@/domain/order-updated-email";

describe("order amendment confirmation feedback", () => {
  it("uses the sent, pending and failed messages", () => {
    expect(orderAmendmentConfirmationMessage("sent")).toBe("Order updated and confirmation sent");
    expect(orderAmendmentConfirmationMessage("pending")).toBe("Order updated, confirmation pending");
    expect(orderAmendmentConfirmationMessage("failed")).toBe(
      "Order updated but email failed, with retry available",
    );
  });

  it("does not claim an email was sent when the amendment was not customer-facing", () => {
    expect(orderAmendmentConfirmationMessage("skipped")).toBe("Order updated");
    expect(orderAmendmentConfirmationMessage(null)).toBe("Order updated");
  });
});
