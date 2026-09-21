import { describe, expect, it } from "vitest";
import { sanitizeProductDescriptionHtml } from "@/domain/product-content-html";
import {
  isProvidedMergeValue,
  parseProductContentJson,
  parseProductContentJsonText,
  previewProductContentJson,
  PRODUCT_CONTENT_JSON_SCHEMA_VERSION,
  type CatalogueLookup,
  type ProductContentJsonSnapshot,
} from "@/domain/product-content-json";
import { parseSpecificationsDocument, upsertSpecRows } from "@/domain/product-specifications";

const snapshot = (): ProductContentJsonSnapshot => ({
  id: "prod_1",
  sku: "GCRTU",
  name: "Glass Cleaner 1ltr",
  slug: "glass-cleaner-1ltr",
  brandId: "brand_pm",
  brandName: "Power Maxed",
  categoryId: "cat_glass",
  categoryName: "Glass Cleaning",
  parentCategoryName: "Vehicle Cleaning",
  status: "ACTIVE",
  isTradeVisible: true,
  isFeatured: false,
  isNew: false,
  shortDescription: null,
  description: "Old copy",
  ean: "123",
  mpn: null,
  rrp: 10.99,
  tradePrice: 4.6,
  vatCode: "STANDARD",
  packQty: 1,
  caseQty: null,
  minOrderQty: 1,
  orderIncrement: 1,
  metaTitle: "Glass Cleaner",
  metaDescription: null,
  specRows: [{ name: "Size", value: "500ml" }],
  selling: { keyBenefits: ["Existing benefit"], features: [], applications: [], directions: null, warnings: null },
  provenance: { manufacturerUrl: null, supplierUrl: null, notes: "keep me" },
  seoKeywords: [],
  primaryMediaAlt: "old alt",
  otherProductSlugs: ["other-product"],
});

const lookup = (): CatalogueLookup => ({
  brands: [{ id: "brand_pm", name: "Power Maxed" }, { id: "brand_ss", name: "Steel Seal" }],
  categories: [
    { id: "cat_vc", name: "Vehicle Cleaning", parentId: null, parentName: null },
    { id: "cat_glass", name: "Glass Cleaning", parentId: "cat_vc", parentName: "Vehicle Cleaning" },
  ],
  cmsMediaIds: ["cmediaid00000000000000001"],
  knownSkus: ["GCRTU", "PM-OTHER"],
});

function exampleJson(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    identity: {
      sku: "GCRTU",
      name: "Power Maxed Glass Cleaner 1 Litre",
      brand: "power maxed",
      category: "Vehicle Cleaning",
      subcategory: "Glass Cleaning",
    },
    content: {
      shortDescription: "Ready-to-use automotive glass cleaner.",
      description: "<p>Full product description...</p>",
    },
    ...overrides,
  };
}

describe("product content JSON v1 contract", () => {
  it("validates v1 JSON", () => {
    const parsed = parseProductContentJson(exampleJson());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.schemaVersion).toBe(PRODUCT_CONTENT_JSON_SCHEMA_VERSION);
  });

  it("rejects invalid JSON text", () => {
    expect(parseProductContentJsonText("{nope").ok).toBe(false);
  });

  it("rejects unsupported schemaVersion", () => {
    const parsed = parseProductContentJson({ ...exampleJson(), schemaVersion: "2.0" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/schemaVersion/);
  });

  it("matches SKU and blocks a mismatch", () => {
    const ok = previewProductContentJson(snapshot(), lookup(), exampleJson());
    expect(ok.skuMatched).toBe(true);
    expect(ok.issues.some((i) => i.level === "error")).toBe(false);
    const bad = previewProductContentJson(snapshot(), lookup(), exampleJson({ identity: { sku: "ABC123", name: "X" } }));
    expect(bad.skuMatched).toBe(false);
    expect(bad.issues.some((i) => i.code === "SKU_MISMATCH")).toBe(true);
    expect(bad.patch).toEqual({});
  });

  it("treats omitted, null and empty arrays as preserve", () => {
    expect(isProvidedMergeValue(undefined)).toBe(false);
    expect(isProvidedMergeValue(null)).toBe(false);
    expect(isProvidedMergeValue([])).toBe(false);
    expect(isProvidedMergeValue({})).toBe(false);
    const preview = previewProductContentJson(
      snapshot(),
      lookup(),
      {
        schemaVersion: "1.0",
        identity: { sku: "GCRTU" },
        content: { keyBenefits: null, features: [], shortDescription: null },
        merchandising: { relatedSkus: [] },
      },
    );
    expect(preview.patch.name).toBeUndefined();
    expect(preview.patch.shortDescription).toBeUndefined();
    expect(preview.patch.selling?.keyBenefits).toBeUndefined();
    expect(preview.changes.some((c) => c.key === "name")).toBe(false);
  });

  it("matches brands case-insensitively and blocks unknown brands", () => {
    const ok = previewProductContentJson(snapshot(), lookup(), exampleJson());
    expect(ok.brandMatched).toBe(true);
    const unknown = previewProductContentJson(
      snapshot(),
      lookup(),
      exampleJson({ identity: { sku: "GCRTU", brand: "Typo Brand" } }),
    );
    expect(unknown.brandMatched).toBe(false);
    expect(unknown.issues.some((i) => i.code === "UNKNOWN_BRAND")).toBe(true);
  });

  it("matches categories case-insensitively and blocks unknown categories", () => {
    const ok = previewProductContentJson(snapshot(), lookup(), exampleJson());
    expect(ok.categoryMatched).toBe(true);
    const unknown = previewProductContentJson(
      snapshot(),
      lookup(),
      exampleJson({ identity: { sku: "GCRTU", category: "Does Not Exist" } }),
    );
    expect(unknown.issues.some((i) => i.code === "UNKNOWN_CATEGORY")).toBe(true);
  });

  it("sanitises description HTML", () => {
    const html = sanitizeProductDescriptionHtml(
      `<p>Safe</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>`,
    );
    expect(html).toContain("<p>Safe</p>");
    expect(html.toLowerCase()).not.toContain("script");
    expect(html.toLowerCase()).not.toContain("onerror");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("validates commercial values and surfaces price diffs", () => {
    const preview = previewProductContentJson(
      snapshot(),
      lookup(),
      exampleJson({
        commercial: { rrp: 11.49, baseTradePrice: 4.6, vatRate: 20, packQty: 1 },
      }),
    );
    const rrp = preview.changes.find((c) => c.key === "rrp");
    expect(rrp?.current).toContain("10.99");
    expect(rrp?.proposed).toContain("11.49");
    const bad = previewProductContentJson(
      snapshot(),
      lookup(),
      exampleJson({ commercial: { vatRate: 5 } }),
    );
    expect(bad.issues.some((i) => i.code === "INVALID_VAT")).toBe(true);
  });

  it("merges SEO and reports an unknown related SKU without storing relationships", () => {
    const preview = previewProductContentJson(
      snapshot(),
      lookup(),
      exampleJson({
        seo: { metaTitle: "Power Maxed Glass Cleaner 1 Litre | Automotive Brands", slug: "power-maxed-glass-cleaner-1-litre" },
        merchandising: { relatedSkus: ["MISSING-SKU", "PM-OTHER"] },
      }),
    );
    expect(preview.patch.metaTitle).toMatch(/Power Maxed/);
    expect(preview.patch.slug).toBe("power-maxed-glass-cleaner-1-litre");
    expect(preview.unsupported.some((item) => item.includes("relatedSkus"))).toBe(true);
    expect(preview.unresolved.some((item) => item.includes("MISSING-SKU"))).toBe(true);
  });

  it("does not overwrite spec rows that are omitted and upserts provided ones", () => {
    const rows = upsertSpecRows(
      [{ name: "Size", value: "500ml" }, { name: "Colour", value: "Blue" }],
      [{ name: "Size", value: "1 Litre" }],
    );
    expect(rows).toEqual([
      { name: "Size", value: "1 Litre" },
      { name: "Colour", value: "Blue" },
    ]);
  });

  it("parses historic specification arrays", () => {
    const doc = parseSpecificationsDocument([{ name: "Size", value: "1L" }]);
    expect(doc.rows[0]?.value).toBe("1L");
    expect(doc.selling.keyBenefits).toEqual([]);
  });

  it("flags external media URLs and keeps omitted media as a no-op", () => {
    const preview = previewProductContentJson(
      snapshot(),
      lookup(),
      exampleJson({ media: { primaryImage: "https://example.com/a.png", imageAlt: null } }),
    );
    expect(preview.unresolved.some((item) => item.includes("https://example.com"))).toBe(true);
    expect(preview.patch.mediaAlt).toBeUndefined();
  });

  it("blocks a conflicting slug", () => {
    const preview = previewProductContentJson(
      snapshot(),
      lookup(),
      exampleJson({ seo: { slug: "other-product" } }),
    );
    expect(preview.issues.some((i) => i.code === "SLUG_CONFLICT")).toBe(true);
  });
});
