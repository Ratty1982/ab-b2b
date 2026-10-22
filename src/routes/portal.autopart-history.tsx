import { createFileRoute, redirect } from "@tanstack/react-router";
import { ROUTES } from "@/lib/app-nav";

export const Route = createFileRoute("/portal/autopart-history")({
  beforeLoad: () => {
    throw redirect({ href: ROUTES.portalPurchases });
  },
});
