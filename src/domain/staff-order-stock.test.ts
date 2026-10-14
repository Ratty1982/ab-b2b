import { describe, expect, it } from "vitest";
import { staffOrderAvailableLabel, staffOrderStockAvailability } from "@/domain/staff-order-stock";

describe("staff order sellable stock", () => {
  it("keeps sellable stock independent of the ordered quantity", () => {
    const stock = staffOrderStockAvailability({
      freeSellableQty: 200,
      stale: false,
      stockKnown: true,
    });
    expect(stock).toEqual({ sellableQty: 200, stockConfirmed: true });
    expect(staffOrderAvailableLabel(stock)).toBe("Available to order: 200 units");
  });

  it("deducts other reservations and gives an edited order its own holds back", () => {
    const otherHeld = staffOrderStockAvailability({
      freeSellableQty: 150,
      stale: false,
      stockKnown: true,
    });
    expect(otherHeld.sellableQty).toBe(150);

    const editing = staffOrderStockAvailability({
      freeSellableQty: 198,
      stale: false,
      stockKnown: true,
      ownActiveReservedQty: 2,
    });
    expect(editing.sellableQty).toBe(200);
  });

  it("labels one sellable unit in the singular", () => {
    expect(staffOrderAvailableLabel({ sellableQty: 1, stockConfirmed: true })).toBe(
      "Available to order: 1 unit",
    );
  });

  it("does not advertise stale or missing stock as available", () => {
    expect(
      staffOrderStockAvailability({ freeSellableQty: 200, stale: true, stockKnown: true }),
    ).toEqual({ sellableQty: 0, stockConfirmed: false });
    expect(
      staffOrderStockAvailability({ freeSellableQty: 0, stale: true, stockKnown: false }),
    ).toEqual({ sellableQty: 0, stockConfirmed: false });
    expect(
      staffOrderAvailableLabel({ sellableQty: 200, stockConfirmed: false }),
    ).toBe("Stock not confirmed");
  });

  it("keeps an edited order's existing hold when the feed is stale, without confirming free stock", () => {
    const stock = staffOrderStockAvailability({
      freeSellableQty: 198,
      stale: true,
      stockKnown: true,
      ownActiveReservedQty: 2,
    });
    expect(stock.sellableQty).toBe(2);
    expect(stock.stockConfirmed).toBe(false);
    expect(staffOrderAvailableLabel(stock)).toBe("Stock not confirmed");
  });
});
