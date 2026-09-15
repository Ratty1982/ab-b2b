import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell, type NavItem } from "@/components/ab/AppShell";
import { ensureSalesAccess } from "@/server/auth/route-guards";
import { resolvePostLoginPath, safeReturnPath } from "@/server/auth/session";
import { filterNavByPermissions, shellUserFromSession } from "@/lib/nav-permissions";
import type { PermissionKey } from "@/domain/permissions";

const allNav: Array<NavItem & { permission?: PermissionKey | PermissionKey[] }> = [
  { label: "Dashboard", to: "/sales", exact: true },
  { label: "My Customers", to: "/sales/customers", permission: "sales.view_own_accounts" },
  { label: "Leads", to: "/crm", permission: "crm.view" },
  { label: "Opportunities", to: "/crm", permission: "crm.view" },
  { label: "Quotes", to: "/sales/quotes", permission: "quotes.view" },
  // Stay within sales chrome — do not deep-link into trade portal orders shell
  { label: "Orders", to: "/sales", permission: "orders.view" },
  { label: "Trade Applications", to: "/crm/applications", permission: "applications.view" },
  {
    label: "Manager View",
    to: "/crm/manager",
    permission: ["sales.view_team_accounts", "reports.management"],
  },
];

export const Route = createFileRoute("/sales")({
  beforeLoad: async ({ location }) => {
    const result = await ensureSalesAccess();
    if (!result.ok) {
      if (result.reason === "unauthenticated") {
        throw redirect({
          to: "/login",
          search: { returnTo: safeReturnPath(location.href, "/sales") },
        });
      }
      if (result.session.signedIn) {
        throw redirect({ to: resolvePostLoginPath(result.session) });
      }
      throw redirect({ to: "/login" });
    }
    return { session: result.session };
  },
  component: SalesLayout,
});

function SalesLayout() {
  const { session } = Route.useRouteContext();
  const user = session.user;
  const nav = filterNavByPermissions(allNav, user);

  return (
    <AppShell nav={nav} area="Sales Portal" user={shellUserFromSession(user)}>
      <Outlet />
    </AppShell>
  );
}
