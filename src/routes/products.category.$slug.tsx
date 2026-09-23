import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicCatalogueShell } from "@/components/public/PublicCatalogueShell";
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
  loader: async ({ params, location }) => {
    const search = location.search as { brand?: string; q?: string; page?: number };
    const [requestSession, result] = await Promise.all([
      getClientSession(),
      listPublicCatalogueFn({
        data: {
          categorySlug: params.slug,
          brandSlug: search.brand,
          q: search.q,
          page: search.page,
        },
      }),
    ]);
    if (!result.ok || !result.data.category) throw notFound();
    return { ...result.data, error: null as string | null, requestSession };
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
  const search = Route.useSearch();
  const category = data.category!;
  return (
    <PublicCatalogueShell
      data={data}
      heading={category.name}
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Products", to: "/products" },
        { label: category.name },
      ]}
      context={{ brandSlug: search.brand, categorySlug: category.slug, q: search.q }}
      searchAction={`/products/category/${category.slug}`}
      requestSession={data.requestSession}
    />
  );
}
