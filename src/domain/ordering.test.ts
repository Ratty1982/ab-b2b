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

  it("allows 12 but not 24 when Avail is 17", () => {
    expect(validateOrderQuantity({ requestedQuantity: 12, caseQty: 12, sellableQty: 17 }).ok).toBe(true);
    const rejected = validateOrderQuantity({ requestedQuantity: 24, caseQty: 12, sellableQty: 17 });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.message).not.toContain("17");
  });

  it("blocks ordering when Avail is below one full case", () => {
    const result = validateOrderQuantity({ requestedQuantity: 12, caseQty: 12, sellableQty: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INSUFFICIENT_FULL_CASE");
      expect(result.message).toBe("Insufficient stock for a full case");
      expect(result.message).not.toContain("10");
    }
    expect(maxOrderableQuantity({ caseQty: 12, sellableQty: 10 })).toBeNull();
  });

  it("exposes canIncrement without revealing stock", () => {
    expect(canIncrementQuantity({ currentQuantity: 12, caseQty: 12, sellableQty: 24 })).toBe(true);
    expect(canIncrementQuantity({ currentQuantity: 24, caseQty: 12, sellableQty: 24 })).toBe(false);
    expect(canDecrementQuantity({ currentQuantity: 24, caseQty: 12 })).toBe(true);
    expect(canDecrementQuantity({ currentQuantity: 12, caseQty: 12 })).toBe(false);
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
});
