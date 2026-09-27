import { describe, expect, it } from "vitest";
import {
  HOMEPAGE_PRIMARY_BRAND_ORDER,
  homepageBrandLogoSrc,
  orderHomepageBrandPresentation,
} from "@/domain/homepage-brand-logos";

describe("homepage brand logo presentation", () => {
  it("orders Steel Seal before Power Maxed without touching other slugs' relative place", () => {
    expect([...HOMEPAGE_PRIMARY_BRAND_ORDER]).toEqual(["steel-seal", "power-maxed"]);
    const ordered = orderHomepageBrandPresentation([
      { slug: "power-maxed", name: "Power Maxed" },
      { slug: "street-rhino", name: "Street Rhino" },
      { slug: "steel-seal", name: "Steel Seal" },
    ]);
    expect(ordered.map((b) => b.slug)).toEqual(["steel-seal", "power-maxed", "street-rhino"]);
  });

  it("falls back to transparent static brand assets", () => {
    expect(homepageBrandLogoSrc("steel-seal", null)).toBe("/brand/steel-seal-logo.png");
    expect(homepageBrandLogoSrc("power-maxed", null)).toBe("/brand/power-maxed-logo.png");
    expect(homepageBrandLogoSrc("steel-seal", "/api/cms-media/abc")).toBe("/api/cms-media/abc");
    expect(homepageBrandLogoSrc("other", null)).toBeNull();
  });
});
