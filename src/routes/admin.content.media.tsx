import { createFileRoute } from "@tanstack/react-router";
import { PanelHeader } from "@/components/ab/AppShell";
import { MediaLibraryPanel } from "@/components/cms/MediaLibraryPanel";
import { ROUTES } from "@/lib/app-nav";

export const Route = createFileRoute("/admin/content/media")({
  head: () => ({
    meta: [{ title: "Media — Website — Automotive Brands Admin" }],
  }),
  component: CmsMediaLibrary,
});

function CmsMediaLibrary() {
  return (
    <div>
      <PanelHeader
        title="Media"
        sub="Images used on public website pages. JPEG, PNG, WebP and GIF up to 8 MB."
        crumbs={[
          { label: "Website" },
          { label: "Media", to: ROUTES.adminMedia },
        ]}
      />
      <div className="p-4 sm:p-6">
        <MediaLibraryPanel />
      </div>
    </div>
  );
}
