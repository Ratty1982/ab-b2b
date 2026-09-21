import { createElement, type ReactElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CatalogueSidebar } from "@/components/public/CatalogueSidebar";
import {
  CATALOGUE_SHELL_GRID_CLASS,
  CATALOGUE_SIDEBAR_ASIDE_CLASS,
  CatalogueMobileNav,
  PublicCatalogueLayout,
} from "@/components/public/PublicCatalogueShell";
import { ProductDetailView, type PublicProductDetail } from "@/components/public/ProductDetail";
import type { PublicCategoryNavNode } from "@/domain/public-catalogue-nav";
import type { PublicProductCard } from "@/server/catalogue/products";

vi.mock("@/lib/session", () => ({
  useSession: () => ({ signedIn: false, loading: false, refresh: async () => undefined }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
    params,
    "aria-current": ariaCurrent,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
    params?: { slug?: string };
    "aria-current"?: string;
  }) =>
    createElement(
      "a",
      {
        href: typeof to === "string" ? to : "/",
        className,
        "aria-current": ariaCurrent,
        "data-slug": params?.slug,
      },
      children,
    ),
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
    price: { currency: "GBP", trade: 8.7, rrp: 17.99, source: "account" },
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
    specifications: [{ name: "size", value: "5L" }],
    selling: {
      keyBenefits: ["Leaves glass crystal clear and streak free"],
      features: ["Professional-grade glass cleaner"],
      applications: ["Vehicle Windscreens"],
      directions: "Apply to the glass surface.",
      warnings: null,
    },
    gallery: [{ src: "/media/gc5000.jpg", alt: "Window & Glass Cleaner 5 Litre" }],
    related: [card({ id: "p2", sku: "GC500", slug: "gc500", name: "Window & Glass Cleaner 500ml" })],
    packQty: 1,
    caseQty: 2,
    unit: "EA",
    ...partial,
  };
}

const navCategories: PublicCategoryNavNode[] = [
  {
    slug: "vehicle-cleaning",
    name: "Vehicle Cleaning",
    productCount: 4,
    children: [{ slug: "glass", name: "Glass", productCount: 2, children: [] }],
  },
  { slug: "additives", name: "Additives", productCount: 8, children: [] },
];

const navBrands = [
  { slug: "power-maxed", name: "Power Maxed" },
  { slug: "steel-seal", name: "Steel Seal" },
  { slug: "street-rhino", name: "Street Rhino" },
];

function html(node: ReactNode) {
  return renderToStaticMarkup(node as ReactElement);
}

describe("product detail catalogue navigation", () => {
  it("reuses CatalogueSidebar data from props rather than a hard-coded product nav list", () => {
    const markup = html(
      createElement(CatalogueSidebar, {
        brands: navBrands,
        categories: navCategories,
        context: { brandSlug: "power-maxed", categorySlug: "vehicle-cleaning" },
      }),
    );
    expect(markup).toContain("Vehicle Cleaning");
    expect(markup).toContain("Additives");
    expect(markup).toContain("Power Maxed");
    expect(markup).toContain("Steel Seal");
    expect(markup).toContain("Street Rhino");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("font-semibold text-primary");
    const sidebarSrc = readFileSync(path.join(process.cwd(), "src/components/public/CatalogueSidebar.tsx"), "utf8");
    expect(sidebarSrc).not.toMatch(/Power Maxed|Steel Seal|Car Care|Additives/);
    expect(sidebarSrc).toContain("brands.map");
    expect(sidebarSrc).toContain("categories.map");
  });

  it("marks the product brand and category as current without colour-only state", () => {
    const markup = html(
      createElement(CatalogueSidebar, {
        brands: navBrands,
        categories: navCategories,
        context: { brandSlug: "steel-seal", categorySlug: "additives" },
      }),
    );
    expect(markup).toMatch(/aria-current="page"[^>]*>Steel Seal/);
    expect(markup).toMatch(/aria-current="page"[^>]*>Additives/);
    expect(markup).toContain("font-semibold");
  });

  it("wraps product content in the shared catalogue layout grid and desktop sidebar", () => {
    const markup = html(
      createElement(
        PublicCatalogueLayout,
        {
          brands: navBrands,
          categories: navCategories,
          context: { brandSlug: "power-maxed", categorySlug: "vehicle-cleaning" },
          breadcrumbs: [
            { label: "Home", to: "/" },
            { label: "Products", to: "/products" },
            { label: "Window & Glass Cleaner 5 Litre" },
          ],
        },
        createElement(ProductDetailView, { data: detail() }),
      ),
    );
    expect(markup).toContain('data-catalogue-shell="layout"');
    expect(markup).toContain('data-catalogue-sidebar="desktop"');
    expect(markup).toContain(CATALOGUE_SHELL_GRID_CLASS);
    expect(markup).toContain("lg:grid-cols-[220px_minmax(0,1fr)]");
    expect(markup).toContain(CATALOGUE_SIDEBAR_ASIDE_CLASS);
    expect(markup).toContain("hidden lg:block");
    expect(markup).toContain('data-catalogue-mobile-nav="trigger"');
    expect(markup).toContain("lg:hidden");
    expect(markup).toContain("Filters / Categories");
    expect(markup).toContain('data-product-detail="page"');
    expect(markup).toContain("Window &amp; Glass Cleaner 5 Litre");
    expect(markup).toContain("overflow-x-hidden");
  });

  it("reuses the catalogue mobile sheet rather than a second product drawer", () => {
    const markup = html(
      createElement(CatalogueMobileNav, {
        brands: navBrands,
        categories: navCategories,
        context: { brandSlug: "power-maxed", categorySlug: "vehicle-cleaning" },
      }),
    );
    expect(markup).toContain('data-catalogue-mobile-nav="trigger"');
    expect(markup).toContain("Filters / Categories");
    const layout = html(
      createElement(
        PublicCatalogueLayout,
        {
          brands: navBrands,
          categories: navCategories,
          context: { brandSlug: "power-maxed", categorySlug: "vehicle-cleaning" },
        },
        createElement("div", { "data-product-detail": "page" }),
      ),
    );
    expect(layout).toContain("Vehicle Cleaning");
    expect(layout).toContain("Steel Seal");
    expect(layout).toContain('data-catalogue-mobile-nav="trigger"');
    const routeSrc = readFileSync(path.join(process.cwd(), "src/routes/products.$sku.tsx"), "utf8");
    expect(routeSrc).toContain("PublicCatalogueLayout");
    expect(routeSrc).toContain("data.nav.brands");
    expect(routeSrc).toContain("data.nav.categories");
    expect(routeSrc).toContain("data.card.brandSlug");
    expect(routeSrc).toContain("data.card.categorySlug");
    expect(routeSrc).not.toContain("Car Care");
    expect(routeSrc).not.toContain("Power Maxed");
    const productSrc = readFileSync(path.join(process.cwd(), "src/server/catalogue/products.ts"), "utf8");
    expect(productSrc).toContain("loadPublicCatalogueNav");
    expect(productSrc).toContain("nav: { brands: nav.brands, categories: nav.categories }");
  });
});
