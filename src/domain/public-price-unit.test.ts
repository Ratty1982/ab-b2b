import { describe, expect, it } from "vitest";
import { publicUnitPriceQualifier } from "@/domain/public-price-unit";

describe("public unit price qualifier", () => {
  it("maps EA and empty units to each, without using caseQty", () => {
    expect(publicUnitPriceQualifier("EA")).toBe("each");
    expect(publicUnitPriceQualifier("each")).toBe("each");
    expect(publicUnitPriceQualifier(null)).toBe("each");
    expect(publicUnitPriceQualifier(undefined)).toBe("each");
    expect(publicUnitPriceQualifier("PAIR")).toBe("pair");
    expect(publicUnitPriceQualifier("SET")).toBe("set");
  });
});
