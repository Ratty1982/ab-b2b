import { createFileRoute, Link } from "@tanstack/react-router";
import { PanelHeader } from "@/components/ab/AppShell";
import { ROUTES } from "@/lib/app-nav";

/** Shared empty shell for portal features not yet production-backed. */
export function PortalComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <PanelHeader title={title} sub="Coming soon" />
      <div className="p-4 sm:p-6">
        <div className="max-w-xl rounded-lg border border-dashed border-border p-6">
          <p className="text-[13px] text-steel">{description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to={ROUTES.portal}
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-bold uppercase hover:border-steel"
            >
              Dashboard
            </Link>
            <Link
              to={ROUTES.products}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
            >
              Shop products
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
