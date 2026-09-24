import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "@/domain/permissions";
import { SYSTEM_ROLE_PERMISSIONS, TRADE_ROLE_PERMISSIONS } from "@/domain/role-permissions";
import {
  BACK_OFFICE_NAV,
  ROUTES,
  TRADE_PORTAL_NAV,
  areaHomePath,
  backOfficeNavForUser,
  breadcrumbsForPath,
  collectNavDefs,
  flattenVisible,
  isItemActive,
  navCtxFromUser,
  portalNavForUser,
  visibleNav,
} from "@/lib/app-nav";
import type { SafeSessionUser } from "@/server/auth/session";

function user(partial: Partial<SafeSessionUser> & Pick<SafeSessionUser, "actorType" | "navPermissions">): SafeSessionUser {
  return {
    id: "1",
    email: "a@b.com",
    name: "Test",
    systemRoles: [],
    displayRole: "Test",
    companyId: null,
    companyName: null,
    accountNumber: null,
    tradeRole: null,
    actingFor: null,
      tradeTestPricingMode: "NONE",
      tradeTestPriceListId: null,
      tradeTestPriceListName: null,
    ...partial,
  };
}

const superAdmin = user({
  actorType: "INTERNAL",
  systemRoles: ["SUPER_ADMIN"],
  displayRole: "Super Admin",
  navPermissions: [...ALL_PERMISSIONS],
});

const salesRep = user({
  actorType: "INTERNAL",
  systemRoles: ["SALES_REPRESENTATIVE"],
  displayRole: "Sales Representative",
  navPermissions: [...SYSTEM_ROLE_PERMISSIONS.SALES_REPRESENTATIVE],
});

const tradeBuyer = user({
  actorType: "TRADE",
  displayRole: "Trade Buyer",
  tradeRole: "TRADE_BUYER",
  navPermissions: [...TRADE_ROLE_PERMISSIONS.TRADE_BUYER],
});

describe("canonical navigation contract", () => {
  it("has unique ids across back-office and portal trees", () => {
    const ids = [
      ...collectNavDefs(BACK_OFFICE_NAV).map((i) => i.id),
      ...collectNavDefs(TRADE_PORTAL_NAV).map((i) => i.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not expose unimplemented items", () => {
    const visible = flattenVisible(backOfficeNavForUser(superAdmin));
    expect(visible.map((i) => i.id)).toContain("orders");
    expect(visible.map((i) => i.id)).not.toContain("invoices");
    expect(visible.map((i) => i.id)).toContain("brands");
    expect(visible.map((i) => i.id)).toContain("categories");
    expect(visible.map((i) => i.id)).toContain("product-imports");
    expect(visible.map((i) => i.id)).not.toContain("crm-leads");
    expect(visible.map((i) => i.id)).not.toContain("audit-log");
  });

  it("gives SUPER_ADMIN Website Pages, Homepage, Team and Media", () => {
    const items = flattenVisible(backOfficeNavForUser(superAdmin));
    const ids = items.map((i) => i.id);
    expect(ids).toContain("website-pages");
    expect(ids).toContain("website-homepage");
    expect(ids).toContain("website-team");
    expect(ids).toContain("website-media");
    expect(items.find((i) => i.id === "website-homepage")?.to).toBe(ROUTES.adminHomepage);
    expect(items.find((i) => i.id === "website-pages")?.to).toBe(ROUTES.adminContent);
    expect(items.find((i) => i.id === "website-team")?.to).toBe(ROUTES.adminTeam);
    expect(items.find((i) => i.id === "website-media")?.to).toBe(ROUTES.adminMedia);
    const sections = backOfficeNavForUser(superAdmin).map((s) => s.id);
    expect(sections).toEqual(["home", "sales", "catalogue", "crm", "website", "operations", "system"]);
  });

  it("keeps Website nav as Pages, Homepage, Team, Media in that order", () => {
    const website = BACK_OFFICE_NAV.find((s) => s.id === "website");
    expect(website?.items.map((i) => i.id)).toEqual([
      "website-pages",
      "website-homepage",
      "website-team",
      "website-media",
    ]);
    expect(website?.items.map((i) => i.label)).toEqual(["Pages", "Homepage", "Team", "Media"]);
    expect(website?.items.map((i) => i.to)).toEqual([
      ROUTES.adminContent,
      ROUTES.adminHomepage,
      ROUTES.adminTeam,
      ROUTES.adminMedia,
    ]);
    const sections = BACK_OFFICE_NAV.map((s) => s.id);
    expect(sections.indexOf("website")).toBeGreaterThan(sections.indexOf("crm"));
    expect(sections.indexOf("website")).toBeLessThan(sections.indexOf("operations"));
  });

  it("gives SUPER_ADMIN unique visible destinations", () => {
    const tos = flattenVisible(backOfficeNavForUser(superAdmin)).map((i) => i.to);
    expect(new Set(tos).size).toBe(tos.length);
  });

  it("hides admin-only navigation from sales representatives", () => {
    const items = flattenVisible(backOfficeNavForUser(salesRep));
    const ids = items.map((i) => i.id);
    expect(ids).toContain("dashboard");
    expect(ids).toContain("customers");
    expect(ids).toContain("trade-applications");
    expect(ids).toContain("quotes");
    expect(ids).toContain("opportunities");
    expect(ids).not.toContain("website-pages");
    expect(ids).not.toContain("website-homepage");
    expect(ids).not.toContain("website-team");
    expect(ids).not.toContain("website-media");
    expect(ids).not.toContain("products");
    expect(ids).not.toContain("users");
    expect(ids).not.toContain("settings");
    expect(ids).not.toContain("sales-team");
    expect(items.find((i) => i.id === "customers")?.label).toBe("My Customers");
    expect(items.find((i) => i.id === "customers")?.to).toBe(ROUTES.salesCustomers);
  });

  it("uses portal navigation for trade customers, never back-office Website", () => {
    const portal = flattenVisible(portalNavForUser(tradeBuyer));
    expect(portal.some((i) => i.to === ROUTES.portal)).toBe(true);
    expect(portal.some((i) => i.id === "website-homepage")).toBe(false);
    const backoffice = flattenVisible(visibleNav(BACK_OFFICE_NAV, navCtxFromUser(tradeBuyer)));
    expect(backoffice.some((i) => i.id === "website-homepage")).toBe(false);
  });

  it("sends the logo to the correct area home", () => {
    expect(areaHomePath(navCtxFromUser(superAdmin))).toBe(ROUTES.admin);
    expect(areaHomePath(navCtxFromUser(salesRep))).toBe(ROUTES.sales);
    expect(areaHomePath(navCtxFromUser(tradeBuyer))).toBe(ROUTES.portal);
  });

  it("marks Homepage active on the editor URL and Pages on the list URL", () => {
    const items = flattenVisible(backOfficeNavForUser(superAdmin));
    const pages = items.find((i) => i.id === "website-pages")!;
    const home = items.find((i) => i.id === "website-homepage")!;
    const media = items.find((i) => i.id === "website-media")!;
    expect(isItemActive(home, "/admin/content/home")).toBe(true);
    expect(isItemActive(pages, "/admin/content/home")).toBe(false);
    expect(isItemActive(pages, "/admin/content")).toBe(true);
    expect(isItemActive(media, "/admin/content/media")).toBe(true);
    expect(isItemActive(pages, "/admin/content/media")).toBe(false);
    const dash = items.find((i) => i.id === "dashboard")!;
    expect(isItemActive(dash, "/admin")).toBe(true);
    expect(isItemActive(dash, "/admin/customers")).toBe(false);
    const customers = items.find((i) => i.id === "customers")!;
    expect(isItemActive(customers, "/admin/customers/abc")).toBe(true);
  });

  it("builds Website > Homepage breadcrumbs", () => {
    const crumbs = breadcrumbsForPath("/admin/content/home", navCtxFromUser(superAdmin));
    expect(crumbs.map((c) => c.label)).toEqual(["Website", "Homepage"]);
  });
});
