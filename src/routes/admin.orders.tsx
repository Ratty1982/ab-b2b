import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for /admin/orders and /admin/orders/$orderId.
 * List lives on the index route. This parent MUST render <Outlet /> or
 * order detail never appears after client navigation.
 */
export const Route = createFileRoute("/admin/orders")({
  component: AdminOrdersLayout,
});

function AdminOrdersLayout() {
  return <Outlet />;
}
