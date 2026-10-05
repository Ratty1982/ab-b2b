import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { PublicCatalogueShell } from "@/components/public/PublicCatalogueShell";
import {
  appliedCatalogueNav,
  catalogueSidebarContext,
  productsCategoryFnInput,
  productsIndexLoaderDeps,
} from "@/domain/public-catalogue-nav";
import { getClientSession } from "@/server/auth/session";
import { listPublicCatalogueFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/products/category/$slug")({
  validateSearch: (search: Record<string, unknown>): { brand?: string; q?: string; page?: number } => {
    const out: { brand?: string; q?: string; page?: number } = {};
    if (typeof search["brand"] === "string") out.brand = search["brand"];
    if (typeof search["q"] === "string") out.q = search["q"];
    if (typeof search["page"] === "string" || typeof search["page"] === "number") out.page = Number(search["page"]);
    return out;
  },
  loaderDeps: ({ search }) => productsIndexLoaderDeps(search),
  loader: async ({ params, deps }) => {
    const listingDeps = { ...deps, categorySlug: params.slug };
    const [requestSession, result] = await Promise.all([
      getClientSession(),
      listPublicCatalogueFn({
        data: productsCategoryFnInput(listingDeps),
      }),
    ]);
    const applied = {
      appliedBrandSlug: listingDeps.brand || null,
      ...(listingDeps.q ? { appliedQ: listingDeps.q } : {}),
    };
    if (!result.ok || !result.data.category) throw notFound();
    if (listingDeps.brand && result.data.categoryInBrandScope === false) {
      throw redirect({
        to: "/products",
        search: {
          brand: listingDeps.brand,
          ...(listingDeps.q ? { q: listingDeps.q } : {}),
        },
      });
    }
    return { ...result.data, error: null as string | null, requestSession, ...applied };
  },
  headers: () => ({
    "Cache-Control": "private, no-store",
  }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.category?.name ?? "Category"} — Automotive Brands` }],
  }),
  component: CategoryPage,
});

function CategoryPage() {
  const data = Route.useLoaderData();
  const category = data.category!;
  const context = catalogueSidebarContext(
    appliedCatalogueNav({
      brandSlug: data.appliedBrandSlug,
      categorySlug: category.slug,
      q: data.appliedQ,
      categories: data.categories,
      categorySlugsByBrand: data.categorySlugsByBrand,
    }),
  );
  return (
    <PublicCatalogueShell
      data={data}
      heading={category.name}
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Products", to: "/products" },
        { label: category.name },
      ]}
      context={context}
      searchAction={`/products/category/${category.slug}`}
      requestSession={data.requestSession}
    />
  );
}
