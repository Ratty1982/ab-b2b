import { createFileRoute } from "@tanstack/react-router";
import { PortalComingSoon } from "@/components/ab/PortalComingSoon";

export const Route = createFileRoute("/portal/favourites")({
  head: () => ({
    meta: [{ title: "Favourites — Automotive Brands Trade Portal" }],
  }),
  component: () => (
    <PortalComingSoon
      title="Favourites / order lists"
      description="Saved order lists are not available yet. Use Shop and Basket to build orders."
    />
  ),
});
