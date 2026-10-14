import { redirect } from "@tanstack/react-router";

import type { PermissionKey } from "@/domain/permissions";
import { ensureStaffPermission } from "@/server/auth/route-guards";
import { resolvePostLoginPath, safeReturnPath } from "@/server/auth/session";

/** Block a direct URL when the signed-in user lacks the section permission. */
export async function guardStaffPage(permission: PermissionKey, href: string, fallback: string) {
  const result = await ensureStaffPermission({ data: { permission } });
  if (result.ok) return;
  if (result.reason === "unauthenticated") {
    throw redirect({
      to: "/login",
      search: { returnTo: safeReturnPath(href, fallback) },
    });
  }
  if (result.session.signedIn) {
    throw redirect({ to: resolvePostLoginPath(result.session) });
  }
  throw redirect({ to: "/login" });
}
