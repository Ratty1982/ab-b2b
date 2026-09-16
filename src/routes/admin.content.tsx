import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { listCmsPagesFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/admin/content")({
  head: () => ({
    meta: [{ title: "Website — Automotive Brands Admin" }],
  }),
  component: CmsPages,
});

function CmsPages() {
  const [pages, setPages] = useState<
    Array<{ slug: string; title: string; status: string; updatedAt: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listCmsPagesFn().then((r) => {
      if (r.ok) setPages(r.data);
      else setError(r.error);
    });
  }, []);

  return (
    <div>
      <PanelHeader title="Website" sub="CMS pages — draft, preview and publish" />
      <div className="p-4 sm:p-6">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {pages.length === 0 && !error ? (
          <p className="text-sm text-steel">
            No CMS pages yet. The homepage is created automatically on production bootstrap.
          </p>
        ) : (
          <ul className="grid gap-2">
            {pages.map((p) => (
              <li key={p.slug}>
                <Link
                  to="/admin/content/$slug"
                  params={{ slug: p.slug }}
                  className="flex items-center justify-between gap-3 border border-border bg-surface/40 px-4 py-3 hover:border-primary/50"
                >
                  <div>
                    <div className="font-semibold">{p.title}</div>
                    <div className="num text-[12px] text-steel">
                      /{p.slug === "home" ? "" : p.slug}
                    </div>
                  </div>
                  <StatusBadge tone={p.status === "PUBLISHED" ? "good" : "warn"}>
                    {p.status}
                  </StatusBadge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
