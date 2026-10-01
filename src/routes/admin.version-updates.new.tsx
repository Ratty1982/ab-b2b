import { createFileRoute, redirect } from "@tanstack/react-router";
import { VersionUpdateEditor } from "@/components/system/VersionUpdateEditor";
import { ROUTES } from "@/lib/app-nav";
import { ensureAdminAccess } from "@/server/auth/route-guards";

export const Route = createFileRoute("/admin/version-updates/new")({
  beforeLoad: async () => {
    const result = await ensureAdminAccess();
    if (!result.ok || !result.session.signedIn) throw redirect({ to: "/login" });
    if (!result.session.user.navPermissions.includes("version_updates.manage")) {
      throw redirect({ to: ROUTES.admin });
    }
  },
  head: () => ({ meta: [{ title: "Create Version Update — Automotive Brands Admin" }] }),
  component: () => <VersionUpdateEditor />,
});
