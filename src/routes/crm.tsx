import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/ab/AppShell";
import { ensureCrmAccess } from "@/server/auth/route-guards";
import { resolvePostLoginPath, safeReturnPath } from "@/server/auth/session";
import { shellModelFromSession, shellUserFromSession } from "@/lib/nav-permissions";
import { ROUTES } from "@/lib/app-nav";

export const Route = createFileRoute("/crm")({
  beforeLoad: async ({ location }) => {
    const result = await ensureCrmAccess();
    if (!result.ok) {
      if (result.reason === "unauthenticated") {
        throw redirect({
          to: "/login",
          search: { returnTo: safeReturnPath(location.href, ROUTES.crm) },
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
  const model = shellModelFromSession(user);

  return (
    <AppShell
      sections={model.sections}
      homeTo={model.homeTo}
      areaLabel={model.areaLabel}
      user={shellUserFromSession(user)}
    >
      <Outlet />
    </AppShell>
  );
}
