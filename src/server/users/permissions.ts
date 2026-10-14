import { z } from "zod";

import { prisma } from "@/infra/database/client";
import { isPermissionKey, type PermissionKey, type SystemRoleKey } from "@/domain/permissions";
import { SYSTEM_ROLE_META } from "@/domain/role-permissions";
import {
  PERMISSION_CATEGORIES,
  PERMISSION_LABELS,
  SENSITIVE_PERMISSIONS,
  accessSummary,
  applyUserPermissionOverrides,
  overrideMapFromStored,
  removesLastEffectiveSuperAdmin,
  sensitivePermissionChanges,
  storedFromOverrideMap,
  type OverrideEffect,
  type OverrideMap,
  type StoredOverride,
} from "@/domain/user-permissions";
import { previewBackOfficeNavigation } from "@/lib/app-nav";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";

const saveSchema = z.object({
  userId: z.string().cuid(),
  confirmSensitive: z.boolean().optional(),
  overrides: z
    .array(
      z.object({
        permissionKey: z.string(),
        effect: z.enum(["INHERIT", "ALLOW", "DENY"]),
      }),
    )
    .max(200),
});

export type StaffPermissionEditor = {
  userId: string;
  name: string;
  email: string;
  roles: Array<{ key: string; label: string }>;
  categories: Array<{
    id: string;
    label: string;
    columns: {
      view: PermissionKey[];
      edit: PermissionKey[];
      manage: PermissionKey[];
    };
    permissions: Array<{
      key: PermissionKey;
      label: string;
      roleGranted: boolean;
      effect: OverrideEffect;
      effective: boolean;
    }>;
  }>;
  customisedCount: number;
  summary: string[];
  navigation: Array<{ section: string; items: string[] }>;
  sensitiveKeys: PermissionKey[];
};

async function requireSuperAdminActor(actorUserId: string) {
  const profile = await requireAuthenticatedUser(actorUserId);
  if (profile.actorType !== "INTERNAL" || !profile.systemRoles.includes("SUPER_ADMIN")) {
    throw new AuthError("Only a Super Admin can change individual permissions", "FORBIDDEN", 403);
  }
  return profile;
}

function roleLabel(key: string): string {
  if (key in SYSTEM_ROLE_META) return SYSTEM_ROLE_META[key as SystemRoleKey].name;
  return key;
}

async function loadStaffPermissionTarget(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      },
      permissionOverrides: {
        select: { permissionKey: true, effect: true },
        orderBy: { permissionKey: "asc" },
      },
    },
  });
  if (!user || user.actorType !== "INTERNAL") {
    throw new AuthError("User not found", "NOT_FOUND", 404);
  }
  return user;
}

function roleGrantedSet(
  user: Awaited<ReturnType<typeof loadStaffPermissionTarget>>,
): Set<PermissionKey> {
  const granted = new Set<PermissionKey>();
  for (const assignment of user.userRoles) {
    for (const row of assignment.role.permissions) {
      if (isPermissionKey(row.permission.key)) granted.add(row.permission.key);
    }
  }
  return granted;
}

function storedOverrides(
  rows: Array<{ permissionKey: string; effect: "ALLOW" | "DENY" }>,
): StoredOverride[] {
  return rows.flatMap((row) =>
    isPermissionKey(row.permissionKey) ? [{ permissionKey: row.permissionKey, effect: row.effect }] : [],
  );
}

function editorFromUser(user: Awaited<ReturnType<typeof loadStaffPermissionTarget>>): StaffPermissionEditor {
  const granted = roleGrantedSet(user);
  const stored = storedOverrides(user.permissionOverrides);
  const overrides = overrideMapFromStored(stored);
  const applied = applyUserPermissionOverrides(granted, stored);
  return {
    userId: user.id,
    name: user.name ?? user.email,
    email: user.email,
    roles: user.userRoles.map((assignment) => ({
      key: assignment.role.key,
      label: roleLabel(assignment.role.key),
    })),
    categories: PERMISSION_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      columns: {
        view: [...(category.columns.view ?? [])],
        edit: [...(category.columns.edit ?? [])],
        manage: [...(category.columns.manage ?? [])],
      },
      permissions: category.permissions.map((key) => {
        const effect = overrides[key] ?? "INHERIT";
        const roleHas = granted.has(key);
        const effective =
          effect === "ALLOW" ? true : effect === "DENY" ? false : roleHas;
        return {
          key,
          label: PERMISSION_LABELS[key],
          roleGranted: roleHas,
          effect,
          effective,
        };
      }),
    })),
    customisedCount: stored.length,
    summary: accessSummary(applied.effective),
    navigation: previewBackOfficeNavigation({
      permissions: applied.effective,
      denied: applied.denied,
    }),
    sensitiveKeys: [...SENSITIVE_PERMISSIONS],
  };
}

export async function getStaffUserPermissions(
  actorUserId: string,
  userId: string,
): Promise<StaffPermissionEditor> {
  await requireSuperAdminActor(actorUserId);
  const user = await loadStaffPermissionTarget(userId);
  return editorFromUser(user);
}

async function otherEffectiveSuperAdmins(excludeUserId: string): Promise<number> {
  const rows = await prisma.user.findMany({
    where: {
      id: { not: excludeUserId },
      status: "ACTIVE",
      actorType: "INTERNAL",
      userRoles: { some: { role: { key: "SUPER_ADMIN" } } },
    },
    select: {
      userRoles: {
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      },
      permissionOverrides: { select: { permissionKey: true, effect: true } },
    },
  });
  let count = 0;
  for (const row of rows) {
    const granted = new Set<PermissionKey>();
    for (const assignment of row.userRoles) {
      for (const permission of assignment.role.permissions) {
        if (isPermissionKey(permission.permission.key)) granted.add(permission.permission.key);
      }
    }
    const applied = applyUserPermissionOverrides(granted, storedOverrides(row.permissionOverrides));
    if (applied.effective.has("users.manage")) count += 1;
  }
  return count;
}

export async function saveStaffUserPermissions(actorUserId: string, raw: unknown) {
  await requireSuperAdminActor(actorUserId);
  const input = saveSchema.parse(raw);
  const seen = new Set<string>();
  const desired: OverrideMap = {};
  for (const row of input.overrides) {
    if (!isPermissionKey(row.permissionKey)) {
      throw new AuthError("Unknown permission", "VALIDATION", 400);
    }
    if (seen.has(row.permissionKey)) {
      throw new AuthError("Duplicate permission", "VALIDATION", 400);
    }
    seen.add(row.permissionKey);
    if (row.effect === "INHERIT") continue;
    desired[row.permissionKey] = row.effect;
  }

  const user = await loadStaffPermissionTarget(input.userId);
  const beforeStored = storedOverrides(user.permissionOverrides);
  const beforeMap = overrideMapFromStored(beforeStored);
  const sensitive = sensitivePermissionChanges(beforeMap, desired);
  const targetIsSuperAdmin = user.userRoles.some((assignment) => assignment.role.key === "SUPER_ADMIN");
  if ((sensitive.length > 0 || targetIsSuperAdmin) && input.confirmSensitive !== true) {
    const labels = sensitive.map((key) => PERMISSION_LABELS[key]);
    throw new AuthError(
      targetIsSuperAdmin
        ? "Confirm changes to a Super Admin's permissions"
        : `Confirm sensitive permission changes: ${labels.join(", ")}`,
      "CONFIRM_SENSITIVE",
      400,
    );
  }

  const granted = roleGrantedSet(user);
  const nextStored = storedFromOverrideMap(desired);
  const applied = applyUserPermissionOverrides(granted, nextStored);
  if (
    removesLastEffectiveSuperAdmin({
      targetHasSuperAdminRole: targetIsSuperAdmin,
      targetKeepsUsersManage: applied.effective.has("users.manage"),
      otherEffectiveSuperAdmins: await otherEffectiveSuperAdmins(user.id),
    })
  ) {
    throw new AuthError(
      "This change would remove the last Super Admin who can manage users",
      "VALIDATION",
      400,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.userPermissionOverride.deleteMany({ where: { userId: user.id } });
    if (nextStored.length > 0) {
      await tx.userPermissionOverride.createMany({
        data: nextStored.map((row) => ({
          userId: user.id,
          permissionKey: row.permissionKey,
          effect: row.effect,
          updatedByUserId: actorUserId,
        })),
      });
    }
    await tx.user.update({ where: { id: user.id }, data: { updatedAt: new Date() } });
  });

  await recordAuditEvent({
    action: "USER_PERMISSIONS_UPDATED",
    entityType: "User",
    entityId: user.id,
    actorUserId,
    targetUserId: user.id,
    before: { overrides: beforeStored },
    after: { overrides: nextStored },
  });

  const refreshed = await loadStaffPermissionTarget(user.id);
  return editorFromUser(refreshed);
}
