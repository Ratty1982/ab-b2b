import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRANDS,
  isLaunchPublicBrandSlug,
  LAUNCH_PUBLIC_BRAND_SLUGS,
} from "@/domain/catalogue";
import { defaultHomepageSections, HOMEPAGE_LAUNCH_CONTENT_KEY } from "@/server/cms/homepage-seed";
import { ACCOUNT_MANAGER_HOURS } from "@/domain/account-manager-hours";
import { resolveHomepageBrands } from "@/domain/homepage-resolve";

describe("launch public brands", () => {
  it("exposes only Power Maxed and Steel Seal as launch public brands", () => {
    expect([...LAUNCH_PUBLIC_BRAND_SLUGS]).toEqual(["power-maxed", "steel-seal"]);
    expect(isLaunchPublicBrandSlug("power-maxed")).toBe(true);
    expect(isLaunchPublicBrandSlug("steel-seal")).toBe(true);
    expect(isLaunchPublicBrandSlug("street-rhino")).toBe(false);
    expect(isLaunchPublicBrandSlug("bramley-power")).toBe(false);
    expect(isLaunchPublicBrandSlug("kidzmotion")).toBe(false);
  });

  it("seeds non-launch brands inactive while keeping their catalogue rows", () => {
    const bySlug = Object.fromEntries(DEFAULT_BRANDS.map((b) => [b.slug, b]));
    expect(bySlug["power-maxed"]?.isActive).toBe(true);
    expect(bySlug["steel-seal"]?.isActive).toBe(true);
    expect(bySlug["street-rhino"]?.isActive).toBe(false);
    expect(bySlug["bramley-power"]?.isActive).toBe(false);
    expect(bySlug["kidzmotion"]?.isActive).toBe(false);
    expect(DEFAULT_BRANDS).toHaveLength(5);
    expect(bySlug["power-maxed"]?.tagline).toMatch(/Vehicle Care/i);
    expect(bySlug["power-maxed"]?.description).toMatch(/valeting|cleaning|workshop/i);
    expect(bySlug["steel-seal"]?.description).toMatch(/head gasket|cooling/i);
  });
});

describe("homepage launch seed", () => {
  it("ships trade sales demo hero, two-brand section, and honest benefits", () => {
    const sections = defaultHomepageSections();
    const byType = Object.fromEntries(sections.map((s) => [s.type, s]));

    expect(byType["HERO"]?.config["eyebrow"]).toMatch(/POWER MAXED/i);
    expect(String(byType["HERO"]?.config["headline"])).toMatch(/BUILT FOR THE TRADE/i);
    expect(byType["HERO"]?.config["ctaLabel"]).toBe("Shop Products");
    expect(byType["HERO"]?.config["ctaHref"]).toBe("/products");
    expect(byType["HERO"]?.config["secondaryCtaLabel"]).toBe("Open a Trade Account");
    expect(byType["HERO"]?.config["contentKey"]).toBe(HOMEPAGE_LAUNCH_CONTENT_KEY);

    expect(byType["FEATURED_BRANDS"]?.config["heading"]).toMatch(/TWO BRANDS/i);
    const cards = byType["FEATURED_BRANDS"]?.config["brandCards"] as Array<{
      slug: string;
      enabled: boolean;
    }>;
    expect(cards.filter((c) => c.enabled).map((c) => c.slug)).toEqual(["power-maxed", "steel-seal"]);

    expect(byType["CATEGORY_GRID"]?.config["ctaLabel"]).toMatch(/View all products/i);
    expect(byType["FEATURED_PRODUCTS"]?.config["heading"]).toMatch(/Featured products/i);

    const benefits = byType["BENEFITS_GRID"]?.config["items"] as Array<{ title: string; body: string }>;
    expect(benefits.some((b) => /trade pricing/i.test(b.title))).toBe(true);
    expect(benefits.some((b) => b.body.includes(ACCOUNT_MANAGER_HOURS.orderCutoffLine))).toBe(true);
    expect(JSON.stringify(benefits)).not.toMatch(/same-day despatch/i);
    expect(JSON.stringify(benefits)).not.toMatch(/five brands/i);

    expect(byType["RESOURCES"]?.enabled).toBe(false);
    expect(byType["NEWS"]?.enabled).toBe(false);
    expect(byType["TRADE_CTA"]?.config["eyebrow"]).toMatch(/Built for trade/i);
  });

  it("filters homepage brand cards to public catalogue brands only", () => {
    const config = defaultHomepageSections().find((s) => s.type === "FEATURED_BRANDS")!.config;
    const resolved = resolveHomepageBrands(config, [
      {
        slug: "power-maxed",
        name: "Power Maxed",
        tagline: null,
        description: "Valeting",
        logoSrc: null,
      },
      {
        slug: "steel-seal",
        name: "Steel Seal",
        tagline: null,
        description: "Repair",
        logoSrc: null,
      },
    ]);
    expect(resolved.map((b) => b.slug)).toEqual(["power-maxed", "steel-seal"]);
    expect(resolved.every((b) => !["street-rhino", "kidzmotion"].includes(b.slug))).toBe(true);
  });
});
