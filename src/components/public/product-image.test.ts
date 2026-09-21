import { describe, expect, it } from "vitest";
import {
  PRODUCT_IMAGE_CARD_STAGE_CLASS,
  PRODUCT_IMAGE_FIT_CLASS,
  PRODUCT_IMAGE_LOGO_SRC,
  PRODUCT_IMAGE_PLACEHOLDER_LABEL,
  PRODUCT_IMAGE_STAGE_CLASS,
  PRODUCT_IMAGE_THUMB_STAGE_CLASS,
  productImageStageClass,
} from "@/components/public/ProductImage";

describe("public product image presentation", () => {
  it("uses contain sizing on a dark card stage and never cover", () => {
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("object-contain");
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("object-center");
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("max-h-[85%]");
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("max-w-[85%]");
    expect(PRODUCT_IMAGE_FIT_CLASS).not.toContain("object-cover");
    expect(PRODUCT_IMAGE_STAGE_CLASS).toContain("bg-surface");
    expect(PRODUCT_IMAGE_STAGE_CLASS).not.toContain("bg-white");
    expect(productImageStageClass("card")).toBe(PRODUCT_IMAGE_CARD_STAGE_CLASS);
  });

  it("uses a compact contained thumbnail for list rows", () => {
    expect(productImageStageClass("thumb")).toBe(PRODUCT_IMAGE_THUMB_STAGE_CLASS);
    expect(PRODUCT_IMAGE_THUMB_STAGE_CLASS).toContain("size-20");
    expect(PRODUCT_IMAGE_THUMB_STAGE_CLASS).not.toContain("w-full");
    expect(PRODUCT_IMAGE_THUMB_STAGE_CLASS).not.toContain("object-contain");
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("object-contain");
  });

  it("uses the Automotive Brands mark for missing images", () => {
    expect(PRODUCT_IMAGE_LOGO_SRC).toBe("/brand/ab-logo.jpg");
    expect(PRODUCT_IMAGE_PLACEHOLDER_LABEL.toLowerCase()).toContain("coming soon");
  });
});
