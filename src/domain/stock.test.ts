import { describe, expect, it } from "vitest";
import {
  catalogueMatchSummary,
  customerAvailabilityForStock,
  describeStockQtyChange,
  getEffectiveSellableQuantity,
  getSellableQuantity,
  internalStatusFromSellable,
  isStockStale,
  sellableQuantityFromAvail,
  skuMatchKey,
  stockAttentionSummary,
  stockAvailabilityTransitionLabel,
  stockSyncOutcome,
  summariseStockQtyChanges,
} from "@/domain/stock";

describe("authoritative stock vs public availability", () => {
  it("maps Avail bands without rounding to case size", () => {
    expect(sellableQuantityFromAvail(100)).toBe(100);
    expect(sellableQuantityFromAvail(21)).toBe(21);
    expect(sellableQuantityFromAvail(20)).toBe(20);
    expect(sellableQuantityFromAvail(1)).toBe(1);
    expect(sellableQuantityFromAvail(0)).toBe(0);
    expect(sellableQuantityFromAvail(-5)).toBe(0);
    expect(getSellableQuantity({ sellableQty: 11 })).toBe(11);
    expect(getEffectiveSellableQuantity({ autopartAvail: 48, reservedQty: 24 })).toBe(24);
    expect(getEffectiveSellableQuantity({ autopartAvail: 7, reservedQty: 0 })).toBe(7);
    expect(getEffectiveSellableQuantity({ autopartAvail: 10, reservedQty: 15 })).toBe(0);
  });

  it("maps customer bands from sellable qty", () => {
    expect(customerAvailabilityForStock({ sellableQty: 100, stale: false })).toBe("in");
    expect(customerAvailabilityForStock({ sellableQty: 21, stale: false })).toBe("in");
    expect(customerAvailabilityForStock({ sellableQty: 20, stale: false })).toBe("low");
    expect(customerAvailabilityForStock({ sellableQty: 1, stale: false })).toBe("low");
    expect(customerAvailabilityForStock({ sellableQty: 0, stale: false })).toBe("out");
    expect(customerAvailabilityForStock({ sellableQty: 0, stale: false })).toBe("out");
  });

  it("maps internal status from sellable qty", () => {
    expect(internalStatusFromSellable(36)).toBe("IN_STOCK");
    expect(internalStatusFromSellable(8)).toBe("LOW");
    expect(internalStatusFromSellable(0)).toBe("OUT_OF_STOCK");
  });

  it("match keys trim and compare case-insensitively without fuzzy matching", () => {
    expect(skuMatchKey(" gc5000 ")).toBe("GC5000");
    expect(skuMatchKey("GC5000")).not.toBe(skuMatchKey("GC500"));
  });

  it("treats last success older than the threshold as stale", () => {
    const now = new Date("2026-09-21T18:00:00.000Z");
    expect(isStockStale(new Date("2026-09-20T00:00:00.000Z"), now, 36)).toBe(true);
    expect(isStockStale(new Date("2026-09-21T12:00:00.000Z"), now, 36)).toBe(false);
    expect(isStockStale(null, now, 36)).toBe(false);
  });

  it("treats valid Autopart SKUs absent from AB as SUCCESS, not PARTIAL", () => {
    expect(stockSyncOutcome({ rowsRead: 12732, invalid: 0, duplicates: 0 })).toBe("SUCCESS");
    expect(stockSyncOutcome({ rowsRead: 13200, invalid: 0, duplicates: 0 })).toBe("SUCCESS");
    expect(stockSyncOutcome({ rowsRead: 500, invalid: 1, duplicates: 0 })).toBe("PARTIAL");
    expect(stockSyncOutcome({ rowsRead: 10, invalid: 0, duplicates: 2 })).toBe("PARTIAL");
    expect(stockSyncOutcome({ rowsRead: 0, invalid: 0, duplicates: 0 })).toBe("FAILED");
    expect(stockAttentionSummary(0, 0)).toBeNull();
    expect(stockAttentionSummary(1, 0)).toBe("1 row(s) need attention");
    expect(catalogueMatchSummary({ matched: 468, unmatched: 12732, invalid: 0 })).toBe(
      "Matched AB SKUs: 468. Not in AB catalogue: 12732. Invalid: 0",
    );
  });

  it("records availability transitions from central Avail bands and skips unchanged qty", () => {
    expect(describeStockQtyChange(36, 36)).toBeNull();
    expect(describeStockQtyChange(8, 36)).toMatchObject({
      previousQty: 8,
      newQty: 36,
      delta: 28,
      previousAvailability: "low",
      newAvailability: "in",
    });
    expect(stockAvailabilityTransitionLabel("low", "in")).toBe("LOW STOCK → IN STOCK");
    expect(describeStockQtyChange(36, 20)?.newAvailability).toBe("low");
    expect(describeStockQtyChange(5, 0)?.newAvailability).toBe("out");
    expect(describeStockQtyChange(0, 50)?.newAvailability).toBe("in");
    const sameBand = describeStockQtyChange(36, 35);
    expect(sameBand).toMatchObject({ previousQty: 36, newQty: 35, previousAvailability: "in", newAvailability: "in" });
    expect(stockAvailabilityTransitionLabel("in", "in")).toBe("IN STOCK");
    expect(
      summariseStockQtyChanges([
        describeStockQtyChange(8, 36)!,
        describeStockQtyChange(36, 20)!,
        describeStockQtyChange(5, 0)!,
      ]),
    ).toEqual({
      increased: 1,
      decreased: 2,
      becameInStock: 1,
      becameLowStock: 1,
      becameOutOfStock: 1,
    });
  });
});
