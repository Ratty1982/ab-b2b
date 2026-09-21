import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for /admin/products/imports and /admin/products/imports/$id.
 * The list lives on the index route; the job workspace is the $id child.
 * This parent MUST render <Outlet /> or uploaded jobs appear stuck on the list.
 */
export const Route = createFileRoute("/admin/products/imports")({
  component: ProductImportsLayout,
});

function ProductImportsLayout() {
  return <Outlet />;
}
