import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicCatalogueShell } from "@/components/public/PublicCatalogueShell";
import { getPublicBrandFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/brands/$slug")({
  validateSearch: (search: Record<string, unknown>): { q?: string; page?: number; category?: string } => {
    const out: { q?: string; page?: number; category?: string } = {};
    if (typeof search["q"] === "string") out.q = search["q"];
    if (typeof search["category"] === "string") out.category = search["category"];
    if (typeof search["page"] === "string" || typeof search["page"] === "number") out.page = Number(search["page"]);
    return out;
  },
  loader: async ({ params, location }) => {
    const search = location.search as { q?: string; page?: number; category?: string };
    const result = await getPublicBrandFn({
      data: { slug: params.slug, q: search.q, page: search.page, categorySlug: search.category },
    });
    if (!result.ok || !result.data) throw notFound();
    return result.data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.name ?? "Brand"} — Automotive Brands` },
      { name: "description", content: loaderData?.description ?? "" },
    ],
  }),
  component: BrandPage,
});

function BrandPage() {
  const brand = Route.useLoaderData();
  const search = Route.useSearch();
  return (
    <PublicCatalogueShell
      data={{ ...brand.catalogue, error: null }}
      heading={
        search.category && brand.catalogue.category
          ? `${brand.name} · ${brand.catalogue.category.name}`
          : brand.name
      }
      intro={brand.description ?? brand.tagline ?? undefined}
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Brands", to: "/brands" },
        { label: brand.name },
      ]}
      context={{ brandSlug: brand.slug, q: search.q, brandRoute: true, categorySlug: search.category }}
      searchAction={`/brands/${brand.slug}`}
    />
  );
}
