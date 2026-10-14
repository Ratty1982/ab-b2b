import { describe, expect, it } from "vitest";
import { assessBasketLineQuantity, assessStaffUnitOrderQuantity } from "@/domain/ordering";
import {
  applySalesOrderProductAdd,
  parseStaffOrderQuantity,
  parseStaffOrderUnitPrice,
  placeSalesOrderSchema,
  salesOrderAllocationChanged,
  salesOrderBackorderSummary,
  salesOrderDraftHeaderSchema,
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

  it("adds a new product at the top with a blank quantity", () => {
    const older = selectSalesOrderProduct([], { ...hit, variantId: "cmv782z930000jsixwrk8kwf0", sku: "OLDER" });
    const newer = selectSalesOrderProduct(older, hit);
    expect(newer.map((line) => line.sku)).toEqual(["CASE12", "OLDER"]);
    expect(newer[0]?.qty).toBeNull();
    expect(newer[1]?.qty).toBeNull();
  });

  it("moves an existing product to the top without changing its quantity", () => {
    const first = selectSalesOrderProduct([], hit);
    const withQty = [{ ...first[0]!, qty: 4 }];
    const second = selectSalesOrderProduct(withQty, { ...hit, variantId: "cmv782z930000jsixwrk8kwf0", sku: "OTHER" });
    const again = selectSalesOrderProduct(second, hit);
    expect(again).toHaveLength(2);
    expect(again[0]?.sku).toBe("CASE12");
    expect(again[0]?.qty).toBe(4);
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
    expect(parseStaffOrderQuantity("")).toBeNull();
  });
});

const cuid = "cmv782z930000jsixwrk8kwfz";

describe("sales order collection and blank quantities", () => {
  const base = {
    draftId: cuid,
    confirmAuthorised: true as const,
    idempotencyKey: "idem-key-1",
    source: "TELEPHONE" as const,
    contactId: cuid,
    lines: [{ variantId: cuid, qty: 2 }],
    expectedReview: {
      lines: [{ variantId: cuid, qty: 2, customerUnitPrice: "1.00", lineNet: "2.00" }],
      subtotal: "2.00",
      vatTotal: "0.40",
      deliveryTotal: "5.95",
      grandTotal: "8.35",
    },
  };

  it("requires a delivery address for delivery and not for collection", () => {
    expect(placeSalesOrderSchema.safeParse({ ...base, fulfilmentChoice: "DELIVERY" }).success).toBe(false);
    const collection = placeSalesOrderSchema.safeParse({
      ...base,
      fulfilmentChoice: "COLLECTION",
      expectedReview: { ...base.expectedReview, deliveryTotal: "0.00", grandTotal: "2.40" },
    });
    expect(collection.success).toBe(true);
    if (collection.success) expect(collection.data.fulfilmentChoice).toBe("COLLECTION");
  });

  it("keeps a blank draft quantity null and rejects it at placement", () => {
    const draft = salesOrderDraftHeaderSchema.safeParse({
      draftId: cuid,
      lines: [{ variantId: cuid, qty: null }],
    });
    expect(draft.success).toBe(true);
    if (draft.success) expect(draft.data.lines?.[0]?.qty).toBeNull();
    expect(placeSalesOrderSchema.safeParse({ ...base, lines: [{ variantId: cuid, qty: null }] }).success).toBe(false);
    expect(salesOrderDraftHeaderSchema.safeParse({ draftId: cuid, lines: [{ variantId: cuid, qty: 0 }] }).success).toBe(false);
  });

  it("describes partial and full backorders and detects an allocation change", () => {
    const rows = salesOrderBackorderSummary([
      {
        variantId: cuid,
        sku: "PART",
        name: "Partial",
        quantity: 5,
        availableQtyAtOrder: 3,
        backorderQtyAtOrder: 2,
      },
      {
        variantId: "cmv782z930000jsixwrk8kwf0",
        sku: "FULL",
        name: "Full",
        quantity: 2,
        availableQtyAtOrder: 0,
        backorderQtyAtOrder: 2,
      },
    ]);
    expect(rows.map((row) => row.extent)).toEqual(["PARTIAL", "FULL"]);
    expect(rows[0]).toMatchObject({ sellableQty: null, stockConfirmed: false });
    expect(salesOrderAllocationChanged(undefined, { availableQtyAtOrder: 3, backorderQtyAtOrder: 2 })).toBe(true);
    expect(salesOrderAllocationChanged(undefined, { availableQtyAtOrder: 3, backorderQtyAtOrder: 0 })).toBe(false);
    expect(
      salesOrderAllocationChanged(
        { availableQty: 3, backorderQty: 2 },
        { availableQtyAtOrder: 1, backorderQtyAtOrder: 4 },
      ),
    ).toBe(true);
  });

  it("keeps confirmed sellable stock separate from the allocated and backordered quantities", () => {
    const [row] = salesOrderBackorderSummary([
      {
        variantId: cuid,
        sku: "PART",
        name: "Partial",
        quantity: 12,
        availableQtyAtOrder: 6,
        backorderQtyAtOrder: 6,
        sellableQty: 6,
        stockConfirmed: true,
      },
    ]);
    expect(row).toMatchObject({
      orderedQty: 12,
      availableQty: 6,
      backorderQty: 6,
      sellableQty: 6,
      stockConfirmed: true,
      extent: "PARTIAL",
    });
    const [stale] = salesOrderBackorderSummary([
      {
        variantId: cuid,
        sku: "STALE",
        name: "Stale",
        quantity: 2,
        availableQtyAtOrder: 0,
        backorderQtyAtOrder: 2,
        sellableQty: 200,
        stockConfirmed: false,
      },
    ]);
    expect(stale?.sellableQty).toBeNull();
    expect(stale?.stockConfirmed).toBe(false);
  });
});
