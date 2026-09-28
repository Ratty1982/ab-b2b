import { describe, expect, it } from "vitest";
import { shouldPartialDespatchFrom504c } from "@/domain/backorder";
import { orderStatusLabel } from "@/domain/autopart-504c-plan";

describe("504C backorder safety", () => {
  it("does not treat known-backorder orders as fully despatchable from order-level invoice alone", () => {
    expect(
      shouldPartialDespatchFrom504c({
        items: [
          { backorderQtyAtOrder: 0 },
          { backorderQtyAtOrder: 7 },
        ],
        expectedGoodsNet: 100,
        invoiceGoods: 100,
      }),
    ).toBe(true);
  });

  it("preserves simple-order full despatch path when no backorder quantities exist", () => {
    expect(
      shouldPartialDespatchFrom504c({
        items: [{ backorderQtyAtOrder: 0 }, { backorderQtyAtOrder: 0 }],
        expectedGoodsNet: 100,
        invoiceGoods: 100,
      }),
    ).toBe(false);
  });

  it("labels PARTIALLY_DESPATCHED for staff/plan copy", () => {
    expect(orderStatusLabel("PARTIALLY_DESPATCHED")).toBe("Part Despatched");
    expect(orderStatusLabel("DISPATCHED")).toBe("Despatched");
  });
});
