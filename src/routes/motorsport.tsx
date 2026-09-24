import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicLayout, Breadcrumbs } from "@/components/ab/PublicLayout";
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
      <div className="border-b border-border/40">
        <div className="mx-auto max-w-[1400px] px-4 py-3 sm:px-6 lg:px-10">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Motorsport" }]} />
        </div>
      </div>
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
