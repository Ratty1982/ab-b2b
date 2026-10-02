import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  formatInternalAvailableQty,
  InternalStockDisplay,
} from "@/components/ab/InternalStockDisplay";
import { PUBLIC_AVAILABILITY_LABEL } from "@/domain/availability";

function html(node: ReactNode) {
  return renderToStaticMarkup(node as ReactElement);
}

describe("InternalStockDisplay", () => {
  it("formats singular, plural and zero as N available", () => {
    expect(formatInternalAvailableQty(0)).toBe("0 available");
    expect(formatInternalAvailableQty(1)).toBe("1 available");
    expect(formatInternalAvailableQty(2)).toBe("2 available");
    expect(formatInternalAvailableQty(6)).toBe("6 available");
  });

  it("renders badge with labelled quantity — never a naked number", () => {
    const markup = html(
      createElement(InternalStockDisplay, {
        qty: 6,
        availability: "low",
        stale: false,
      }),
    );
    expect(markup).toContain(PUBLIC_AVAILABILITY_LABEL.low);
    expect(markup).toContain("6 available");
    expect(markup).toMatch(/data-internal-stock-qty="true"/);
    expect(markup).not.toMatch(/>6</);
    expect(markup).not.toContain("Qty: 6");
    expect(markup).not.toContain("Stock quantity 6");
  });

  it("covers stock status bands with exact qty wording", () => {
    expect(
      html(createElement(InternalStockDisplay, { qty: 21, availability: "in" })),
    ).toContain("21 available");
    expect(
      html(createElement(InternalStockDisplay, { qty: 20, availability: "low" })),
    ).toContain("20 available");
    expect(
      html(createElement(InternalStockDisplay, { qty: 1, availability: "low" })),
    ).toContain("1 available");
    expect(
      html(createElement(InternalStockDisplay, { qty: 0, availability: "out" })),
    ).toContain("0 available");
    expect(
      html(createElement(InternalStockDisplay, { qty: 0, availability: "backorder" })),
    ).toContain("0 available");
  });

  it("labels stale internal stock without implying it is current", () => {
    const markup = html(
      createElement(InternalStockDisplay, {
        qty: 6,
        availability: "low",
        stale: true,
      }),
    );
    expect(markup).toContain("6 available");
    expect(markup).toContain("Stock update may be delayed");
    expect(markup).toMatch(/data-internal-stock-stale="true"/);
  });
});
