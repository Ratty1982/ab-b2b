import { describe, expect, it } from "vitest";
import {
  classifySalesRepNotificationCandidate,
  mergeOrderInternalNotificationRecipients,
  normalizeOrderNotificationEmail,
  orderPlacedByLabel,
  orderReceivedInternalIdempotencyKey,
  orderReceivedInternalRecipientIdempotencyKey,
  orderReceivedInternalSalesRepIdempotencyKey,
} from "@/domain/order-sales-rep-notification";
import { buildOrderReceivedInternalBodies, type OrderEmailSnapshot } from "@/server/orders/email";

function snapshot(overrides: Partial<OrderEmailSnapshot> = {}): OrderEmailSnapshot {
  return {
    orderId: "ord-1",
    orderNumber: "AB-200001",
    companyName: "York Motor Factors",
    status: "SUBMITTED",
    poNumber: "PO-9",
    currency: "GBP",
    subtotal: "100.00",
    vatTotal: "20.00",
    deliveryTotal: "0.00",
    grandTotal: "120.00",
    placedAt: new Date("2026-11-10T14:30:00.000Z"),
    paymentTerms: "30 Days",
    deliveryInstructions: null,
    deliveryAddress: {
      line1: "1 High Street",
      line2: null,
      town: "York",
      county: null,
      postcode: "YO1 1AA",
      country: "GB",
    },
    contact: { name: "Alex Buyer", email: "alex@example.invalid", phone: "01904 000000" },
    items: [
      {
        sku: "SKU-1",
        name: "Brake Cleaner",
        qty: 4,
        customerUnitPrice: "25.00",
        lineTotal: "100.00",
        orderingMode: null,
        availableQtyAtOrder: 4,
        backorderQtyAtOrder: 0,
      },
    ],
    autopartAccountLinked: true,
    autopartCustomerCodeSnapshot: "YORK01",
    salesRepNameSnapshot: "Luke Andrews",
    salesRepCodeSnapshot: "LA01",
    sourceQuoteNumber: null,
    fulfilmentChoice: "DELIVERY",
    placedByStaffName: null,
    placedByStaffUserId: null,
    portalOrderUrl: "https://example.test/portal/orders/ord-1",
    adminOrderUrl: "https://example.test/admin/orders/ord-1",
    ...overrides,
  };
}

describe("order sales rep notification helpers", () => {
  it("normalises and validates emails", () => {
    expect(normalizeOrderNotificationEmail("  Ops@Example.COM ")).toBe("ops@example.com");
    expect(normalizeOrderNotificationEmail("not-an-email")).toBeNull();
  });

  it("deduplicates configured recipients with the sales rep", () => {
    expect(
      mergeOrderInternalNotificationRecipients(
        ["ops@example.com", "Ops@Example.com", "desk@example.com"],
        "OPS@example.com",
      ),
    ).toEqual(["ops@example.com", "desk@example.com"]);

    expect(
      mergeOrderInternalNotificationRecipients(["ops@example.com"], "rep@example.com"),
    ).toEqual(["ops@example.com", "rep@example.com"]);

    expect(mergeOrderInternalNotificationRecipients([], "rep@example.com")).toEqual([
      "rep@example.com",
    ]);
  });

  it("builds per-order per-recipient idempotency keys", () => {
    expect(orderReceivedInternalIdempotencyKey("ord-1", "Rep@Example.com")).toBe(
      "ORDER_RECEIVED_INTERNAL:ord-1:rep@example.com",
    );
    expect(orderReceivedInternalSalesRepIdempotencyKey("ord-1")).toBe(
      "ORDER_RECEIVED_INTERNAL_SALES_REP:ord-1",
    );
    expect(
      orderReceivedInternalRecipientIdempotencyKey({
        orderId: "ord-1",
        toEmail: "Rep@Example.com",
        salesRepEmail: "rep@example.com",
      }),
    ).toBe("ORDER_RECEIVED_INTERNAL_SALES_REP:ord-1");
    expect(
      orderReceivedInternalRecipientIdempotencyKey({
        orderId: "ord-1",
        toEmail: "ops@example.com",
        salesRepEmail: "rep@example.com",
      }),
    ).toBe("ORDER_RECEIVED_INTERNAL:ord-1:ops@example.com");
  });

  it("labels customer vs internal staff placement", () => {
    expect(orderPlacedByLabel({ placedByStaffName: null })).toBe("Customer (B2B portal)");
    expect(orderPlacedByLabel({ placedByStaffName: "Sam Seller" })).toBe(
      "Internal staff (Sam Seller)",
    );
  });

  it("classifies active reps with usable email", () => {
    const ok = classifySalesRepNotificationCandidate({
      salesRepIdSnapshot: "rep-1",
      salesRep: {
        id: "rep-1",
        active: true,
        displayName: "Luke Andrews",
        businessEmail: "Luke@AutomotiveBrands.example",
        user: { name: "Luke", email: "luke.user@example.invalid", status: "ACTIVE" },
      },
    });
    expect(ok).toEqual({
      ok: true,
      email: "luke@automotivebrands.example",
      salesRepId: "rep-1",
      displayName: "Luke Andrews",
    });
  });

  it("skips inactive reps, inactive users, missing snapshot, and unusable email", () => {
    expect(
      classifySalesRepNotificationCandidate({
        salesRepIdSnapshot: null,
        salesRep: null,
      }).ok,
    ).toBe(false);

    expect(
      classifySalesRepNotificationCandidate({
        salesRepIdSnapshot: "rep-1",
        salesRep: {
          id: "rep-1",
          active: false,
          displayName: "Inactive",
          businessEmail: "rep@example.com",
          user: { name: "Inactive", email: "rep@example.com", status: "ACTIVE" },
        },
      }),
    ).toMatchObject({ ok: false, reason: "sales_rep_inactive" });

    expect(
      classifySalesRepNotificationCandidate({
        salesRepIdSnapshot: "rep-1",
        salesRep: {
          id: "rep-1",
          active: true,
          displayName: "Locked",
          businessEmail: "rep@example.com",
          user: { name: "Locked", email: "rep@example.com", status: "DISABLED" },
        },
      }),
    ).toMatchObject({ ok: false, reason: "user_inactive" });

    expect(
      classifySalesRepNotificationCandidate({
        salesRepIdSnapshot: "rep-1",
        salesRep: {
          id: "rep-1",
          active: true,
          displayName: "No Mail",
          businessEmail: "bad",
          user: { name: "No Mail", email: "also-bad", status: "ACTIVE" },
        },
      }),
    ).toMatchObject({ ok: false, reason: "email_unusable" });
  });
});

describe("order received internal email content", () => {
  it("uses the required subject and RECEIVED/SUBMITTED wording with staff view URL", () => {
    const bodies = buildOrderReceivedInternalBodies(snapshot());
    expect(bodies.subject).toBe("New Customer Order - York Motor Factors - AB-200001");
    expect(bodies.text).toContain("RECEIVED / SUBMITTED");
    expect(bodies.text).toContain("Customer (B2B portal)");
    expect(bodies.text).toContain("Autopart account: YORK01");
    expect(bodies.text).toContain("Assigned sales representative: Luke Andrews (LA01)");
    expect(bodies.text).toContain("VIEW ORDER: https://example.test/admin/orders/ord-1");
    expect(bodies.text).not.toMatch(/despatched successfully/i);
    expect(bodies.html).toContain("View order");
    expect(bodies.html).toContain("/admin/orders/ord-1");
    expect(bodies.html).not.toContain("/portal/orders/");
  });

  it("labels staff-placed orders and backorder detail", () => {
    const bodies = buildOrderReceivedInternalBodies(
      snapshot({
        placedByStaffName: "Alex Morgan",
        placedByStaffUserId: "staff-1",
        items: [
          {
            sku: "SKU-BO",
            name: "Backorder Item",
            qty: 10,
            customerUnitPrice: "10.00",
            lineTotal: "100.00",
            orderingMode: null,
            availableQtyAtOrder: 2,
            backorderQtyAtOrder: 8,
          },
        ],
      }),
    );
    expect(bodies.text).toContain("Internal staff (Alex Morgan)");
    expect(bodies.text).toMatch(/Backorder: one or more lines/i);
    expect(bodies.html).toContain("Backorder lines present");
  });
});
