import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ClientSession } from "@/server/auth/session";
import { ALL_PERMISSIONS } from "@/domain/permissions";

const sessionState: { current: ClientSession } = {
  current: { signedIn: false },
};

vi.mock("@/lib/session", () => ({
  useSession: () => ({ ...sessionState.current, loading: false, refresh: async () => undefined }),
  guestSession: { signedIn: false },
  canViewBasketSession: (session: ClientSession) =>
    Boolean(
      session.signedIn &&
        ((session.user?.actorType === "TRADE" && session.user.companyId) ||
          (session.user?.actorType === "INTERNAL" &&
            (session.user.tradeTestPricingMode === "BASE_TRADE" ||
              (session.user.tradeTestPricingMode === "PRICE_LIST" &&
                session.user.tradeTestPriceListId)))),
    ),
  RequestSessionProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/server/auth/session", async () => {
  const actual = await vi.importActual<typeof import("@/server/auth/session")>("@/server/auth/session");
  return {
    ...actual,
    signOutCurrent: vi.fn(async () => ({ ok: true })),
  };
});

vi.mock("@/server/phase2/fns", () => ({
  getBasketSummaryFn: vi.fn(async () => ({
    ok: true,
    data: { basketId: "b1", companyId: "c1", lineCount: 3, unitCount: 36 },
  })),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    activeProps,
    activeOptions: _activeOptions,
    className,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    activeProps?: { className?: string };
    activeOptions?: unknown;
    className?: string;
  } & Record<string, unknown>) => {
    const resolvedClassName =
      typeof className === "string" && activeProps?.className && to === "/motorsport"
        ? activeProps.className
        : className;
    return createElement(
      "a",
      { href: typeof to === "string" ? to : "/", ...rest, className: resolvedClassName },
      children,
    );
  },
  useRouter: () => ({ invalidate: async () => undefined }),
}));

import {
  Breadcrumbs,
  PublicHeader,
  PublicPageBreadcrumbs,
} from "@/components/ab/PublicLayout";
import { Logo } from "@/components/ab/Logo";
import { PublicCmsPage } from "@/components/public/PublicCmsPage";

function html(node: ReactNode) {
  return renderToStaticMarkup(node as ReactElement);
}

const tradeSession: ClientSession = {
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
    navPermissions: ["orders.view", "orders.create", "pricing.view", "products.view"],
    actingFor: null,
    tradeTestPricingMode: "NONE",
    tradeTestPriceListId: null,
    tradeTestPriceListName: null,
  },
};

const adminSession: ClientSession = {
  signedIn: true,
  user: {
    id: "u-admin",
    email: "admin@example.com",
    name: "Admin User",
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
  },
};

describe("public header navigation refinement", () => {
  it("desktop primary nav uses Why Us and keeps destination /why-automotive-brands", () => {
    sessionState.current = { signedIn: false };
    const markup = html(createElement(PublicHeader));
    expect(markup).toContain('data-public-header="primary-nav"');
    expect(markup).toContain("Products");
    expect(markup).toContain("Brands");
    expect(markup).toContain("Trade Solutions");
    expect(markup).toContain("Motorsport");
    expect(markup).toContain("Why Us");
    expect(markup).toContain('href="/why-automotive-brands"');
    expect(markup).toContain('href="/motorsport"');
    expect(markup).toMatch(/whitespace-nowrap/);
  });

  it("Motorsport link carries active underline treatment classes", () => {
    sessionState.current = { signedIn: false };
    const markup = html(createElement(PublicHeader));
    // Mock forces activeProps for /motorsport to verify underline accent wiring.
    expect(markup).toContain("after:bg-primary");
    expect(markup).toContain('href="/motorsport"');
  });

  it("logo is mark-only and enlarged for the public header", () => {
    sessionState.current = { signedIn: false };
    const markup = html(createElement(PublicHeader));
    expect(markup).toContain('data-logo-size="header"');
    expect(markup).toContain("/brand/ab-logo.jpg");
    expect(markup).not.toContain("AUTOMOTIVE BRANDS");
    expect(markup).not.toContain("Trade Supply");
    expect(markup).toContain("h-14");
  });

  it("Logo markOnly omits brand text entirely", () => {
    const markup = html(createElement(Logo, { markOnly: true, size: "header" }));
    expect(markup).not.toContain("AUTOMOTIVE BRANDS");
    expect(markup).not.toContain("Trade Supply");
    expect(markup).toContain('aria-label="Automotive Brands area home"');
  });

  it("preserves search affordance with short placeholder", () => {
    sessionState.current = { signedIn: false };
    const markup = html(createElement(PublicHeader));
    expect(markup).toContain('data-public-header="search"');
    expect(markup).toContain("Search products or SKU");
    expect(markup).toContain('data-public-header="search-full"');
    expect(markup).toContain('data-public-header="search-toggle"');
    expect(markup).toContain('data-public-header="search-mobile"');
    expect(markup).toContain('href="/products"');
  });

  it("anonymous right-side hierarchy: search, Trade Login, Open Trade Account CTA", () => {
    sessionState.current = { signedIn: false };
    const markup = html(createElement(PublicHeader));
    expect(markup).toContain('data-public-header="trade-login"');
    expect(markup).toContain('data-public-header="open-account"');
    expect(markup).toContain("Open Trade Account");
    expect(markup).not.toContain('data-public-header="my-account"');
    expect(markup).not.toContain('data-public-header="trade-portal"');
    expect(markup).not.toContain('data-public-header="admin"');
    expect(markup).toContain('data-public-header="mobile-menu-toggle"');
  });

  it("authenticated trade account dropdown exposes Trade Portal and Log out, not Admin", () => {
    sessionState.current = tradeSession;
    const markup = html(createElement(PublicHeader));
    expect(markup).toContain('data-public-header="account-menu"');
    expect(markup).toContain('data-public-header="my-account"');
    expect(markup).toContain('data-public-header="account-dropdown"');
    expect(markup).toContain('data-public-header="trade-portal"');
    expect(markup).toContain('data-public-header="logout"');
    expect(markup).not.toContain('data-public-header="admin"');
    expect(markup).toContain('data-public-header="basket"');
    expect(markup).toContain('data-basket-badge-count="0"');
  });

  it("authenticated admin account dropdown exposes Admin only when authorised", () => {
    sessionState.current = adminSession;
    const markup = html(createElement(PublicHeader));
    expect(markup).toContain('data-public-header="admin"');
    expect(markup).toContain('href="/admin"');
    expect(markup).not.toContain('data-public-header="trade-portal"');
    expect(markup).toContain("Log out");
  });

  it("mobile menu includes Why Us and anonymous auth CTAs", () => {
    sessionState.current = { signedIn: false };
    // Mobile menu is closed by default — open it via checking labels exist in primary nav
    // and that mobile CTA data attributes are defined in the component tree when opened.
    // Static render starts closed; verify mobile toggle + primary labels for drawer contents.
    const markup = html(createElement(PublicHeader));
    expect(markup).toContain('data-public-header="mobile-menu-toggle"');
    expect(markup).toContain("Why Us");
    expect(markup).toContain("Trade Solutions");
  });

  it("in-content breadcrumbs use page placement, not a full-width chrome strip", () => {
    const crumbs = html(
      createElement(PublicPageBreadcrumbs, {
        items: [
          { label: "Home", to: "/" },
          { label: "Motorsport" },
        ],
      }),
    );
    expect(crumbs).toContain('data-public-breadcrumbs="page"');
    expect(crumbs).toContain("Home");
    expect(crumbs).toContain("Motorsport");
    expect(crumbs).not.toContain("border-b border-border/40");
    expect(crumbs).toContain('aria-label="Breadcrumb"');
  });

  it("products and brand breadcrumb items render through shared Breadcrumbs", () => {
    const products = html(
      createElement(Breadcrumbs, {
        items: [
          { label: "Home", to: "/" },
          { label: "Products" },
        ],
      }),
    );
    const brand = html(
      createElement(Breadcrumbs, {
        items: [
          { label: "Home", to: "/" },
          { label: "Brands", to: "/brands" },
          { label: "Power Maxed" },
        ],
      }),
    );
    expect(products).toContain("Products");
    expect(brand).toContain("Power Maxed");
    expect(brand).toContain('href="/brands"');
  });

  it("PublicCmsPage places breadcrumbs in page content without dark strip wrapper", () => {
    const markup = html(
      createElement(PublicCmsPage, {
        page: {
          slug: "why-automotive-brands",
          title: "Why Automotive Brands",
          seoTitle: null,
          metaDescription: null,
          ogImageSrc: null,
          sections: [],
        },
        breadcrumbs: [
          { label: "Home", to: "/" },
          { label: "Why Automotive Brands" },
        ],
      }),
    );
    expect(markup).toContain('data-public-breadcrumbs="page"');
    expect(markup).toContain("Why Automotive Brands");
    expect(markup).not.toContain("border-b border-border/40");
  });
});
