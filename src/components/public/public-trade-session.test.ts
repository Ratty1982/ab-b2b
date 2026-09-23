import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSession } from "@/server/auth/session";
import { canViewBasketSession, isTradeCustomerSession } from "@/lib/session-guards";
import { buildSafeSession, sessionDiagnostics } from "@/server/auth/request-session";

const sessionState: { current: ClientSession } = {
  current: { signedIn: false },
};

vi.mock("@/lib/session", () => ({
  useSession: () => ({ ...sessionState.current, loading: false, refresh: async () => undefined }),
  guestSession: { signedIn: false },
  canViewBasketSession: (session: ClientSession) =>
    Boolean(
      session.signedIn &&
        session.user?.actorType === "TRADE" &&
        session.user.companyId &&
        session.user.navPermissions?.includes("orders.view"),
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
  Link: ({ children, to }: { children: ReactNode; to: string }) =>
    createElement("a", { href: typeof to === "string" ? to : "/" }, children),
  useRouter: () => ({ invalidate: async () => undefined }),
  getRouteApi: () => ({
    useRouteContext: () => ({ session: sessionState.current }),
  }),
}));

import { PublicHeader } from "@/components/ab/PublicLayout";
import { TradePrice } from "@/components/ab/Price";
import { ProductTradeOrdering } from "@/components/public/ProductTradeOrdering";

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
  },
};

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
    expect(markup).not.toContain("Log out");
  });

  it("authenticated trade header hides login CTAs and shows Basket + My Account", () => {
    sessionState.current = tradeSession;
    const markup = html(createElement(PublicHeader));
    expect(markup).not.toContain("Trade Login");
    expect(markup).not.toContain("Open a Trade Account");
    expect(markup).toContain("My Account");
    expect(markup).toContain("Basket");
    expect(markup).toContain("Log out");
  });

  it("signed-in without orders.view still hides Trade Login (auth ≠ orderability)", () => {
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
    expect(markup).toContain("My Account");
    expect(markup).toContain("Log out");
    expect(markup).not.toContain(">Basket<");
  });

  it("trade customer session guards require TRADE + company + orders.view for basket", () => {
    expect(isTradeCustomerSession(tradeSession)).toBe(true);
    expect(canViewBasketSession(tradeSession)).toBe(true);
    expect(canViewBasketSession({ signedIn: false })).toBe(false);
    expect(
      canViewBasketSession({
        signedIn: true,
        user: { ...tradeSession.user, navPermissions: ["pricing.view"] },
      }),
    ).toBe(false);
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
        initialPanel: {
          orderable: true,
          reason: null,
          caseQty: 12,
          caseTitle: "Case of 12",
          caseSubtitle: "Sold in multiples of 12",
          minimumQuantity: 12,
          quantity: 12,
          caseCount: 1,
          caseCountLabel: "1 case",
          unitPriceExVatDisplay: "3.69",
          lineNetDisplay: "44.28",
          canIncrement: true,
          canDecrement: false,
          canAdd: true,
          insufficientFullCase: false,
        },
      }),
    );
    expect(markup).toContain("Case of 12");
    expect(markup).toContain("£3.69 each ex VAT");
    expect(markup).toContain("£44.28 ex VAT");
    expect(markup).toMatch(/Add to basket/i);
    expect(markup).toContain('aria-label="Increase quantity"');
    expect(markup).not.toContain("Trade Login");
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
          quantity: 12,
          caseCount: 1,
          caseCountLabel: "1 case",
          unitPriceExVatDisplay: null,
          lineNetDisplay: null,
          canIncrement: false,
          canDecrement: false,
          canAdd: false,
          insufficientFullCase: true,
        },
      }),
    );
    expect(markup).toContain("Insufficient stock for a full case");
    expect(markup).not.toMatch(/Add to basket/i);
    expect(markup).not.toContain("Sign in");
    const header = html(createElement(PublicHeader));
    expect(header).toContain("My Account");
    expect(header).toContain("Basket");
    expect(header).not.toContain("Trade Login");
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
