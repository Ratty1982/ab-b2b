import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for /admin/content and /admin/content/$slug.
 * The list lives on the index route; the editor is the $slug child.
 * This parent MUST render <Outlet /> or the editor never appears.
 */
export const Route = createFileRoute("/admin/content")({
  component: WebsiteLayout,
});

function WebsiteLayout() {
  return <Outlet />;
}
