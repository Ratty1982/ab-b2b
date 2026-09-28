import { describe, expect, it } from "vitest";
import {
  backorderUnitsLabel,
  presentCustomerLineFulfilment,
  summariseCustomerOrderFulfilment,
} from "@/domain/customer-fulfilment";

describe("presentCustomerLineFulfilment", () => {
  it("shows part backorder at placement", () => {
    const line = presentCustomerLineFulfilment({
      qty: 12,
      availableQtyAtOrder: 5,
      backorderQtyAtOrder: 7,
    });
    expect(line.lineStatus).toBe("PART_BACKORDERED");
    expect(line.allocatedAtOrder).toBe(5);
    expect(line.outstandingBackorderQty).toBe(7);
    expect(line.despatchedQty).toBeNull();
  });

  it("shows full backorder at placement", () => {
    const line = presentCustomerLineFulfilment({
      qty: 24,
      availableQtyAtOrder: 0,
      backorderQtyAtOrder: 24,
    });
    expect(line.lineStatus).toBe("BACKORDERED");
    expect(line.outstandingBackorderQty).toBe(24);
  });

  it("shows part despatch from authoritative line qty", () => {
    const line = presentCustomerLineFulfilment({
      qty: 12,
      availableQtyAtOrder: 0,
      backorderQtyAtOrder: 12,
      despatchedQty: 5,
    });
    expect(line.lineStatus).toBe("PART_DESPATCHED");
    expect(line.despatchedQty).toBe(5);
    expect(line.outstandingBackorderQty).toBe(7);
    expect(line.despatchQuantitiesKnown).toBe(true);
  });

  it("does not invent despatched qty on order-level part despatch", () => {
    const line = presentCustomerLineFulfilment({
      qty: 12,
      availableQtyAtOrder: 5,
      backorderQtyAtOrder: 7,
      orderPartDespatchedWithoutLineQty: true,
    });
    expect(line.lineStatus).toBe("PART_DESPATCHED");
    expect(line.despatchedQty).toBeNull();
    expect(line.outstandingBackorderQty).toBeNull();
    expect(line.limitation).toBeTruthy();
  });

  it("marks fully despatched orders complete", () => {
    const line = presentCustomerLineFulfilment({
      qty: 12,
      availableQtyAtOrder: 5,
      backorderQtyAtOrder: 7,
      orderFullyDespatched: true,
    });
    expect(line.lineStatus).toBe("DESPATCHED");
    expect(line.despatchedQty).toBe(12);
    expect(line.outstandingBackorderQty).toBe(0);
  });
});

describe("summariseCustomerOrderFulfilment", () => {
  it("labels processing with outstanding backorder", () => {
    const summary = summariseCustomerOrderFulfilment({
      status: "CONFIRMED",
      items: [
        { qty: 12, availableQtyAtOrder: 5, backorderQtyAtOrder: 7, despatchedQty: 0 },
      ],
    });
    expect(summary.orderStatusBadge).toBe("PART_BACKORDERED");
    expect(summary.hasOutstandingBackorder).toBe(true);
    expect(summary.outstandingBackorderUnits).toBe(7);
  });

  it("labels mixed split fulfilment as part despatched", () => {
    const summary = summariseCustomerOrderFulfilment({
      status: "PARTIALLY_DESPATCHED",
      items: [
        { qty: 12, availableQtyAtOrder: 12, backorderQtyAtOrder: 0, despatchedQty: 12 },
        { qty: 24, availableQtyAtOrder: 12, backorderQtyAtOrder: 12, despatchedQty: 12 },
        { qty: 6, availableQtyAtOrder: 0, backorderQtyAtOrder: 6, despatchedQty: 0 },
      ],
    });
    expect(summary.orderStatusBadge).toBe("PART_DESPATCHED");
    expect(summary.hasOutstandingBackorder).toBe(true);
  });
});

describe("backorderUnitsLabel", () => {
  it("formats unit copy", () => {
    expect(backorderUnitsLabel(1)).toBe("1 item on backorder");
    expect(backorderUnitsLabel(7)).toBe("7 items on backorder");
    expect(backorderUnitsLabel(0)).toBe("");
  });
});
