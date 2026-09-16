import type { AppNavItem } from "@/lib/app-nav";
import type { NavItem } from "@/components/ab/AppShell";
import type { PermissionKey } from "@/domain/permissions";
import type { SafeSessionUser } from "@/server/auth/session";

export function filterNavByPermissions(
  items: Array<AppNavItem | (NavItem & { permission?: PermissionKey | PermissionKey[]; deferred?: boolean })>,
  user: SafeSessionUser | null,
): NavItem[] {
  if (!user) return [];
  const set = new Set(user.navPermissions);
  return items
    .filter((item) => {
      if (item.deferred) return false;
      if (!item.permission) return true;
      const required = Array.isArray(item.permission) ? item.permission : [item.permission];
      return required.some((p) => set.has(p));
    })
    .map(({ label, to, exact }) => {
      const item: NavItem = { label, to };
      if (exact !== undefined) item.exact = exact;
      return item;
    });
}

export function shellUserFromSession(user: SafeSessionUser): { name: string; role: string } {
  return {
    name: user.name,
    role: user.actingFor ? `Ordering for ${user.actingFor.companyName}` : user.displayRole,
  };
}
