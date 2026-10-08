import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "@/domain/permissions";
import { TRADE_ROLE_PERMISSIONS } from "@/domain/role-permissions";
import {
  brandsShowcaseCtas,
  orderPublicBrandShowcase,
  PUBLIC_BRAND_SHOWCASE_ORDER,
  PUBLIC_BRANDS_PAGE_DESCRIPTION,
  PUBLIC_BRANDS_PAGE_TITLE,
  publicBrandPropositionCards,
  tradeProductCountLabel,
  type PublicCatalogueBrandCard,
} from "@/domain/public-brands-showcase";
import type { ClientSession } from "@/server/auth/session";

function brand(partial: Partial<PublicCatalogueBrandCard> & Pick<PublicCatalogueBrandCard, "slug" | "name">): PublicCatalogueBrandCard {
  return {
    tagline: null,
    description: null,
    logoSrc: null,
    lines: 0,
    ...partial,
  };
}

function tradeCustomer(): ClientSession {
  return {
    signedIn: true,
    user: {
      id: "u-trade",
      email: "buyer@example.com",
      name: "Trade Buyer",
      actorType: "TRADE",
      systemRoles: [],
      displayRole: "TRADE BUYER · Example Factors",
      companyId: "co1",
      companyName: "Example Factors",
      accountNumber: "AB-100",
      tradeRole: "TRADE_BUYER",
      navPermissions: [...TRADE_ROLE_PERMISSIONS.TRADE_BUYER],
      actingFor: null,
      tradeTestPricingMode: "NONE",
      tradeTestPriceListId: null,
      tradeTestPriceListName: null,
      twoFactorEnabled: false,
      mfaRequired: false,
    },
  };
}

describe("public brands showcase order", () => {
  it("presents Steel Seal before Power Maxed regardless of catalogue order", () => {
    const ordered = orderPublicBrandShowcase([
      brand({ slug: "power-maxed", name: "Power Maxed", lines: 319 }),
      brand({ slug: "street-rhino", name: "Street Rhino", lines: 40 }),
      brand({ slug: "steel-seal", name: "Steel Seal", lines: 8 }),
      brand({ slug: "bramley-power", name: "Bramley Power", lines: 12 }),
      brand({ slug: "streetwize", name: "Streetwize", lines: 3 }),
      brand({ slug: "leisurewize", name: "Leisurewize", lines: 2 }),
      brand({ slug: "saxon", name: "Saxon", lines: 1 }),
      brand({ slug: "kidzmotion", name: "Kidzmotion", lines: 6 }),
    ]);

    expect(ordered.map((item) => item.slug)).toEqual([...PUBLIC_BRAND_SHOWCASE_ORDER]);
    expect(ordered.map((item) => item.name)).toEqual(["Steel Seal", "Power Maxed"]);
    expect(ordered[0]?.emphasis).toBe("primary");
    expect(ordered[1]?.emphasis).toBe("secondary");
    expect(ordered.some((item) => /street|leisure|saxon|bramley|kidz/i.test(item.slug))).toBe(false);
  });

  it("does not invent a brand that is not in the public catalogue", () => {
    const ordered = orderPublicBrandShowcase([
      brand({ slug: "power-maxed", name: "Power Maxed", lines: 4 }),
    ]);
    expect(ordered.map((item) => item.slug)).toEqual(["power-maxed"]);
  });

  it("links each brand to its existing catalogue route and uses approved logos", () => {
    const ordered = orderPublicBrandShowcase([
      brand({ slug: "power-maxed", name: "Power Maxed", lines: 10, logoSrc: null }),
      brand({ slug: "steel-seal", name: "Steel Seal", lines: 2, logoSrc: "/media/cms/steel.png" }),
    ]);
    const steel = ordered[0]!;
    const power = ordered[1]!;
    expect(steel.shopHref).toBe("/brands/steel-seal");
    expect(steel.shopLabel).toBe("Shop Steel Seal");
    expect(steel.logoSrc).toBe("/media/cms/steel.png");
    expect(steel.logoAlt).toBe("Steel Seal logo");
    expect(power.shopHref).toBe("/brands/power-maxed");
    expect(power.shopLabel).toBe("Shop Power Maxed");
    expect(power.logoSrc).toBe("/brand/power-maxed-logo.png");
    expect(steel.kicker).toBe("Head Gasket & Cooling Repair");
    expect(power.kicker).toBe("Vehicle Care & Workshop");
    expect(steel.points.join(" ")).toMatch(/head gasket/i);
    expect(power.points.join(" ")).toMatch(/valeting/i);
  });
});

describe("public brand product counts", () => {
  it("labels the supplied visibility count as trade products", () => {
    expect(tradeProductCountLabel(132)).toBe("132 trade products");
    expect(tradeProductCountLabel(1)).toBe("1 trade product");
    expect(tradeProductCountLabel(1320)).toBe("1,320 trade products");
    expect(tradeProductCountLabel(-4)).toBe("0 trade products");
    expect(tradeProductCountLabel(132)).not.toMatch(/trade-visible|line/i);

    const ordered = orderPublicBrandShowcase([
      brand({ slug: "steel-seal", name: "Steel Seal", lines: 8 }),
      brand({ slug: "power-maxed", name: "Power Maxed", lines: 319 }),
    ]);
    expect(ordered[0]?.tradeProductCountLabel).toBe("8 trade products");
    expect(ordered[1]?.tradeProductCountLabel).toBe("319 trade products");
    expect(ordered[0]?.tradeProductCountLabel).not.toMatch(/trade-visible/);
  });
});

describe("public brands CTAs", () => {
  it("offers a trade account to anonymous visitors", () => {
    const ctas = brandsShowcaseCtas({ signedIn: false });
    expect(ctas.offerTradeAccount).toBe(true);
    expect(ctas.heroPrimary).toEqual({ label: "Shop Products", href: "/products" });
    expect(ctas.heroSecondary).toEqual({ label: "Open a Trade Account", href: "/register" });
    expect(ctas.closePrimary).toEqual({ label: "Open a Trade Account", href: "/register" });
    expect(ctas.closeSecondary).toEqual({ label: "Shop Products", href: "/products" });
  });

  it("does not ask an approved trade customer to open another account", () => {
    const ctas = brandsShowcaseCtas(tradeCustomer());
    expect(ctas.offerTradeAccount).toBe(false);
    expect(ctas.heroPrimary).toEqual({ label: "Shop Products", href: "/products" });
    expect(ctas.closePrimary).toEqual({ label: "Shop Products", href: "/products" });
    expect(ctas.heroSecondary).toEqual({ label: "Trade Portal", href: "/portal" });
    expect(ctas.closeSecondary).toEqual({ label: "Trade Portal", href: "/portal" });
    const labels = [ctas.heroPrimary, ctas.heroSecondary, ctas.closePrimary, ctas.closeSecondary]
      .filter(Boolean)
      .map((cta) => cta!.label);
    expect(labels.join(" ")).not.toMatch(/open a trade account/i);
  });

  it("sends a signed-in internal admin to Admin instead of registration", () => {
    const ctas = brandsShowcaseCtas({
      signedIn: true,
      user: {
        id: "u-admin",
        email: "admin@example.com",
        name: "Admin",
        actorType: "INTERNAL",
        systemRoles: ["SUPER_ADMIN"],
        displayRole: "Super Admin",
        companyId: null,
        companyName: null,
        accountNumber: null,
        tradeRole: null,
        navPermissions: [...ALL_PERMISSIONS],
        actingFor: null,
        tradeTestPricingMode: "NONE",
        tradeTestPriceListId: null,
        tradeTestPriceListName: null,
        twoFactorEnabled: false,
        mfaRequired: false,
      },
    });
    expect(ctas.offerTradeAccount).toBe(false);
    expect(ctas.heroPrimary.href).toBe("/products");
    expect(ctas.heroSecondary).toEqual({ label: "Admin", href: "/admin" });
    expect(ctas.closePrimary.label).toBe("Shop Products");
    expect([ctas.heroSecondary?.href, ctas.closeSecondary?.href]).not.toContain("/register");
  });
});

describe("public brands proposition and metadata", () => {
  it("keeps the proposition in Steel Seal then Power Maxed order", () => {
    const cards = publicBrandPropositionCards([
      { slug: "power-maxed" },
      { slug: "street-rhino" },
      { slug: "steel-seal" },
    ]);
    expect(cards.map((card) => card.slug)).toEqual(["steel-seal", "power-maxed"]);
    expect(cards[0]?.kicker).toMatch(/Head Gasket/i);
    expect(cards[1]?.kicker).toMatch(/Vehicle Care/i);
  });

  it("describes Steel Seal and Power Maxed without naming Power Maxed first", () => {
    expect(PUBLIC_BRANDS_PAGE_TITLE.startsWith("Steel Seal")).toBe(true);
    expect(PUBLIC_BRANDS_PAGE_DESCRIPTION.indexOf("Steel Seal")).toBeLessThan(
      PUBLIC_BRANDS_PAGE_DESCRIPTION.indexOf("Power Maxed"),
    );
    expect(PUBLIC_BRANDS_PAGE_TITLE).not.toMatch(/streetwize|leisurewize|saxon/i);
  });
});
