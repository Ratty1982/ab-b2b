import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicCmsPage } from "@/components/public/PublicCmsPage";
import { MeetTheTeamTeaser } from "@/components/team/TeamMemberCard";
import { getPublicCmsPageFn, listFeaturedPublicTeamMembersFn } from "@/server/phase2/fns";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";

const FALLBACK = marketingCmsPageBySlug("why-automotive-brands")!;

export const Route = createFileRoute("/why-automotive-brands")({
  loader: async () => {
    const [pageResult, featuredResult] = await Promise.all([
      getPublicCmsPageFn({ data: { slug: "why-automotive-brands" } }),
      listFeaturedPublicTeamMembersFn({ data: { limit: 4 } }),
    ]);
    if (!pageResult.ok || !pageResult.data) throw notFound();
    return {
      page: pageResult.data,
      featuredMembers: featuredResult.ok ? featuredResult.data : [],
    };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.page.seoTitle || FALLBACK.seoTitle },
      {
        name: "description",
        content: loaderData?.page.metaDescription || FALLBACK.metaDescription,
      },
      { property: "og:title", content: loaderData?.page.seoTitle || FALLBACK.seoTitle },
      {
        property: "og:description",
        content: loaderData?.page.metaDescription || FALLBACK.metaDescription,
      },
    ],
  }),
  component: Why,
});

function Why() {
  const { page, featuredMembers } = Route.useLoaderData();
  return (
    <PublicCmsPage
      page={page}
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Why Automotive Brands" }]}
      trailing={<MeetTheTeamTeaser members={featuredMembers} />}
    />
  );
}
