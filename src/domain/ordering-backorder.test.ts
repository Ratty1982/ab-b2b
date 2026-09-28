import { describe, expect, it } from "vitest";
import {
  assessBasketLineQuantity,
  canIncrementQuantity,
  isOrderableByStockPolicy,
  maxOrderableQuantity,
  resolveCustomerOrdering,
  validateOrderQuantity,
} from "@/domain/ordering";
import { allocateOrderLineQuantities } from "@/domain/backorder";
import {
  publicAvailabilityForOrderLine,
  publicAvailabilityFromStock,
} from "@/domain/availability";

describe("backorder policy — product defaults", () => {
  it("DENY is the conservative default (omit policy)", () => {
    expect(resolveCustomerOrdering({ caseQty: 12, sellableQty: 0 }).mode).toBe("NOT_ORDERABLE");
    expect(
      validateOrderQuantity({ requestedQuantity: 12, caseQty: 12, sellableQty: 0 }).ok,
    ).toBe(false);
  });

  it("ALLOW enables zero-stock case ordering", () => {
    const state = resolveCustomerOrdering({
      caseQty: 12,
      sellableQty: 0,
      backorderPolicy: "ALLOW",
    });
    expect(state.mode).toBe("CASE");
    expect(state.backordersAllowed).toBe(true);
    expect(state.maximumQuantity).toBeNull();
    expect(
      validateOrderQuantity({
        requestedQuantity: 12,
        caseQty: 12,
        sellableQty: 0,
        backorderPolicy: "ALLOW",
      }).ok,
    ).toBe(true);
  });

  it("DENY blocks zero stock and oversell", () => {
    expect(
      validateOrderQuantity({
        requestedQuantity: 12,
        caseQty: 12,
        sellableQty: 0,
        backorderPolicy: "DENY",
      }).ok,
    ).toBe(false);
    expect(
      validateOrderQuantity({
        requestedQuantity: 12,
        caseQty: 12,
        sellableQty: 5,
        backorderPolicy: "DENY",
      }).ok,
    ).toBe(false);
  });
});

describe("backorder ordering scenarios", () => {
  it("available 12 / order 12", () => {
    const v = validateOrderQuantity({
      requestedQuantity: 12,
      caseQty: 12,
      sellableQty: 12,
      backorderPolicy: "ALLOW",
    });
    expect(v.ok).toBe(true);
    expect(allocateOrderLineQuantities({ orderedQty: 12, sellableQty: 12 }).backorderQtyAtOrder).toBe(0);
  });

  it("available 5 / order 12 / ALLOW", () => {
    const v = validateOrderQuantity({
      requestedQuantity: 12,
      caseQty: 12,
      sellableQty: 5,
      backorderPolicy: "ALLOW",
    });
    expect(v.ok).toBe(true);
    const split = allocateOrderLineQuantities({ orderedQty: 12, sellableQty: 5 });
    expect(split).toMatchObject({ availableQtyAtOrder: 5, backorderQtyAtOrder: 7, reserveQty: 5 });
  });

  it("available 0 / order 12 / ALLOW", () => {
    expect(
      validateOrderQuantity({
        requestedQuantity: 12,
        caseQty: 12,
        sellableQty: 0,
        backorderPolicy: "ALLOW",
      }).ok,
    ).toBe(true);
    expect(allocateOrderLineQuantities({ orderedQty: 12, sellableQty: 0 })).toMatchObject({
      reserveQty: 0,
      backorderQtyAtOrder: 12,
    });
  });

  it("available 5 / order 12 / DENY", () => {
    expect(
      validateOrderQuantity({
        requestedQuantity: 12,
        caseQty: 12,
        sellableQty: 5,
        backorderPolicy: "DENY",
      }).ok,
    ).toBe(false);
  });

  it("caseQty 12 — invalid pack quantities still rejected under ALLOW", () => {
    const base = { caseQty: 12, sellableQty: 0, backorderPolicy: "ALLOW" as const };
    expect(validateOrderQuantity({ ...base, requestedQuantity: 1 }).ok).toBe(false);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 5 }).ok).toBe(false);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 13 }).ok).toBe(false);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 24 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 36 }).ok).toBe(true);
  });

  it("final-part-case preserved with ALLOW — 1..sellable OR case multiples", () => {
    const base = { caseQty: 12, sellableQty: 5, backorderPolicy: "ALLOW" as const };
    const state = resolveCustomerOrdering(base);
    expect(state.isFinalPartCase).toBe(true);
    expect(state.backordersAllowed).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 3 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 5 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 6 }).ok).toBe(false);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 12 }).ok).toBe(true);
    const split = allocateOrderLineQuantities({ orderedQty: 12, sellableQty: 5 });
    expect(split.availableQtyAtOrder).toBe(5);
    expect(split.backorderQtyAtOrder).toBe(7);
  });

  it("basket revalidation — stock drop with ALLOW stays VALID", () => {
    expect(
      assessBasketLineQuantity({
        quantity: 12,
        caseQty: 12,
        sellableQty: 6,
        productActive: true,
        tradeVisible: true,
        hasTradePrice: true,
        backorderPolicy: "ALLOW",
      }),
    ).toBe("VALID");
  });

  it("basket revalidation — stock drop with DENY flags QUANTITY_UNAVAILABLE", () => {
    expect(
      assessBasketLineQuantity({
        quantity: 12,
        caseQty: 12,
        sellableQty: 6,
        productActive: true,
        tradeVisible: true,
        hasTradePrice: true,
        backorderPolicy: "DENY",
      }),
    ).toBe("QUANTITY_UNAVAILABLE");
  });

  it("stock policy — zero stock orderable only when ALLOW", () => {
    const stock = { sellableQty: 0, stale: false, availability: "out" as const };
    expect(isOrderableByStockPolicy(stock, "DENY")).toBe(false);
    expect(isOrderableByStockPolicy(stock, "ALLOW")).toBe(true);
    expect(isOrderableByStockPolicy({ sellableQty: 10, stale: true, availability: null }, "ALLOW")).toBe(
      false,
    );
  });

  it("canIncrement without stock cap when ALLOW", () => {
    expect(
      canIncrementQuantity({
        currentQuantity: 12,
        caseQty: 12,
        sellableQty: 12,
        backorderPolicy: "ALLOW",
      }),
    ).toBe(true);
    expect(maxOrderableQuantity({ caseQty: 12, sellableQty: 12, backorderPolicy: "ALLOW" })).toBeNull();
  });
});

describe("availability bands with backorder", () => {
  it("zero stock + ALLOW → backorder, not out", () => {
    expect(
      publicAvailabilityFromStock({
        sellableQty: 0,
        stale: false,
        unknown: false,
        backorderAllowed: true,
      }),
    ).toBe("backorder");
    expect(
      publicAvailabilityFromStock({
        sellableQty: 0,
        stale: false,
        unknown: false,
        backorderAllowed: false,
      }),
    ).toBe("out");
  });

  it("partial line availability when ordered exceeds sellable", () => {
    expect(
      publicAvailabilityForOrderLine({
        sellableQty: 5,
        orderedQty: 12,
        backorderAllowed: true,
      }),
    ).toBe("partial");
    expect(
      publicAvailabilityForOrderLine({
        sellableQty: 0,
        orderedQty: 12,
        backorderAllowed: true,
      }),
    ).toBe("backorder");
  });
});
