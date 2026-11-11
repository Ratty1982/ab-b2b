import { describe, expect, it } from "vitest";
import {
  isBackInStockEventStillInStock,
  isBackInStockTransition,
} from "@/domain/stock-back-in-stock";

const activeProduct = {
  productIsActive: true,
  productIsTradeVisible: true,
  productStatus: "ACTIVE",
} as const;

describe("back-in-stock transition detection", () => {
  it("records 0→10 when prior Inventory confirmed zero", () => {
    expect(
      isBackInStockTransition({
        hasPriorInventory: true,
        previousQtyOnHand: 0,
        newQtyOnHand: 10,
        ...activeProduct,
      }),
    ).toBe(true);
  });

  it("does not record 10→20 (already in stock)", () => {
    expect(
      isBackInStockTransition({
        hasPriorInventory: true,
        previousQtyOnHand: 10,
        newQtyOnHand: 20,
        ...activeProduct,
      }),
    ).toBe(false);
  });

  it("does not treat UNKNOWN / first confirmation as back in stock", () => {
    expect(
      isBackInStockTransition({
        hasPriorInventory: false,
        previousQtyOnHand: 0,
        newQtyOnHand: 10,
        ...activeProduct,
      }),
    ).toBe(false);
  });

  it("records a new event on 10→0→5 (zero then return)", () => {
    expect(
      isBackInStockTransition({
        hasPriorInventory: true,
        previousQtyOnHand: 0,
        newQtyOnHand: 5,
        ...activeProduct,
      }),
    ).toBe(true);
  });

  it("rejects inactive / non-trade-visible / non-ACTIVE products", () => {
    expect(
      isBackInStockTransition({
        hasPriorInventory: true,
        previousQtyOnHand: 0,
        newQtyOnHand: 8,
        productIsActive: false,
        productIsTradeVisible: true,
        productStatus: "ACTIVE",
      }),
    ).toBe(false);
    expect(
      isBackInStockTransition({
        hasPriorInventory: true,
        previousQtyOnHand: 0,
        newQtyOnHand: 8,
        productIsActive: true,
        productIsTradeVisible: false,
        productStatus: "ACTIVE",
      }),
    ).toBe(false);
    expect(
      isBackInStockTransition({
        hasPriorInventory: true,
        previousQtyOnHand: 0,
        newQtyOnHand: 8,
        productIsActive: true,
        productIsTradeVisible: true,
        productStatus: "DRAFT",
      }),
    ).toBe(false);
  });

  it("rejects non-positive new qty and non-zero previous", () => {
    expect(
      isBackInStockTransition({
        hasPriorInventory: true,
        previousQtyOnHand: 0,
        newQtyOnHand: 0,
        ...activeProduct,
      }),
    ).toBe(false);
    expect(
      isBackInStockTransition({
        hasPriorInventory: true,
        previousQtyOnHand: 1,
        newQtyOnHand: 5,
        ...activeProduct,
      }),
    ).toBe(false);
  });
});

describe("back-in-stock display eligibility", () => {
  it("requires confirmed positive current Autopart Avail and active trade product", () => {
    expect(
      isBackInStockEventStillInStock({
        hasInventoryRow: true,
        currentQtyOnHand: 12,
        stale: false,
        ...activeProduct,
      }),
    ).toBe(true);
    expect(
      isBackInStockEventStillInStock({
        hasInventoryRow: true,
        currentQtyOnHand: 0,
        stale: false,
        ...activeProduct,
      }),
    ).toBe(false);
    expect(
      isBackInStockEventStillInStock({
        hasInventoryRow: true,
        currentQtyOnHand: 12,
        stale: true,
        ...activeProduct,
      }),
    ).toBe(false);
    expect(
      isBackInStockEventStillInStock({
        hasInventoryRow: false,
        currentQtyOnHand: 12,
        stale: false,
        ...activeProduct,
      }),
    ).toBe(false);
  });
});
