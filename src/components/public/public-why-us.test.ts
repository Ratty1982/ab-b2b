import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CmsSectionRenderer } from "@/components/cms/CmsSectionRenderer";
import { SectionSettings } from "@/components/cms/SectionSettings";
import { PublicWhyUs, type WhyUsTeamProfile } from "@/components/public/PublicWhyUs";
import { defaultSectionConfig } from "@/domain/cms-editor";
import { defaultWhyUsContent, type WhyUsContent } from "@/domain/why-us-content";
import type { ClientSession } from "@/server/auth/session";

function renderPage(
  session: ClientSession,
  content: WhyUsContent = defaultWhyUsContent(),
  team: readonly WhyUsTeamProfile[] = [],
) {
  return renderToStaticMarkup(createElement(PublicWhyUs, { content, session, team }) as ReactElement);
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

const internalAdmin: ClientSession = {
  signedIn: true,
  user: {
    ...tradeCustomer.user,
    id: "u-admin",
    email: "admin@example.invalid",
    actorType: "INTERNAL",
    companyId: null,
    companyName: null,
    accountNumber: null,
    tradeRole: null,
    navPermissions: ["admin.access"],
    displayRole: "Super Admin",
  },
};

describe("public why us page", () => {
  it("renders the company sections in order with Steel Seal before Power Maxed", () => {
    const html = renderPage({ signedIn: false });
    const order = ["hero", "stats", "story", "support", "testimonials", "brands", "close"].map((section) =>
      html.indexOf(`data-why-section="${section}"`),
    );
    expect(order.every((index, position) => index > (order[position - 1] ?? -1))).toBe(true);
    expect(html).not.toContain('data-why-section="team"');
    expect(html).toContain('data-why-template="why-us"');
    expect(html).toContain("More than a supplier.");
    expect(html).toContain("text-brand-yellow");
    expect(html).toContain("A partner in your success.");
    expect(html).toContain("40+");
    expect(html).toContain("3,000+");
    expect(html).toContain("UK &amp; international");
    expect(html).toContain("builds brands that perform.");
    expect(html).toContain("More than just a supply chain");
    for (const title of ["Distribution", "Product development", "Marketing support", "Long-term partnerships"]) {
      expect(html).toContain(title);
    }
    expect(html).toContain("Filipe Barradas");
    expect(html).toContain("Prosper Popularity");
    expect(html).toContain("Portugal");
    expect(html).toContain("oy my staff");
    expect(html).toContain("Oliver Taskin");
    expect(html).toContain("Steel Seal GMBH");
    expect(html).toContain("Germany");
    expect(html).toContain("Its is the lucky");
    expect(html).toContain("Chris Burnside");
    expect(html).toContain("Livingston Auto Parts");
    const livingston = html.slice(html.indexOf("Chris Burnside"), html.indexOf('data-why-section="brands"'));
    expect(livingston).not.toMatch(/United Kingdom|>UK</);
    expect(html).not.toContain("Distributor Testimonial");
    expect(html).not.toContain("Confirm before correcting");
    expect(html).not.toContain("does not state a country");
    expect(html).not.toContain("collective industry experience");
    expect(html).not.toContain("Do not add awards");
    const steel = html.indexOf('data-why-brand="steel-seal"');
    const power = html.indexOf('data-why-brand="power-maxed"');
    expect(steel).toBeGreaterThan(-1);
    expect(power).toBeGreaterThan(steel);
    expect(html.match(/data-why-brand="/g)).toHaveLength(2);
    expect(html.indexOf("/brand/steel-seal-logo.png")).toBeLessThan(html.indexOf("/brand/power-maxed-logo.png"));
    expect(html).toContain('href="/brands/steel-seal"');
    expect(html).toContain('href="/brands/power-maxed"');
    expect(html).toContain('alt="Steel Seal logo"');
    expect(html).toContain('alt="Power Maxed logo"');
    expect(html).toContain("object-contain");
    expect(html).toContain("max-w-[1400px]");
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("sm:grid-cols-3");
    expect(html).toContain("xl:grid-cols-4");
    expect(html).toContain("lg:grid-cols-2");
    expect(html).not.toContain("bg-white");
    expect(html).not.toContain("Mug Shots Coming Soon");
    expect(html).not.toContain('data-team-photo-placeholder');
    expect(html).not.toMatch(/FBA|supplier cost|amazon|purchase recommendation/i);
    expect(html).not.toMatch(/\b\d+\s+in stock\b/i);
    expect(html).not.toMatch(/discount|credit terms|guaranteed approval/i);
    expect(html).toContain("This is not a photograph of a named Automotive Brands building.");
  });

  it("links anonymous visitors to registration and approved customers to the portal", () => {
    const anonymous = renderPage({ signedIn: false });
    expect(anonymous).toContain('data-offer-trade-account="yes"');
    expect(anonymous.match(/href="\/register"/g)).toHaveLength(2);
    expect(anonymous).toContain("Open a Trade Account");

    const approved = renderPage(tradeCustomer);
    expect(approved).toContain('data-offer-trade-account="no"');
    expect(approved).toContain("one convenient ordering portal");
    expect(approved).not.toContain('href="/register"');
    const approvedCtas = approved.match(/data-why-cta="(?:hero|close)"[\s\S]*?<\/a>/g) ?? [];
    expect(approvedCtas).toHaveLength(2);
    expect(approvedCtas.join("")).not.toMatch(/open a trade account/i);
    expect(approved.match(/Go to Trade Portal/g)).toHaveLength(2);
    expect(approved.match(/href="\/portal"/g)).toHaveLength(2);
    expect(approved).toContain('href="/brands/steel-seal"');
    expect(approved).toContain('href="/brands/power-maxed"');

    const admin = renderPage(internalAdmin);
    expect(admin).toContain('href="/admin"');
    expect(admin).toContain("Admin");
    expect(admin).not.toContain('href="/register"');
  });

  it("hides testimonials and statistics when they are unpublished", () => {
    const content = defaultWhyUsContent();
    content.testimonials.items = content.testimonials.items.map((item) => ({ ...item, published: false }));
    content.stats.enabled = false;
    const html = renderPage({ signedIn: false }, content);
    expect(html).not.toContain('data-why-section="testimonials"');
    expect(html).not.toContain('data-why-section="stats"');
    expect(html).not.toContain("Filipe Barradas");
    expect(html).not.toContain("oy my staff");
  });

  it("shows only published profiles that have a photograph", () => {
    const hidden = renderPage({ signedIn: false }, defaultWhyUsContent(), [
      {
        id: "with-photo",
        displayName: "Alex Example",
        jobTitle: "Trade Manager",
        photo: { src: "/api/cms-media/alex", alt: "Alex Example" },
      },
    ]);
    expect(hidden).not.toContain('data-why-section="team"');
    expect(hidden).not.toContain("Alex Example");

    const content = defaultWhyUsContent();
    content.team.enabled = true;
    const shown = renderPage({ signedIn: false }, content, [
      {
        id: "with-photo",
        displayName: "Alex Example",
        jobTitle: "Trade Manager",
        photo: { src: "/api/cms-media/alex", alt: "Portrait of Alex Example" },
      },
      {
        id: "no-photo",
        displayName: "Sam Placeholder",
        jobTitle: "Buyer",
        photo: null,
      },
    ]);
    expect(shown).toContain('data-why-section="team"');
    expect(shown).toContain("Alex Example");
    expect(shown).toContain('alt="Portrait of Alex Example"');
    expect(shown).toContain("aspect-[4/5]");
    expect(shown).not.toContain("Sam Placeholder");
    expect(shown).not.toContain('data-team-photo-placeholder');

    const empty = renderPage({ signedIn: false }, content, [
      { id: "no-photo", displayName: "Sam Placeholder", jobTitle: "Buyer", photo: null },
    ]);
    expect(empty).not.toContain('data-why-section="team"');
  });

  it("uses the same template in CMS preview and exposes the editor controls", () => {
    const content = defaultWhyUsContent();
    content.hero.media = { src: "/api/cms-media/aisle", alt: "Warehouse aisle", focalX: 30, focalY: 40 };
    content.story.media = { src: "/api/cms-media/product", alt: "Product photography" };
    const html = renderPage({ signedIn: false }, content);
    expect(html).toContain('src="/api/cms-media/aisle"');
    expect(html).toContain("object-position:30% 40%");
    expect(html).toContain('data-why-story-visual="image"');
    expect(html).toContain('alt="Product photography"');

    const preview = renderToStaticMarkup(
      createElement(CmsSectionRenderer, {
        section: { id: "preview", type: "WHY_US", config: defaultSectionConfig("WHY_US") },
      }) as ReactElement,
    );
    expect(preview).toContain('data-why-template="why-us"');
    expect(preview).toContain('data-why-section="stats"');
    expect(preview).toContain('data-offer-trade-account="yes"');
    expect(preview.indexOf('data-why-brand="steel-seal"')).toBeLessThan(preview.indexOf('data-why-brand="power-maxed"'));
    expect(preview).not.toContain('data-why-section="team"');

    const editor = renderToStaticMarkup(
      createElement(SectionSettings, {
        type: "WHY_US",
        config: defaultSectionConfig("WHY_US"),
        onChange: () => undefined,
      }) as ReactElement,
    );
    expect(editor).toContain('data-cms-editor="why-us"');
    expect(editor).toContain("Show Meet the Team on Website");
    expect(editor).toContain("Review note (editors only)");
    expect(editor).toContain("Add testimonial");
    expect(editor).toContain("Add support card");
    expect(editor).toContain("Move up");
    for (const slot of ["hero", "story", "steel-seal", "power-maxed"]) {
      expect(editor).toContain(`data-media-slot="${slot}"`);
    }
    expect(editor.indexOf("Steel Seal photography")).toBeLessThan(editor.indexOf("Power Maxed photography"));
    expect(editor).not.toContain("Street Rhino");
  });
});
