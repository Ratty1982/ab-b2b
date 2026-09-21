import { describe, expect, it } from "vitest";
import {
  PRODUCT_IMAGE_CARD_STAGE_CLASS,
  PRODUCT_IMAGE_FIT_CLASS,
  PRODUCT_IMAGE_LIVE_SURFACE_CLASS,
  PRODUCT_IMAGE_LOGO_SRC,
  PRODUCT_IMAGE_MISSING_SURFACE_CLASS,
  PRODUCT_IMAGE_PLACEHOLDER_LABEL,
  PRODUCT_IMAGE_STAGE_CLASS,
  PRODUCT_IMAGE_THUMB_STAGE_CLASS,
  productImageStageClass,
  productImageSurfaceClass,
} from "@/components/public/ProductImage";

describe("public product image presentation", () => {
  it("uses contain sizing at ~85% of a light studio stage and never cover", () => {
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("object-contain");
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("object-center");
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("max-h-[85%]");
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("max-w-[85%]");
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("h-[85%]");
    expect(PRODUCT_IMAGE_FIT_CLASS).not.toContain("object-cover");
    expect(productImageSurfaceClass(true)).toBe(PRODUCT_IMAGE_LIVE_SURFACE_CLASS);
    expect(PRODUCT_IMAGE_LIVE_SURFACE_CLASS).toContain("product-studio");
    expect(PRODUCT_IMAGE_LIVE_SURFACE_CLASS).not.toContain("bg-white");
    expect(PRODUCT_IMAGE_LIVE_SURFACE_CLASS).not.toContain("bg-surface");
    expect(PRODUCT_IMAGE_STAGE_CLASS).not.toContain("bg-surface");
    expect(productImageStageClass("card")).toBe(PRODUCT_IMAGE_CARD_STAGE_CLASS);
  });

  it("keeps the dark branded placeholder when there is no product image", () => {
    expect(productImageSurfaceClass(false)).toBe(PRODUCT_IMAGE_MISSING_SURFACE_CLASS);
    expect(PRODUCT_IMAGE_MISSING_SURFACE_CLASS).toContain("bg-surface");
    expect(PRODUCT_IMAGE_MISSING_SURFACE_CLASS).not.toContain("product-studio");
    expect(PRODUCT_IMAGE_LOGO_SRC).toBe("/brand/ab-logo.jpg");
    expect(PRODUCT_IMAGE_PLACEHOLDER_LABEL.toLowerCase()).toContain("coming soon");
  });

  it("uses a compact contained thumbnail for list rows", () => {
    expect(productImageStageClass("thumb")).toBe(PRODUCT_IMAGE_THUMB_STAGE_CLASS);
    expect(PRODUCT_IMAGE_THUMB_STAGE_CLASS).toContain("size-20");
    expect(PRODUCT_IMAGE_THUMB_STAGE_CLASS).not.toContain("w-full");
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("object-contain");
  });
});
