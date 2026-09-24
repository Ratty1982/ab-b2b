import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicCmsPage } from "@/components/public/PublicCmsPage";
import { getPublicCmsPageFn } from "@/server/phase2/fns";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";

const FALLBACK = marketingCmsPageBySlug("trade-solutions")!;

export const Route = createFileRoute("/trade-solutions")({
  loader: async () => {
    const result = await getPublicCmsPageFn({ data: { slug: "trade-solutions" } });
    if (!result.ok || !result.data) throw notFound();
    return result.data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.seoTitle || FALLBACK.seoTitle },
      { name: "description", content: loaderData?.metaDescription || FALLBACK.metaDescription },
      { property: "og:title", content: loaderData?.seoTitle || FALLBACK.seoTitle },
      { property: "og:description", content: loaderData?.metaDescription || FALLBACK.metaDescription },
    ],
  }),
  component: TradeSolutions,
});

function TradeSolutions() {
  const page = Route.useLoaderData();
  return (
    <PublicCmsPage
      page={page}
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Trade Solutions" }]}
    />
  );
}
