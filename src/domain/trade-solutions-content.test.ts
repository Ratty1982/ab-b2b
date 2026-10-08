import { describe, expect, it } from "vitest";
import { ACCOUNT_MANAGER_HOURS } from "@/domain/account-manager-hours";
import { validateSectionConfig } from "@/domain/cms";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";
import {
  applyShowcaseBrandMedia,
  defaultTradeSolutionsContent,
  parseTradeSolutionsContent,
  TRADE_SOLUTIONS_CONTENT_KEY,
  tradeSolutionsContentFromLegacy,
  tradeSolutionsCtas,
  upgradeMigratedTradeSolutions,
} from "@/domain/trade-solutions-content";
import type { ClientSession } from "@/server/auth/session";

const legacySections = [
  {
    type: "HERO",
    enabled: true,
    config: {
      eyebrow: "Trade solutions",
      headline: "Built for trade ordering",
      supporting:
        "Practical capabilities for approved Automotive Brands trade accounts ordering Power Maxed and Steel Seal.",
      ctaLabel: "Open a Trade Account",
      ctaHref: "/register",
      secondaryCtaLabel: "Shop Products",
      secondaryCtaHref: "/products",
    },
  },
  {
    type: "BENEFITS_GRID",
    enabled: true,
    config: {
      items: [
        {
          title: "Trade pricing",
          body: "Approved customers see their account pricing on the catalogue and product pages.",
        },
        {
          title: "Customer-specific pricing",
          body: "Workshop rate agreed in 2024 for this account only.",
        },
        {
          title: "Live availability",
          body: "Customer-safe availability is derived from current stock data at the point of browsing and ordering.",
        },
      ],
    },
  },
  {
    type: "TRADE_CTA",
    enabled: true,
    config: {
      headline: "Open a trade account",
      supporting: "Apply for account pricing on Power Maxed and Steel Seal.",
    },
  },
];

describe("trade solutions content", () => {
  it("seeds one structured section and leaves other marketing pages on their own templates", () => {
    const page = marketingCmsPageBySlug("trade-solutions");
    expect(page?.sections.map((section) => section.type)).toEqual(["TRADE_SOLUTIONS"]);
    expect(page?.seoTitle).toContain("Steel Seal");
    expect(page?.seoTitle.indexOf("Steel Seal")).toBeLessThan(page!.seoTitle.indexOf("Power Maxed"));
    expect(() => validateSectionConfig("TRADE_SOLUTIONS", page?.sections[0]?.config)).not.toThrow();
    expect(marketingCmsPageBySlug("why-automotive-brands")?.sections[0]?.type).toBe("WHY_US");
    expect(marketingCmsPageBySlug("brands")?.sections.map((section) => section.type)).toEqual(["BRANDS_SHOWCASE"]);
  });

  it("keeps custom legacy copy and replaces the original seed wording", () => {
    const content = tradeSolutionsContentFromLegacy(legacySections);
    expect(content.contentKey).toBe(TRADE_SOLUTIONS_CONTENT_KEY);
    expect(content.hero.headline).toBe("Your trade account.\nYour prices. Your orders.");
    expect(content.hero.highlight).toBe("Your prices.");
    expect(content.benefits.items[0]?.title).toBe("Trade pricing");
    expect(content.benefits.items[0]?.body).toBe("See your approved trade prices across the product range.");
    expect(content.benefits.items[1]?.title).toBe("Customer-specific pricing");
    expect(content.benefits.items[1]?.body).toBe("Workshop rate agreed in 2024 for this account only.");
    expect(content.benefits.items[2]?.title).toBe("Stock availability");
    expect(content.close.enabled).toBe(false);
    expect(content.faqs).toHaveLength(6);
    expect(content.hero.secondaryCtaLabel).toBe("Explore the Benefits");
    expect(content.hero.secondaryCtaHref).toBe("#trade-benefits");
  });

  it("repairs only the copied seed secondary button", () => {
    const seeded = defaultTradeSolutionsContent();
    seeded.hero.secondaryCtaLabel = "Shop Products";
    seeded.hero.secondaryCtaHref = "/products";
    const repaired = upgradeMigratedTradeSolutions(seeded);
    expect(repaired.changed).toBe(true);
    expect(repaired.content.hero.secondaryCtaHref).toBe("#trade-benefits");

    const custom = defaultTradeSolutionsContent();
    custom.hero.headline = "Approved workshop accounts";
    custom.hero.secondaryCtaLabel = "Shop Products";
    custom.hero.secondaryCtaHref = "/products";
    expect(upgradeMigratedTradeSolutions(custom).changed).toBe(false);
  });

  it("keeps a custom hero and enables the closer when the old call to action was rewritten", () => {
    const content = tradeSolutionsContentFromLegacy([
      {
        type: "HERO",
        config: {
          headline: "Approved workshop accounts",
          supporting: "Custom supporting line from the administrator.",
          ctaLabel: "Request access",
          ctaHref: "/contact",
          media: { src: "/api/cms-media/workshop", alt: "Workshop", focalX: 70, focalY: 40 },
        },
      },
      {
        type: "TRADE_CTA",
        config: {
          headline: "Talk to the trade desk",
          supporting: "Custom closer written by an administrator.",
        },
      },
    ]);
    expect(content.hero.headline).toBe("Approved workshop accounts");
    expect(content.hero.highlight).toBe("");
    expect(content.hero.description).toBe("Custom supporting line from the administrator.");
    expect(content.hero.ctaLabel).toBe("Request access");
    expect(content.hero.ctaHref).toBe("/contact");
    expect(content.hero.media.src).toBe("/api/cms-media/workshop");
    expect(content.hero.media.focalX).toBe(70);
    expect(content.close.enabled).toBe(true);
    expect(content.close.headline).toBe("Talk to the trade desk");
    expect(content.close.description).toBe("Custom closer written by an administrator.");
  });

  it("copies empty brand photos from the brands showcase and leaves an existing photo in place", () => {
    const content = defaultTradeSolutionsContent();
    content.brands.powerMaxed.media = { alt: "Kept", src: "/api/cms-media/existing-power" };
    const filled = applyShowcaseBrandMedia(content, {
      steelSeal: { media: { src: "/api/cms-media/engine", alt: "Steel Seal engine", focalX: 64 } },
      powerMaxed: { media: { src: "/api/cms-media/car", alt: "Power Maxed car" } },
    });
    expect(filled.brands.steelSeal.media.src).toBe("/api/cms-media/engine");
    expect(filled.brands.steelSeal.media.focalX).toBe(64);
    expect(filled.brands.powerMaxed.media.src).toBe("/api/cms-media/existing-power");
  });

  it("uses confirmed support hours and does not invent a despatch promise", () => {
    const content = defaultTradeSolutionsContent();
    const support = content.benefits.items.find((item) => item.title === "Account support");
    const cutoff = content.faqs.find((item) => item.question.includes("cut-off"));
    expect(support?.body).toContain(ACCOUNT_MANAGER_HOURS.weekdayLine);
    expect(support?.body).toContain(ACCOUNT_MANAGER_HOURS.orderCutoffLine);
    expect(cutoff?.answer).toContain(ACCOUNT_MANAGER_HOURS.orderCutoffLine);
    expect(cutoff?.answer.toLowerCase()).not.toContain("same-day despatch");
    expect(cutoff?.answer).toContain("not a promise that goods will leave the same day");
    expect(content.faqs.find((item) => item.question.includes("approval"))?.reviewNote).toContain("confirmed");
    expect(content.faqs.find((item) => item.question.includes("delivery"))?.reviewNote.length).toBeGreaterThan(0);
    const parsed = parseTradeSolutionsContent({ hero: { headline: "Kept" } });
    expect(parsed.hero.headline).toBe("Kept");
    expect(parsed.hero.ctaHref).toBe("/register");
  });

  it("sends approved trade customers to the portal and other signed-in users to their account home", () => {
    const content = defaultTradeSolutionsContent();
    const anonymous = tradeSolutionsCtas({ signedIn: false }, content);
    expect(anonymous.offerTradeAccount).toBe(true);
    expect(anonymous.heroPrimary.href).toBe("/register");
    expect(anonymous.heroSecondary.href).toBe("#trade-benefits");

    const trade = tradeSolutionsCtas(
      {
        signedIn: true,
        user: {
          id: "u",
          email: "buyer@example.invalid",
          name: "Buyer",
          actorType: "TRADE",
          systemRoles: [],
          displayRole: "TRADE BUYER",
          companyId: "co",
          companyName: "Factors",
          accountNumber: "AB",
          tradeRole: "TRADE_BUYER",
          navPermissions: [],
          actingFor: null,
          tradeTestPricingMode: "NONE",
          tradeTestPriceListId: null,
          tradeTestPriceListName: null,
          twoFactorEnabled: false,
          mfaRequired: false,
        },
      },
      content,
    );
    expect(trade.heroPrimary).toEqual({ label: "Go to Trade Portal", href: "/portal" });
    expect(trade.brandsPrimary.href).toBe("/portal");
    expect(trade.portal.href).toBe("/portal");
    expect(trade.brandsSecondary.href).toBe("/products");

    const admin: ClientSession = {
      signedIn: true,
      user: {
        id: "admin",
        email: "admin@example.invalid",
        name: "Admin",
        actorType: "INTERNAL",
        systemRoles: ["SUPER_ADMIN"],
        displayRole: "Super Admin",
        companyId: null,
        companyName: null,
        accountNumber: null,
        tradeRole: null,
        navPermissions: ["admin.access"],
        actingFor: null,
        tradeTestPricingMode: "NONE",
        tradeTestPriceListId: null,
        tradeTestPriceListName: null,
        twoFactorEnabled: false,
        mfaRequired: false,
      },
    };
    expect(tradeSolutionsCtas(admin, content).heroPrimary).toEqual({ label: "Admin", href: "/admin" });
  });
});
