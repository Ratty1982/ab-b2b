import type { PermissionKey } from "@/domain/permissions";
import { dedicatedAdminSectionUnlock } from "@/domain/permission-sections";
import { ADMIN_SHELL_PERMISSIONS } from "@/lib/app-nav";
import { grants, hasPermission, loadAccessProfile, type LoadedAccessProfile } from "@/server/rbac/access";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";

export class AuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 403) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

export async function requireAuthenticatedUser(
  userId: string | undefined | null,
): Promise<LoadedAccessProfile> {
  if (!userId) {
    throw new AuthError("Authentication required", "UNAUTHENTICATED", 401);
  }
  const profile = await loadAccessProfile(userId);
  if (!profile) {
    throw new AuthError("Authentication required", "UNAUTHENTICATED", 401);
  }
  return profile;
}

export async function requireSystemPermission(
  userId: string | undefined | null,
  permission: PermissionKey,
): Promise<LoadedAccessProfile> {
  const profile = await requireAuthenticatedUser(userId);
  if (!hasPermission(profile, permission)) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }
  return profile;
}

export async function requireAnySystemPermission(
  userId: string | undefined | null,
  permissions: PermissionKey[],
): Promise<LoadedAccessProfile> {
  const profile = await requireAuthenticatedUser(userId);
  if (!grants(profile, ...permissions)) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }
  return profile;
}

/**
 * Company isolation rule:
 * Never trust ?companyId=, form companyId, or client state companyId
 * without verifying membership or authorised sales access.
 */
export async function requireCompanyAccess(
  userId: string | undefined | null,
  companyId: string,
): Promise<LoadedAccessProfile> {
  const profile = await requireAuthenticatedUser(userId);

  const membership = profile.companyMemberships.find((m) => m.companyId === companyId);
  if (membership) {
    if (membership.status !== "ACTIVE") {
      throw new AuthError("This customer membership is not active", "COMPANY_MEMBERSHIP_INACTIVE", 403);
    }
    return profile;
  }

  if (profile.actorType === "INTERNAL") {
    const allowed = await canAccessCompanyAsSales(profile, companyId);
    if (allowed) return profile;
  }

  throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
}

export async function requireCompanyPermission(
  userId: string | undefined | null,
  companyId: string,
  permission: PermissionKey,
): Promise<LoadedAccessProfile> {
  const profile = await requireCompanyAccess(userId, companyId);

  const membership = profile.companyMemberships.find((m) => m.companyId === companyId);
  if (membership) {
    if (membership.status !== "ACTIVE") {
      throw new AuthError("This customer membership is not active", "COMPANY_MEMBERSHIP_INACTIVE", 403);
    }
    const { TRADE_ROLE_PERMISSIONS } = await import("@/domain/role-permissions");
    const allowed = TRADE_ROLE_PERMISSIONS[membership.role].includes(permission);
    if (!allowed) {
      throw new AuthError("Insufficient company permissions", "COMPANY_FORBIDDEN", 403);
    }
    return profile;
  }

  // Internal staff: system permission + company access already verified
  if (!hasPermission(profile, permission)) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }
  return profile;
}

/** Portal shell: trade membership, or INTERNAL with an Admin Trade Test Level. */
export async function requireTradePortalAccess(
  userId: string | undefined | null,
): Promise<LoadedAccessProfile> {
  const profile = await requireAuthenticatedUser(userId);
  if (
    profile.actorType === "TRADE" &&
    profile.companyMemberships.some((membership) => membership.status === "ACTIVE")
  ) {
    return profile;
  }
  if (profile.actorType === "INTERNAL") {
    const { prisma } = await import("@/infra/database/client");
    const user = await prisma.user.findUnique({
      where: { id: profile.userId },
      select: { tradeTestPricingMode: true, tradeTestPriceListId: true },
    });
    if (
      user?.tradeTestPricingMode === "BASE_TRADE" ||
      (user?.tradeTestPricingMode === "PRICE_LIST" && user.tradeTestPriceListId)
    ) {
      return profile;
    }
  }
  throw new AuthError("Trade portal access required", "PORTAL_FORBIDDEN", 403);
}

function hasPermissionPrefix(profile: LoadedAccessProfile, prefixes: readonly string[]): boolean {
  for (const key of profile.permissions) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) return true;
  }
  return false;
}

/** Sales / CRM shells — internal users with sales/CRM permissions */
export async function requireInternalSalesAccess(
  userId: string | undefined | null,
): Promise<LoadedAccessProfile> {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Internal sales access required", "SALES_FORBIDDEN", 403);
  }
  const ok =
    grants(
      profile,
      "sales.view_own_accounts",
      "sales.view_team_accounts",
      "sales.view_all_accounts",
      "sales_intelligence.view",
      "crm.view",
      "admin.access",
    ) ||
    hasPermissionPrefix(profile, [
      "sales_intelligence.",
      "quotes.",
      "orders.",
      "promotions.",
      "applications.",
      "companies.",
      "contacts.",
      "customer_groups.",
    ]);
  if (!ok) {
    throw new AuthError("Internal sales access required", "SALES_FORBIDDEN", 403);
  }
  return profile;
}

export async function requireCrmAccess(
  userId: string | undefined | null,
): Promise<LoadedAccessProfile> {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("CRM access required", "CRM_FORBIDDEN", 403);
  }
  const ok =
    grants(profile, "crm.view", "sales.view_own_accounts", "admin.access") ||
    hasPermissionPrefix(profile, ["crm.", "autopart."]) ||
    hasPermission(profile, "tasks.view") ||
    hasPermission(profile, "tasks.manage") ||
    hasPermission(profile, "sales.team.view");
  if (!ok) {
    throw new AuthError("CRM access required", "CRM_FORBIDDEN", 403);
  }
  return profile;
}

export async function requirePurchasingAccess(
  userId: string | undefined | null,
): Promise<LoadedAccessProfile> {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Purchasing Intelligence is internal only", "PURCHASING_FORBIDDEN", 403);
  }
  if (!hasPermissionPrefix(profile, ["purchasing."])) {
    throw new AuthError("Purchasing access required", "PURCHASING_FORBIDDEN", 403);
  }
  return profile;
}

export async function requirePurchasingSection(
  userId: string | undefined | null,
  permission: PermissionKey,
): Promise<LoadedAccessProfile> {
  const profile = await requirePurchasingAccess(userId);
  if (!hasPermission(profile, permission)) {
    throw new AuthError("Purchasing access required", "PURCHASING_FORBIDDEN", 403);
  }
  return profile;
}

export async function requireAdminAccess(
  userId: string | undefined | null,
): Promise<LoadedAccessProfile> {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Admin access required", "ADMIN_FORBIDDEN", 403);
  }
  const ok =
    ADMIN_SHELL_PERMISSIONS.some((key) => hasPermission(profile, key)) ||
    dedicatedAdminSectionUnlock(profile.permissions);
  if (!ok) {
    throw new AuthError("Admin access required", "ADMIN_FORBIDDEN", 403);
  }
  return profile;
}
