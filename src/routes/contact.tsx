import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicCmsPage } from "@/components/public/PublicCmsPage";
import { CallbackRequestForm } from "@/components/public/CallbackRequestForm";
import { getPublicCmsPageFn } from "@/server/phase2/fns";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";

const FALLBACK = marketingCmsPageBySlug("contact")!;

export const Route = createFileRoute("/contact")({
  loader: async () => {
    const result = await getPublicCmsPageFn({ data: { slug: "contact" } });
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
  component: Contact,
});

function Contact() {
  const page = Route.useLoaderData();
  return (
    <PublicCmsPage
      page={page}
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Contact" }]}
      trailing={
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
          <CallbackRequestForm />
        </div>
      }
    />
  );
}
