import { describe, expect, it } from "vitest";
import { PUBLIC_AVAILABILITY_LABEL } from "@/domain/availability";
import {
  customerOrderIncrement,
  formatPublicCaseOrderingRows,
  FULL_CASE_ORDERING,
  isValidCustomerOrderQuantity,
  minimumCustomerOrderQuantity,
  PRODUCT_ORDER_PANEL_PLAN,
  publicOrderingFromVariant,
  publicTradeOrderingCopy,
} from "@/domain/case-ordering";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("full-case ordering domain", () => {
  it("treats caseQty as the customer order multiple, never inventory", () => {
    expect(FULL_CASE_ORDERING.rule).toBe("FULL_CASE_ONLY");
    expect(FULL_CASE_ORDERING.customerIncrementField).toBe("caseQty");
    expect(customerOrderIncrement(2)).toBe(2);
    expect(customerOrderIncrement(6)).toBe(6);
    expect(customerOrderIncrement(null)).toBeNull();
    expect(customerOrderIncrement(undefined)).toBeNull();
    expect(customerOrderIncrement(0)).toBeNull();
    const dto = publicOrderingFromVariant({
      packQty: 1,
      caseQty: 2,
      minOrderQty: 2,
      orderIncrement: 1,
      inventory: [{ qtyOnHand: 47 }],
    });
    expect(dto.caseQty).toBe(2);
    expect(dto.caseQty).not.toBe(47);
    expect(dto.packQty).toBe(1);
    expect(dto.orderIncrement).toBe(1);
  });

  it("computes the smallest valid case multiple for MOQ", () => {
    expect(minimumCustomerOrderQuantity({ caseQty: 6, minimumOrderQty: 6 })).toBe(6);
    expect(minimumCustomerOrderQuantity({ caseQty: 6, minimumOrderQty: 12 })).toBe(12);
    expect(minimumCustomerOrderQuantity({ caseQty: 6, minimumOrderQty: 10 })).toBe(12);
    expect(minimumCustomerOrderQuantity({ caseQty: 2, minimumOrderQty: 2 })).toBe(2);
  });

  it("validates Phase 6 quantities against caseQty only", () => {
    expect(isValidCustomerOrderQuantity(2, 2)).toBe(true);
    expect(isValidCustomerOrderQuantity(4, 2)).toBe(true);
    expect(isValidCustomerOrderQuantity(1, 2)).toBe(false);
    expect(isValidCustomerOrderQuantity(3, 2)).toBe(false);
    expect(isValidCustomerOrderQuantity(6, 6)).toBe(true);
    expect(isValidCustomerOrderQuantity(1, null)).toBe(false);
  });

  it("does not invent a case quantity when missing", () => {
    expect(publicOrderingFromVariant({ packQty: 1, caseQty: null, minOrderQty: 1, orderIncrement: 1 }).caseQty).toBeNull();
    expect(formatPublicCaseOrderingRows(null)).toEqual([]);
    expect(formatPublicCaseOrderingRows(undefined)).toEqual([]);
    expect(publicTradeOrderingCopy(null)).toBeNull();
  });
});

describe("public case ordering presentation", () => {
  it("shows GC5000 caseQty 2 as a case multiple and ignores orderIncrement 1", () => {
    expect(publicTradeOrderingCopy(2)).toEqual({
      title: "Case of 2",
      subtitle: "Sold in multiples of 2",
    });
    expect(publicTradeOrderingCopy(6)).toEqual({
      title: "Case of 6",
      subtitle: "Sold in multiples of 6",
    });
    expect(publicTradeOrderingCopy(1)).toEqual({
      title: "Single unit",
      subtitle: "Sold individually",
    });
    expect(publicTradeOrderingCopy(2)?.subtitle).not.toMatch(/individually/i);
    expect(customerOrderIncrement(2)).not.toBe(1);
  });

  it("keeps exact stock quantity private", () => {
    expect(Object.values(PUBLIC_AVAILABILITY_LABEL).join(" ")).not.toMatch(/\d/);
    expect(formatPublicCaseOrderingRows(2).some((row) => row.label.toLowerCase().includes("stock"))).toBe(false);
  });
});

describe("commercial admin fields", () => {
  it("keeps the existing Commercial tab field set without a second ordering editor", () => {
    const src = readFileSync(path.join(process.cwd(), "src/routes/admin.products.$id.tsx"), "utf8");
    expect(src).toContain('label="Pack qty"');
    expect(src).toContain('label="Case qty"');
    expect(src).toContain('label="Minimum order qty"');
    expect(src).toContain('label="Order increment"');
    expect(src).toContain('label="Base trade price"');
    expect(src).toContain('label="RRP"');
    expect(src).toContain('label="VAT"');
    expect(src).toContain('label="Unit"');
    expect(src.match(/function CommercialForm/g)?.length).toBe(1);
    expect(src).not.toContain("Ordering Information");
  });
});

describe("Phase 6 ProductOrderPanel plan", () => {
  it("documents unit vs case totals without implementing basket UI", () => {
    expect(PRODUCT_ORDER_PANEL_PLAN.component).toBe("ProductOrderPanel");
    expect(PRODUCT_ORDER_PANEL_PLAN.mount).toBe("product-hero-after-short-description");
    expect(PRODUCT_ORDER_PANEL_PLAN.headlinePrice).toBe("unit-trade-price");
    expect(PRODUCT_ORDER_PANEL_PLAN.quantityRule).toBe("FULL_CASE_ONLY");
    expect(PRODUCT_ORDER_PANEL_PLAN.serverMustValidate).toBe(true);
    const hero = readFileSync(path.join(process.cwd(), "src/components/public/ProductDetail.tsx"), "utf8");
    expect(hero).toContain("ProductOrderPanel");
    expect(hero).not.toMatch(/Coming Soon/);
    const docs = readFileSync(path.join(process.cwd(), "docs/phase-6-product-order-panel.md"), "utf8");
    expect(docs).toContain("£8.70");
    expect(docs).toContain("£17.40");
    expect(docs).toContain("requestedQuantity % caseQty === 0");
  });
});
