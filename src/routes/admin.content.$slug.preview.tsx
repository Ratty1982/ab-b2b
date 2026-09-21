import { createFileRoute, Link } from "@tanstack/react-router";
import { CmsPageView } from "@/components/cms/CmsSectionRenderer";
import { PublicHomepage } from "@/components/public/PublicHomepage";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { getCmsPageDraftFn, previewPublicHomepageFn } from "@/server/phase2/fns";
import type { CmsSectionTypeKey } from "@/domain/cms";

export const Route = createFileRoute("/admin/content/$slug/preview")({
  loader: async ({ params }) => {
    const r = await getCmsPageDraftFn({ data: { slug: params.slug } });
    if (!r.ok) return { error: r.error, page: null as null, homepage: null };
    const sections = (r.data.version?.sections ?? []).map((s) => ({
      id: s.id,
      type: s.type as CmsSectionTypeKey,
      config: s.config as Record<string, unknown>,
      enabled: s.enabled,
    }));
    if (params.slug === "home") {
      const preview = await previewPublicHomepageFn({ data: { sections } });
      return {
        error: preview.ok ? null : preview.error,
        page: r.data,
        homepage: preview.ok ? preview.data : null,
      };
    }
    return { error: null as string | null, page: r.data, homepage: null };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `Draft preview — ${loaderData?.page?.title ?? "CMS"}` }],
  }),
  component: DraftPreview,
});

function DraftPreview() {
  const { slug } = Route.useParams();
  const { error, page, homepage } = Route.useLoaderData();
  const sections = (page?.version?.sections ?? [])
    .filter((s) => s.enabled)
    .map((s) => ({
      id: s.id,
      type: s.type as CmsSectionTypeKey,
      config: s.config as Record<string, unknown>,
    }));

  return (
    <div>
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-warn/40 bg-warn/15 px-4 py-2 text-[12px]">
        <span>Authenticated draft preview — not the live website.</span>
        <Link to="/admin/content/$slug" params={{ slug }} className="font-semibold uppercase hover:underline">
          Back to editor
        </Link>
      </div>
      {error ? <p className="p-6 text-sm text-bad">{error}</p> : null}
      <PublicLayout>
        {slug === "home" && homepage ? (
          <PublicHomepage data={{ ...homepage, sections: homepage.sections.filter((s) => s.enabled) }} />
        ) : sections.length ? (
          <CmsPageView sections={sections} />
        ) : (
          <p className="px-6 py-16 text-center text-sm text-steel">This draft has no enabled sections.</p>
        )}
      </PublicLayout>
    </div>
  );
}
