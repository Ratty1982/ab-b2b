/**
 * Idempotent RBAC system bootstrap — safe for production.
 * Creates/updates Permission, Role, and RolePermission rows only.
 * No demo companies, users, or sample commercial data.
 */
import type { PrismaClient } from "@prisma/client";

import { PERMISSIONS, SYSTEM_ROLE_KEYS, type SystemRoleKey } from "../../src/domain/permissions";
import { SYSTEM_ROLE_META, SYSTEM_ROLE_PERMISSIONS } from "../../src/domain/role-permissions";

export interface RbacBootstrapResult {
  permissionsUpserted: number;
  rolesUpserted: number;
  rolePermissionLinks: number;
}

export async function bootstrapRbac(prisma: PrismaClient): Promise<RbacBootstrapResult> {
  let permissionsUpserted = 0;
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: {
        key,
        name: key,
        description: `Permission ${key}`,
      },
      update: {
        name: key,
        description: `Permission ${key}`,
      },
    });
    permissionsUpserted += 1;
  }

  let rolesUpserted = 0;
  let rolePermissionLinks = 0;

  for (const key of SYSTEM_ROLE_KEYS) {
    const meta = SYSTEM_ROLE_META[key];
    const role = await prisma.role.upsert({
      where: { key },
      create: {
        key,
        name: meta.name,
        description: meta.description,
        isSystem: true,
      },
      update: {
        name: meta.name,
        description: meta.description,
        isSystem: true,
      },
    });
    rolesUpserted += 1;

    const desired = SYSTEM_ROLE_PERMISSIONS[key as SystemRoleKey];
    const perms = await prisma.permission.findMany({
      where: { key: { in: desired } },
    });

    // Replace mapping so removed permissions do not linger on system roles
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (perms.length) {
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
      rolePermissionLinks += perms.length;
    }
  }

  return { permissionsUpserted, rolesUpserted, rolePermissionLinks };
}
