import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProductResultList,
  PRODUCT_LIST_ROW_CLASS,
  PRODUCT_LIST_ROW_ORDER_CLASS,
  catalogueListShowsOrder,
} from "@/components/public/ProductCard";
import { CatalogueListQuickOrder } from "@/components/public/CatalogueListQuickOrder";
import type { PublicProductCard } from "@/server/catalogue/products";
import type { ProductOrderingPanel } from "@/server/basket/service";

vi.mock("@/lib/session", () => ({
  useSession: () => ({ signedIn: true, loading: false, refresh: async () => undefined }),
  guestSession: { signedIn: false },
  RequestSessionProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/server/phase2/fns", () => ({
  previewProductOrderQuantityFn: vi.fn(),
  addToBasketFn: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => async () => undefined,
  Link: ({
    children,
    to,
    params,
    className,
  }: {
    children?: ReactNode;
    to: string;
    params?: { sku?: string };
    className?: string;
  }) =>
    createElement(
      "a",
      {
        href: typeof to === "string" ? `${to}${params?.sku ? `/${params.sku}` : ""}` : "/",
        className,
      },
      children,
    ),
  getRouteApi: () => ({
    useRouteContext: () => ({ session: { signedIn: true } }),
  }),
}));

const orderableCase: ProductOrderingPanel = {
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
};

const orderableSingle: ProductOrderingPanel = {
  ...orderableCase,
  caseQty: 1,
  caseTitle: "Single unit",
  caseSubtitle: "Sold individually",
  minimumQuantity: 1,
  quantityStep: 1,
  quantity: 1,
  caseCount: 1,
  caseCountLabel: "1 case",
  unitPriceExVat: "2.1900",
  unitPriceExVatDisplay: "2.19",
  lineNetDisplay: "2.19",
};

function card(partial: Partial<PublicProductCard> = {}): PublicProductCard {
  return {
    id: "p1",
    sku: "PMML500SC40",
    slug: "pmml500sc40",
    name: "5-in-1 Multi Lube 500ml",
    brand: "Power Maxed",
    brandSlug: "power-maxed",
    category: "Lubricants",
    categorySlug: "lubricants",
    imageSrc: null,
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

function html(node: ReactNode) {
  return renderToStaticMarkup(node as ReactElement);
}

describe("catalogue list quick ordering presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides ORDER column for anonymous / no-ordering payloads", () => {
    const items = [card({ ordering: null })];
    expect(catalogueListShowsOrder(items)).toBe(false);
    const markup = html(createElement(ProductResultList, { items }));
    expect(markup).not.toContain(">Order<");
    expect(markup).not.toContain('data-catalogue-order="controls"');
    expect(markup).toContain(PRODUCT_LIST_ROW_CLASS.split(" ")[0]!);
    expect(markup).not.toContain('data-catalogue-order-column="true"');
  });

  it("shows ORDER column with case controls for authenticated orderable products", () => {
    const items = [
      card({ ordering: orderableCase }),
      card({
        id: "p2",
        sku: "PMPC1",
        slug: "pmpc1",
        name: "Polishing Cloth",
        price: { currency: "GBP", trade: 2.19, rrp: 4.99, source: "base_catalogue" },
        ordering: orderableSingle,
        variantId: "clyyyyyyyyyyyyyyyyyyyyyy",
      }),
    ];
    expect(catalogueListShowsOrder(items)).toBe(true);
    const markup = html(createElement(ProductResultList, { items }));
    expect(markup).toContain(">Order<");
    expect(markup).toContain('data-catalogue-order-column="true"');
    expect(markup).toContain(PRODUCT_LIST_ROW_ORDER_CLASS.split(" ")[0]!);
    expect(markup).toContain("Case of 12");
    expect(markup).toContain("Single unit");
    expect(markup).toContain('data-catalogue-order-action="add"');
    expect(markup).toContain(">12<");
    expect(markup).toContain(">1<");
    expect(markup).not.toMatch(/17 available|qtyOnHand|sourceAvailRaw/i);
  });

  it("shows Unavailable for out-of-stock rows without Add controls", () => {
    const markup = html(
      createElement(CatalogueListQuickOrder, {
        variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
        productName: "Out item",
        availability: "out",
        initialPanel: { ...orderableCase, orderable: false, canAdd: false },
      }),
    );
    expect(markup).toContain("Unavailable");
    expect(markup).not.toContain('data-catalogue-order-action="add"');
    expect(markup).not.toContain('aria-label="Increase');
  });

  it("shows insufficient full-case messaging without exposing exact stock", () => {
    const markup = html(
      createElement(CatalogueListQuickOrder, {
        variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
        productName: "Low case",
        availability: "low",
        initialPanel: {
          ...orderableCase,
          orderable: false,
          canAdd: false,
          insufficientFullCase: true,
          isFinalPartCase: false,
          remainingQty: null,
          reason: "Insufficient stock for a full case",
        },
      }),
    );
    expect(markup).toContain("Insufficient stock for full case");
    expect(markup).not.toMatch(/\b7\b/);
    expect(markup).not.toContain('data-catalogue-order-action="add"');
  });

  it("shows final-part-case controls with remaining stock hint", () => {
    const markup = html(
      createElement(CatalogueListQuickOrder, {
        variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
        productName: "Final stock",
        availability: "low",
        initialPanel: {
          ...orderableCase,
          orderable: true,
          canAdd: true,
          canDecrement: true,
          canIncrement: false,
          quantity: 7,
          minimumQuantity: 1,
          quantityStep: 1,
          caseCount: null,
          caseCountLabel: null,
          caseSubtitle: "Normally sold in multiples of 12",
          isFinalPartCase: true,
          remainingQty: 7,
          lineNetDisplay: "25.83",
        },
      }),
    );
    expect(markup).toContain("Final stock · 7 left");
    expect(markup).toContain('data-catalogue-order-mode="final-part-case"');
    expect(markup).toContain('data-catalogue-order-action="add"');
    expect(markup).toContain(">7<");
  });

  it("blocks Add when trade price is unavailable", () => {
    const markup = html(
      createElement(CatalogueListQuickOrder, {
        variantId: "clxxxxxxxxxxxxxxxxxxxxxx",
        productName: "No price",
        availability: "in",
        initialPanel: {
          ...orderableCase,
          orderable: false,
          canAdd: false,
          reason: "Trade price unavailable",
          unitPriceExVat: null,
          unitPriceExVatDisplay: null,
          lineNetDisplay: null,
        },
      }),
    );
    expect(markup).toContain("Pricing unavailable");
    expect(markup).not.toContain('data-catalogue-order-action="add"');
  });

  it("keeps row quantity state independent across products", () => {
    const items = [
      card({ id: "a", ordering: orderableCase, sku: "A" }),
      card({
        id: "b",
        sku: "B",
        ordering: {
          ...orderableCase,
          quantity: 24,
          caseCount: 2,
          caseCountLabel: "2 cases",
          lineNetDisplay: "88.50",
        },
      }),
    ];
    const markup = html(createElement(ProductResultList, { items }));
    expect(markup).toContain(">12<");
    expect(markup).toContain(">24<");
  });
});
