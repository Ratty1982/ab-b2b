import { describe, expect, it } from "vitest";
import { validateSectionConfig } from "@/domain/cms";
import {
  MARKETING_CMS_PAGES,
  MARKETING_CMS_SLUGS,
  marketingCmsPageBySlug,
} from "@/domain/cms-marketing-pages";
import { cmsPageBlurb, cmsPublicPath } from "@/lib/cms-pages";

describe("marketing CMS pages", () => {
  it("covers every public marketing slug with editable seeds", () => {
    expect(MARKETING_CMS_SLUGS).toEqual([
      "brands",
      "trade-solutions",
      "why-automotive-brands",
      "about",
      "contact",
      "resources",
    ]);
    expect(marketingCmsPageBySlug("home")).toBeUndefined();
  });

  it("validates every seeded section config", () => {
    for (const page of MARKETING_CMS_PAGES) {
      expect(page.sections.length).toBeGreaterThan(0);
      for (const section of page.sections) {
        expect(() => validateSectionConfig(section.type, section.config)).not.toThrow();
      }
      expect(cmsPublicPath(page.slug)).toBe(page.slug === "brands" ? "/brands" : `/${page.slug}`);
      expect(cmsPageBlurb(page.slug)).toBe(page.blurb);
    }
  });

  it("keeps Resources off primary nav while still CMS-managed", () => {
    expect(marketingCmsPageBySlug("resources")?.primaryNav).toBe(false);
    expect(marketingCmsPageBySlug("trade-solutions")?.primaryNav).toBe(true);
  });
});
