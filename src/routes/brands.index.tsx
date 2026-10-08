import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicLayout, PublicPageBreadcrumbs } from "@/components/ab/PublicLayout";
import { PublicBrandsShowcase } from "@/components/public/PublicBrandsShowcase";
import {
  orderPublicBrandShowcase,
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
    return {
      brands: orderPublicBrandShowcase(brands.ok ? brands.data : []),
      requestSession,
    };
  },
  headers: () => ({
    "Cache-Control": "private, no-store",
  }),
  head: () => ({
    meta: [
      { title: PUBLIC_BRANDS_PAGE_TITLE },
      { name: "description", content: PUBLIC_BRANDS_PAGE_DESCRIPTION },
    ],
  }),
  component: BrandsIndex,
});

function BrandsIndex() {
  const { brands, requestSession } = Route.useLoaderData();
  return (
    <PublicLayout requestSession={requestSession}>
      <PublicPageBreadcrumbs items={[{ label: "Home", to: "/" }, { label: "Brands" }]} />
      <PublicBrandsShowcase brands={brands} session={requestSession} />
    </PublicLayout>
  );
}
