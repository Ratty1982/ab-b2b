import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for /portal/orders and /portal/orders/$orderId (+ confirmation).
 * List lives on the index route. This parent MUST render <Outlet /> or
 * order detail never appears after client navigation.
 */
export const Route = createFileRoute("/portal/orders")({
  component: PortalOrdersLayout,
});

function PortalOrdersLayout() {
  return <Outlet />;
}
