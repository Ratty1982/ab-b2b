import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicLayout, Breadcrumbs } from "@/components/ab/PublicLayout";
import { TradePrice } from "@/components/ab/Price";
import { CatalogueMedia } from "@/components/catalogue/CatalogueMedia";
import { listPublicCatalogueFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/products/category/$slug")({
  loader: async ({ params }) => {
    const result = await listPublicCatalogueFn({ data: { categorySlug: params.slug, page: 1 } });
    if (!result.ok || !result.data.category) throw notFound();
    return result.data;
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.category?.name ?? "Category"} — Automotive Brands` }],
  }),
  component: CategoryPage,
});

function CategoryPage() {
  const data = Route.useLoaderData();
  return (
    <PublicLayout>
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Products", to: "/products" }, { label: data.category!.name }]} />
        <h1 className="mt-4 font-display text-3xl font-semibold uppercase">{data.category!.name}</h1>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.items.map((p) => (
            <Link key={p.id} to="/products/$sku" params={{ sku: p.slug }} className="rounded-lg border border-border p-3">
              {p.imageSrc ? (
                <CatalogueMedia src={p.imageSrc} alt="" className="aspect-[4/3] w-full rounded" />
              ) : (
                <div className="aspect-[4/3] rounded bg-white" />
              )}
              <div className="mt-2 font-medium">{p.name}</div>
              <TradePrice trade={p.price.trade} rrp={p.price.rrp} size="sm" ctaMode="text" />
            </Link>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
