import { describe, expect, it } from "vitest";
import { validateSectionConfig } from "@/domain/cms";
import { defaultSectionConfig } from "@/domain/cms-editor";
import { brands } from "@/lib/data";
import {
  DEFAULT_FEATURED_BRANDS_HEADING,
  DEFAULT_FEATURED_BRANDS_INTRO,
  DEFAULT_FEATURED_BRAND_CARDS,
  attachFeaturedBrandLogos,
  defaultFeaturedBrandsConfig,
  featuredBrandsIntro,
  hydrateFeaturedBrandCards,
  resolveFeaturedBrandCards,
} from "@/domain/featured-brands";

const catalogue = brands.map((b) => ({ slug: b.slug, name: b.name }));

describe("featured brands CMS copy", () => {
  it("ships editable defaults rather than catalogue blurbs", () => {
    const cfg = defaultFeaturedBrandsConfig();
    expect(cfg.heading).toBe(DEFAULT_FEATURED_BRANDS_HEADING);
    expect(cfg.intro).toBe(DEFAULT_FEATURED_BRANDS_INTRO);
    const cards = resolveFeaturedBrandCards(cfg);
    expect(cards).toHaveLength(5);
    expect(cards.find((c) => c.slug === "power-maxed")?.description).toMatch(/cleaning, detailing/);
    expect(cards.find((c) => c.slug === "steel-seal")?.description).toMatch(/head gasket/);
    expect(cards.find((c) => c.slug === "kidzmotion")?.heading).toBe("KidZmotion");
    const power = brands.find((b) => b.slug === "power-maxed");
    expect(power?.blurb).toBeTruthy();
    expect(cards.find((c) => c.slug === "power-maxed")?.description).not.toBe(power?.blurb);
  });

  it("uses homepage builder draft values on the live preview, including custom links", () => {
    const live = resolveFeaturedBrandCards({
      heading: "Trade brands",
      intro: "Custom intro",
      displayCount: 4,
      brandCards: [
        {
          slug: "power-maxed",
          heading: "PM Workshop",
          description: "Custom marketing line",
          href: "/products?brand=power-maxed",
          enabled: true,
        },
        {
          slug: "steel-seal",
          heading: "Steel Seal",
          description: "Hidden on this homepage",
          href: "/brands/steel-seal",
          enabled: false,
        },
        {
          slug: "street-rhino",
          heading: "Street Rhino",
          description: "Accessories",
          href: "/brands/street-rhino",
          enabled: true,
        },
      ],
    });
    expect(live.map((c) => c.slug)).toEqual(["power-maxed", "street-rhino"]);
    expect(live[0]?.heading).toBe("PM Workshop");
    expect(live[0]?.description).toBe("Custom marketing line");
    expect(live[0]?.href).toBe("/products?brand=power-maxed");
  });

  it("hydrates legacy brandSlugs/logos without requiring a Brand record change", () => {
    const cards = hydrateFeaturedBrandCards(
      {
        brandSlugs: ["power-maxed", "steel-seal"],
        logos: { "power-maxed": { mediaId: "cms-logo-1", alt: "PM" } },
      },
      catalogue,
    );
    const power = cards.find((c) => c.slug === "power-maxed");
    const steel = cards.find((c) => c.slug === "steel-seal");
    const rhino = cards.find((c) => c.slug === "street-rhino");
    expect(power?.enabled).toBe(true);
    expect(steel?.enabled).toBe(true);
    expect(rhino?.enabled).toBe(false);
    expect(power?.description).toBe(DEFAULT_FEATURED_BRAND_CARDS[0]?.description);
    expect(power?.logo?.mediaId).toBe("cms-logo-1");
    expect(power?.description).not.toBe(brands.find((b) => b.slug === "power-maxed")?.blurb);
    expect(featuredBrandsIntro({ heading: "Five brands. One supply partner." })).toBe(
      DEFAULT_FEATURED_BRANDS_INTRO,
    );
    expect(featuredBrandsIntro({ intro: "" })).toBe("");
  });

  it("accepts featured brands config with intro and brandCards", () => {
    const parsed = validateSectionConfig("FEATURED_BRANDS", defaultSectionConfig("FEATURED_BRANDS")) as {
      heading: string;
      intro: string;
      brandCards: Array<{ slug: string; heading: string }>;
    };
    expect(parsed.heading).toBe(DEFAULT_FEATURED_BRANDS_HEADING);
    expect(parsed.intro).toMatch(/one place/);
    expect(parsed.brandCards.map((c) => c.slug)).toContain("bramley-power");
  });

  it("still validates legacy featured brands configs without brandCards", () => {
    const cfg = validateSectionConfig("FEATURED_BRANDS", {
      heading: "Five brands. One supply partner.",
      brandSlugs: ["power-maxed"],
      displayCount: "5",
    }) as { brandCards: unknown[]; displayCount: number };
    expect(cfg.displayCount).toBe(5);
    expect(cfg.brandCards).toEqual([]);
  });

  it("prefers a CMS card logo over the catalogue logo", () => {
    const attached = attachFeaturedBrandLogos(
      {
        brandCards: [
          {
            slug: "power-maxed",
            heading: "Power Maxed",
            description: "Trade copy",
            href: "/brands/power-maxed",
            enabled: true,
            logo: { mediaId: "cms-1", alt: "CMS" },
          },
        ],
      },
      { "power-maxed": { mediaId: "db-1", alt: "Catalogue" } },
    );
    const cards = attached["brandCards"] as Array<{ logo?: { mediaId?: string } }>;
    expect(cards[0]?.logo?.mediaId).toBe("cms-1");
  });
});
