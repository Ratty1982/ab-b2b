import { describe, expect, it } from "vitest";
import { autoMapHeaders, parseMappedRows, coerceImportValues } from "@/domain/product-import";
import { resolveDisplayPrice, viewerFromAccess } from "@/server/pricing/trade-price";

describe("product import mapping", () => {
  it("auto-maps the original template headers", () => {
    const mapping = autoMapHeaders([
      "sku",
      "name",
      "brand",
      "category",
      "subcategory",
      "trade",
      "rrp",
      "packQty",
      "caseQty",
      "vat",
      "description",
      "active",
    ]);
    expect(mapping.sku).toBe(0);
    expect(mapping.name).toBe(1);
    expect(mapping.brand).toBe(2);
  });

  it("rejects duplicate SKUs and invalid prices", () => {
    const csv = `sku,name,trade\nA1,One,10\nA1,Two,12\nA2,Bad,-3\n`;
    const parsed = parseMappedRows(csv, { sku: 0, name: 1, trade: 2 });
    expect(parsed.issues.some((i) => i.message.includes("Duplicate SKU"))).toBe(true);
    expect(parsed.issues.some((i) => i.message.includes("Invalid trade"))).toBe(true);
  });

  it("ignores blank cells in coerce", () => {
    const values = coerceImportValues({ sku: "X", trade: "12.5" });
    expect(values.trade).toBe(12.5);
    expect(values.name).toBeUndefined();
  });
});

describe("pricing boundary", () => {
  it("hides trade price from anonymous viewers", () => {
    const price = resolveDisplayPrice({
      viewer: viewerFromAccess({ signedIn: false }),
      tradePrice: 18.5,
      rrp: 24,
    });
    expect(price.trade).toBeNull();
    expect(price.rrp).toBe(24);
    expect(price.source).toBe("hidden");
  });

  it("returns base catalogue trade price for trade viewers", () => {
    const price = resolveDisplayPrice({
      viewer: viewerFromAccess({
        signedIn: true,
        actorType: "TRADE",
        permissions: ["pricing.view", "products.view"],
      }),
      tradePrice: 18.5,
      rrp: 24,
    });
    expect(price.trade).toBe(18.5);
    expect(price.source).toBe("base_catalogue");
  });
});
