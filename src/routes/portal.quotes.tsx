import { createFileRoute } from "@tanstack/react-router";
import { PortalComingSoon } from "@/components/ab/PortalComingSoon";

export const Route = createFileRoute("/portal/quotes")({
  head: () => ({
    meta: [{ title: "Quotes — Automotive Brands Trade Portal" }],
  }),
  component: () => (
    <PortalComingSoon
      title="Quotes"
      description="Trade quotes are not available in the portal yet. Place orders through Shop or Basket for now."
    />
  ),
});
