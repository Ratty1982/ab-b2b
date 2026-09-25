import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for /portal/orders/$orderId and .../confirmation.
 * Detail lives on the index route. This parent MUST render <Outlet /> or
 * confirmation never appears after client navigation.
 */
export const Route = createFileRoute("/portal/orders/$orderId")({
  component: PortalOrderIdLayout,
});

function PortalOrderIdLayout() {
  return <Outlet />;
}
