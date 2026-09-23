import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSession } from "@/server/auth/session";

const sessionState: { current: ClientSession } = {
  current: { signedIn: false },
};

vi.mock("@/lib/session", () => ({
  useSession: () => ({ ...sessionState.current, loading: false, refresh: async () => undefined }),
  guestSession: { signedIn: false },
}));

vi.mock("@/server/auth/session", () => ({
  signOutCurrent: vi.fn(async () => ({ ok: true })),
}));

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
}));

import { PublicHeader } from "@/components/ab/PublicLayout";
import { ProductTradeOrdering } from "@/components/public/ProductTradeOrdering";
import { TradePrice } from "@/components/ab/Price";

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
    displayRole: "BUYER · Example Factors",
    companyId: "co1",
    companyName: "Example Factors",
    accountNumber: "AB-100",
    tradeRole: "TRADE_BUYER",
    navPermissions: ["orders.view", "orders.create"],
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

  it("anonymous PDP price does not show YOUR PRICE even when trade leaks into props", () => {
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
    expect(markup).not.toContain("aria-label=\"Increase quantity\"");
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
    expect(markup).toContain("aria-label=\"Increase quantity\"");
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
