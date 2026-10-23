import type { CompanyUserRole } from "@prisma/client";

import { prisma } from "@/infra/database/client";
import { TRADE_ROLE_PERMISSIONS } from "@/domain/role-permissions";
import { isPermissionKey, type PermissionKey, type TradeAccessKey } from "@/domain/permissions";
import {
  allowsListedPermissions,
  applyUserPermissionOverrides,
  type StoredOverride,
} from "@/domain/user-permissions";
import type { RequestActor } from "@/server/context/actor";

/** Map Prisma CompanyUserRole → product trade access key */
export function companyRoleToTradeAccess(role: CompanyUserRole): TradeAccessKey {
  switch (role) {
    case "TRADE_ADMIN":
      return "TRADE_ACCOUNT_ADMIN";
    case "TRADE_BUYER":
      return "TRADE_BUYER";
    case "TRADE_ACCOUNTS":
      return "TRADE_ACCOUNTS";
    case "TRADE_READ_ONLY":
      return "TRADE_READ_ONLY";
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

export function tradeAccessToCompanyRole(access: TradeAccessKey): CompanyUserRole {
  switch (access) {
    case "TRADE_ACCOUNT_ADMIN":
      return "TRADE_ADMIN";
    case "TRADE_BUYER":
      return "TRADE_BUYER";
    case "TRADE_ACCOUNTS":
      return "TRADE_ACCOUNTS";
    case "TRADE_READ_ONLY":
      return "TRADE_READ_ONLY";
    default: {
      const _exhaustive: never = access;
      return _exhaustive;
    }
  }
}

export interface LoadedAccessProfile {
  userId: string;
  email: string;
  name: string | null;
  actorType: "INTERNAL" | "TRADE";
  status: string;
  systemRoles: string[];
  permissions: Set<PermissionKey>;
  companyMemberships: Array<{
    companyId: string;
    companyName: string;
    accountNumber: string | null;
    role: TradeAccessKey;
    status: string;
    isDefault: boolean;
  }>;
  salesRepId: string | null;
  managerSalesRepId: string | null;
  /** Explicit DENY overrides. admin.access must not bypass these. */
  deniedPermissions: Set<PermissionKey>;
}

export async function loadAccessProfile(userId: string): Promise<LoadedAccessProfile | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      },
      permissionOverrides: { select: { permissionKey: true, effect: true } },
      companyUsers: {
        where: { status: "ACTIVE" },
        include: { company: { select: { id: true, name: true, accountNumber: true } } },
      },
      salesRep: { select: { id: true, managerId: true, active: true } },
    },
  });

  if (!user || user.status === "DISABLED") return null;

  const rolePermissions = new Set<PermissionKey>();
  const systemRoles: string[] = [];

  for (const ur of user.userRoles) {
    systemRoles.push(ur.role.key);
    for (const rp of ur.role.permissions) {
      if (isPermissionKey(rp.permission.key)) rolePermissions.add(rp.permission.key);
    }
  }

  const storedOverrides: StoredOverride[] =
    user.actorType === "INTERNAL"
      ? user.permissionOverrides.flatMap((row) =>
          isPermissionKey(row.permissionKey) && (row.effect === "ALLOW" || row.effect === "DENY")
            ? [{ permissionKey: row.permissionKey, effect: row.effect }]
            : [],
        )
      : [];
  const applied = applyUserPermissionOverrides(rolePermissions, storedOverrides);
  const permissions = applied.effective;
  const deniedPermissions = applied.denied;

  const companyMemberships = user.companyUsers.map((cu) => {
    const tradeRole = companyRoleToTradeAccess(cu.role);
    if (cu.status === "ACTIVE") {
      for (const key of TRADE_ROLE_PERMISSIONS[tradeRole]) {
        // Trade permissions stay company-scoped at enforcement time.
        // A staff DENY still suppresses the navigation hint for that key.
        if (deniedPermissions.has(key)) continue;
        permissions.add(key);
      }
    }
    return {
      companyId: cu.companyId,
      companyName: cu.company.name,
      accountNumber: cu.company.accountNumber,
      role: tradeRole,
      status: cu.status,
      isDefault: cu.isDefault,
    };
  });

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    actorType: user.actorType,
    status: user.status,
    systemRoles,
    permissions,
    companyMemberships,
    salesRepId: user.salesRep?.active ? user.salesRep.id : null,
    managerSalesRepId: user.salesRep?.active ? (user.salesRep.managerId ?? null) : null,
    deniedPermissions,
  };
}

/** Specific permissions win. admin.access does not override an explicit DENY. */
export function grants(profile: LoadedAccessProfile, ...keys: PermissionKey[]): boolean {
  return allowsListedPermissions(profile.permissions, profile.deniedPermissions, keys);
}

export function profileToActor(
  profile: LoadedAccessProfile,
  opts?: { companyId?: string; onBehalfOfCompanyId?: string },
): RequestActor {
  const kind = profile.actorType === "INTERNAL" ? "internal_user" : "trade_user";
  const defaultCompany =
    opts?.companyId ??
    profile.companyMemberships.find((m) => m.isDefault && m.status === "ACTIVE")?.companyId ??
    profile.companyMemberships.find((m) => m.status === "ACTIVE")?.companyId;

  const actor: RequestActor = {
    kind,
    userId: profile.userId,
    email: profile.email,
    roles: [...profile.systemRoles, ...profile.companyMemberships.map((m) => m.role)],
    permissions: [...profile.permissions],
  };
  if (defaultCompany) actor.companyId = defaultCompany;
  if (opts?.onBehalfOfCompanyId) actor.onBehalfOfCompanyId = opts.onBehalfOfCompanyId;
  return actor;
}

export function hasPermission(profile: LoadedAccessProfile, permission: PermissionKey): boolean {
  return profile.permissions.has(permission);
}

export function hasAnyPermission(
  profile: LoadedAccessProfile,
  permissions: PermissionKey[],
): boolean {
  return permissions.some((p) => profile.permissions.has(p));
}
