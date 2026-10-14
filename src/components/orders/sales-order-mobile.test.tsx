/** @vitest-environment happy-dom */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SalesOrderProductResults } from "@/components/orders/SalesOrderProductResults";
import {
  SALES_ORDER_CARD_LAYOUT_WIDTHS,
  SALES_ORDER_MOBILE_FOOTER_ID,
  SALES_ORDER_REVIEW_ID,
  SalesOrderCustomerResults,
  SalesOrderLines,
  SalesOrderMobileFooter,
  SalesOrderPriceAlert,
  SalesOrderReviewPanel,
  SalesOrderSection,
  openSalesOrderReview,
  salesOrderControlClass,
  salesOrderUsesCardLayout,
  useSalesOrderKeyboard,
  type SalesOrderCustomerCard,
} from "@/components/orders/sales-order-mobile";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    search,
  }: {
    children: ReactNode;
    className?: string;
    search?: { companyId?: string };
  }) => createElement("a", { className, href: `/sales/orders/new?companyId=${search?.companyId ?? ""}` }, children),
}));

const customer: SalesOrderCustomerCard = {
  id: "cmp_1",
  name: "North Motors",
  tradingName: "North Motors Trade",
  accountNumber: "ACC-100",
  phone: "0114 000 0000",
  primaryEmail: "desk@north.test",
  autopartCustomerCode: "AP1",
  town: "Sheffield",
  postcode: "S1 2AB",
  contactName: "Nia Keane",
  assignedSalesRep: { name: "Alex Rep", code: "AR" },
};

function mobileMarkup(html: string) {
  return html
    .split('data-layout="mobile-cards"')
    .slice(1)
    .map((part) => part.split('data-layout="desktop-table"')[0] ?? "");
}

function hasClass(className: string, token: string) {
  return className.split(/\s+/).includes(token);
}

describe("sales order mobile layout", () => {
  it("uses stacked cards below the desktop breakpoint, including 768px", () => {
    for (const width of SALES_ORDER_CARD_LAYOUT_WIDTHS) {
      expect(salesOrderUsesCardLayout(width)).toBe(true);
    }
    expect(salesOrderUsesCardLayout(1024)).toBe(false);
    expect(salesOrderUsesCardLayout(1280)).toBe(false);
  });

  it("stacks customer cards on mobile and keeps the desktop table", () => {
    const html = renderToStaticMarkup(
      createElement(SalesOrderCustomerResults, { customers: [customer], showEmpty: false }),
    );
    const mobile = mobileMarkup(html);
    expect(mobile).toHaveLength(1);
    expect(mobile[0]).toContain("lg:hidden");
    expect(mobile[0]).not.toContain("min-w-[");
    expect(mobile[0]).toContain("North Motors");
    expect(mobile[0]).toContain("ACC-100");
    expect(mobile[0]).toContain("Alex Rep");
    expect(mobile[0]).toContain("Nia Keane");
    expect(mobile[0]).toContain("Sheffield, S1 2AB");
    expect(mobile[0]).toContain("Start order");
    expect(mobile[0]).toContain("w-full");
    expect(mobile[0]).toContain("min-h-11");
    expect(html).toContain('data-layout="desktop-table"');
    expect(html).toContain("hidden");
    expect(html).toContain("lg:block");
    expect(html).toContain("min-w-[760px]");
    expect(html).toContain("Assigned representative");
  });

  it("renders product cards on mobile and the order table on desktop", () => {
    const html = renderToStaticMarkup(
      createElement(SalesOrderLines, {
        lines: [
          {
            variantId: "var_1",
            qty: 2,
            sku: "CASE12",
            name: "Brake fluid",
            unitPriceOverride: "2.50",
          },
        ],
        reviewLines: [
          {
            variantId: "var_1",
            issue: "CASE_CONFIGURATION_CHANGED",
            issueMessage: "Case size changed. Please update the quantity.",
            caseQty: 12,
            availableQtyAtOrder: 48,
            backorderQtyAtOrder: 0,
            backordersAllowed: false,
            lineNet: "5.00",
            resolvedUnitPrice: "2.93",
            customerUnitPrice: "2.50",
            priceSource: "STAFF_OVERRIDE",
          },
        ],
        priceDrafts: {},
        onQuantityChange: () => undefined,
        onQuantityBlur: () => undefined,
        onPriceDraftChange: () => undefined,
        onPriceOverride: () => undefined,
        onClearPriceDraft: () => undefined,
        onRemove: () => undefined,
      }),
    );
    const mobile = mobileMarkup(html)[0] ?? "";
    expect(mobile).toContain("lg:hidden");
    expect(mobile).not.toContain("min-w-[");
    expect(mobile).toContain("CASE12");
    expect(mobile).toContain("Brake fluid");
    expect(mobile).toContain('aria-label="Quantity for CASE12"');
    expect(mobile).toContain('aria-label="Unit price for CASE12"');
    expect(mobile).toContain("Manual price ex VAT");
    expect(mobile).toContain("Stock 48 available");
    expect(mobile).toContain("Line total £5.00");
    expect(mobile).toContain("Remove");
    expect(mobile).toContain("Case size changed. Please update the quantity.");
    expect(mobile).toContain("text-[16px]");
    expect(mobile).toContain("min-h-11");
    expect(html).toContain("min-w-[640px]");
    expect(html).toContain("lg:block");
  });

  it("keeps product search as a full-row button", () => {
    const html = renderToStaticMarkup(
      createElement(SalesOrderProductResults, {
        products: [
          {
            variantId: "var_1",
            sku: "CASE12",
            name: "Brake fluid",
            brand: "Power Maxed",
            caseQty: 12,
            minOrderQty: 12,
            sellableQty: 48,
            backordersAllowed: false,
            customerUnitPrice: "2.93",
            priceSource: "PROMOTION",
            promotionCode: null,
            issue: "VALID",
            issueMessage: null,
          },
        ],
        disabled: false,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Add CASE12 to the order"');
    expect(html).not.toMatch(/>Add</);
    expect(html).toContain("min-h-11");
    expect(html).toContain("hover:bg-surface/80");
  });

  it("puts price warnings outside collapsible sections and reviews on the same page", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(SalesOrderPriceAlert, {
          changes: [
            {
              variantId: "var_1",
              sku: "CASE12",
              previousUnitPrice: "2.93",
              newUnitPrice: "2.50",
              previousLineNet: "5.86",
              newLineNet: "5.00",
            },
          ],
          totalsChanged: true,
          previousGrandTotal: "14.00",
          grandTotal: "12.19",
          onReview: () => undefined,
        }),
        createElement(SalesOrderSection, { title: "Customer", hint: "Contact required", children: "Contact" }),
      ),
    );
    expect(html.indexOf('role="alert"')).toBeGreaterThan(-1);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain("Contact required");
    expect(html).toContain("Review these changes before placing the order.");
    expect(html).toContain("VAT and delivery");
    const source = readFileSync(join(process.cwd(), "src/routes/sales.orders.new.tsx"), "utf8");
    expect(source.indexOf("<SalesOrderPriceAlert")).toBeLessThan(source.indexOf("<SalesOrderSection"));
    expect(source).toContain("<SalesOrderReviewPanel");
    expect(source).toContain("openSalesOrderReview()");
    expect(source).not.toContain('to="/sales/orders/review"');
    expect(salesOrderControlClass).toContain("text-[16px]");
    expect(salesOrderControlClass).toContain("min-h-11");
    expect(salesOrderControlClass).not.toContain("text-[14px]");
  });
});

function OrderHarness() {
  const typing = useSalesOrderKeyboard();
  const [po, setPo] = useState("PO-UNSAVED");
  const [qty, setQty] = useState(5);
  return createElement(
    "div",
    null,
    createElement(SalesOrderSection, {
      title: "Customer",
      hint: "Contact required",
      children: createElement("input", {
        "aria-label": "Customer PO",
        className: salesOrderControlClass,
        value: po,
        onChange: (event: { target: { value: string } }) => setPo(event.target.value),
      }),
    }),
    createElement(SalesOrderLines, {
      lines: [{ variantId: "var_1", qty, sku: "CASE12", name: "Brake fluid", unitPriceOverride: null }],
      reviewLines: [
        {
          variantId: "var_1",
          issue: "VALID",
          issueMessage: null,
          caseQty: 12,
          availableQtyAtOrder: 48,
          lineNet: "16.25",
          resolvedUnitPrice: "3.25",
          customerUnitPrice: "3.25",
          priceSource: "BASE",
        },
      ],
      priceDrafts: {},
      onQuantityChange: (_variantId: string, raw: string) => {
        const next = Number(raw);
        if (!Number.isInteger(next) || next < 1) return;
        setQty(next);
      },
      onQuantityBlur: () => undefined,
      onPriceDraftChange: () => undefined,
      onPriceOverride: () => undefined,
      onClearPriceDraft: () => undefined,
      onRemove: () => undefined,
    }),
    createElement(SalesOrderReviewPanel, {
      companyName: "North Motors",
      paymentTerms: "30 days",
      poNumber: po,
      subtotal: "16.25",
      deliveryTotal: "5.95",
      vatTotal: "4.44",
      grandTotal: "26.64",
      blocking: false,
      changes: [],
      totalsChanged: false,
      previousGrandTotal: null,
      acceptedPrices: true,
      authorised: false,
      placing: false,
      placeDisabled: true,
      placeLabel: "Place order",
      fulfilmentChoice: "DELIVERY",
      backorders: [],
      backorderAcknowledged: false,
      onAcceptPrices: () => undefined,
      onAuthorised: () => undefined,
      onBackorderAcknowledged: () => undefined,
      onPlace: () => undefined,
    }),
    createElement(SalesOrderMobileFooter, {
      total: "26.64",
      priceWarning: false,
      hidden: typing,
      onReview: () => openSalesOrderReview(),
    }),
  );
}

describe("sales order mobile review keeps unsaved edits", () => {
  it("keeps typed values when the section collapses and the review opens", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(OrderHarness));
    });

    const po = container.querySelector('[aria-label="Customer PO"]') as HTMLInputElement;
    const qty = container.querySelector('[aria-label="Quantity for CASE12"]') as HTMLInputElement;
    expect(po.value).toBe("PO-UNSAVED");
    expect(qty.value).toBe("5");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(po, "PO-PHONE");
      po.dispatchEvent(new Event("input", { bubbles: true }));
      setter?.call(qty, "15");
      qty.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(po.value).toBe("PO-PHONE");
    expect(qty.value).toBe("15");

    const summary = container.querySelector("summary");
    await act(async () => {
      summary?.click();
    });
    expect(container.querySelector('[aria-label="Customer PO"]')).toBe(po);
    expect((container.querySelector('[aria-label="Customer PO"]') as HTMLInputElement).value).toBe("PO-PHONE");

    const reviewButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Review order");
    await act(async () => {
      reviewButton?.click();
    });
    const review = document.getElementById(SALES_ORDER_REVIEW_ID);
    expect(review).not.toBeNull();
    expect(review?.textContent).toContain("VAT");
    expect(review?.textContent).toContain("Delivery");
    expect(review?.textContent).toContain("authorised");
    expect(review?.textContent).toContain("PO-PHONE");
    expect((container.querySelector('[aria-label="Quantity for CASE12"]') as HTMLInputElement).value).toBe("15");

    const footer = document.getElementById(SALES_ORDER_MOBILE_FOOTER_ID);
    expect(footer?.textContent).toContain("Order total");
    expect(footer?.textContent).toContain("£26.64");
    expect(hasClass(footer?.className ?? "", "hidden")).toBe(false);

    await act(async () => {
      po.focus();
    });
    expect(hasClass(footer?.className ?? "", "hidden")).toBe(true);

    const authorisation = [...container.querySelectorAll("input")].find(
      (input) => input instanceof HTMLInputElement && input.type === "checkbox",
    ) as HTMLInputElement;
    await act(async () => {
      authorisation.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(hasClass(footer?.className ?? "", "hidden")).toBe(false);
    expect((container.querySelector('[aria-label="Customer PO"]') as HTMLInputElement).value).toBe("PO-PHONE");

    await act(async () => {
      root!.unmount();
    });
    container.remove();
  });
});
