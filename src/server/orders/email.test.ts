import { describe, expect, it } from "vitest";
import {
  buildOrderPartDespatchedCustomerBodies,
  buildOrderUpdatedCustomerBodies,
  type OrderEmailSnapshot,
} from "@/server/orders/email";

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

describe("order updated customer email", () => {
  it("confirms the amendment with revised quantities, prices, totals and the portal link", () => {
    const bodies = buildOrderUpdatedCustomerBodies(
      snapshot({
        status: "SUBMITTED",
        poNumber: "PO-EDIT",
        subtotal: "32.50",
        vatTotal: "6.50",
        deliveryTotal: "8.00",
        grandTotal: "47.00",
        items: [
          {
            sku: "A",
            name: "Widget A",
            qty: 5,
            customerUnitPrice: "6.50",
            lineTotal: "32.50",
            orderingMode: "UNIT",
            availableQtyAtOrder: 5,
            backorderQtyAtOrder: 0,
          },
        ],
      }),
    );
    expect(bodies.subject).toBe("Your Automotive Brands Order AB-100001 Has Been Updated");
    expect(bodies.subject).not.toContain("We've received");
    expect(bodies.text).toContain("has been amended");
    expect(bodies.text).toContain("Original order number: AB-100001");
    expect(bodies.text).toContain("Your reference: PO-EDIT");
    expect(bodies.text).toContain("Qty: 5");
    expect(bodies.text).toContain("£6.50");
    expect(bodies.text).toContain("£32.50");
    expect(bodies.text).toContain("£6.50 GBP");
    expect(bodies.text).toContain("£47.00");
    expect(bodies.text).toContain("1 High Street");
    expect(bodies.html).toContain("https://example.test/portal");
    expect(bodies.html).toContain("View your order");
    expect(bodies.text).not.toMatch(/Autopart/i);
  });

  it("shows customer collection and backordered quantities", () => {
    const bodies = buildOrderUpdatedCustomerBodies(
      snapshot({
        status: "SUBMITTED",
        fulfilmentChoice: "COLLECTION",
        deliveryAddress: null,
        deliveryTotal: "0.00",
        items: [
          {
            sku: "B",
            name: "Widget B",
            qty: 5,
            customerUnitPrice: "2.50",
            lineTotal: "12.50",
            orderingMode: "UNIT",
            availableQtyAtOrder: 2,
            backorderQtyAtOrder: 3,
          },
        ],
      }),
    );
    expect(bodies.text).toContain("CUSTOMER COLLECTION");
    expect(bodies.text).toContain("Customer Collection");
    expect(bodies.text).toContain("Delivery: £0.00");
    expect(bodies.text).not.toContain("1 High Street");
    expect(bodies.text).toContain("2 available · 3 on backorder");
    expect(bodies.text).toMatch(/SOME ITEMS ARE ON BACKORDER/);
    expect(bodies.html).toContain("3 currently on backorder");
    expect(bodies.html).toContain("Customer Collection");
  });
});
