import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateSectionConfig } from "@/domain/cms";
import { SectionSettings } from "@/components/cms/SectionSettings";
import {
  brandsShowcaseContentFromLegacy,
  defaultBrandsShowcaseContent,
  parseBrandsShowcaseContent,
  upgradeLegacyBrandsShowcaseContent,
} from "@/domain/brands-showcase-content";
import { defaultSectionConfig } from "@/domain/cms-editor";
import { presentPublicBrandShowcase } from "@/domain/public-brands-showcase";

describe("brands showcase CMS content", () => {
  it("validates the default template and keeps shop links on the brand catalogues", () => {
    const content = parseBrandsShowcaseContent(defaultSectionConfig("BRANDS_SHOWCASE"));
    expect(validateSectionConfig("BRANDS_SHOWCASE", content)).toMatchObject({
      steelSeal: { heading: "Steel Seal", ctaHref: "/brands/steel-seal" },
      powerMaxed: { heading: "Power Maxed", ctaHref: "/brands/power-maxed" },
    });
    expect(content.hero.headline.indexOf("Steel Seal")).toBe(-1);
    expect(JSON.stringify(content)).not.toMatch(/street-rhino|streetwize|leisurewize|saxon|bramley|kidzmotion/i);

    const presented = presentPublicBrandShowcase(
      [
        { slug: "power-maxed", name: "Power Maxed", tagline: null, description: null, logoSrc: null, lines: 12 },
        { slug: "street-rhino", name: "Street Rhino", tagline: null, description: null, logoSrc: null, lines: 4 },
        { slug: "steel-seal", name: "Steel Seal", tagline: null, description: null, logoSrc: null, lines: 2 },
      ],
      {
        ...content,
        steelSeal: { ...content.steelSeal, ctaHref: "/brands/street-rhino", ctaLabel: "Shop the range" },
      },
    );
    expect(presented.map((brand) => brand.slug)).toEqual(["steel-seal", "power-maxed"]);
    expect(presented[0]?.shopHref).toBe("/brands/steel-seal");
    expect(presented[0]?.shopLabel).toBe("Shop the range");
    expect(presented[1]?.shopHref).toBe("/brands/power-maxed");
  });

  it("migrates hero copy and ignores every brand except Steel Seal and Power Maxed", () => {
    const migrated = brandsShowcaseContentFromLegacy([
      {
        type: "HERO",
        enabled: true,
        config: {
          eyebrow: "Saved eyebrow",
          headline: "Saved headline",
          supporting: "Saved supporting copy",
          ctaLabel: "Browse",
          ctaHref: "/products",
          secondaryCtaLabel: "Apply",
          secondaryCtaHref: "/register",
          media: { src: "/api/cms-media/hero-saved", alt: "Workshop" },
        },
      },
      {
        type: "FEATURED_BRANDS",
        enabled: false,
        config: {
          brandCards: [
            { slug: "street-rhino", heading: "Street Rhino", description: "Should never appear", href: "/brands/street-rhino" },
            { slug: "steel-seal", heading: "Steel Seal", description: "Saved Steel Seal copy", href: "/brands/steel-seal" },
            { slug: "power-maxed", heading: "Power Maxed", description: "Saved Power Maxed copy", href: "/elsewhere" },
          ],
        },
      },
    ]);

    expect(migrated.hero).toMatchObject({
      eyebrow: "Saved eyebrow",
      headline: "Saved headline",
      description: "Saved supporting copy",
      ctaLabel: "Browse",
      ctaHref: "/products",
    });
    expect(migrated.hero.media.src).toBe("/api/cms-media/hero-saved");
    expect(migrated.steelSeal.description).toBe("Saved Steel Seal copy");
    expect(migrated.powerMaxed.description).toBe("Saved Power Maxed copy");
    expect(migrated.steelSeal.ctaHref).toBe("/brands/steel-seal");
    expect(migrated.powerMaxed.ctaHref).toBe("/brands/power-maxed");
    expect(JSON.stringify(migrated)).not.toMatch(/street rhino|should never appear/i);
  });

  it("replaces the disconnected seed and keeps a custom headline and uploaded photo", () => {
    const legacy = defaultBrandsShowcaseContent();
    legacy.hero.headline = "Two brands. One trade supplier.";
    legacy.hero.description =
      "Power Maxed and Steel Seal are available through a single Automotive Brands trade account — browse the range, then order with account pricing once approved.";
    legacy.hero.media = { src: "/api/cms-media/custom-hero", alt: "Custom hero" };
    legacy.steelSeal.description = "Head gasket repair and cooling-system repair products.";
    const upgraded = upgradeLegacyBrandsShowcaseContent(legacy);
    expect(upgraded.changed).toBe(true);
    expect(upgraded.content.hero.headline).toBe("Two specialist brands.\nOne trade account.");
    expect(upgraded.content.hero.description.indexOf("Steel Seal")).toBeLessThan(
      upgraded.content.hero.description.indexOf("Power Maxed"),
    );
    expect(upgraded.content.hero.media.src).toBe("/api/cms-media/custom-hero");
    expect(upgraded.content.steelSeal.description).toMatch(/workshops and trade counters/i);

    const custom = defaultBrandsShowcaseContent();
    custom.hero.headline = "Editor headline stays";
    custom.steelSeal.description = "Editor Steel Seal description";
    const kept = upgradeLegacyBrandsShowcaseContent(custom);
    expect(kept.changed).toBe(false);
    expect(kept.content.hero.headline).toBe("Editor headline stays");
    expect(kept.content.steelSeal.description).toBe("Editor Steel Seal description");
  });

  it("falls back to the approved template when stored config is unusable", () => {
    expect(parseBrandsShowcaseContent(null).hero.headline).toMatch(/two specialist brands/i);
    expect(parseBrandsShowcaseContent({ hero: { headline: "" } }).steelSeal.heading).toBe("Steel Seal");
  });
});

describe("brands CMS editor fields", () => {
  it("edits the showcase template instead of the old hero page", () => {
    const html = renderToStaticMarkup(
      createElement(SectionSettings, {
        type: "BRANDS_SHOWCASE",
        config: defaultBrandsShowcaseContent() as unknown as Record<string, unknown>,
        onChange: () => undefined,
      }) as ReactElement,
    );
    expect(html).toContain('data-cms-editor="brands-showcase"');
    expect(html.indexOf("Steel Seal")).toBeLessThan(html.indexOf("Power Maxed"));
    expect(html).toContain("Feature highlights");
    expect(html).toContain("Image alt text");
    expect(html).toContain("Choose image");
    expect(html).toContain("Final trade account");
    expect(html).toContain("/brands/steel-seal");
    expect(html).toContain("/brands/power-maxed");
    expect(html).not.toMatch(/callout SKU|featured brands|street rhino/i);
  });
});
