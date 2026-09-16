import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/ab/AppShell";
import { ensurePortalAccess } from "@/server/auth/route-guards";
import { resolvePostLoginPath, safeReturnPath } from "@/server/auth/session";
import { filterNavByPermissions, shellUserFromSession } from "@/lib/nav-permissions";
import { PORTAL_NAV, ROUTES } from "@/lib/app-nav";

export const Route = createFileRoute("/portal")({
  beforeLoad: async ({ location }) => {
    const result = await ensurePortalAccess();
    if (!result.ok) {
      if (result.reason === "unauthenticated") {
        throw redirect({
          to: "/login",
          search: { returnTo: safeReturnPath(location.href, ROUTES.portal) },
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
  const nav = filterNavByPermissions(PORTAL_NAV, user);

  return (
    <AppShell nav={nav} area="Trade Portal" user={shellUserFromSession(user)}>
      <Outlet />
    </AppShell>
  );
}
