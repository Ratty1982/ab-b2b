import { describe, expect, it } from "vitest";
import {
  exactSkuMatchFilter,
  normaliseProductSearchQuery,
  preferExactSkuRows,
} from "@/domain/product-search-exact";

describe("product search exact SKU", () => {
  it("normalises case and whitespace", () => {
    expect(normaliseProductSearchQuery("  ss  ")).toBe("ss");
    expect(exactSkuMatchFilter(" SS ")?.equals).toBe("SS");
  });

  it("prefers exact rows when present", () => {
    const exact = [{ sku: "SS" }];
    const fallback = [{ sku: "SS-KIT" }, { sku: "BOSS" }];
    expect(preferExactSkuRows("ss", exact, fallback)).toEqual(exact);
    expect(preferExactSkuRows("ss", [], fallback)).toEqual(fallback);
  });
});
