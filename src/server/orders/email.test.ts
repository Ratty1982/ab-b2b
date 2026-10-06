import { describe, expect, it } from "vitest";
import { buildOrderPartDespatchedCustomerBodies, type OrderEmailSnapshot } from "@/server/orders/email";

function snapshot(overrides: Partial<OrderEmailSnapshot> = {}): OrderEmailSnapshot {
  return {
    orderId: "ord-1",
    orderNumber: "AB-100001",
    companyName: "Test Co",
    status: "PARTIALLY_DESPATCHED",
    poNumber: "PO-1",
    currency: "GBP",
    subtotal: "20.00",
    vatTotal: "4.00",
    deliveryTotal: "0.00",
    grandTotal: "24.00",
    placedAt: new Date("2026-10-01T12:00:00.000Z"),
    paymentTerms: "30 Days",
    deliveryInstructions: null,
    deliveryAddress: {
      line1: "1 High Street",
      line2: null,
      town: "Leeds",
      county: null,
      postcode: "LS1 1AA",
      country: "GB",
    },
    contact: { name: "Alex Buyer", email: "alex@example.test", phone: null },
    items: [
      {
        sku: "A",
        name: "Widget A",
        qty: 10,
        customerUnitPrice: "1.00",
        lineTotal: "10.00",
        orderingMode: null,
        availableQtyAtOrder: 10,
        backorderQtyAtOrder: 0,
        despatchedQty: 6,
      },
      {
        sku: "B",
        name: "Widget B",
        qty: 4,
        customerUnitPrice: "2.50",
        lineTotal: "10.00",
        orderingMode: null,
        availableQtyAtOrder: 0,
        backorderQtyAtOrder: 4,
        despatchedQty: 0,
      },
    ],
    autopartAccountLinked: true,
    autopartCustomerCodeSnapshot: "TEST01",
    salesRepNameSnapshot: null,
    salesRepCodeSnapshot: null,
    sourceQuoteNumber: null,
    portalOrderUrl: "https://example.test/portal",
    adminOrderUrl: "https://example.test/admin",
    ...overrides,
  };
}

describe("part-despatch email quantities", () => {
  it("uses authoritative 504/TRM despatchedQty when line quantities are known", () => {
    const bodies = buildOrderPartDespatchedCustomerBodies(snapshot(), { lineQuantitiesKnown: true });
    expect(bodies.text).toContain("6 × Widget A");
    expect(bodies.text).toContain("4 × Widget A");
    expect(bodies.text).toContain("4 × Widget B");
    expect(bodies.text).not.toMatch(/Exact item quantities will appear/);
  });

  it("does not invent SKU quantities when 504C line detail is unknown", () => {
    const bodies = buildOrderPartDespatchedCustomerBodies(snapshot(), { lineQuantitiesKnown: false });
    expect(bodies.text).toMatch(/Exact item quantities will appear/);
    expect(bodies.text).toContain("4 × Widget B");
    expect(bodies.text).not.toContain("6 × Widget A");
  });
});
