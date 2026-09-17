import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for /admin/products, /admin/products/$id and /admin/products/imports.
 * The list lives on the index route; the workspace and imports are children.
 * This parent MUST render <Outlet /> or those screens never appear after client navigation.
 */
export const Route = createFileRoute("/admin/products")({
  component: ProductsLayout,
});

function ProductsLayout() {
  return <Outlet />;
}
