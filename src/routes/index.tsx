import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { PublicHomepage } from "@/components/public/PublicHomepage";
import type { PublicHomepageData } from "@/domain/homepage";
import { defaultHomepageSections } from "@/server/cms/homepage-seed";
import { getPublicHomepageFn } from "@/server/phase2/fns";

const EMPTY_HOMEPAGE: PublicHomepageData = {
  seoTitle: "Automotive Brands — Automotive products built for the trade",
  metaDescription:
    "Trade supply of Power Maxed and Steel Seal to UK motor factors, workshops, retailers and distributors. Open a trade account for account pricing and case ordering.",
  ogImageSrc: null,
  sections: defaultHomepageSections().map((section, index) => ({
    id: `fallback-${section.type}-${index}`,
    type: section.type,
    config: section.config as PublicHomepageData["sections"][number]["config"],
    enabled: section.enabled !== false,
  })),
  brands: [],
  categories: [],
  productsBySku: {},
  recentProducts: [],
  featuredProducts: [],
  cmsError: "Homepage content could not be loaded",
};

export const Route = createFileRoute("/")({
  loader: async () => {
    const result = await getPublicHomepageFn();
    if (!result.ok) {
      console.error("[ab:homepage] loader failed", result.error);
      return { homepage: { ...EMPTY_HOMEPAGE, cmsError: result.error } };
    }
    return { homepage: result.data };
  },
  head: ({ loaderData }) => {
    const seoTitle = loaderData?.homepage?.seoTitle ?? EMPTY_HOMEPAGE.seoTitle;
    const seoDesc = loaderData?.homepage?.metaDescription ?? EMPTY_HOMEPAGE.metaDescription;
    return {
      meta: [
        { title: seoTitle },
        { name: "description", content: seoDesc },
        { property: "og:title", content: seoTitle },
        { property: "og:description", content: seoDesc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(loaderData?.homepage?.ogImageSrc
          ? [{ property: "og:image", content: loaderData.homepage.ogImageSrc }]
          : []),
      ],
    };
  },
  component: Home,
});

function Home() {
  const { homepage } = Route.useLoaderData();
  return (
    <PublicLayout kinetic>
      <PublicHomepage data={homepage} />
    </PublicLayout>
  );
}
