import { describe, expect, it } from "vitest";
import {
  companyPriceListLabel,
  DEFAULT_TRADE_PRICE_LABEL,
} from "@/domain/default-trade-price";

describe("default trade price labelling", () => {
  it("labels unassigned companies as Default Trade Price", () => {
    expect(companyPriceListLabel(null)).toBe(DEFAULT_TRADE_PRICE_LABEL);
    expect(companyPriceListLabel(undefined)).toBe(DEFAULT_TRADE_PRICE_LABEL);
    expect(companyPriceListLabel("   ")).toBe(DEFAULT_TRADE_PRICE_LABEL);
  });

  it("keeps assigned list names", () => {
    expect(companyPriceListLabel("Trade A")).toBe("Trade A");
  });
});
