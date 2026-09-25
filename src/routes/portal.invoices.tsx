import { createFileRoute } from "@tanstack/react-router";
import { PortalComingSoon } from "@/components/ab/PortalComingSoon";

export const Route = createFileRoute("/portal/invoices")({
  head: () => ({
    meta: [{ title: "Invoices — Automotive Brands Trade Portal" }],
  }),
  component: () => (
    <PortalComingSoon
      title="Invoices & statements"
      description="Invoices and statements will appear here once account integration is live. No balances are shown until then."
    />
  ),
});
