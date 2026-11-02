import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicCmsPage } from "@/components/public/PublicCmsPage";
import { AboutCertificationsSection } from "@/components/public/PublicCertifications";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";
import { getPublicCmsPageFn, listPublicCertificationsFn } from "@/server/phase2/fns";

const FALLBACK = marketingCmsPageBySlug("about")!;

export const Route = createFileRoute("/about")({
  loader: async () => {
    const [result, certifications] = await Promise.all([
      getPublicCmsPageFn({ data: { slug: "about" } }),
      listPublicCertificationsFn({ data: { placement: "about" } }),
    ]);
    if (!result.ok || !result.data) throw notFound();
    return {
      page: result.data,
      certifications: certifications.ok ? certifications.data : [],
    };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.page?.seoTitle || FALLBACK.seoTitle },
      { name: "description", content: loaderData?.page?.metaDescription || FALLBACK.metaDescription },
      { property: "og:title", content: loaderData?.page?.seoTitle || FALLBACK.seoTitle },
      {
        property: "og:description",
        content: loaderData?.page?.metaDescription || FALLBACK.metaDescription,
      },
    ],
  }),
  component: About,
});

function About() {
  const { page, certifications } = Route.useLoaderData();
  return (
    <>
      <PublicCmsPage page={page} breadcrumbs={[{ label: "Home", to: "/" }, { label: "About Us" }]} />
      <AboutCertificationsSection certifications={certifications} />
    </>
  );
}
