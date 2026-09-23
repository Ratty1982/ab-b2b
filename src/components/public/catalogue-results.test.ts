import { describe, expect, it } from "vitest";
import { catalogueSearch } from "@/components/public/CatalogueSidebar";
import {
  CATALOGUE_GRID_KIND,
  CATALOGUE_LIST_KIND,
  PRODUCT_LIST_ROW_CLASS,
  PRODUCT_LIST_ROW_ORDER_CLASS,
  catalogueResultsKind,
  productRowHasQuantity,
} from "@/components/public/ProductCard";
import {
  PRODUCT_IMAGE_CARD_STAGE_CLASS,
  PRODUCT_IMAGE_FIT_CLASS,
  PRODUCT_IMAGE_THUMB_STAGE_CLASS,
  productImageStageClass,
} from "@/components/public/ProductImage";
import { PUBLIC_AVAILABILITY_LABEL } from "@/domain/availability";
import { resolveDisplayPrice, viewerFromAccess } from "@/server/pricing/trade-price";

describe("catalogue grid vs list presentation", () => {
  it("uses ProductCard grid presentation, not list rows", () => {
    expect(catalogueResultsKind("grid")).toBe(CATALOGUE_GRID_KIND);
    expect(productImageStageClass("card")).toBe(PRODUCT_IMAGE_CARD_STAGE_CLASS);
    expect(PRODUCT_IMAGE_CARD_STAGE_CLASS).toContain("aspect-[5/4]");
    expect(PRODUCT_IMAGE_CARD_STAGE_CLASS).toContain("w-full");
  });

  it("uses compact ProductListRow presentation with a small contain thumbnail", () => {
    expect(catalogueResultsKind("list")).toBe(CATALOGUE_LIST_KIND);
    expect(productImageStageClass("thumb")).toBe(PRODUCT_IMAGE_THUMB_STAGE_CLASS);
    expect(productImageStageClass("list")).toBe(PRODUCT_IMAGE_THUMB_STAGE_CLASS);
    expect(PRODUCT_IMAGE_THUMB_STAGE_CLASS).toContain("size-20");
    expect(PRODUCT_IMAGE_THUMB_STAGE_CLASS).toContain("shrink-0");
    expect(PRODUCT_IMAGE_THUMB_STAGE_CLASS).not.toContain("w-full");
    expect(PRODUCT_IMAGE_THUMB_STAGE_CLASS).not.toContain("aspect-[5/4]");
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("object-contain");
    expect(PRODUCT_IMAGE_FIT_CLASS).not.toContain("object-cover");
    expect(PRODUCT_LIST_ROW_CLASS).toContain("grid-cols-[80px_minmax(0,1fr)]");
    expect(PRODUCT_LIST_ROW_CLASS).not.toContain("aspect-[5/4]");
    expect(PRODUCT_LIST_ROW_ORDER_CLASS).toContain("minmax(11rem,14rem)");
  });

  it("keeps category, brand and search when only the results view changes", () => {
    const context = { categorySlug: "vehicle-cleaning", brandSlug: "power-maxed", q: "glass" };
    expect(catalogueSearch(context)).toEqual({
      q: "glass",
      brand: "power-maxed",
    });
    expect(catalogueResultsKind("list")).not.toBe(catalogueResultsKind("grid"));
    expect(catalogueSearch(context)).toEqual(catalogueSearch(context));
  });

  it("keeps pricing privacy and never embeds stock quantity in availability labels", () => {
    const hidden = resolveDisplayPrice({
      viewer: viewerFromAccess({ signedIn: false }),
      tradePrice: 4.6,
      rrp: 10.99,
    });
    expect(hidden.trade).toBeNull();
    expect(hidden.rrp).toBe(10.99);

    const shown = resolveDisplayPrice({
      viewer: viewerFromAccess({
        signedIn: true,
        actorType: "TRADE",
        permissions: ["pricing.view"],
      }),
      tradePrice: 4.6,
      rrp: 10.99,
    });
    expect(shown.trade).toBe(4.6);

    expect(PUBLIC_AVAILABILITY_LABEL.in).toBe("In Stock");
    expect(PUBLIC_AVAILABILITY_LABEL.low).toBe("Low Stock");
    expect(PUBLIC_AVAILABILITY_LABEL.out).toBe("Out of Stock");
    expect(Object.values(PUBLIC_AVAILABILITY_LABEL).join(" ")).not.toMatch(/\d/);
    expect(
      productRowHasQuantity(PUBLIC_AVAILABILITY_LABEL.in, {
        availability: "in",
        price: hidden,
      }),
    ).toBe(false);
  });
});
