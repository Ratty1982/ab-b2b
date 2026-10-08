import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicLayout, PublicPageBreadcrumbs } from "@/components/ab/PublicLayout";
import { PublicBrandsShowcase } from "@/components/public/PublicBrandsShowcase";
import { parseBrandsShowcaseContent } from "@/domain/brands-showcase-content";
import {
  PUBLIC_BRANDS_PAGE_DESCRIPTION,
  PUBLIC_BRANDS_PAGE_TITLE,
} from "@/domain/public-brands-showcase";
import { getClientSession } from "@/server/auth/session";
import { getPublicCmsPageFn, listPublicBrandsFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/brands/")({
  loader: async () => {
    const [cms, brands, requestSession] = await Promise.all([
      getPublicCmsPageFn({ data: { slug: "brands" } }),
      listPublicBrandsFn(),
      getClientSession(),
    ]);
    if (!cms.ok || !cms.data) throw notFound();
    const showcase = cms.data.sections.find((section) => section.type === "BRANDS_SHOWCASE");
    const seoTitle = cms.data.seoTitle?.trim() || PUBLIC_BRANDS_PAGE_TITLE;
    const metaDescription = cms.data.metaDescription?.trim() || PUBLIC_BRANDS_PAGE_DESCRIPTION;
    return {
      brands: brands.ok ? brands.data : [],
      requestSession,
      content: parseBrandsShowcaseContent(showcase?.config),
      seoTitle,
      metaDescription,
    };
  },
  headers: () => ({
    "Cache-Control": "private, no-store",
  }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.seoTitle || PUBLIC_BRANDS_PAGE_TITLE },
      { name: "description", content: loaderData?.metaDescription || PUBLIC_BRANDS_PAGE_DESCRIPTION },
    ],
  }),
  component: BrandsIndex,
});

function BrandsIndex() {
  const { brands, requestSession, content } = Route.useLoaderData();
  return (
    <PublicLayout requestSession={requestSession}>
      <PublicPageBreadcrumbs items={[{ label: "Home", to: "/" }, { label: "Brands" }]} />
      <PublicBrandsShowcase brands={brands} session={requestSession} content={content} />
    </PublicLayout>
  );
}
