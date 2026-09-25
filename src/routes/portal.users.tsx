import { createFileRoute } from "@tanstack/react-router";
import { PortalComingSoon } from "@/components/ab/PortalComingSoon";

export const Route = createFileRoute("/portal/users")({
  head: () => ({
    meta: [{ title: "Company & Users — Automotive Brands Trade Portal" }],
  }),
  component: () => (
    <PortalComingSoon
      title="Company & users"
      description="Company user management is not available in the trade portal yet. Ask your Automotive Brands account manager if you need an additional user invited."
    />
  ),
});
