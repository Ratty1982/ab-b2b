import { describe, expect, it } from "vitest";
import { cmsImageFitClass } from "@/lib/cms-media";
import {
  brandLogoClass,
  catalogueMediaClass,
  categoryImageClass,
  mediaFitClassForUsage,
  mediaLibraryThumbClass,
  photoCoverClass,
} from "@/lib/media-presentation";

describe("media presentation", () => {
  it("uses contain for product, logo and category imagery", () => {
    expect(catalogueMediaClass).toContain("object-contain");
    expect(catalogueMediaClass).not.toContain("object-cover");
    expect(brandLogoClass).toContain("object-contain");
    expect(categoryImageClass).toContain("object-contain");
    expect(mediaFitClassForUsage("PRODUCT_IMAGE")).toBe(catalogueMediaClass);
    expect(mediaLibraryThumbClass("PRODUCT_IMAGE")).toContain("object-contain");
    expect(mediaLibraryThumbClass("PRODUCT_IMAGE")).not.toContain("object-cover");
    expect(catalogueMediaClass).toContain("bg-white");
    expect(mediaLibraryThumbClass("PRODUCT_IMAGE")).toContain("bg-white");
    expect(photoCoverClass).not.toContain("bg-white");
  });

  it("keeps photographic CMS fits on cover", () => {
    expect(photoCoverClass).toContain("object-cover");
    expect(mediaFitClassForUsage("CMS_GENERAL")).toContain("object-cover");
    expect(cmsImageFitClass("fill")).toContain("object-cover");
    expect(cmsImageFitClass("content")).toContain("object-cover");
    expect(cmsImageFitClass("contain")).toContain("object-contain");
  });
});
