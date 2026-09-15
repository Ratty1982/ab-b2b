import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell, type NavItem } from "@/components/ab/AppShell";
import { ensureCrmAccess } from "@/server/auth/route-guards";
import { resolvePostLoginPath, safeReturnPath } from "@/server/auth/session";
import { filterNavByPermissions, shellUserFromSession } from "@/lib/nav-permissions";
import type { PermissionKey } from "@/domain/permissions";

const allNav: Array<NavItem & { permission?: PermissionKey | PermissionKey[] }> = [
  { label: "Dashboard", to: "/sales", exact: true },
  { label: "Companies", to: "/sales/customers", permission: "companies.view" },
  { label: "Contacts", to: "/crm", exact: true, permission: "contacts.view" },
  { label: "Leads", to: "/crm", exact: true, permission: "crm.view" },
  { label: "Opportunities", to: "/crm", exact: true, permission: "crm.view" },
  { label: "Activities", to: "/crm", exact: true, permission: "crm.activities.create" },
  { label: "Tasks", to: "/crm", exact: true, permission: "tasks.view" },
  { label: "Quotes", to: "/sales/quotes", permission: "quotes.view" },
  { label: "Trade Applications", to: "/crm/applications", permission: "applications.view" },
  {
    label: "Sales Team",
    to: "/crm/manager",
    permission: ["sales.view_team_accounts", "reports.management"],
  },
  { label: "Reports", to: "/crm/manager", permission: "reports.view" },
  { label: "Admin", to: "/admin", permission: "admin.access" },
];

export const Route = createFileRoute("/crm")({
  beforeLoad: async ({ location }) => {
    const result = await ensureCrmAccess();
    if (!result.ok) {
      if (result.reason === "unauthenticated") {
        throw redirect({
          to: "/login",
          search: { returnTo: safeReturnPath(location.href, "/crm") },
        });
      }
      if (result.session.signedIn) {
        throw redirect({ to: resolvePostLoginPath(result.session) });
      }
      throw redirect({ to: "/login" });
    }
    return { session: result.session };
  },
  component: CrmLayout,
});

function CrmLayout() {
  const { session } = Route.useRouteContext();
  const user = session.user;
  const nav = filterNavByPermissions(allNav, user);

  return (
    <AppShell nav={nav} area="CRM" user={shellUserFromSession(user)}>
      <Outlet />
    </AppShell>
  );
}
