import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { PanelHeader } from "@/components/ab/AppShell";
import { ROUTES } from "@/lib/app-nav";

/**
 * Sales home previously used frontend demo CRM fixtures.
 * Redirect staff to the production CRM Overview (My Day).
 */
export const Route = createFileRoute("/sales/")({
  beforeLoad: () => {
    throw redirect({ to: ROUTES.crmOverview });
  },
  head: () => ({
    meta: [
      { title: "Sales — Automotive Brands" },
      { name: "description", content: "Sales workspace — redirects to CRM Overview." },
    ],
  }),
  component: SalesHomeFallback,
});

function SalesHomeFallback() {
  return (
    <div>
      <PanelHeader title="Sales" sub="Opening CRM Overview…" />
      <p className="px-6 py-8 text-sm text-steel">
        <Link to={ROUTES.crmOverview} className="text-primary hover:underline">
          Go to CRM Overview
        </Link>
      </p>
    </div>
  );
}
