import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/pricing")({
  component: PricingLayout,
});

function PricingLayout() {
  return <Outlet />;
}
