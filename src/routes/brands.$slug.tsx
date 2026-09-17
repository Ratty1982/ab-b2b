import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicLayout, Breadcrumbs } from "@/components/ab/PublicLayout";
import { TradePrice } from "@/components/ab/Price";
import { CatalogueMedia } from "@/components/catalogue/CatalogueMedia";
import { getPublicBrandFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/brands/$slug")({
  loader: async ({ params }) => {
    const result = await getPublicBrandFn({ data: { slug: params.slug } });
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
  return (
    <PublicLayout>
      <section className="border-b border-border/60 bg-surface/30">
        <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Brands", to: "/brands" }, { label: brand.name }]} />
          <h1 className="mt-6 font-display text-4xl font-semibold uppercase">{brand.name}</h1>
          <p className="mt-3 max-w-xl text-sm text-steel">{brand.description}</p>
          <Link to="/products" search={{ brand: brand.slug }} className="mt-6 inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground">
            Shop {brand.name}
          </Link>
        </div>
      </section>
      <section className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6 lg:px-10">
        <h2 className="font-display text-2xl font-semibold uppercase">Products</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {brand.products.map((p) => (
            <Link key={p.id} to="/products/$sku" params={{ sku: p.slug }} className="rounded-lg border border-border p-3">
              <CatalogueMedia src={p.imageSrc} alt="" className="aspect-[4/3] w-full rounded" />
              <div className="mt-2 font-medium">{p.name}</div>
              <TradePrice trade={p.price.trade} rrp={p.price.rrp} size="sm" ctaMode="text" />
            </Link>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
