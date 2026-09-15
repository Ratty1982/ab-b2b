import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell, type NavItem } from "@/components/ab/AppShell";
import { ensureAdminAccess } from "@/server/auth/route-guards";
import { resolvePostLoginPath, safeReturnPath } from "@/server/auth/session";
import { filterNavByPermissions, shellUserFromSession } from "@/lib/nav-permissions";
import type { PermissionKey } from "@/domain/permissions";

const allNav: Array<NavItem & { permission?: PermissionKey | PermissionKey[] }> = [
  { label: "Overview", to: "/admin", exact: true, permission: "admin.access" },
  { label: "Products", to: "/admin/products", permission: ["products.view", "products.edit"] },
  { label: "Brands & Categories", to: "/admin/products", permission: "products.view" },
  // Keep company links inside admin/sales chrome — not trade portal
  { label: "Companies", to: "/sales/customers", permission: "companies.view" },
  { label: "Trade Applications", to: "/crm/applications", permission: "applications.view" },
  { label: "Orders", to: "/admin", permission: "orders.view" },
  { label: "Quotes", to: "/sales/quotes", permission: "quotes.view" },
  { label: "Price Lists & Pricing", to: "/admin/pricing", permission: "pricing.view" },
  { label: "Promotions", to: "/admin/pricing", permission: "pricing.edit" },
  { label: "Sales Team", to: "/crm/manager", permission: "sales.view_team_accounts" },
  { label: "Users & Permissions", to: "/admin/roles", permission: ["users.view", "roles.view"] },
  { label: "Website Content", to: "/admin/content", permission: "cms.view" },
  { label: "Downloads", to: "/admin/content", permission: "cms.view" },
  { label: "Settings", to: "/admin/settings", permission: "settings.view" },
];

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    const result = await ensureAdminAccess();
    if (!result.ok) {
      if (result.reason === "unauthenticated") {
        throw redirect({
          to: "/login",
          search: { returnTo: safeReturnPath(location.href, "/admin") },
        });
      }
      if (result.session.signedIn) {
        throw redirect({ to: resolvePostLoginPath(result.session) });
      }
      throw redirect({ to: "/login" });
    }
    return { session: result.session };
  },
  component: AdminLayout,
});

function AdminLayout() {
  const { session } = Route.useRouteContext();
  const user = session.user;
  const nav = filterNavByPermissions(allNav, user);

  return (
    <AppShell nav={nav} area="Internal Admin" user={shellUserFromSession(user)}>
      <Outlet />
    </AppShell>
  );
}
