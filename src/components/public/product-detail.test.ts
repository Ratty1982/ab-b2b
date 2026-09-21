import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ProductApplications,
  ProductBenefits,
  ProductDescription,
  ProductDetailView,
  ProductDirections,
  ProductFeatures,
  ProductSpecifications,
  ProductWarnings,
  type PublicProductDetail,
} from "@/components/public/ProductDetail";
import {
  PRODUCT_IMAGE_DETAIL_STAGE_CLASS,
  PRODUCT_IMAGE_FIT_CLASS,
  PRODUCT_IMAGE_LIVE_SURFACE_CLASS,
  PRODUCT_IMAGE_MISSING_SURFACE_CLASS,
} from "@/components/public/ProductImage";
import { PUBLIC_AVAILABILITY_LABEL, publicAvailabilityFromQty } from "@/domain/availability";
import type { PublicProductCard } from "@/server/catalogue/products";

vi.mock("@/lib/session", () => ({
  useSession: () => ({ signedIn: false, loading: false, refresh: async () => undefined }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) =>
    createElement("a", { href: typeof to === "string" ? to : "/" }, children),
}));

function card(partial: Partial<PublicProductCard> = {}): PublicProductCard {
  return {
    id: "p1",
    sku: "GC5000",
    slug: "gc5000",
    name: "Window & Glass Cleaner 5 Litre",
    brand: "Power Maxed",
    brandSlug: "power-maxed",
    category: "Vehicle Cleaning",
    categorySlug: "vehicle-cleaning",
    imageSrc: "/media/gc5000.jpg",
    rrp: 17.99,
    price: { currency: "GBP", trade: null, rrp: 17.99, source: "hidden" },
    availability: "in",
    isNew: false,
    isFeatured: false,
    ...partial,
  };
}

function detail(partial: Partial<PublicProductDetail> = {}): PublicProductDetail {
  return {
    card: card(),
    sku: "GC5000",
    shortDescription: "Professional-grade 5L glass cleaner for fast, streak-free cleaning.",
    description: "Full product description for windscreens, windows, mirrors and interior glass.",
    specifications: [
      { name: "size", value: "5L" },
      { name: "productType", value: "Glass Cleaner" },
      { name: "form", value: "Liquid" },
      { name: "finish", value: "Streak-Free" },
      { name: "residueFree", value: "true" },
      { name: "fastEvaporating", value: "true" },
      { name: "tinted_window_safe", value: "true" },
    ],
    selling: {
      keyBenefits: [
        "Leaves glass crystal clear and streak free",
        "Fast-evaporating formula for quick cleaning",
      ],
      features: ["Professional-grade glass cleaner", "Safe for tinted windows"],
      applications: ["Vehicle Windscreens", "Mirrors", "Interior Vehicle Glass"],
      directions: "Apply to the glass surface and wipe clean with a suitable clean cloth.",
      warnings: null,
    },
    gallery: [{ src: "/media/gc5000.jpg", alt: "Window & Glass Cleaner 5 Litre" }],
    related: [card({ id: "p2", sku: "GC500", slug: "gc500", name: "Window & Glass Cleaner 500ml" })],
    ...partial,
  };
}

function html(node: ReactNode) {
  return renderToStaticMarkup(node as ReactElement);
}

describe("public product detail sections", () => {
  it("puts shortDescription in the hero and description in Product Description", () => {
    const markup = html(createElement(ProductDetailView, { data: detail() }));
    expect(markup).toContain("data-product-short-description");
    expect(markup).toContain("Professional-grade 5L glass cleaner");
    expect(markup).toContain('data-product-section="description"');
    expect(markup).toContain("Full product description");
    expect(markup.indexOf("data-product-short-description")).toBeLessThan(markup.indexOf("data-product-section=\"description\""));
  });

  it("renders benefits when populated and hides them when empty", () => {
    const populated = html(createElement(ProductBenefits, { items: ["Streak-free finish"] }));
    expect(populated).toContain("Key benefits");
    expect(populated).toContain("Streak-free finish");
    expect(populated).not.toContain("list-disc");
    expect(ProductBenefits({ items: [] })).toBeNull();
  });

  it("renders features when populated and hides them when empty", () => {
    const populated = html(createElement(ProductFeatures, { items: ["Professional-grade glass cleaner"] }));
    expect(populated).toContain("Features");
    expect(populated).toContain("Professional-grade glass cleaner");
    expect(ProductFeatures({ items: [] })).toBeNull();
  });

  it("renders applications as chips when populated and hides them when empty", () => {
    const populated = html(createElement(ProductApplications, { items: ["Vehicle Windscreens", "Mirrors"] }));
    expect(populated).toContain("Suitable for");
    expect(populated).toContain("Vehicle Windscreens");
    expect(populated).toContain("rounded-full");
    expect(populated).not.toContain("list-disc");
    expect(ProductApplications({ items: [] })).toBeNull();
  });

  it("renders directions when populated and hides them when empty", () => {
    const populated = html(
      createElement(ProductDirections, { text: "Apply to the glass surface and wipe clean." }),
    );
    expect(populated).toContain("How to use");
    expect(populated).toContain("Apply to the glass surface");
    expect(ProductDirections({ text: "   " })).toBeNull();
  });

  it("hides warnings when absent and renders Important information when supplied", () => {
    expect(ProductWarnings({ text: "" })).toBeNull();
    const markup = html(createElement(ProductDetailView, { data: detail({ selling: { ...(detail().selling!), warnings: null } }) }));
    expect(markup).not.toContain("Important information");
    const withWarning = html(
      createElement(ProductWarnings, { text: "Keep out of reach of children." }),
    );
    expect(withWarning).toContain("Important information");
    expect(withWarning).toContain("Keep out of reach of children.");
  });

  it("renders additional specifications with human labels, Yes/No, and standardised size", () => {
    const markup = html(
      createElement(ProductSpecifications, {
        rows: [
          { label: "Size", value: "5 Litre" },
          { label: "Residue Free", value: "Yes" },
          { label: "Fast Evaporating", value: "No" },
          { label: "Tinted Window Safe", value: "Yes" },
        ],
      }),
    );
    expect(markup).toContain("Specifications");
    expect(markup).toContain("5 Litre");
    expect(markup).not.toContain(">5L<");
    expect(markup).toContain("Residue Free");
    expect(markup).toContain("Yes");
    expect(markup).toContain("No");
    expect(markup).not.toContain("residueFree");
    expect(markup).not.toContain("fastEvaporating");
    expect(ProductSpecifications({ rows: [] })).toBeNull();
  });

  it("keeps anonymous stock quantity hidden and availability labels correct", () => {
    expect(publicAvailabilityFromQty(21)).toBe("in");
    expect(publicAvailabilityFromQty(20)).toBe("low");
    expect(publicAvailabilityFromQty(0)).toBe("out");
    const markup = html(createElement(ProductDetailView, { data: detail() }));
    expect(markup).toContain(PUBLIC_AVAILABILITY_LABEL.in);
    expect(markup).not.toMatch(/qty|on hand|21 units/i);
    expect(Object.values(PUBLIC_AVAILABILITY_LABEL).join(" ")).not.toMatch(/\d/);
  });

  it("uses contain for live product images and keeps missing images on a dark stage", () => {
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("object-contain");
    expect(PRODUCT_IMAGE_FIT_CLASS).not.toContain("object-cover");
    expect(PRODUCT_IMAGE_LIVE_SURFACE_CLASS).toContain("product-studio");
    expect(PRODUCT_IMAGE_MISSING_SURFACE_CLASS).toContain("bg-surface");
    expect(PRODUCT_IMAGE_DETAIL_STAGE_CLASS).not.toContain("product-studio");
    const live = html(createElement(ProductDetailView, { data: detail() }));
    expect(live).toContain("data-product-image-surface=\"live\"");
    expect(live).toContain("object-contain");
    const missing = html(
      createElement(ProductDetailView, {
        data: detail({
          card: card({ imageSrc: null }),
          gallery: [],
        }),
      }),
    );
    expect(missing).toContain("data-product-image-surface=\"missing\"");
    expect(missing).toContain("Image coming soon");
  });

  it("renders related products after content without artificial min-height whitespace", () => {
    const markup = html(createElement(ProductDetailView, { data: detail() }));
    const contentIdx = markup.indexOf('data-product-detail="content"');
    const relatedIdx = markup.indexOf('data-product-section="related"');
    expect(contentIdx).toBeGreaterThan(-1);
    expect(relatedIdx).toBeGreaterThan(contentIdx);
    expect(markup).not.toMatch(/min-h-\[(?:60|70|80|90|100)(?:vh|rem)/);
    expect(markup).toContain("overflow-x-hidden");
    expect(markup).toContain("Related products");
    expect(markup).toContain("Window &amp; Glass Cleaner 500ml");
  });

  it("does not render empty selling sections", () => {
    const markup = html(
      createElement(ProductDetailView, {
        data: detail({
          shortDescription: null,
          description: null,
          specifications: [],
          selling: { keyBenefits: [], features: [], applications: [], directions: null, warnings: null },
          related: [],
        }),
      }),
    );
    expect(markup).not.toContain("Key benefits");
    expect(markup).not.toContain("Features");
    expect(markup).not.toContain("Suitable for");
    expect(markup).not.toContain("How to use");
    expect(markup).not.toContain("Important information");
    expect(markup).not.toContain("Specifications");
    expect(markup).not.toContain("Related products");
    expect(markup).not.toContain("data-product-short-description");
  });

  it("keeps description sanitised", () => {
    const markup = html(
      createElement(ProductDescription, { html: '<p>Safe</p><script>alert(1)</script>' }),
    );
    expect(markup).toContain("Safe");
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("alert(1)");
  });
});
