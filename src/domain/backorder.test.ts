import { describe, expect, it } from "vitest";
import {
  allocateOrderLineQuantities,
  DEFAULT_GLOBAL_BACKORDER_POLICY,
  isEffectiveBackorderAllowed,
  orderContainsBackorder,
  orderIsFullyBackordered,
  presentLineBackorder,
  presentOrderItemBackorder,
  shouldPartialDespatchFrom504c,
} from "@/domain/backorder";

describe("backorder policy defaults", () => {
  it("global default is ALLOW; effective helper only accepts ALLOW|DENY", () => {
    expect(DEFAULT_GLOBAL_BACKORDER_POLICY).toBe("ALLOW");
    expect(isEffectiveBackorderAllowed("DENY")).toBe(false);
    expect(isEffectiveBackorderAllowed(null)).toBe(false);
    expect(isEffectiveBackorderAllowed(undefined)).toBe(false);
    expect(isEffectiveBackorderAllowed("ALLOW")).toBe(true);
  });
});

describe("allocateOrderLineQuantities", () => {
  it("available 12 / order 12 → no backorder", () => {
    expect(allocateOrderLineQuantities({ orderedQty: 12, sellableQty: 12 })).toEqual({
      orderedQty: 12,
      availableQtyAtOrder: 12,
      backorderQtyAtOrder: 0,
      reserveQty: 12,
    });
  });

  it("available 5 / order 12 → reserve 5 backorder 7", () => {
    expect(allocateOrderLineQuantities({ orderedQty: 12, sellableQty: 5 })).toEqual({
      orderedQty: 12,
      availableQtyAtOrder: 5,
      backorderQtyAtOrder: 7,
      reserveQty: 5,
    });
  });

  it("available 0 / order 12 → reserve 0 backorder 12", () => {
    expect(allocateOrderLineQuantities({ orderedQty: 12, sellableQty: 0 })).toEqual({
      orderedQty: 12,
      availableQtyAtOrder: 0,
      backorderQtyAtOrder: 12,
      reserveQty: 0,
    });
  });

  it("never reserves more than sellable", () => {
    const split = allocateOrderLineQuantities({ orderedQty: 100, sellableQty: 3 });
    expect(split.reserveQty).toBe(3);
    expect(split.reserveQty + split.backorderQtyAtOrder).toBe(100);
  });
});

describe("presentation helpers", () => {
  it("flags partial and full backorder", () => {
    expect(presentLineBackorder({ orderedQty: 12, sellableQty: 5 })).toMatchObject({
      hasBackorder: true,
      partiallyBackordered: true,
      fullyBackordered: false,
      backorderQty: 7,
    });
    expect(presentLineBackorder({ orderedQty: 12, sellableQty: 0 })).toMatchObject({
      fullyBackordered: true,
      backorderQty: 12,
    });
  });

  it("reads historical OrderItem snapshots", () => {
    expect(
      presentOrderItemBackorder({ qty: 12, availableQtyAtOrder: 5, backorderQtyAtOrder: 7 }),
    ).toMatchObject({ availableQty: 5, backorderQty: 7, partiallyBackordered: true });
  });

  it("detects order-level backorder flags", () => {
    expect(orderContainsBackorder([{ backorderQtyAtOrder: 0 }, { backorderQtyAtOrder: 3 }])).toBe(true);
    expect(orderContainsBackorder([{ backorderQtyAtOrder: 0 }])).toBe(false);
    expect(
      orderIsFullyBackordered([
        { qty: 12, availableQtyAtOrder: 0, backorderQtyAtOrder: 12 },
        { qty: 6, availableQtyAtOrder: 0, backorderQtyAtOrder: 6 },
      ]),
    ).toBe(true);
    expect(
      orderIsFullyBackordered([
        { qty: 12, availableQtyAtOrder: 5, backorderQtyAtOrder: 7 },
        { qty: 6, availableQtyAtOrder: 0, backorderQtyAtOrder: 6 },
      ]),
    ).toBe(false);
  });
});

describe("504C partial despatch safety", () => {
  it("never fully despatches when known backorder quantities remain", () => {
    expect(
      shouldPartialDespatchFrom504c({
        items: [{ backorderQtyAtOrder: 7 }],
        expectedGoodsNet: 100,
        invoiceGoods: 100,
      }),
    ).toBe(true);
    expect(
      shouldPartialDespatchFrom504c({
        items: [{ backorderQtyAtOrder: 7 }],
        expectedGoodsNet: 100,
        invoiceGoods: 40,
      }),
    ).toBe(true);
    expect(
      shouldPartialDespatchFrom504c({
        items: [{ backorderQtyAtOrder: 0 }],
        expectedGoodsNet: 100,
        invoiceGoods: 100,
      }),
    ).toBe(false);
  });
});
