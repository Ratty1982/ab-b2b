import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for /portal/quotes and /portal/quotes/$quoteId.
 * List lives on the index route. Parent MUST render <Outlet />.
 */
export const Route = createFileRoute("/portal/quotes")({
  component: PortalQuotesLayout,
});

function PortalQuotesLayout() {
  return <Outlet />;
}
