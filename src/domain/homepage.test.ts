import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectHomepageSkus, strConfig } from "@/domain/homepage";
import { productsForSkus, resolveHomepageCategories, skuKey } from "@/domain/homepage-resolve";
import { defaultHomepageSections } from "@/server/cms/homepage-seed";

describe("homepage SKU collection", () => {
  it("collects hero callout and product lists without duplicates", () => {
    const skus = collectHomepageSkus([
      {
        id: "hero",
        type: "HERO",
        enabled: true,
        config: { calloutSku: "pm-4410" },
      },
      {
        id: "featured",
        type: "FEATURED_PRODUCTS",
        enabled: true,
        config: { productSkus: ["PM-4410", "SS-100"] },
      },
      {
        id: "popular",
        type: "POPULAR_PRODUCTS",
        enabled: false,
        config: { productSkus: ["HIDDEN"] },
      },
    ]);
    expect(skus).toEqual(["PM-4410", "SS-100"]);
  });
});

describe("homepage category resolution", () => {
  const cats = [
    { slug: "cleaning", name: "Cleaning", description: "Workshop chemicals", parentId: null },
    { slug: "accessories", name: "Accessories", description: null, parentId: null },
  ];

  it("uses CMS categorySlugs against catalogue records", () => {
    expect(
      resolveHomepageCategories({ categorySlugs: ["accessories", "missing", "cleaning"] }, cats).map((c) => c.slug),
    ).toEqual(["accessories", "cleaning"]);
  });

  it("maps legacy category tiles onto real slugs when possible", () => {
    expect(
      resolveHomepageCategories(
        { categories: [{ name: "Cleaning", href: "/products" }] },
        cats,
      ).map((c) => c.slug),
    ).toEqual(["cleaning"]);
  });
});

describe("homepage product lookup", () => {
  it("resolves SKUs from the catalogue map", () => {
    expect(skuKey(" ab-1 ")).toBe("AB-1");
    const products = productsForSkus(["AB-1", "missing"], {
      "AB-1": {
        sku: "AB-1",
        slug: "ab-1",
        name: "Test",
        brand: "Power Maxed",
        imageSrc: null,
        rrp: 10,
        price: { currency: "GBP", rrp: 10, trade: null, source: "hidden" },
        availability: "in",
      },
    });
    expect(products).toHaveLength(1);
    expect(products[0]?.sku).toBe("AB-1");
  });
});

describe("canonical homepage route contract", () => {
  it("always loads through the server-safe homepage RPC and one visual component", () => {
    const source = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
    expect(source).toContain("getPublicHomepageFn");
    expect(source).toContain("PublicHomepage");
    expect(source).not.toContain("getPublishedHomepage()");
    expect(source).not.toContain("LegacyHome");
    expect(source).not.toContain("CmsPageView");
    expect(source).not.toContain('from "@/lib/data"');
    expect(source).not.toContain('from "@/lib/crm-data"');
  });

  it("seeds one preferred homepage shell rather than a CMS/legacy fork", () => {
    const types = defaultHomepageSections().map((section) => section.type);
    expect(types).toContain("HERO");
    expect(types).toContain("FEATURED_BRANDS");
    expect(types).toContain("NEW_PRODUCTS");
    expect(types).toContain("POPULAR_PRODUCTS");
    expect(types).toContain("MOTORSPORT_FEATURE");
    expect(types.indexOf("MOTORSPORT_FEATURE")).toBeLessThan(types.indexOf("TRADE_CTA"));
    const hero = defaultHomepageSections().find((section) => section.type === "HERO");
    expect(strConfig(hero?.config ?? {}, "ctaLabel")).toMatch(/Shop Products/i);
    expect(strConfig(hero?.config ?? {}, "secondaryCtaLabel")).toMatch(/Trade Account/i);
    expect(strConfig(hero?.config ?? {}, "headline")).toMatch(/BUILT FOR THE TRADE/i);
    const motorsport = defaultHomepageSections().find((section) => section.type === "MOTORSPORT_FEATURE");
    expect(strConfig(motorsport?.config ?? {}, "ctaHref")).toBe("/motorsport");
  });
});
