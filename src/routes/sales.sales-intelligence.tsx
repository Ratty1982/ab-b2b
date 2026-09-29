import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for /sales/sales-intelligence and /sales/sales-intelligence/gaps.
 */
export const Route = createFileRoute("/sales/sales-intelligence")({
  component: SalesIntelligenceLayout,
});

function SalesIntelligenceLayout() {
  return <Outlet />;
}
