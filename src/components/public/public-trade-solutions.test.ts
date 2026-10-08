import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CmsSectionRenderer } from "@/components/cms/CmsSectionRenderer";
import { SectionSettings } from "@/components/cms/SectionSettings";
import { PublicTradeSolutions } from "@/components/public/PublicTradeSolutions";
import { defaultSectionConfig } from "@/domain/cms-editor";
import { defaultTradeSolutionsContent, type TradeSolutionsContent } from "@/domain/trade-solutions-content";
import type { ClientSession } from "@/server/auth/session";

function renderPage(session: ClientSession, content: TradeSolutionsContent = defaultTradeSolutionsContent()) {
  return renderToStaticMarkup(
    createElement(PublicTradeSolutions, { content, session }) as ReactElement,
  );
}

const tradeCustomer: ClientSession = {
  signedIn: true,
  user: {
    id: "u-trade",
    email: "buyer@example.invalid",
    name: "Trade Buyer",
    actorType: "TRADE",
    systemRoles: [],
    displayRole: "TRADE BUYER",
    companyId: "co1",
    companyName: "Example Factors",
    accountNumber: "AB-100",
    tradeRole: "TRADE_BUYER",
    navPermissions: [],
    actingFor: null,
    tradeTestPricingMode: "NONE",
    tradeTestPriceListId: null,
    tradeTestPriceListName: null,
    twoFactorEnabled: false,
    mfaRequired: false,
  },
};

describe("public trade solutions page", () => {
  it("renders the approved sections with Steel Seal before Power Maxed", () => {
    const html = renderPage({ signedIn: false });
    expect(html).toContain('data-trade-template="trade-solutions"');
    for (const section of ["hero", "portal", "benefits", "steps", "brands", "faq"]) {
      expect(html).toContain(`data-trade-section="${section}"`);
    }
    expect(html).not.toContain('data-trade-section="close"');
    expect(html).toContain("Your trade account.");
    expect(html).toContain("text-brand-yellow");
    expect(html).toContain("Your prices.");
    expect(html).toContain("Simple, fast");
    expect(html).toContain("Real benefits for ");
    expect(html).toContain("your business");
    expect(html).toContain("How it works");
    expect(html).toContain("One trade account");
    const steel = html.indexOf('data-trade-brand="steel-seal"');
    const power = html.indexOf('data-trade-brand="power-maxed"');
    expect(steel).toBeGreaterThan(-1);
    expect(power).toBeGreaterThan(steel);
    expect(html.match(/data-trade-brand="/g)).toHaveLength(2);
    expect(html.indexOf("/brand/steel-seal-logo.png")).toBeLessThan(html.indexOf("/brand/power-maxed-logo.png"));
    expect(html).toContain('alt="Steel Seal logo"');
    expect(html).toContain('alt="Power Maxed logo"');
    expect(html).not.toMatch(/street rhino|streetwize|leisurewize|saxon|bramley|kidzmotion/i);
    expect(html).not.toContain("bg-white");
    expect(html).toContain("max-w-[1400px]");
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("md:grid-cols-2");
    expect(html).toContain("xl:grid-cols-3");
    expect(html).toContain("lg:grid-cols-3");
    expect(html).not.toMatch(/order-first|order-last|lg:order-/);
  });

  it("links anonymous visitors to registration and approved customers to the portal", () => {
    const anonymous = renderPage({ signedIn: false });
    expect(anonymous).toContain('data-offer-trade-account="yes"');
    expect(anonymous).toContain('href="/register"');
    expect(anonymous).toContain("Open a Trade Account");
    expect(anonymous).toContain('href="#trade-benefits"');
    expect(anonymous).toContain("Explore the Benefits");
    expect(anonymous).toContain('href="/portal"');
    expect(anonymous).toContain("Explore the Portal");
    expect(anonymous).toContain('href="/products"');
    expect(anonymous).toContain("Shop Products");

    const approved = renderPage(tradeCustomer);
    expect(approved).toContain('data-offer-trade-account="no"');
    expect(approved).not.toMatch(/open a trade account/i);
    expect(approved).not.toContain('href="/register"');
    expect(approved).toContain("Go to Trade Portal");
    expect(approved).toContain('href="/portal"');
    expect(approved).toContain('href="/products"');
    expect(approved).toContain('href="#trade-benefits"');
  });

  it("renders six benefits, three steps and a keyboard-accessible FAQ without review notes", () => {
    const html = renderPage({ signedIn: false });
    for (const title of [
      "Trade pricing",
      "Customer-specific pricing",
      "Case ordering",
      "Stock availability",
      "Quick ordering",
      "Account support",
    ]) {
      expect(html).toContain(title);
    }
    expect(html).not.toContain("Live availability");
    expect(html).toContain("01");
    expect(html).toContain("02");
    expect(html).toContain("03");
    expect(html).toContain("Apply for an account");
    expect(html).toContain("Get approved");
    expect(html).toContain("Start ordering");
    expect(html).toContain("Who can apply for a trade account?");
    expect(html).toContain("<summary");
    expect(html).toContain('name="trade-faq"');
    expect(html).toContain("group-open:block");
    expect(html).toContain("A fixed approval time is not published");
    expect(html).not.toContain("Confirm eligibility");
    expect(html).not.toContain("Add an approval time");
    expect(html).not.toContain("Confirm delivery options");
    expect(html.toLowerCase()).not.toContain("same-day despatch");
    expect(html).not.toMatch(/FBA|supplier cost|amazon|backorder|purchase recommendation|internal stock/i);
    expect(html).not.toMatch(/\b\d+\s+in stock\b/i);
    expect(html).toContain('data-hero-visual="fallback"');
    expect(html).toContain('data-portal-screenshot="missing"');
    expect(html).toContain("This page does not show sample products or prices.");
    expect(html).toContain("Monday to Friday");
    expect(html).toContain("13:00");
  });

  it("renders selected media and keeps the CMS preview on the same template", () => {
    const content = defaultTradeSolutionsContent();
    content.hero.media = { src: "/api/cms-media/workshop", alt: "Mechanic using a laptop", focalX: 72, focalY: 46 };
    content.portal.media = { src: "/api/cms-media/portal", alt: "Trade portal product list" };
    content.close.enabled = true;
    const html = renderPage({ signedIn: false }, content);
    expect(html).toContain('src="/api/cms-media/workshop"');
    expect(html).toContain('alt="Mechanic using a laptop"');
    expect(html).toContain("object-position:72% 46%");
    expect(html).not.toContain('data-hero-visual="fallback"');
    expect(html).toContain('data-portal-screenshot="image"');
    expect(html).toContain('alt="Trade portal product list"');
    expect(html).toContain('data-trade-section="close"');
    expect(html).toContain("Browse Products");

    const preview = renderToStaticMarkup(
      createElement(CmsSectionRenderer, {
        section: {
          id: "preview",
          type: "TRADE_SOLUTIONS",
          config: defaultSectionConfig("TRADE_SOLUTIONS"),
        },
      }) as ReactElement,
    );
    expect(preview).toContain('data-trade-template="trade-solutions"');
    expect(preview).toContain('data-trade-section="benefits"');
    expect(preview).toContain('data-offer-trade-account="yes"');
    expect(preview.indexOf('data-trade-brand="steel-seal"')).toBeLessThan(
      preview.indexOf('data-trade-brand="power-maxed"'),
    );

    const editor = renderToStaticMarkup(
      createElement(SectionSettings, {
        type: "TRADE_SOLUTIONS",
        config: defaultSectionConfig("TRADE_SOLUTIONS"),
        onChange: () => undefined,
      }) as ReactElement,
    );
    expect(editor).toContain('data-cms-editor="trade-solutions"');
    expect(editor).toContain('data-media-slot="hero"');
    expect(editor).toContain('data-media-slot="portal"');
    expect(editor).toContain('data-media-slot="steel-seal"');
    expect(editor).toContain('data-media-slot="power-maxed"');
    expect(editor).toContain("Review note (editors only)");
    expect(editor).toContain("Add question");
    expect(editor).toContain("Move up");
    expect(editor.indexOf("Steel Seal photography")).toBeLessThan(editor.indexOf("Power Maxed photography"));
  });
});
