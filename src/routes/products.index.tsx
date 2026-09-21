import { createFileRoute } from "@tanstack/react-router";
import { PublicCatalogueShell } from "@/components/public/PublicCatalogueShell";
import { listPublicCatalogueFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/products/")({
  validateSearch: (search: Record<string, unknown>): { brand?: string; q?: string; page?: number } => {
    const out: { brand?: string; q?: string; page?: number } = {};
    if (typeof search["brand"] === "string") out.brand = search["brand"];
    if (typeof search["q"] === "string") out.q = search["q"];
    if (typeof search["page"] === "string" || typeof search["page"] === "number") out.page = Number(search["page"]);
    return out;
  },
  loader: async ({ location }) => {
    const search = location.search as { brand?: string; q?: string; page?: number };
    const result = await listPublicCatalogueFn({
      data: { brandSlug: search.brand, q: search.q, page: search.page },
    });
    if (!result.ok) {
      return { items: [], total: 0, brands: [], categories: [], category: null, page: 1, pageSize: 24, error: result.error };
    }
    return { ...result.data, error: null };
  },
  head: () => ({
    meta: [
      { title: "Trade Product Catalogue — Automotive Brands" },
      { name: "description", content: "Browse the Automotive Brands catalogue. Trade customers sign in to see account pricing." },
    ],
  }),
  component: Catalogue,
});

function Catalogue() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const brandName = data.brands.find((b) => b.slug === search.brand)?.name;
  return (
    <PublicCatalogueShell
      data={data}
      heading={brandName ? `${brandName} catalogue` : "Trade Catalogue"}
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Products" }]}
      context={{ brandSlug: search.brand, q: search.q }}
      searchAction="/products"
    />
  );
}
