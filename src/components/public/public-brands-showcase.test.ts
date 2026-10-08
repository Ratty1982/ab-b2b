import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicBrandsShowcase } from "@/components/public/PublicBrandsShowcase";
import { defaultBrandsShowcaseContent } from "@/domain/brands-showcase-content";
import { type PublicCatalogueBrandCard } from "@/domain/public-brands-showcase";
import { TRADE_ROLE_PERMISSIONS } from "@/domain/role-permissions";
import type { ClientSession } from "@/server/auth/session";

function brand(
  partial: Partial<PublicCatalogueBrandCard> & Pick<PublicCatalogueBrandCard, "slug" | "name">,
): PublicCatalogueBrandCard {
  return {
    tagline: null,
    description: null,
    logoSrc: null,
    lines: 0,
    ...partial,
  };
}

const catalogue = [
  brand({
    slug: "power-maxed",
    name: "Power Maxed",
    description: "Professional valeting, cleaning, workshop and vehicle maintenance products for the trade.",
    lines: 319,
  }),
  brand({ slug: "street-rhino", name: "Street Rhino", lines: 12 }),
  brand({
    slug: "steel-seal",
    name: "Steel Seal",
    description: "Head gasket repair and cooling-system repair products for workshops and trade counters.",
    lines: 8,
  }),
  brand({ slug: "kidzmotion", name: "Kidzmotion", lines: 4 }),
];

function tradeCustomer(): ClientSession {
  return {
    signedIn: true,
    user: {
      id: "u-trade",
      email: "buyer@example.com",
      name: "Trade Buyer",
      actorType: "TRADE",
      systemRoles: [],
      displayRole: "TRADE BUYER",
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

function renderShowcase(session: ClientSession, content = defaultBrandsShowcaseContent()) {
  return renderToStaticMarkup(
    createElement(PublicBrandsShowcase, {
      brands: catalogue,
      session,
      content,
    }) as ReactElement,
  );
}

describe("public brands showcase markup", () => {
  it("renders Steel Seal before Power Maxed and hides every other brand", () => {
    const html = renderShowcase({ signedIn: false });
    const steel = html.indexOf('data-brand-showcase="steel-seal"');
    const power = html.indexOf('data-brand-showcase="power-maxed"');
    expect(steel).toBeGreaterThan(-1);
    expect(power).toBeGreaterThan(steel);
    expect(html.match(/data-brand-showcase="/g)).toHaveLength(2);
    expect(html).toContain('data-brands-template="brands-showcase"');
    expect(html).toContain('data-brand-order="steel-seal power-maxed"');
    expect(html).not.toContain("bg-white");
    expect(html).not.toMatch(/order-first|order-last|lg:order-/);
    expect(html).not.toMatch(/street rhino|streetwize|leisurewize|saxon|bramley|kidzmotion/i);
    expect(html).not.toMatch(/trade-visible/);
    expect(html).not.toMatch(/coming soon|explore all our brands/i);
    expect(html).toContain("8 trade products");
    expect(html).toContain("319 trade products");
    expect(html).toContain('href="/brands/steel-seal"');
    expect(html).toContain('href="/brands/power-maxed"');
    expect(html).toContain('alt="Steel Seal logo"');
    expect(html).toContain('alt="Power Maxed logo"');
    expect(html).toContain("Head Gasket &amp; Cooling Repair");
    expect(html).toContain("Vehicle Care &amp; Workshop");
    expect(html).not.toMatch(/FBA|backorder|purchase recommendation|internal stock|supplier cost/i);
  });

  it("offers a trade account to anonymous visitors and shops products", () => {
    const html = renderShowcase({ signedIn: false });
    expect(html).toContain('data-offer-trade-account="yes"');
    expect(html).toContain('href="/register"');
    expect(html).toContain("Open a Trade Account");
    expect(html).toContain('href="/products"');
    expect(html).toContain("Shop Products");
    expect(html.indexOf("Shop Steel Seal")).toBeLessThan(html.indexOf("Shop Power Maxed"));
  });

  it("does not ask an approved trade customer to open an account", () => {
    const html = renderShowcase(tradeCustomer());
    expect(html).toContain('data-offer-trade-account="no"');
    expect(html).not.toMatch(/open a trade account/i);
    expect(html).not.toContain('href="/register"');
    expect(html).toContain('href="/products"');
    expect(html).toContain('href="/portal"');
    expect(html).toContain("Trade Portal");
    expect(html.indexOf('data-brand-showcase="steel-seal"')).toBeLessThan(
      html.indexOf('data-brand-showcase="power-maxed"'),
    );
  });

  it("shows a CMS photograph on the published showcase and keeps the dark fallback when none is set", () => {
    const content = defaultBrandsShowcaseContent();
    content.hero.headline = "Workshop brands.\nOne trade account.";
    content.steelSeal.media = {
      src: "/api/cms-media/engine-photo",
      alt: "Close-up of an engine head gasket",
    };
    content.steelSeal.ctaLabel = "Shop Steel Seal";
    const html = renderShowcase({ signedIn: false }, content);
    expect(html.indexOf('data-brand-showcase="steel-seal"')).toBeLessThan(
      html.indexOf('data-brand-showcase="power-maxed"'),
    );
    expect(html).toContain("Workshop brands.");
    expect(html).toContain('src="/api/cms-media/engine-photo"');
    expect(html).toContain('alt="Close-up of an engine head gasket"');
    expect(html).toContain('data-brand-visual="photo"');
    expect(html).toContain('data-brand-visual="fallback"');
    expect(html).toContain('href="/brands/steel-seal"');
    expect(html).toContain('href="/brands/power-maxed"');
    expect(html).not.toContain("bg-white");
    expect(html).not.toMatch(/street rhino|streetwize|leisurewize|saxon|bramley|kidzmotion/i);
  });
});
