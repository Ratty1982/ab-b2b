/**
 * Staged authenticator policy for Automotive Brands B2B.
 *
 * SUPER_ADMIN and ACCOUNTS are the privileged set. Other internal roles,
 * including management, are a later stage. Trade customers stay optional.
 * Every enforcement flag defaults off so existing users are not locked out.
 */

import type { SystemRoleKey } from "@/domain/permissions";
import { SYSTEM_ROLE_KEYS } from "@/domain/permissions";

export const MFA_REQUIRED_SYSTEM_ROLES: readonly SystemRoleKey[] = [
  "SUPER_ADMIN",
  "ACCOUNTS",
] as const;

/** Internal roles covered when the later staff stage is switched on. */
export const MFA_STAFF_SYSTEM_ROLES: readonly SystemRoleKey[] = SYSTEM_ROLE_KEYS;

export function roleRequiresMfa(roleKey: string): boolean {
  return (MFA_REQUIRED_SYSTEM_ROLES as readonly string[]).includes(roleKey);
}

export function profileRequiresMfa(systemRoles: readonly string[]): boolean {
  return systemRoles.some((r) => roleRequiresMfa(r));
}

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  if (raw === "true" || raw === "1" || raw === "on") return true;
  return false;
}

/**
 * First stage. Blocks Super Admin and Accounts until they finish enrolment.
 * Unset, false, 0, and off all leave this off.
 */
export function isPrivilegedMfaEnforced(): boolean {
  return envFlag("MFA_ENFORCE_PRIVILEGED");
}

/** Later stage. Blocks every internal role, including management. Default off. */
export function isStaffMfaEnforced(): boolean {
  return envFlag("MFA_ENFORCE_STAFF");
}

/** Not part of the first rollout. Default off. Customers may still enrol. */
export function isCustomerMfaEnforced(): boolean {
  return envFlag("MFA_ENFORCE_CUSTOMERS");
}

/**
 * True when this signed-in account must finish authenticator setup before
 * business pages and server actions. A completed enrolment is never blocked.
 */
export function mfaEnrollmentRequired(input: {
  actorType: "INTERNAL" | "TRADE";
  systemRoles: readonly string[];
  twoFactorEnabled: boolean;
}): boolean {
  if (input.twoFactorEnabled) return false;
  if (input.actorType === "TRADE") return isCustomerMfaEnforced();
  if (isPrivilegedMfaEnforced() && profileRequiresMfa(input.systemRoles)) return true;
  if (isStaffMfaEnforced()) return true;
  return false;
}

/** An ordinary administrator cannot reset someone else's authenticator. */
export function canResetAnotherUsersAuthenticator(input: {
  actorUserId: string;
  targetUserId: string;
  actorIsSuperAdmin: boolean;
}): boolean {
  return input.actorIsSuperAdmin && input.actorUserId !== input.targetUserId;
}
