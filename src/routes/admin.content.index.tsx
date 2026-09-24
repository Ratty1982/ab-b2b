import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExternalLink, Pencil } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { cmsPageBlurb, cmsPublicPath } from "@/lib/cms-pages";
import { ROUTES } from "@/lib/app-nav";
import { listCmsPagesFn } from "@/server/phase2/fns";
import { InstantText } from "@/components/ab/InstantText";

export const Route = createFileRoute("/admin/content/")({
  head: () => ({
    meta: [{ title: "Website — Automotive Brands Admin" }],
  }),
  component: CmsPages,
});

type CmsPageRow = {
  slug: string;
  title: string;
  status: string;
  updatedAt: string;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
};

function CmsPages() {
  const navigate = useNavigate();
  const [pages, setPages] = useState<CmsPageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void listCmsPagesFn().then((r) => {
      setLoading(false);
      if (r.ok) setPages(r.data as CmsPageRow[]);
      else setError(r.error);
    });
  }, []);

  return (
    <div>
      <PanelHeader
        title="Pages"
        sub="Edit public pages as drafts, then publish when they are ready"
        crumbs={[{ label: "Website" }, { label: "Pages", to: ROUTES.adminContent }]}
      />
      <div className="p-4 sm:p-6">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {loading ? <p className="text-sm text-steel">Loading pages…</p> : null}
        {!loading && pages.length === 0 && !error ? (
          <p className="text-sm text-steel">
            No CMS pages yet. Homepage and marketing pages are created automatically on production
            bootstrap (or the first public page request).
          </p>
        ) : null}
        {pages.length > 0 ? (
          <ul className="grid gap-3">
            {pages.map((p) => {
              const publicPath = cmsPublicPath(p.slug);
              return (
                <li key={p.slug}>
                  <article className="grid gap-4 border border-border bg-surface/40 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() =>
                        void navigate({
                          to: "/admin/content/$slug",
                          params: { slug: p.slug },
                        })
                      }
                    >
                      <h2 className="font-display text-xl font-semibold uppercase tracking-tight">
                        {p.title}
                      </h2>
                      <p className="mt-1 text-[13px] text-steel">{cmsPageBlurb(p.slug)}</p>
                      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-steel">
                        <div>
                          <span className="uppercase tracking-wide">URL </span>
                          <span className="num text-foreground">{publicPath}</span>
                        </div>
                        <div>
                          <span className="uppercase tracking-wide">Status </span>
                          <StatusBadge tone={p.status === "PUBLISHED" ? "good" : "warn"}>
                            {p.status}
                          </StatusBadge>
                        </div>
                        {p.hasUnpublishedChanges ? (
                          <div>
                            <StatusBadge tone="warn">Unpublished draft</StatusBadge>
                          </div>
                        ) : null}
                        <div>
                          Last updated <InstantText value={p.updatedAt} variant="audit" />
                        </div>
                        <div>
                          Last published{" "}
                          {p.publishedAt ? <InstantText value={p.publishedAt} variant="audit" /> : "Never"}
                        </div>
                      </dl>
                    </button>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to="/admin/content/$slug"
                        params={{ slug: p.slug }}
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-[12px] font-bold uppercase tracking-wide text-primary-foreground"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        Edit Page
                      </Link>
                      <Link
                        to="/admin/content/$slug/preview"
                        params={{ slug: p.slug }}
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-[12px] font-semibold uppercase tracking-wide"
                      >
                        <ExternalLink className="size-3.5" aria-hidden />
                        Preview draft
                      </Link>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
