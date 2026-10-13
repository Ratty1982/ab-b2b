import { describe, expect, it } from "vitest";
import { assessBasketLineQuantity, assessStaffUnitOrderQuantity } from "@/domain/ordering";
import {
  applySalesOrderProductAdd,
  parseStaffOrderQuantity,
  parseStaffOrderUnitPrice,
  selectSalesOrderProduct,
} from "@/domain/sales-order-entry";

const hit = {
  variantId: "cmv782z930000jsixwrk8kwfz",
  sku: "CASE12",
  name: "Case product",
  caseQty: 12,
  minOrderQty: 12,
};

describe("sales order product selection", () => {
  it("adds one product and closes the search", () => {
    const result = applySalesOrderProductAdd({ busy: false, lines: [], hit });
    expect(result.accepted).toBe(true);
    expect(result.clearSearch).toBe(true);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      variantId: hit.variantId,
      sku: "CASE12",
      unitPriceOverride: null,
    });
  });

  it("ignores a second add while the first is still in flight", () => {
    const first = applySalesOrderProductAdd({ busy: false, lines: [], hit });
    const second = applySalesOrderProductAdd({ busy: true, lines: first.lines, hit });
    expect(second.accepted).toBe(false);
    expect(second.clearSearch).toBe(false);
    expect(second.lines).toHaveLength(1);
  });

  it("keeps the existing case increment when the same product is added again", () => {
    const once = selectSalesOrderProduct([], hit);
    const twice = selectSalesOrderProduct(once, hit);
    expect(once[0]?.qty).toBe(12);
    expect(twice).toHaveLength(1);
    expect(twice[0]?.qty).toBe(24);
  });
});

describe("staff unit quantity and price", () => {
  const stock = {
    sellableQty: 48,
    productActive: true,
    tradeVisible: true,
    orderableByStockPolicy: true,
    hasTradePrice: true,
    backorderPolicy: "DENY" as const,
  };

  it("still rejects a single unit on the customer case rule", () => {
    expect(
      assessBasketLineQuantity({
        ...stock,
        quantity: 1,
        caseQty: 12,
        minimumOrderQty: 12,
      }),
    ).toBe("CASE_CONFIGURATION_CHANGED");
  });

  it("accepts quantities 1, 2 and 15 for a case of 12", () => {
    for (const quantity of [1, 2, 15]) {
      expect(assessStaffUnitOrderQuantity({ ...stock, quantity })).toBe("VALID");
    }
  });

  it("still blocks a staff quantity that exceeds sellable stock when backorders are denied", () => {
    expect(assessStaffUnitOrderQuantity({ ...stock, quantity: 50 })).toBe("QUANTITY_UNAVAILABLE");
  });

  it("parses a manual unit price and rejects negative or non-finite amounts", () => {
    expect(parseStaffOrderUnitPrice("2.5")).toBe("2.50");
    expect(parseStaffOrderUnitPrice("0")).toBe("0.00");
    expect(parseStaffOrderUnitPrice("-1")).toBeNull();
    expect(parseStaffOrderUnitPrice("Infinity")).toBeNull();
    expect(parseStaffOrderUnitPrice("NaN")).toBeNull();
    expect(parseStaffOrderUnitPrice("1.234")).toBeNull();
    expect(parseStaffOrderQuantity("15")).toBe(15);
    expect(parseStaffOrderQuantity("1.5")).toBeNull();
    expect(parseStaffOrderQuantity("0")).toBeNull();
  });
});
