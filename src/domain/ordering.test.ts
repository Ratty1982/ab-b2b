import { describe, expect, it } from "vitest";
import {
  assessBasketLineQuantity,
  canDecrementQuantity,
  canIncrementQuantity,
  caseCountForQuantity,
  formatCaseCountLabel,
  getMinimumOrderQuantity,
  getOrderingRules,
  maxOrderableQuantity,
  resolveCustomerOrdering,
  validateOrderQuantity,
} from "@/domain/ordering";

describe("Phase 6A case quantity enforcement", () => {
  it("accepts full case multiples for caseQty 12", () => {
    expect(validateOrderQuantity({ requestedQuantity: 12, caseQty: 12, sellableQty: 100 }).ok).toBe(true);
    expect(validateOrderQuantity({ requestedQuantity: 24, caseQty: 12, sellableQty: 100 }).ok).toBe(true);
    expect(validateOrderQuantity({ requestedQuantity: 1, caseQty: 12, sellableQty: 100 }).ok).toBe(false);
    expect(validateOrderQuantity({ requestedQuantity: 11, caseQty: 12, sellableQty: 100 }).ok).toBe(false);
    expect(validateOrderQuantity({ requestedQuantity: 13, caseQty: 12, sellableQty: 100 }).ok).toBe(false);
  });

  it("accepts unit steps when caseQty is 1", () => {
    expect(validateOrderQuantity({ requestedQuantity: 1, caseQty: 1, sellableQty: 10 }).ok).toBe(true);
    expect(validateOrderQuantity({ requestedQuantity: 2, caseQty: 1, sellableQty: 10 }).ok).toBe(true);
  });

  it("rejects missing or zero caseQty", () => {
    expect(getOrderingRules({ caseQty: null }).orderable).toBe(false);
    expect(getOrderingRules({ caseQty: 0 }).orderable).toBe(false);
    expect(validateOrderQuantity({ requestedQuantity: 1, caseQty: null, sellableQty: 100 }).ok).toBe(false);
    expect(validateOrderQuantity({ requestedQuantity: 12, caseQty: 0, sellableQty: 100 }).ok).toBe(false);
  });
});

describe("Phase 6A MOQ against case multiples", () => {
  it("raises MOQ to the next full case", () => {
    expect(getMinimumOrderQuantity({ caseQty: 12, minimumOrderQty: 20 })).toBe(24);
    expect(getMinimumOrderQuantity({ caseQty: 6, minimumOrderQty: 12 })).toBe(12);
    expect(getMinimumOrderQuantity({ caseQty: 12, minimumOrderQty: null })).toBe(12);
    expect(validateOrderQuantity({ requestedQuantity: 12, caseQty: 12, minimumOrderQty: 20, sellableQty: 100 }).ok).toBe(
      false,
    );
    expect(validateOrderQuantity({ requestedQuantity: 24, caseQty: 12, minimumOrderQty: 20, sellableQty: 100 }).ok).toBe(
      true,
    );
  });
});

describe("Phase 6A stock validation without leaking exact qty", () => {
  it("allows case multiples within Avail 36 / case 12", () => {
    const base = { caseQty: 12, sellableQty: 36 };
    expect(validateOrderQuantity({ ...base, requestedQuantity: 12 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 24 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 36 }).ok).toBe(true);
    const over = validateOrderQuantity({ ...base, requestedQuantity: 48 });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.message).not.toMatch(/36|48|17|10/);
      expect(JSON.stringify(over)).not.toMatch(/"sellableQty":\s*36/);
    }
  });

  it("allows 12 but not 17 when Avail is 17 (still has a full case)", () => {
    expect(validateOrderQuantity({ requestedQuantity: 12, caseQty: 12, sellableQty: 17 }).ok).toBe(true);
    expect(validateOrderQuantity({ requestedQuantity: 17, caseQty: 12, sellableQty: 17 }).ok).toBe(false);
    expect(validateOrderQuantity({ requestedQuantity: 13, caseQty: 12, sellableQty: 17 }).ok).toBe(false);
    const rejected = validateOrderQuantity({ requestedQuantity: 24, caseQty: 12, sellableQty: 17 });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.message).not.toContain("17");
  });

  it("exposes canIncrement without revealing stock in CASE mode", () => {
    expect(canIncrementQuantity({ currentQuantity: 12, caseQty: 12, sellableQty: 24 })).toBe(true);
    expect(canIncrementQuantity({ currentQuantity: 24, caseQty: 12, sellableQty: 24 })).toBe(false);
    expect(canDecrementQuantity({ currentQuantity: 24, caseQty: 12 })).toBe(true);
    expect(canDecrementQuantity({ currentQuantity: 12, caseQty: 12 })).toBe(false);
  });
});

describe("FINAL PART-CASE STOCK EXCEPTION", () => {
  it("stock 37: 12/24/36 valid, 37 invalid", () => {
    const base = { caseQty: 12, sellableQty: 37 };
    expect(resolveCustomerOrdering(base).mode).toBe("CASE");
    expect(validateOrderQuantity({ ...base, requestedQuantity: 12 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 24 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 36 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 37 }).ok).toBe(false);
    expect(maxOrderableQuantity(base)).toBe(36);
  });

  it("stock 17: only 12 valid — not 13–17", () => {
    const base = { caseQty: 12, sellableQty: 17 };
    expect(resolveCustomerOrdering(base).mode).toBe("CASE");
    expect(validateOrderQuantity({ ...base, requestedQuantity: 12 }).ok).toBe(true);
    for (const q of [13, 14, 15, 16, 17]) {
      expect(validateOrderQuantity({ ...base, requestedQuantity: q }).ok).toBe(false);
    }
  });

  it("stock 12: 12 valid", () => {
    expect(validateOrderQuantity({ requestedQuantity: 12, caseQty: 12, sellableQty: 12 }).ok).toBe(true);
    expect(resolveCustomerOrdering({ caseQty: 12, sellableQty: 12 }).mode).toBe("CASE");
  });

  it("stock 11: final part-case allows 1–11, rejects 12", () => {
    const base = { caseQty: 12, sellableQty: 11 };
    const state = resolveCustomerOrdering(base);
    expect(state.mode).toBe("FINAL_PART_CASE");
    expect(state.isFinalPartCase).toBe(true);
    expect(state.step).toBe(1);
    expect(state.minimumQuantity).toBe(1);
    expect(state.maximumQuantity).toBe(11);
    expect(state.defaultQuantity).toBe(11);
    expect(state.remainingSellable).toBe(11);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 1 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 7 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 11 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 12 }).ok).toBe(false);
  });

  it("stock 7: allows 1–7, rejects 8", () => {
    const base = { caseQty: 12, sellableQty: 7 };
    expect(resolveCustomerOrdering(base).mode).toBe("FINAL_PART_CASE");
    expect(maxOrderableQuantity(base)).toBe(7);
    for (let q = 1; q <= 7; q++) {
      const result = validateOrderQuantity({ ...base, requestedQuantity: q });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.isFinalPartCase).toBe(true);
        expect(result.caseCount).toBeNull();
      }
    }
    expect(validateOrderQuantity({ ...base, requestedQuantity: 8 }).ok).toBe(false);
  });

  it("stock 1: allows 1", () => {
    const result = validateOrderQuantity({ requestedQuantity: 1, caseQty: 12, sellableQty: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.isFinalPartCase).toBe(true);
  });

  it("stock 0: not orderable", () => {
    expect(resolveCustomerOrdering({ caseQty: 12, sellableQty: 0 }).mode).toBe("NOT_ORDERABLE");
    expect(validateOrderQuantity({ requestedQuantity: 1, caseQty: 12, sellableQty: 0 }).ok).toBe(false);
    expect(maxOrderableQuantity({ caseQty: 12, sellableQty: 0 })).toBeNull();
  });

  it("overrides MOQ when final stock is below one case", () => {
    const base = { caseQty: 12, minimumOrderQty: 24, sellableQty: 7 };
    const state = resolveCustomerOrdering(base);
    expect(state.mode).toBe("FINAL_PART_CASE");
    expect(state.minimumQuantity).toBe(1);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 1 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 7 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 8 }).ok).toBe(false);
  });

  it("does not use orderIncrement — step is always 1 in final mode", () => {
    const state = resolveCustomerOrdering({ caseQty: 12, sellableQty: 5 });
    expect(state.step).toBe(1);
    expect(state.step).not.toBe(12);
  });

  it("disables final-part-case when positive stock is stale", () => {
    const state = resolveCustomerOrdering({
      caseQty: 12,
      sellableQty: 7,
      orderableByStockPolicy: false,
    });
    expect(state.mode).toBe("NOT_ORDERABLE");
    expect(state.isFinalPartCase).toBe(false);
    expect(
      validateOrderQuantity({
        requestedQuantity: 7,
        caseQty: 12,
        sellableQty: 7,
        orderableByStockPolicy: false,
      }).ok,
    ).toBe(false);
  });

  it("defaults quantity to all remaining stock", () => {
    expect(resolveCustomerOrdering({ caseQty: 12, sellableQty: 7 }).defaultQuantity).toBe(7);
    expect(canDecrementQuantity({ currentQuantity: 7, caseQty: 12, sellableQty: 7 })).toBe(true);
    expect(canIncrementQuantity({ currentQuantity: 7, caseQty: 12, sellableQty: 7 })).toBe(false);
    expect(canIncrementQuantity({ currentQuantity: 5, caseQty: 12, sellableQty: 7 })).toBe(true);
  });
});

describe("case count labels", () => {
  it("formats singular and plural cases", () => {
    expect(caseCountForQuantity(12, 12)).toBe(1);
    expect(caseCountForQuantity(24, 12)).toBe(2);
    expect(formatCaseCountLabel(1)).toBe("1 case");
    expect(formatCaseCountLabel(2)).toBe("2 cases");
  });
});

describe("basket line revalidation flags", () => {
  it("flags inactive products and invalid case multiples after caseQty change", () => {
    expect(
      assessBasketLineQuantity({
        quantity: 12,
        caseQty: 12,
        sellableQty: 100,
        productActive: false,
        tradeVisible: true,
        hasTradePrice: true,
      }),
    ).toBe("PRODUCT_UNAVAILABLE");
    expect(
      assessBasketLineQuantity({
        quantity: 12,
        caseQty: 8,
        sellableQty: 100,
        productActive: true,
        tradeVisible: true,
        hasTradePrice: true,
      }),
    ).toBe("CASE_CONFIGURATION_CHANGED");
    expect(
      assessBasketLineQuantity({
        quantity: 24,
        caseQty: 12,
        sellableQty: 17,
        productActive: true,
        tradeVisible: true,
        hasTradePrice: true,
      }),
    ).toBe("QUANTITY_UNAVAILABLE");
  });

  it("accepts final-part-case basket lines", () => {
    expect(
      assessBasketLineQuantity({
        quantity: 7,
        caseQty: 12,
        sellableQty: 7,
        productActive: true,
        tradeVisible: true,
        hasTradePrice: true,
      }),
    ).toBe("VALID");
  });

  it("flags QUANTITY_UNAVAILABLE when final stock drops below basket qty", () => {
    expect(
      assessBasketLineQuantity({
        quantity: 7,
        caseQty: 12,
        sellableQty: 5,
        productActive: true,
        tradeVisible: true,
        hasTradePrice: true,
      }),
    ).toBe("QUANTITY_UNAVAILABLE");
  });

  it("flags CASE_CONFIGURATION_CHANGED when stock replenishes into normal case mode", () => {
    expect(
      assessBasketLineQuantity({
        quantity: 7,
        caseQty: 12,
        sellableQty: 20,
        productActive: true,
        tradeVisible: true,
        hasTradePrice: true,
      }),
    ).toBe("CASE_CONFIGURATION_CHANGED");
  });
});
