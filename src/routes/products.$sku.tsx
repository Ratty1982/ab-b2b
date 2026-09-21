import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicLayout, Breadcrumbs } from "@/components/ab/PublicLayout";
import { ProductDetailView } from "@/components/public/ProductDetail";
import { getPublicProductFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/products/$sku")({
  loader: async ({ params }) => {
    const result = await getPublicProductFn({ data: { slug: params.sku } });
    if (!result.ok || !result.data) throw notFound();
    return result.data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Product unavailable — Automotive Brands" }, { name: "robots", content: "noindex" }] };
    }
    const p = loaderData.card;
    return {
      meta: [
        { title: `${p.name} — Automotive Brands` },
        { name: "description", content: loaderData.shortDescription || `${p.name} by ${p.brand}` },
      ],
    };
  },
  component: ProductPage,
});

function ProductPage() {
  const data = Route.useLoaderData();
  return (
    <PublicLayout>
      <div className="mx-auto max-w-[1400px] px-4 pt-6 sm:px-6 lg:px-10">
        <Breadcrumbs
          items={[
            { label: "Home", to: "/" },
            { label: "Products", to: "/products" },
            { label: data.card.name },
          ]}
        />
      </div>
      <ProductDetailView data={data} />
    </PublicLayout>
  );
}
