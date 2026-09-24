import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSession } from "@/server/auth/session";
import { canViewBasketSession, hasOrderingCompanyContext, isTradeCustomerSession } from "@/lib/session-guards";
import { buildSafeSession, sessionDiagnostics } from "@/server/auth/request-session";
import { BASKET_UPDATED_EVENT } from "@/lib/basket-events";
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
  hasOrderingCompanyContext: (session: ClientSession) =>
    Boolean(
      session.signedIn &&
        ((session.user?.actorType === "TRADE" && session.user.companyId) ||
          (session.user?.actorType === "INTERNAL" &&
            (session.user.tradeTestPricingMode === "BASE_TRADE" ||
              (session.user.tradeTestPricingMode === "PRICE_LIST" &&
                session.user.tradeTestPriceListId)))),
    ),
  isTradeCustomerSession: (session: ClientSession) =>
    Boolean(session.signedIn && session.user?.actorType === "TRADE" && session.user.companyId),
  RequestSessionProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/server/auth/session", async () => {
  const actual = await vi.importActual<typeof import("@/server/auth/session")>("@/server/auth/session");
  return {
    ...actual,
    signOutCurrent: vi.fn(async () => ({ ok: true })),
    resolvePostLoginPath: () => "/portal",
  };
});

vi.mock("@/server/phase2/fns", () => ({
  getBasketSummaryFn: vi.fn(async () => ({
    ok: true,
    data: { basketId: "b1", companyId: "c1", lineCount: 2, unitCount: 24 },
  })),
  getProductOrderingPanelFn: vi.fn(),
  previewProductOrderQuantityFn: vi.fn(),
  addToBasketFn: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string } & Record<string, unknown>) =>
    createElement("a", { href: typeof to === "string" ? to : "/", ...rest }, children),
  useRouter: () => ({ invalidate: async () => undefined }),
  getRouteApi: () => ({
    useRouteContext: () => ({ session: sessionState.current }),
  }),
}));

import { PublicHeader } from "@/components/ab/PublicLayout";
import { BasketNavBadge } from "@/components/ab/BasketNavBadge";
import { TradePrice } from "@/components/ab/Price";
import { ProductTradeOrdering } from "@/components/public/ProductTradeOrdering";
import { ProductDetailView, type PublicProductDetail } from "@/components/public/ProductDetail";
import type { PublicProductCard } from "@/server/catalogue/products";

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

const orderablePanel = {
  orderable: true,
  reason: null,
  caseQty: 12,
  caseTitle: "Case of 12",
  caseSubtitle: "Sold in multiples of 12",
  minimumQuantity: 12,
  quantityStep: 12,
  quantity: 12,
  caseCount: 1,
  caseCountLabel: "1 case",
  unitPriceExVat: "3.6900",
  unitPriceExVatDisplay: "3.69",
  lineNetDisplay: "44.28",
  canIncrement: true,
  canDecrement: false,
  canAdd: true,
  insufficientFullCase: false,
  isFinalPartCase: false,
  remainingQty: null,
} as const;

function card(partial: Partial<PublicProductCard> = {}): PublicProductCard {
  return {
    id: "p-pmml",
    sku: "PMML500SC40",
    slug: "pmml500sc40",
    name: "5-in-1 Multi Lube 500ml",
    brand: "Power Maxed",
    brandSlug: "power-maxed",
    category: "Lubricants",
    categorySlug: "lubricants",
    imageSrc: "/media/pmml.jpg",
    rrp: 7.99,
    price: { currency: "GBP", trade: 3.69, rrp: 7.99, source: "base_catalogue" },
    availability: "in",
    isNew: false,
    isFeatured: false,
    variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
    ordering: null,
    ...partial,
  };
}

function detail(partial: Partial<PublicProductDetail> = {}): PublicProductDetail {
  return {
    card: card(),
    sku: "PMML500SC40",
    variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
    shortDescription: "Versatile 500ml maintenance spray for workshops and trade use.",
    description: "Full description for Multi Lube.",
    specifications: [{ name: "size", value: "500ml" }],
    selling: {
      keyBenefits: ["Multi-purpose lubricant"],
      features: ["500ml aerosol"],
      applications: ["Workshop"],
      directions: "Shake well before use.",
      warnings: null,
    },
    gallery: [{ src: "/media/pmml.jpg", alt: "5-in-1 Multi Lube 500ml" }],
    related: [],
    packQty: 1,
    caseQty: 12,
    minimumOrderQty: 12,
    orderIncrement: 12,
    unit: "EA",
    orderingPanel: orderablePanel,
    ...partial,
  };
}

describe("public trade session chrome", () => {
  beforeEach(() => {
    sessionState.current = { signedIn: false };
  });

  it("anonymous header shows Trade Login and Open a Trade Account, not Basket", () => {
    const markup = html(createElement(PublicHeader));
    expect(markup).toContain("Trade Login");
    expect(markup).toContain("Open a Trade Account");
    expect(markup).not.toContain("My Account");
    expect(markup).not.toContain(">Basket<");
    expect(markup).not.toContain('data-public-header="basket"');
    expect(markup).not.toContain("Log out");
    expect(markup).toContain("Products");
    expect(markup).toContain("Brands");
    expect(markup).toContain("Trade Solutions");
    expect(markup).toContain("Why Automotive Brands");
    expect(markup).not.toContain(">Resources<");
    expect(markup).not.toContain(">About Us<");
  });

  it("authenticated trade header hides login CTAs and shows Basket + Trade Portal → /portal", () => {
    sessionState.current = tradeSession;
    const markup = html(createElement(PublicHeader));
    expect(markup).not.toContain("Trade Login");
    expect(markup).not.toContain("Open a Trade Account");
    expect(markup).toContain("Trade Portal");
    expect(markup).toContain('data-public-header="trade-portal"');
    expect(markup).toContain('href="/portal"');
    expect(markup).not.toContain('data-public-header="admin"');
    expect(markup).not.toContain("My Account");
    expect(markup).not.toContain(">Account<");
    expect(markup).toContain("Basket");
    expect(markup).toContain('data-public-header="basket"');
    expect(markup).toContain("Log out");
    // Desktop Basket must not be viewport-hidden (was hidden sm:inline-flex).
    expect(markup).not.toMatch(/data-public-header="basket"[^>]*hidden sm:/);
  });

  it("authenticated internal admin header shows Admin → /admin, not Account or My Account", () => {
    sessionState.current = {
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
        navPermissions: ["admin.access", "products.edit", "pricing.edit", "cms.view"],
        actingFor: null,
      tradeTestPricingMode: "NONE",
      tradeTestPriceListId: null,
      tradeTestPriceListName: null,
      },
    };
    const markup = html(createElement(PublicHeader));
    expect(markup).toContain("Admin");
    expect(markup).toContain('data-public-header="admin"');
    expect(markup).toContain('href="/admin"');
    expect(markup).not.toContain("My Account");
    expect(markup).not.toContain(">Account<");
    expect(markup).not.toContain("Trade Login");
    expect(markup).not.toContain("Basket");
    expect(markup).toContain("Log out");
  });

  it("admin with trade test level shows Basket + Trade Portal + Admin", () => {
    sessionState.current = {
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
        tradeTestPricingMode: "PRICE_LIST",
        tradeTestPriceListId: "pl-a",
        tradeTestPriceListName: "Trade Level A",
      },
    };
    const markup = html(createElement(PublicHeader));
    expect(markup).toContain("Basket");
    expect(markup).toContain("Trade Portal");
    expect(markup).toContain("Admin");
    expect(markup).not.toContain("My Account");
    expect(markup).not.toContain(">Account<");
  });

  it("signed-in trade without orders.view still shows Basket chrome (server enforces mutate)", () => {
    sessionState.current = {
      signedIn: true,
      user: {
        ...tradeSession.user,
        navPermissions: ["pricing.view", "products.view"],
      },
    };
    const markup = html(createElement(PublicHeader));
    expect(markup).not.toContain("Trade Login");
    expect(markup).not.toContain("Open a Trade Account");
    expect(markup).toContain("Trade Portal");
    expect(markup).toContain("Log out");
    expect(markup).toContain("Basket");
  });

  it("trade customer session guards require TRADE + company; INTERNAL needs trade test level", () => {
    expect(isTradeCustomerSession(tradeSession)).toBe(true);
    expect(canViewBasketSession(tradeSession)).toBe(true);
    expect(hasOrderingCompanyContext(tradeSession)).toBe(true);
    expect(canViewBasketSession({ signedIn: false })).toBe(false);
    expect(
      canViewBasketSession({
        signedIn: true,
        user: { ...tradeSession.user, navPermissions: ["pricing.view"] },
      }),
    ).toBe(true);
    expect(
      canViewBasketSession({
        signedIn: true,
        user: { ...tradeSession.user, companyId: null as unknown as string },
      }),
    ).toBe(false);
    const adminNoCtx: ClientSession = {
      signedIn: true,
      user: {
        id: "u-admin",
        email: "a@example.com",
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
      },
    };
    expect(hasOrderingCompanyContext(adminNoCtx)).toBe(false);
    expect(canViewBasketSession(adminNoCtx)).toBe(false);
    const adminTest: ClientSession = {
      signedIn: true,
      user: {
        ...adminNoCtx.user,
        tradeTestPricingMode: "PRICE_LIST",
        tradeTestPriceListId: "pl-a",
        tradeTestPriceListName: "Trade A",
      },
    };
    expect(hasOrderingCompanyContext(adminTest)).toBe(true);
    expect(canViewBasketSession(adminTest)).toBe(true);
  });

  it("anonymous PDP price does not show YOUR PRICE amount even when trade leaks into props", () => {
    const markup = html(
      createElement(TradePrice, { trade: 3.69, rrp: 8.99, size: "lg", unitQualifier: "each" }),
    );
    expect(markup).not.toContain("Your price ·");
    expect(markup).toContain("Sign in to view your price");
    expect(markup).toContain("RRP");
    expect(markup).not.toContain("£3.69");
  });

  it("authenticated trade PDP price shows YOUR PRICE from resolved trade", () => {
    sessionState.current = tradeSession;
    const markup = html(
      createElement(TradePrice, { trade: 3.69, rrp: 8.99, size: "lg", unitQualifier: "each" }),
    );
    expect(markup).toContain("£3.69");
    expect(markup).toContain("Your price · each · ex VAT");
  });

  it("SAME authenticated request cannot show YOUR PRICE together with Trade Login", () => {
    sessionState.current = tradeSession;
    const price = html(
      createElement(TradePrice, { trade: 3.69, rrp: 7.99, size: "lg", unitQualifier: "each" }),
    );
    const header = html(createElement(PublicHeader));
    const showsYourPrice = price.includes("Your price ·") && price.includes("£3.69");
    const showsAnonCtas = header.includes("Trade Login") || header.includes("Open a Trade Account");
    expect(showsYourPrice).toBe(true);
    expect(showsAnonCtas).toBe(false);
  });

  it("anonymous Trade Ordering does not show Add to Basket or quantity controls", () => {
    const markup = html(
      createElement(ProductTradeOrdering, {
        caseQty: 12,
        variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
        productName: "5-in-1 Multi Lube 500ml",
      }),
    );
    expect(markup).toContain("Trade ordering");
    expect(markup).toContain("Sign in");
    expect(markup).not.toMatch(/Add to basket/i);
    expect(markup).not.toContain('aria-label="Increase quantity"');
  });

  it("authenticated orderable Trade Ordering shows quantity controls and Add to Basket", () => {
    sessionState.current = tradeSession;
    const markup = html(
      createElement(ProductTradeOrdering, {
        caseQty: 12,
        variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
        productName: "5-in-1 Multi Lube 500ml",
        initialPanel: orderablePanel,
      }),
    );
    expect(markup).toContain("Case of 12 · Sold in multiples of 12");
    expect(markup).toContain("£3.69 each ex VAT");
    expect(markup).toContain("£44.28");
    expect(markup).not.toContain("£3.6875");
    expect(markup).toMatch(/Total[\s\S]*ex VAT/i);
    expect(markup).toMatch(/Add to basket/i);
    expect(markup).toContain('aria-label="Increase quantity"');
    expect(markup).toContain('data-ordering-placement="hero"');
    expect(markup).not.toContain("Trade Login");
    expect(markup).not.toContain("View basket");
  });

  it("authenticated but not-orderable product keeps trade chrome messaging, not anonymous CTAs", () => {
    sessionState.current = tradeSession;
    const markup = html(
      createElement(ProductTradeOrdering, {
        caseQty: 12,
        variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
        initialPanel: {
          orderable: false,
          reason: "Insufficient stock for a full case",
          caseQty: 12,
          caseTitle: "Case of 12",
          caseSubtitle: "Sold in multiples of 12",
          minimumQuantity: 12,
          quantityStep: 12,
          quantity: 12,
          caseCount: 1,
          caseCountLabel: "1 case",
          unitPriceExVatDisplay: null,
          lineNetDisplay: null,
          canIncrement: false,
          canDecrement: false,
          canAdd: false,
          insufficientFullCase: true,
          isFinalPartCase: false,
          remainingQty: null,
        },
      }),
    );
    expect(markup).toContain("Insufficient stock for a full case");
    expect(markup).not.toMatch(/Add to basket/i);
    expect(markup).not.toContain("Sign in");
    const header = html(createElement(PublicHeader));
    expect(header).toContain("Trade Portal");
    expect(header).toContain("Basket");
    expect(header).not.toContain("Trade Login");
  });

  it("authenticated final-part-case mode shows FINAL STOCK and unit stepper", () => {
    sessionState.current = tradeSession;
    const markup = html(
      createElement(ProductTradeOrdering, {
        caseQty: 12,
        variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
        initialPanel: {
          orderable: true,
          reason: null,
          caseQty: 12,
          caseTitle: "Case of 12",
          caseSubtitle: "Normally sold in multiples of 12",
          minimumQuantity: 1,
          quantityStep: 1,
          quantity: 7,
          caseCount: null,
          caseCountLabel: null,
          unitPriceExVat: "3.6900",
          unitPriceExVatDisplay: "3.69",
          lineNetDisplay: "25.83",
          canIncrement: false,
          canDecrement: true,
          canAdd: true,
          insufficientFullCase: false,
          isFinalPartCase: true,
          remainingQty: 7,
        },
      }),
    );
    expect(markup).toContain("Final stock");
    expect(markup).toContain("Only 7 remaining");
    expect(markup).toContain("Final stock can be ordered as individual units");
    expect(markup).toContain("Normally sold in multiples of 12");
    expect(markup).toContain("7 units");
    expect(markup).toContain('data-ordering-mode="final-part-case"');
    expect(markup).toMatch(/Add to basket/i);
    expect(markup).not.toContain("Insufficient stock for a full case");
  });

  it("basket badge listens for basket-updated events", () => {
    expect(BASKET_UPDATED_EVENT).toBe("ab:basket-updated");
    sessionState.current = tradeSession;
    const markup = html(createElement(BasketNavBadge));
    expect(markup).toContain("Basket");
    expect(markup).toContain("/portal/basket");
  });
});

describe("admin / internal ordering context (PMPC1 regression)", () => {
  const adminNoCompany: ClientSession = {
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

  const singleUnitPanel = {
    orderable: true,
    reason: null,
    caseQty: 1,
    caseTitle: "Single unit",
    caseSubtitle: "Sold individually",
    minimumQuantity: 1,
    quantityStep: 1,
    quantity: 1,
    caseCount: 1,
    caseCountLabel: "1 unit",
    unitPriceExVat: "2.1900",
    unitPriceExVatDisplay: "2.19",
    lineNetDisplay: "2.19",
    canIncrement: true,
    canDecrement: false,
    canAdd: true,
    insufficientFullCase: false,
    isFinalPartCase: false,
    remainingQty: null,
  } as const;

  it("admin without trade test level is NOT told to Sign in or select a customer", () => {
    sessionState.current = adminNoCompany;
    const markup = html(
      createElement(ProductTradeOrdering, {
        caseQty: 1,
        variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
        productName: "Polishing Cloth 40cm × 40cm",
        initialPanel: {
          orderable: false,
          reason: "Select a trade test level in Admin to enable ordering.",
          caseQty: null,
          caseTitle: "Single unit",
          caseSubtitle: "Sold individually",
          minimumQuantity: null,
          quantityStep: null,
          quantity: null,
          caseCount: null,
          caseCountLabel: null,
          unitPriceExVatDisplay: null,
          lineNetDisplay: null,
          canIncrement: false,
          canDecrement: false,
          canAdd: false,
          insufficientFullCase: false,
          isFinalPartCase: false,
          remainingQty: null,
        },
      }),
    );
    expect(markup).toContain("Trade ordering");
    expect(markup).toMatch(/trade test level/i);
    expect(markup).toContain("/admin/settings");
    expect(markup).not.toMatch(/Sign in/i);
    expect(markup).not.toMatch(/Select a trade customer/i);
    expect(markup).not.toMatch(/Add to basket/i);
    expect(markup).toContain('data-ordering-actor="internal"');
  });

  it("admin with trade test level can see quantity and Add to Basket", () => {
    sessionState.current = {
      signedIn: true,
      user: {
        ...adminNoCompany.user,
        tradeTestPricingMode: "PRICE_LIST",
        tradeTestPriceListId: "pl-a",
        tradeTestPriceListName: "Trade Level A",
      },
    };
    const markup = html(
      createElement(ProductDetailView, {
        data: {
          card: {
            id: "p-pmpc1",
            sku: "PMPC1",
            slug: "pmpc1",
            name: "Polishing Cloth 40cm × 40cm",
            brand: "Power Maxed",
            brandSlug: "power-maxed",
            category: "Accessories",
            categorySlug: "accessories",
            imageSrc: "/media/pmpc1.jpg",
            rrp: 4.99,
            price: { currency: "GBP", trade: 2.19, rrp: 4.99, source: "price_list" },
            availability: "in",
            isNew: false,
            isFeatured: false,
            variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
            ordering: null,
          },
          sku: "PMPC1",
          variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
          shortDescription: "Soft polishing cloth.",
          description: "Full description",
          specifications: [],
          selling: {
            keyBenefits: [],
            features: [],
            applications: [],
            directions: null,
            warnings: null,
          },
          gallery: [],
          related: [],
          caseQty: 1,
          unit: "EA",
          orderingPanel: singleUnitPanel,
        },
      }),
    );
    expect(markup).toContain("£2.19");
    expect(markup).toContain("Your price · each · ex VAT");
    expect(markup).toContain("Single unit · Sold individually");
    expect(markup).toContain('aria-label="Increase quantity"');
    expect(markup).toMatch(/Add to basket/i);
    expect(markup).not.toMatch(/Sign in/i);
    expect(markup).toContain("1 unit");
    expect(markup).not.toContain("View basket");
  });
});

describe("authenticated orderable PDP render condition", () => {
  beforeEach(() => {
    sessionState.current = tradeSession;
  });

  it("renders Trade Ordering, quantity selector, and Add to Basket in the hero for an orderable product", () => {
    const markup = html(createElement(ProductDetailView, { data: detail() }));

    // Hero commerce: price + purchasing controls in the first composition.
    expect(markup).toContain("£3.69");
    expect(markup).toContain("Your price · each · ex VAT");
    expect(markup).toContain("RRP £7.99");
    expect(markup).toContain("Versatile 500ml maintenance spray");

    expect(markup).toContain('data-ordering-placement="hero"');
    expect(markup).toContain("Trade ordering");
    expect(markup).toContain("Case of 12 · Sold in multiples of 12");
    expect(markup).toContain('aria-label="Decrease quantity"');
    expect(markup).toContain('aria-label="Increase quantity"');
    expect(markup).toMatch(/Add to basket/i);
    expect(markup).toContain("1 case");
    expect(markup).toContain("12 units");
    expect(markup).toContain("£3.69 each ex VAT");
    expect(markup).toContain("£44.28");
    expect(markup).not.toContain("£3.6875");
    expect(markup).toMatch(/Total[\s\S]*ex VAT/i);
    // Basket navigation lives in the header, not duplicated on every PDP card.
    expect(markup).not.toContain(">View basket<");

    // Primary controls sit under short description, before lower content.
    expect(markup.indexOf("data-product-short-description")).toBeLessThan(
      markup.indexOf('data-product-section="ordering"'),
    );
    expect(markup.indexOf('data-product-section="ordering"')).toBeLessThan(
      markup.indexOf('data-product-detail="content"'),
    );
    expect(markup.match(/Trade ordering/g)?.length).toBe(1);
    expect(markup.match(/Add to basket/gi)?.length).toBe(1);
  });

  it("does not expose exact stock figures in the purchasing UI", () => {
    const markup = html(createElement(ProductDetailView, { data: detail() }));
    expect(markup).not.toMatch(/17 available|qtyOnHand|sellableQty/i);
  });
});

describe("request session diagnostics", () => {
  it("exposes safe booleans without dumping full PII", () => {
    const diag = sessionDiagnostics(tradeSession);
    expect(diag.signedIn).toBe(true);
    expect(diag.actorType).toBe("TRADE");
    expect(diag.isTradeCustomer).toBe(true);
    expect(diag.canViewOrders).toBe(true);
    expect(diag.canCreateOrders).toBe(true);
    expect(diag.userIdSuffix).toBe("u-trade".slice(-6));
    expect(JSON.stringify(diag)).not.toContain("@");
  });
});

describe("buildSafeSession shape", () => {
  it("is exported for integration coverage of the shared resolver", () => {
    expect(typeof buildSafeSession).toBe("function");
  });
});
