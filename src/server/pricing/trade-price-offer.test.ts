import { describe, expect, it } from "vitest";
import { resolveTradePriceFromFacts } from "@/domain/trade-price-resolution";
import { toDisplayPrice } from "@/server/pricing/trade-price";

const at = new Date("2026-09-15T12:00:00.000Z");

describe("customer promotion badge", () => {
  it("exposes the applied offer name and hides it when the viewer cannot see trade prices", () => {
    const resolved = resolveTradePriceFromFacts({
      variantId: "v1",
      sku: "PM-1",
      baseTradePrice: "10.0000",
      vatCode: "STANDARD",
      quantity: 1,
      at,
      company: null,
      customerPrice: null,
      priceListItem: null,
      quantityBreaks: [],
      promotions: [
        {
          id: "p1",
          code: "TRADE10",
          name: "Trade 10",
          type: "PERCENT",
          value: "10",
          startsAt: null,
          endsAt: null,
          isActive: true,
          variantIds: null,
          skus: null,
        },
      ],
    });
    expect(toDisplayPrice({ viewer: { kind: "trade", canViewPricing: true }, rrp: "20", resolution: resolved }).offer).toEqual({
      code: "TRADE10",
      name: "Trade 10",
    });
    expect(
      toDisplayPrice({ viewer: { kind: "anonymous" }, rrp: "20", resolution: resolved }).offer,
    ).toBeNull();
    expect(
      toDisplayPrice({ viewer: { kind: "anonymous" }, rrp: "20", resolution: resolved }).trade,
    ).toBeNull();
  });
});
