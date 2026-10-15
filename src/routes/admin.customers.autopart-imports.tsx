import { createFileRoute, redirect } from "@tanstack/react-router";
import { ROUTES } from "@/lib/app-nav";

export const Route = createFileRoute("/admin/customers/autopart-imports")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `${ROUTES.adminAutopartImports}${location.searchStr}`,
    });
  },
});
