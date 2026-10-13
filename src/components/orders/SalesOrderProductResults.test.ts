import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SalesOrderProductResults,
  type SalesOrderProductResult,
} from "@/components/orders/SalesOrderProductResults";

const hit: SalesOrderProductResult = {
  variantId: "cmv782z930000jsixwrk8kwfz",
  sku: "CASE12",
  name: "Brake fluid",
  brand: "Power Maxed",
  caseQty: 12,
  minOrderQty: 12,
  sellableQty: 48,
  backordersAllowed: false,
  customerUnitPrice: "3.25",
  priceSource: "BASE",
  promotionCode: null,
  issue: "VALID",
  issueMessage: null,
};

describe("sales order product results", () => {
  it("makes the whole result a button and does not render an Add link", () => {
    const html = renderToStaticMarkup(
      createElement(SalesOrderProductResults, {
        products: [hit],
        disabled: false,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain("<button");
    expect(html).toContain("CASE12");
    expect(html).toContain("Case 12");
    expect(html).toContain('aria-label="Add CASE12 to the order"');
    expect(html).not.toMatch(/>Add</);
    expect(html).toContain("hover:bg-surface/80");
    expect(html).toContain("focus-visible:outline");
  });
});
