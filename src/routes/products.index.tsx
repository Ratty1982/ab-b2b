import { createFileRoute } from "@tanstack/react-router";
import { PublicCatalogueShell } from "@/components/public/PublicCatalogueShell";
import {
  appliedCatalogueNav,
  catalogueSidebarContext,
  productsIndexLoaderDeps,
  productsListingFnInput,
} from "@/domain/public-catalogue-nav";
import { getClientSession } from "@/server/auth/session";
import { listPublicCatalogueFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/products/")({
  validateSearch: (search: Record<string, unknown>): { brand?: string; q?: string; page?: number } => {
    const out: { brand?: string; q?: string; page?: number } = {};
    if (typeof search["brand"] === "string") out.brand = search["brand"];
    if (typeof search["q"] === "string") out.q = search["q"];
    if (typeof search["page"] === "string" || typeof search["page"] === "number") out.page = Number(search["page"]);
    return out;
  },
  loaderDeps: ({ search }) => productsIndexLoaderDeps(search),
  loader: async ({ deps }) => {
    const [requestSession, result] = await Promise.all([
      getClientSession(),
      listPublicCatalogueFn({
        data: productsListingFnInput(deps),
      }),
    ]);
    const applied = {
      appliedBrandSlug: deps.brand || null,
      ...(deps.q ? { appliedQ: deps.q } : {}),
    };
    if (!result.ok) {
      return {
        items: [],
        total: 0,
        brands: [],
        categories: [],
        categorySlugsByBrand: {},
        category: null,
        page: 1,
        pageSize: 24,
        error: result.error,
        requestSession,
        ...applied,
      };
    }
    return { ...result.data, error: null, requestSession, ...applied };
  },
  headers: () => ({
    "Cache-Control": "private, no-store",
  }),
  head: () => ({
    meta: [
      { title: "Trade Product Catalogue — Automotive Brands" },
      {
        name: "description",
        content: "Browse the Automotive Brands catalogue. Trade customers sign in to see account pricing.",
      },
    ],
  }),
  component: Catalogue,
});

function Catalogue() {
  const data = Route.useLoaderData();
  const brandName = data.brands.find((b) => b.slug === data.appliedBrandSlug)?.name;
  const context = catalogueSidebarContext(
    appliedCatalogueNav({
      brandSlug: data.appliedBrandSlug,
      q: data.appliedQ,
      categories: data.categories,
      categorySlugsByBrand: data.categorySlugsByBrand,
    }),
  );
  return (
    <PublicCatalogueShell
      data={data}
      heading={brandName ? `${brandName} catalogue` : "Trade Catalogue"}
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Products" }]}
      context={context}
      searchAction="/products"
      requestSession={data.requestSession}
    />
  );
}
