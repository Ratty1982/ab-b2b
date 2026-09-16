import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/ab/AppShell";
import { ensureSalesAccess } from "@/server/auth/route-guards";
import { resolvePostLoginPath, safeReturnPath } from "@/server/auth/session";
import { filterNavByPermissions, shellUserFromSession } from "@/lib/nav-permissions";
import { ROUTES, SALES_NAV } from "@/lib/app-nav";

export const Route = createFileRoute("/sales")({
  beforeLoad: async ({ location }) => {
    const result = await ensureSalesAccess();
    if (!result.ok) {
      if (result.reason === "unauthenticated") {
        throw redirect({
          to: "/login",
          search: { returnTo: safeReturnPath(location.href, ROUTES.sales) },
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
  const nav = filterNavByPermissions(SALES_NAV, user);

  return (
    <AppShell nav={nav} area="Sales Portal" user={shellUserFromSession(user)}>
      <Outlet />
    </AppShell>
  );
}
