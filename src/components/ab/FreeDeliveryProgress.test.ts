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
        thresholdExVatDisplay: "100.00",
        amountToFreeDeliveryDisplay: "55.72",
        progressPercent: 44.28,
      }),
    );
    expect(html).toContain("Free delivery");
    expect(html).toContain("Spend £55.72 more to unlock");
    expect(html).toContain("FREE DELIVERY");
    expect(html).toContain("£44.28 of £100.00");
    expect(html).toContain('aria-valuenow="44"');
    expect(html).toContain("width:44.28%");
    expect(html).not.toContain("Add £");
    expect(html).not.toContain("Buy ");
  });

  it("renders unlocked state at/above threshold", () => {
    const html = renderToStaticMarkup(
      createElement(FreeDeliveryProgress, {
        freeDelivery: true,
        goodsNetDisplay: "100.00",
        thresholdExVatDisplay: "100.00",
        amountToFreeDeliveryDisplay: null,
        progressPercent: 100,
      }),
    );
    expect(html).toContain("Free delivery unlocked");
    expect(html).toContain("Your order qualifies for free delivery");
    expect(html).toContain("£100.00+ qualifying spend");
    expect(html).toContain('data-free-delivery="unlocked"');
    expect(html).toContain("width:100%");
    expect(html).not.toContain("Spend £");
  });

  it("shows £0.01 remaining just below threshold", () => {
    const html = renderToStaticMarkup(
      createElement(FreeDeliveryProgress, {
        freeDelivery: false,
        goodsNetDisplay: "99.99",
        thresholdExVatDisplay: "100.00",
        amountToFreeDeliveryDisplay: "0.01",
        progressPercent: 99.99,
      }),
    );
    expect(html).toContain("Spend £0.01 more to unlock");
    expect(html).toContain("£99.99 of £100.00");
  });
});
