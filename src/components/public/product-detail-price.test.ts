import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProductDetailView, type PublicProductDetail } from "@/components/public/ProductDetail";
import type { PublicProductCard } from "@/server/catalogue/products";

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    signedIn: true,
    loading: false,
    refresh: async () => undefined,
    user: {
      id: "u1",
      actorType: "TRADE",
      companyId: "c1",
      navPermissions: ["orders.view", "orders.create"],
    },
  }),
  guestSession: { signedIn: false },
  canViewBasketSession: () => true,
  isTradeCustomerSession: () => true,
  RequestSessionProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) =>
    createElement("a", { href: typeof to === "string" ? to : "/" }, children),
  useRouter: () => ({ invalidate: async () => undefined }),
}));

function card(partial: Partial<PublicProductCard> = {}): PublicProductCard {
  return {
    id: "p1",
    sku: "GC5000",
    slug: "gc5000",
    name: "Window & Glass Cleaner 5 Litre",
    brand: "Power Maxed",
    brandSlug: "power-maxed",
    category: "Vehicle Cleaning",
    categorySlug: "vehicle-cleaning",
    imageSrc: "/media/gc5000.jpg",
    rrp: 17.99,
    price: { currency: "GBP", trade: 8.7, rrp: 17.99, source: "base_catalogue" },
    availability: "in",
    isNew: false,
    isFeatured: false,
    ...partial,
  };
}

function detail(partial: Partial<PublicProductDetail> = {}): PublicProductDetail {
  return {
    card: card(),
    sku: "GC5000",
    shortDescription: "Professional-grade 5L glass cleaner.",
    description: "Full product description.",
    specifications: [],
    selling: {
      keyBenefits: [],
      features: [],
      applications: [],
      directions: null,
      warnings: null,
    },
    gallery: [{ src: "/media/gc5000.jpg", alt: "GC5000" }],
    related: [],
    packQty: 1,
    caseQty: 2,
    unit: "EA",
    ...partial,
  };
}

function html(node: ReactNode) {
  return renderToStaticMarkup(node as ReactElement);
}

describe("signed-in product unit price", () => {
  it("shows the unit trade price with EACH qualifier and does not multiply by caseQty", () => {
    const markup = html(createElement(ProductDetailView, { data: detail() }));
    expect(markup).toContain("£8.70");
    expect(markup).toContain("Your price · each · ex VAT");
    expect(markup).toContain("RRP £17.99");
    expect(markup).not.toContain("£17.40");
    expect(markup).not.toContain("£20.88");
    expect(markup).not.toMatch(/Add to Basket/i);
    const pair = html(createElement(ProductDetailView, { data: detail({ unit: "PAIR" }) }));
    expect(pair).toContain("Your price · pair · ex VAT");
  });
});
