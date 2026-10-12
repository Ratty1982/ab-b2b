import { describe, expect, it } from "vitest";
import {
  customerPromotionOfferLabel,
  customerPromotionValidityLabel,
  promotionVisibleToCustomer,
  type CustomerPromotionSource,
} from "@/domain/customer-promotions";
import { promotionApplies } from "@/domain/trade-price-resolution";

const at = new Date("2026-10-12T12:00:00.000Z");

function promo(partial: Partial<CustomerPromotionSource> = {}): CustomerPromotionSource {
  return {
    id: "promo-1",
    code: "TRADE10",
    name: "Trade 10",
    type: "PERCENT",
    value: "10.0000",
    startsAt: null,
    endsAt: null,
    isActive: true,
    metadata: {},
    ...partial,
  };
}

describe("customer promotion visibility", () => {
  it("shows an active in-window percent or fixed promotion", () => {
    expect(promotionVisibleToCustomer(promo(), at)).toBe(true);
    expect(promotionVisibleToCustomer(promo({ type: "FIXED", value: "1.5000" }), at)).toBe(true);
  });

  it("hides quantity deals, disabled rows, and dates outside the engine window", () => {
    expect(promotionVisibleToCustomer(promo({ type: "QUANTITY_DEAL" }), at)).toBe(false);
    expect(promotionVisibleToCustomer(promo({ isActive: false }), at)).toBe(false);
    expect(
      promotionVisibleToCustomer(promo({ startsAt: new Date("2026-10-13T00:00:00.000Z") }), at),
    ).toBe(false);
    expect(
      promotionVisibleToCustomer(promo({ endsAt: new Date("2026-10-11T00:00:00.000Z") }), at),
    ).toBe(false);
  });

  it("uses the same catalogue eligibility as the pricing engine", () => {
    const row = promo({ metadata: { skus: ["PM-1"] } });
    expect(promotionVisibleToCustomer(row, at)).toBe(
      promotionApplies(
        {
          id: row.id,
          code: row.code,
          name: row.name,
          type: row.type,
          value: row.value,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          isActive: row.isActive,
          variantIds: null,
          skus: null,
        },
        { variantId: "v", sku: "PM-1", at },
      ),
    );
  });

  it("formats the stored offer without inventing a unit price", () => {
    expect(customerPromotionOfferLabel("PERCENT", "10.0000")).toBe("10% off");
    expect(customerPromotionOfferLabel("PERCENT", "12.5000")).toBe("12.5% off");
    expect(customerPromotionOfferLabel("PERCENT", "12.1250")).toBe("12.125% off");
    expect(customerPromotionOfferLabel("FIXED", "1.5000")).toBe("£1.50 off each unit");
    expect(customerPromotionValidityLabel(null, null)).toBe("Open ended");
  });
});
