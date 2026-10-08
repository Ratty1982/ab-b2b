import { describe, expect, it } from "vitest";
import { validateSectionConfig } from "@/domain/cms";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";
import {
  applyWhyUsBrandMedia,
  defaultWhyUsContent,
  publishedTestimonials,
  whyUsContentFromLegacy,
  WHY_US_PAGE_TITLE,
} from "@/domain/why-us-content";

const legacySeed = [
  {
    type: "HERO",
    config: {
      headline: "Trade supply, without the noise",
      supporting: "A concise proposition for trade customers who need Power Maxed and Steel Seal from one supplier.",
      ctaLabel: "Open a Trade Account",
      ctaHref: "/register",
    },
  },
  {
    type: "BENEFITS_GRID",
    config: {
      items: [
        {
          title: "Trade supplier for Power Maxed & Steel Seal",
          body: "Browse both brands in one catalogue and order through a single Automotive Brands trade account.",
        },
        {
          title: "Account support",
          body: "Dedicated account manager support for trade customers. Monday to Friday.",
        },
      ],
    },
  },
  {
    type: "TRADE_CTA",
    config: {
      headline: "Open a trade account",
      supporting: "Apply to access trade pricing and the trade portal.",
    },
  },
];

describe("why us content", () => {
  it("seeds one company section and keeps Steel Seal before Power Maxed in the title", () => {
    const page = marketingCmsPageBySlug("why-automotive-brands");
    expect(page?.sections.map((section) => section.type)).toEqual(["WHY_US"]);
    expect(page?.seoTitle).toBe(WHY_US_PAGE_TITLE);
    expect(page!.seoTitle.indexOf("Steel Seal")).toBeLessThan(page!.seoTitle.indexOf("Power Maxed"));
    expect(() => validateSectionConfig("WHY_US", page?.sections[0]?.config)).not.toThrow();
    expect(marketingCmsPageBySlug("trade-solutions")?.sections[0]?.type).toBe("TRADE_SOLUTIONS");
    expect(marketingCmsPageBySlug("brands")?.sections[0]?.type).toBe("BRANDS_SHOWCASE");
  });

  it("keeps the team hidden and publishes only attributed quotes", () => {
    const content = defaultWhyUsContent();
    expect(content.team.enabled).toBe(false);
    expect(content.brands.steelSeal.ctaHref).toBe("/brands/steel-seal");
    expect(content.brands.powerMaxed.ctaHref).toBe("/brands/power-maxed");
    const quotes = publishedTestimonials(content);
    expect(quotes.map((item) => item.name)).toEqual(["Filipe Barradas", "Oliver Taskin", "Chris Burnside"]);
    expect(quotes[2]?.country).toBe("");
    expect(quotes[0]?.quote).toContain("oy my staff");
    content.testimonials.items = content.testimonials.items.map((item) => ({ ...item, published: false }));
    expect(publishedTestimonials(content)).toEqual([]);
    content.testimonials.enabled = false;
    content.testimonials.items[0]!.published = true;
    expect(publishedTestimonials(content)).toEqual([]);
  });

  it("keeps a custom headline and custom support card, and leaves the team off", () => {
    const content = whyUsContentFromLegacy([
      {
        type: "HERO",
        config: {
          headline: "Workshop partners first",
          supporting: "Custom supporting line from the administrator.",
          ctaLabel: "Request access",
          ctaHref: "/contact",
          media: { src: "/api/cms-media/aisle", alt: "Warehouse aisle", focalX: 40, focalY: 30 },
        },
      },
      {
        type: "BENEFITS_GRID",
        config: {
          items: [{ title: "Van routes", body: "Bespoke van delivery for this group." }],
        },
      },
      {
        type: "TRADE_CTA",
        config: { headline: "Talk to the trade desk", supporting: "Custom closer written by an administrator." },
      },
    ]);
    expect(content.hero.headline).toBe("Workshop partners first");
    expect(content.hero.highlight).toBe("");
    expect(content.hero.description).toBe("Custom supporting line from the administrator.");
    expect(content.hero.ctaHref).toBe("/contact");
    expect(content.hero.media.src).toBe("/api/cms-media/aisle");
    expect(content.hero.media.focalX).toBe(40);
    expect(content.support.items).toEqual([
      { icon: "partnership", title: "Van routes", body: "Bespoke van delivery for this group." },
    ]);
    expect(content.close.headline).toBe("Talk to the trade desk");
    expect(content.close.description).toBe("Custom closer written by an administrator.");
    expect(content.team.enabled).toBe(false);
  });

  it("uses the company template when the previous seed is unchanged", () => {
    const content = whyUsContentFromLegacy(legacySeed);
    expect(content.hero.headline).toContain("More than a supplier.");
    expect(content.support.items.map((item) => item.title)).toEqual([
      "Distribution",
      "Product development",
      "Marketing support",
      "Long-term partnerships",
    ]);
    expect(content.team.enabled).toBe(false);
  });

  it("copies empty brand photos from the brands showcase and leaves an existing photo in place", () => {
    const content = defaultWhyUsContent();
    content.brands.powerMaxed.media = { alt: "Kept", src: "/api/cms-media/existing-power" };
    const filled = applyWhyUsBrandMedia(content, {
      steelSeal: { media: { src: "/api/cms-media/engine", alt: "Steel Seal engine", focalX: 64 } },
      powerMaxed: { media: { src: "/api/cms-media/car", alt: "Power Maxed car" } },
    });
    expect(filled.brands.steelSeal.media.src).toBe("/api/cms-media/engine");
    expect(filled.brands.steelSeal.media.focalX).toBe(64);
    expect(filled.brands.powerMaxed.media.src).toBe("/api/cms-media/existing-power");
  });
});
