import type { PermissionKey } from "@/domain/permissions";
import { hasPermission, loadAccessProfile, type LoadedAccessProfile } from "@/server/rbac/access";
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
  if (membership) return profile;

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

/** Portal shell: must be a trade user with at least one company membership */
export async function requireTradePortalAccess(
  userId: string | undefined | null,
): Promise<LoadedAccessProfile> {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType !== "TRADE" || profile.companyMemberships.length === 0) {
    // Internal users with company create access may still be redirected elsewhere
    if (profile.actorType === "INTERNAL") {
      throw new AuthError("Trade portal access required", "PORTAL_FORBIDDEN", 403);
    }
    throw new AuthError("Trade portal access required", "PORTAL_FORBIDDEN", 403);
  }
  return profile;
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
    hasPermission(profile, "sales.view_own_accounts") ||
    hasPermission(profile, "sales.view_team_accounts") ||
    hasPermission(profile, "sales.view_all_accounts") ||
    hasPermission(profile, "crm.view") ||
    hasPermission(profile, "admin.access");
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
  if (
    !hasPermission(profile, "crm.view") &&
    !hasPermission(profile, "admin.access") &&
    !hasPermission(profile, "sales.view_own_accounts")
  ) {
    throw new AuthError("CRM access required", "CRM_FORBIDDEN", 403);
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
    hasPermission(profile, "admin.access") ||
    hasPermission(profile, "cms.view") ||
    hasPermission(profile, "cms.edit") ||
    hasPermission(profile, "cms.publish") ||
    hasPermission(profile, "products.create") ||
    hasPermission(profile, "products.edit") ||
    hasPermission(profile, "pricing.edit") ||
    hasPermission(profile, "users.manage") ||
    hasPermission(profile, "roles.manage") ||
    hasPermission(profile, "settings.edit") ||
    hasPermission(profile, "credit.edit");
  if (!ok) {
    throw new AuthError("Admin access required", "ADMIN_FORBIDDEN", 403);
  }
  return profile;
}
