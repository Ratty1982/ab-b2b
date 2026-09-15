import type { CompanyUserRole } from "@prisma/client";

import { prisma } from "@/infra/database/client";
import { TRADE_ROLE_PERMISSIONS } from "@/domain/role-permissions";
import type { PermissionKey, TradeAccessKey } from "@/domain/permissions";
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
}

export async function loadAccessProfile(userId: string): Promise<LoadedAccessProfile | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      },
      companyUsers: {
        where: { status: "ACTIVE" },
        include: { company: { select: { id: true, name: true, accountNumber: true } } },
      },
      salesRep: { select: { id: true, managerId: true, active: true } },
    },
  });

  if (!user || user.status === "DISABLED") return null;

  const permissions = new Set<PermissionKey>();
  const systemRoles: string[] = [];

  for (const ur of user.userRoles) {
    systemRoles.push(ur.role.key);
    for (const rp of ur.role.permissions) {
      permissions.add(rp.permission.key as PermissionKey);
    }
  }

  const companyMemberships = user.companyUsers.map((cu) => {
    const tradeRole = companyRoleToTradeAccess(cu.role);
    for (const key of TRADE_ROLE_PERMISSIONS[tradeRole]) {
      // Trade permissions are company-scoped at enforcement time;
      // we still collect the union for navigation hints.
      permissions.add(key);
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
  };
}

export function profileToActor(
  profile: LoadedAccessProfile,
  opts?: { companyId?: string; onBehalfOfCompanyId?: string },
): RequestActor {
  const kind = profile.actorType === "INTERNAL" ? "internal_user" : "trade_user";
  const defaultCompany =
    opts?.companyId ??
    profile.companyMemberships.find((m) => m.isDefault)?.companyId ??
    profile.companyMemberships[0]?.companyId;

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
