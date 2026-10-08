import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicLayout, PublicPageBreadcrumbs } from "@/components/ab/PublicLayout";
import { PublicTradeSolutions } from "@/components/public/PublicTradeSolutions";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";
import { parseTradeSolutionsContent } from "@/domain/trade-solutions-content";
import { getClientSession } from "@/server/auth/session";
import { getPublicCmsPageFn } from "@/server/phase2/fns";

const FALLBACK = marketingCmsPageBySlug("trade-solutions")!;

export const Route = createFileRoute("/trade-solutions")({
  loader: async () => {
    const [cms, requestSession] = await Promise.all([
      getPublicCmsPageFn({ data: { slug: "trade-solutions" } }),
      getClientSession(),
    ]);
    if (!cms.ok || !cms.data) throw notFound();
    const section = cms.data.sections.find((item) => item.type === "TRADE_SOLUTIONS");
    return {
      requestSession,
      content: parseTradeSolutionsContent(section?.config),
      seoTitle: cms.data.seoTitle?.trim() || FALLBACK.seoTitle,
      metaDescription: cms.data.metaDescription?.trim() || FALLBACK.metaDescription,
    };
  },
  headers: () => ({
    "Cache-Control": "private, no-store",
  }),
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
  const { requestSession, content } = Route.useLoaderData();
  return (
    <PublicLayout requestSession={requestSession}>
      <PublicPageBreadcrumbs items={[{ label: "Home", to: "/" }, { label: "Trade Solutions" }]} />
      <PublicTradeSolutions content={content} session={requestSession} />
    </PublicLayout>
  );
}
