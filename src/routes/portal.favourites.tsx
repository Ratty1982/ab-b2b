import { createFileRoute, redirect } from "@tanstack/react-router";
import { ROUTES } from "@/lib/app-nav";

export const Route = createFileRoute("/portal/favourites")({
  beforeLoad: () => {
    throw redirect({ to: ROUTES.portal });
  },
  component: () => null,
});
