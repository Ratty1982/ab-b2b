import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FreeDeliveryProgress } from "@/components/ab/FreeDeliveryProgress";

describe("FreeDeliveryProgress", () => {
  it("renders spend message and progress for £44.28 goods", () => {
    const html = renderToStaticMarkup(
      createElement(FreeDeliveryProgress, {
        freeDelivery: false,
        goodsNetDisplay: "44.28",
        thresholdExVatDisplay: "150.00",
        amountToFreeDeliveryDisplay: "105.72",
        progressPercent: 29.52,
      }),
    );
    expect(html).toContain("Free delivery");
    expect(html).toContain("Spend £105.72 more to unlock");
    expect(html).toContain("FREE DELIVERY");
    expect(html).toContain("£44.28 of £150.00");
    expect(html).toContain('aria-valuenow="30"');
    expect(html).toContain("width:29.52%");
    expect(html).not.toContain("Add £");
    expect(html).not.toContain("Buy ");
  });

  it("renders unlocked state at/above threshold", () => {
    const html = renderToStaticMarkup(
      createElement(FreeDeliveryProgress, {
        freeDelivery: true,
        goodsNetDisplay: "150.00",
        thresholdExVatDisplay: "150.00",
        amountToFreeDeliveryDisplay: null,
        progressPercent: 100,
      }),
    );
    expect(html).toContain("Free delivery unlocked");
    expect(html).toContain("Your order qualifies for free delivery");
    expect(html).toContain("£150.00+ qualifying spend");
    expect(html).toContain('data-free-delivery="unlocked"');
    expect(html).toContain("width:100%");
    expect(html).not.toContain("Spend £");
  });

  it("shows £0.01 remaining just below threshold", () => {
    const html = renderToStaticMarkup(
      createElement(FreeDeliveryProgress, {
        freeDelivery: false,
        goodsNetDisplay: "149.99",
        thresholdExVatDisplay: "150.00",
        amountToFreeDeliveryDisplay: "0.01",
        progressPercent: 99.99,
      }),
    );
    expect(html).toContain("Spend £0.01 more to unlock");
    expect(html).toContain("£149.99 of £150.00");
  });
});
