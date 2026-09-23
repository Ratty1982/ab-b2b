import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicCatalogueLayout } from "@/components/public/PublicCatalogueShell";
import { ProductDetailView } from "@/components/public/ProductDetail";
import { getClientSession } from "@/server/auth/session";
import { getProductOrderingPanelFn, getPublicProductFn } from "@/server/phase2/fns";
import type { ProductOrderingPanelView } from "@/components/public/ProductTradeOrdering";
export const Route = createFileRoute("/products/$sku")({
  loader: async ({ params }) => {
    // Resolve session with the SAME createServerFn / cookie path as pricing.
    // Do not rely solely on root beforeLoad for public chrome.
    const [requestSession, result] = await Promise.all([
      getClientSession(),
      getPublicProductFn({ data: { slug: params.sku } }),
    ]);
    if (!result.ok || !result.data) throw notFound();

    // Any signed-in actor gets an ordering panel preview. The basket service
    // decides TRADE vs INTERNAL+acting vs "select a customer" messaging.
    let orderingPanel: ProductOrderingPanelView | null = null;
    if (requestSession.signedIn && result.data.variantId) {
      const panel = await getProductOrderingPanelFn({
        data: { variantId: result.data.variantId },
      });
      if (panel.ok) orderingPanel = panel.data;
    }

    return { ...result.data, orderingPanel, requestSession };
  },
  headers: () => ({
    "Cache-Control": "private, no-store",
  }),
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
    <PublicCatalogueLayout
      brands={data.nav.brands}
      categories={data.nav.categories}
      context={{
        brandSlug: data.card.brandSlug,
        categorySlug: data.card.categorySlug,
      }}
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Products", to: "/products" },
        { label: data.card.name },
      ]}
      requestSession={data.requestSession}
    >
      <ProductDetailView data={data} />
    </PublicCatalogueLayout>
  );
}
