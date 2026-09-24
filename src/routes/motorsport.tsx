import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicLayout, PublicPageBreadcrumbs } from "@/components/ab/PublicLayout";
import { MotorsportLanding } from "@/components/public/MotorsportLanding";
import { getPublicCmsPageFn } from "@/server/phase2/fns";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";
import type { CmsSectionTypeKey } from "@/domain/cms";

const FALLBACK = marketingCmsPageBySlug("motorsport")!;

export const Route = createFileRoute("/motorsport")({
  loader: async () => {
    const result = await getPublicCmsPageFn({ data: { slug: "motorsport" } });
    if (!result.ok || !result.data) throw notFound();
    return result.data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.seoTitle || FALLBACK.seoTitle },
      {
        name: "description",
        content: loaderData?.metaDescription || FALLBACK.metaDescription,
      },
      { property: "og:title", content: loaderData?.seoTitle || FALLBACK.seoTitle },
      {
        property: "og:description",
        content: loaderData?.metaDescription || FALLBACK.metaDescription,
      },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: "/motorsport" }],
  }),
  component: MotorsportPage,
});

function MotorsportPage() {
  const page = Route.useLoaderData();
  return (
    <PublicLayout kinetic>
      <PublicPageBreadcrumbs items={[{ label: "Home", to: "/" }, { label: "Motorsport" }]} />
      <MotorsportLanding
        sections={page.sections.map((section) => ({
          id: section.id,
          type: section.type as CmsSectionTypeKey,
          config: section.config as Record<string, unknown>,
        }))}
      />
    </PublicLayout>
  );
}
