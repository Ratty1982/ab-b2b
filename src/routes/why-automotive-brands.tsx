import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicLayout, PublicPageBreadcrumbs } from "@/components/ab/PublicLayout";
import { AboutCertificationsSection } from "@/components/public/PublicCertifications";
import { PublicWhyUs, type WhyUsTeamProfile } from "@/components/public/PublicWhyUs";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";
import { parseWhyUsContent } from "@/domain/why-us-content";
import { getClientSession } from "@/server/auth/session";
import {
  getPublicCmsPageFn,
  listFeaturedPublicTeamMembersFn,
  listPublicCertificationsFn,
} from "@/server/phase2/fns";

const FALLBACK = marketingCmsPageBySlug("why-automotive-brands")!;

export const Route = createFileRoute("/why-automotive-brands")({
  loader: async () => {
    const [cms, requestSession, certifications] = await Promise.all([
      getPublicCmsPageFn({ data: { slug: "why-automotive-brands" } }),
      getClientSession(),
      listPublicCertificationsFn({ data: { placement: "about" } }),
    ]);
    if (!cms.ok || !cms.data) throw notFound();
    const section = cms.data.sections.find((item) => item.type === "WHY_US");
    const content = parseWhyUsContent(section?.config);
    let team: WhyUsTeamProfile[] = [];
    if (content.team.enabled) {
      const featured = await listFeaturedPublicTeamMembersFn({ data: { limit: 8 } });
      if (featured.ok) {
        team = featured.data.map((member) => ({
          id: member.id,
          displayName: member.displayName,
          jobTitle: member.jobTitle,
          photo: member.photo
            ? {
                src: member.photo.src,
                alt: member.photo.alt || member.displayName,
                objectPosition: member.photo.objectPosition,
              }
            : null,
        }));
      }
    }
    return {
      requestSession,
      content,
      team,
      certifications: certifications.ok ? certifications.data : [],
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
  component: Why,
});

function Why() {
  const { requestSession, content, team, certifications } = Route.useLoaderData();
  return (
    <PublicLayout requestSession={requestSession}>
      <PublicPageBreadcrumbs items={[{ label: "Home", to: "/" }, { label: "Why Automotive Brands" }]} />
      <PublicWhyUs content={content} session={requestSession} team={team} />
      <AboutCertificationsSection certifications={certifications} />
    </PublicLayout>
  );
}
