import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicCmsPage } from "@/components/public/PublicCmsPage";
import { getPublicCmsPageFn } from "@/server/phase2/fns";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";

const FALLBACK = marketingCmsPageBySlug("resources")!;

export const Route = createFileRoute("/resources")({
  loader: async () => {
    const result = await getPublicCmsPageFn({ data: { slug: "resources" } });
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
  component: Resources,
});

function Resources() {
  const page = Route.useLoaderData();
  return (
    <PublicCmsPage page={page} breadcrumbs={[{ label: "Home", to: "/" }, { label: "Resources" }]} />
  );
}
