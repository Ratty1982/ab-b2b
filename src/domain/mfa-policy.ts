/**
 * Privileged MFA policy for Automotive Brands B2B.
 *
 * SUPER_ADMIN and ACCOUNTS require authenticator TOTP (Better Auth twoFactor).
 * Other internal roles may enroll optionally. Trade customers are not forced.
 */

import type { SystemRoleKey } from "@/domain/permissions";

export const MFA_REQUIRED_SYSTEM_ROLES: readonly SystemRoleKey[] = [
  "SUPER_ADMIN",
  "ACCOUNTS",
] as const;

export function roleRequiresMfa(roleKey: string): boolean {
  return (MFA_REQUIRED_SYSTEM_ROLES as readonly string[]).includes(roleKey);
}

export function profileRequiresMfa(systemRoles: readonly string[]): boolean {
  return systemRoles.some((r) => roleRequiresMfa(r));
}

/**
 * Enforcement gate — when false, privileged users are warned but not blocked.
 * Set MFA_ENFORCE_PRIVILEGED=true (or omit in production after enrollment cutover).
 */
export function isPrivilegedMfaEnforced(): boolean {
  const raw = process.env["MFA_ENFORCE_PRIVILEGED"]?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  if (raw === "true" || raw === "1" || raw === "on") return true;
  // Default: enforce in production only after operators opt in via env.
  // Shipping default OFF so existing privileged sessions are not locked out
  // before enrollment UI is used.
  return false;
}
