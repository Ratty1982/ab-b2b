import { z } from "zod";

import { prisma } from "@/infra/database/client";
import { isPermissionKey, type PermissionKey, type SystemRoleKey } from "@/domain/permissions";
import { SYSTEM_ROLE_META } from "@/domain/role-permissions";
import {
  STAFF_PERMISSION_TREE,
  implySectionPermissions,
  mergePermissionOverrides,
} from "@/domain/permission-sections";
import {
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
    .max(400),
});

export type StaffPermissionEditor = {
  userId: string;
  name: string;
  email: string;
  roles: Array<{ key: string; label: string }>;
  categories: Array<{
    id: string;
    label: string;
    permissions: Array<{
      key: PermissionKey;
      label: string;
      roleGranted: boolean;
      effect: OverrideEffect;
      effective: boolean;
      sensitive: boolean;
      directRole: boolean;
    }>;
    sections: Array<{
      id: string;
      label: string;
      fixedNote: string | null;
      permissions: Array<{
        key: PermissionKey;
        label: string;
        roleGranted: boolean;
        effect: OverrideEffect;
        effective: boolean;
        sensitive: boolean;
        directRole: boolean;
      }>;
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

const SENSITIVE = new Set<PermissionKey>(SENSITIVE_PERMISSIONS);

function permissionRow(
  key: PermissionKey,
  roleGranted: ReadonlySet<PermissionKey>,
  directRole: ReadonlySet<PermissionKey>,
  overrides: OverrideMap,
  effective: ReadonlySet<PermissionKey>,
) {
  const effect = overrides[key] ?? "INHERIT";
  return {
    key,
    label: PERMISSION_LABELS[key],
    roleGranted: roleGranted.has(key),
    directRole: directRole.has(key),
    effect,
    effective: effective.has(key),
    sensitive: SENSITIVE.has(key),
  };
}

function editorFromUser(user: Awaited<ReturnType<typeof loadStaffPermissionTarget>>): StaffPermissionEditor {
  const granted = roleGrantedSet(user);
  const stored = storedOverrides(user.permissionOverrides);
  const overrides = overrideMapFromStored(stored);
  const applied = applyUserPermissionOverrides(granted, stored);
  const roleGranted = implySectionPermissions(granted, new Set());
  return {
    userId: user.id,
    name: user.name ?? user.email,
    email: user.email,
    roles: user.userRoles.map((assignment) => ({
      key: assignment.role.key,
      label: roleLabel(assignment.role.key),
    })),
    categories: STAFF_PERMISSION_TREE.map((category) => {
      const sections = category.sections.map((section) => ({
        id: section.id,
        label: section.label,
        fixedNote: section.fixedNote ?? null,
        permissions: section.actions.map((key) =>
          permissionRow(key, roleGranted, granted, overrides, applied.effective),
        ),
      }));
      return {
        id: category.id,
        label: category.label,
        sections,
        permissions: sections.flatMap((section) => section.permissions),
      };
    }),
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

async function otherEffectiveSuperAdmins(excludeUserIds: string[]): Promise<number> {
  const rows = await prisma.user.findMany({
    where: {
      id: { notIn: excludeUserIds },
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
      otherEffectiveSuperAdmins: await otherEffectiveSuperAdmins([user.id]),
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

const bulkSchema = z.object({
  userIds: z.array(z.string().cuid()).min(1).max(50),
  confirmSensitive: z.boolean().optional(),
  changes: z
    .array(
      z.object({
        permissionKey: z.string(),
        effect: z.enum(["INHERIT", "ALLOW", "DENY"]),
      }),
    )
    .min(1)
    .max(400),
});

export type BulkPermissionPreview = {
  users: Array<{ id: string; name: string; email: string; roles: string }>;
  changes: Array<{
    key: PermissionKey;
    label: string;
    effect: OverrideEffect;
    sensitive: boolean;
    rows: Array<{
      userId: string;
      name: string;
      beforeEffect: OverrideEffect;
      afterEffect: OverrideEffect;
      beforeEffective: boolean;
      afterEffective: boolean;
    }>;
  }>;
  sensitive: boolean;
};

function parseBulkChanges(raw: Array<{ permissionKey: string; effect: OverrideEffect }>) {
  const seen = new Set<string>();
  const changes: Array<{ permissionKey: PermissionKey; effect: OverrideEffect }> = [];
  for (const row of raw) {
    if (!isPermissionKey(row.permissionKey)) {
      throw new AuthError("Unknown permission", "VALIDATION", 400);
    }
    if (seen.has(row.permissionKey)) {
      throw new AuthError("Duplicate permission", "VALIDATION", 400);
    }
    seen.add(row.permissionKey);
    changes.push({ permissionKey: row.permissionKey, effect: row.effect });
  }
  return changes;
}

async function loadBulkTargets(userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (unique.length !== userIds.length) {
    throw new AuthError("Duplicate user", "VALIDATION", 400);
  }
  const users = [];
  const missing: string[] = [];
  for (const userId of unique) {
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
    if (!user || user.actorType !== "INTERNAL") missing.push(userId);
    else users.push(user);
  }
  if (missing.length) {
    throw new AuthError(`Staff user not found: ${missing.join(", ")}`, "NOT_FOUND", 404);
  }
  return users;
}

function planBulk(
  users: Awaited<ReturnType<typeof loadBulkTargets>>,
  changes: Array<{ permissionKey: PermissionKey; effect: OverrideEffect }>,
) {
  return users.map((user) => {
    const granted = roleGrantedSet(user);
    const beforeStored = storedOverrides(user.permissionOverrides);
    const beforeMap = overrideMapFromStored(beforeStored);
    const afterMap = mergePermissionOverrides(beforeMap, changes);
    const beforeApplied = applyUserPermissionOverrides(granted, beforeStored);
    const afterStored = storedFromOverrideMap(afterMap);
    const afterApplied = applyUserPermissionOverrides(granted, afterStored);
    return { user, granted, beforeMap, afterMap, beforeStored, afterStored, beforeApplied, afterApplied };
  });
}

function bulkPreviewFromPlans(
  plans: ReturnType<typeof planBulk>,
  changes: Array<{ permissionKey: PermissionKey; effect: OverrideEffect }>,
): BulkPermissionPreview {
  const sensitiveKeys = changes.filter((change) => SENSITIVE.has(change.permissionKey));
  const targetIsSuperAdmin = plans.some((plan) =>
    plan.user.userRoles.some((assignment) => assignment.role.key === "SUPER_ADMIN"),
  );
  return {
    users: plans.map((plan) => ({
      id: plan.user.id,
      name: plan.user.name ?? plan.user.email,
      email: plan.user.email,
      roles: plan.user.userRoles.map((assignment) => roleLabel(assignment.role.key)).join(", ") || "No role",
    })),
    changes: changes.map((change) => ({
      key: change.permissionKey,
      label: PERMISSION_LABELS[change.permissionKey],
      effect: change.effect,
      sensitive: SENSITIVE.has(change.permissionKey),
      rows: plans.map((plan) => ({
        userId: plan.user.id,
        name: plan.user.name ?? plan.user.email,
        beforeEffect: plan.beforeMap[change.permissionKey] ?? "INHERIT",
        afterEffect: plan.afterMap[change.permissionKey] ?? "INHERIT",
        beforeEffective: plan.beforeApplied.effective.has(change.permissionKey),
        afterEffective: plan.afterApplied.effective.has(change.permissionKey),
      })),
    })),
    sensitive: sensitiveKeys.length > 0 || targetIsSuperAdmin,
  };
}

async function assertBulkKeepsSuperAdmin(plans: ReturnType<typeof planBulk>) {
  const ids = plans.map((plan) => plan.user.id);
  const outside = await otherEffectiveSuperAdmins(ids);
  const keepers = plans.filter(
    (plan) =>
      plan.user.status === "ACTIVE" &&
      plan.user.userRoles.some((assignment) => assignment.role.key === "SUPER_ADMIN") &&
      plan.afterApplied.effective.has("users.manage"),
  ).length;
  for (const plan of plans) {
    const keeps = plan.afterApplied.effective.has("users.manage");
    const others = outside + keepers - (keeps && plan.user.userRoles.some((a) => a.role.key === "SUPER_ADMIN") && plan.user.status === "ACTIVE" ? 1 : 0);
    if (
      removesLastEffectiveSuperAdmin({
        targetHasSuperAdminRole: plan.user.userRoles.some((assignment) => assignment.role.key === "SUPER_ADMIN"),
        targetKeepsUsersManage: keeps,
        otherEffectiveSuperAdmins: others,
      })
    ) {
      throw new AuthError(
        "This change would remove the last Super Admin who can manage users",
        "VALIDATION",
        400,
      );
    }
  }
}

export async function previewBulkStaffPermissions(actorUserId: string, raw: unknown) {
  await requireSuperAdminActor(actorUserId);
  const input = bulkSchema.parse(raw);
  const changes = parseBulkChanges(input.changes);
  const users = await loadBulkTargets(input.userIds);
  const plans = planBulk(users, changes);
  await assertBulkKeepsSuperAdmin(plans);
  return bulkPreviewFromPlans(plans, changes);
}

export async function applyBulkStaffPermissions(actorUserId: string, raw: unknown) {
  await requireSuperAdminActor(actorUserId);
  const input = bulkSchema.parse(raw);
  const changes = parseBulkChanges(input.changes);
  const users = await loadBulkTargets(input.userIds);
  const plans = planBulk(users, changes);
  const preview = bulkPreviewFromPlans(plans, changes);
  if (preview.sensitive && input.confirmSensitive !== true) {
    throw new AuthError("Confirm sensitive permission changes before applying them", "CONFIRM_SENSITIVE", 400);
  }
  await assertBulkKeepsSuperAdmin(plans);

  await prisma.$transaction(async (tx) => {
    for (const plan of plans) {
      for (const change of changes) {
        if (change.effect === "INHERIT") {
          await tx.userPermissionOverride.deleteMany({
            where: { userId: plan.user.id, permissionKey: change.permissionKey },
          });
          continue;
        }
        await tx.userPermissionOverride.upsert({
          where: {
            userId_permissionKey: { userId: plan.user.id, permissionKey: change.permissionKey },
          },
          create: {
            userId: plan.user.id,
            permissionKey: change.permissionKey,
            effect: change.effect,
            updatedByUserId: actorUserId,
          },
          update: { effect: change.effect, updatedByUserId: actorUserId },
        });
      }
      await tx.user.update({ where: { id: plan.user.id }, data: { updatedAt: new Date() } });
    }
  });

  for (const plan of plans) {
    await recordAuditEvent({
      action: "USER_PERMISSIONS_UPDATED",
      entityType: "User",
      entityId: plan.user.id,
      actorUserId,
      targetUserId: plan.user.id,
      before: { overrides: plan.beforeStored },
      after: { overrides: plan.afterStored },
    });
  }

  return preview;
}
