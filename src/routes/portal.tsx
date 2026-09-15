import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell, type NavItem } from "@/components/ab/AppShell";
import { ensurePortalAccess } from "@/server/auth/route-guards";
import { resolvePostLoginPath, safeReturnPath } from "@/server/auth/session";
import { filterNavByPermissions, shellUserFromSession } from "@/lib/nav-permissions";
import type { PermissionKey } from "@/domain/permissions";

const allNav: Array<NavItem & { permission?: PermissionKey | PermissionKey[] }> = [
  { label: "Dashboard", to: "/portal", exact: true },
  { label: "Shop", to: "/products" },
  { label: "Quick Order", to: "/portal/quick-order", permission: "orders.create" },
  { label: "Orders", to: "/portal/orders", permission: "orders.view" },
  { label: "Quotes", to: "/portal/quotes", permission: "quotes.view" },
  { label: "Invoices & Statements", to: "/portal/invoices", permission: "invoices.view" },
  { label: "Favourites / Order Lists", to: "/portal/favourites" },
  { label: "Downloads", to: "/resources" },
  { label: "Company & Users", to: "/portal/users", permission: "companies.manage_users" },
  { label: "Support", to: "/portal/support" },
];

export const Route = createFileRoute("/portal")({
  beforeLoad: async ({ location }) => {
    const result = await ensurePortalAccess();
    if (!result.ok) {
      if (result.reason === "unauthenticated") {
        throw redirect({
          to: "/login",
          search: { returnTo: safeReturnPath(location.href, "/portal") },
        });
      }
      if (result.session.signedIn) {
        throw redirect({ to: resolvePostLoginPath(result.session) });
      }
      throw redirect({ to: "/login" });
    }
    return { session: result.session };
  },
  component: PortalLayout,
});

function PortalLayout() {
  const { session } = Route.useRouteContext();
  const user = session.user;
  const nav = filterNavByPermissions(allNav, user);

  return (
    <AppShell nav={nav} area="Trade Portal" user={shellUserFromSession(user)}>
      <Outlet />
    </AppShell>
  );
}
