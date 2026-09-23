/**
 * Single request-scoped session/actor resolver.
 *
 * Used by:
 * - product/catalogue loaders (same path as optionalUserId / pricing)
 * - getClientSession server function
 * - root beforeLoad (via getClientSession)
 *
 * Always reads Better Auth from the incoming request headers/cookies.
 * Do not invent a second cookie or client-only auth parser.
 */
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "@/infra/auth";
import { loadAccessProfile } from "@/server/rbac/access";
import { getActiveActingContext } from "@/server/acting-context";
import type { PermissionKey, TradeAccessKey } from "@/domain/permissions";

/** Safe session payload for the client — no hashes, tokens, or full permission dumps by default */
export interface SafeSessionUser {
  id: string;
  email: string;
  name: string;
  actorType: "INTERNAL" | "TRADE";
  systemRoles: string[];
  /** Primary display role label for AppShell */
  displayRole: string;
  companyId: string | null;
  companyName: string | null;
  accountNumber: string | null;
  tradeRole: TradeAccessKey | null;
  /** Permission keys needed for navigation gating (not a security boundary) */
  navPermissions: PermissionKey[];
  actingFor: {
    companyId: string;
    companyName: string;
    accountNumber: string | null;
  } | null;
}

export interface SafeSession {
  signedIn: true;
  user: SafeSessionUser;
}

export type ClientSession = SafeSession | { signedIn: false };

export const guestClientSession: ClientSession = { signedIn: false };

function pickDisplayRole(
  profile: NonNullable<Awaited<ReturnType<typeof loadAccessProfile>>>,
): string {
  if (profile.systemRoles.includes("SUPER_ADMIN")) return "Super Admin";
  if (profile.systemRoles.includes("MANAGEMENT")) return "Management";
  if (profile.systemRoles.includes("SALES_MANAGER")) return "Sales Manager";
  if (profile.systemRoles.includes("SALES_REPRESENTATIVE")) return "Sales Representative";
  if (profile.systemRoles.includes("CUSTOMER_SERVICE")) return "Customer Service";
  if (profile.systemRoles.includes("ACCOUNTS")) return "Accounts";
  if (profile.systemRoles.includes("MARKETING")) return "Marketing";

  const membership =
    profile.companyMemberships.find((m) => m.isDefault) ?? profile.companyMemberships[0];
  if (membership) {
    const roleLabel = membership.role.replaceAll("_", " ");
    return `${roleLabel} · ${membership.companyName}`;
  }
  return "User";
}

export async function buildSafeSession(userId: string): Promise<SafeSession | null> {
  const profile = await loadAccessProfile(userId);
  if (!profile) return null;

  const membership =
    profile.companyMemberships.find((m) => m.isDefault) ?? profile.companyMemberships[0];

  const acting = await getActiveActingContext(userId);

  return {
    signedIn: true,
    user: {
      id: profile.userId,
      email: profile.email,
      name: profile.name ?? profile.email,
      actorType: profile.actorType,
      systemRoles: profile.systemRoles,
      displayRole: pickDisplayRole(profile),
      companyId: membership?.companyId ?? null,
      companyName: membership?.companyName ?? null,
      accountNumber: membership?.accountNumber ?? null,
      tradeRole: membership?.role ?? null,
      navPermissions: [...profile.permissions],
      actingFor: acting
        ? {
            companyId: acting.onBehalfOfCompany.id,
            companyName: acting.onBehalfOfCompany.name,
            accountNumber: acting.onBehalfOfCompany.accountNumber,
          }
        : null,
    },
  };
}

/** Same header source as product pricing `optionalUserId`. */
export async function resolveOptionalRequestUserId(): Promise<string | null> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  return session?.user?.id ?? null;
}

/**
 * Authoritative ClientSession for the current HTTP request.
 * Must only be called inside a TanStack server request / server-fn context
 * where `getRequestHeaders()` is valid.
 */
export async function resolveRequestClientSession(): Promise<ClientSession> {
  const userId = await resolveOptionalRequestUserId();
  if (!userId) return guestClientSession;
  const safe = await buildSafeSession(userId);
  return safe ?? guestClientSession;
}

/** Safe boolean diagnostics for support — never logs cookies/tokens/PII. */
export function sessionDiagnostics(session: ClientSession): {
  signedIn: boolean;
  actorType: "INTERNAL" | "TRADE" | null;
  hasCompany: boolean;
  isTradeCustomer: boolean;
  canViewOrders: boolean;
  canCreateOrders: boolean;
  userIdSuffix: string | null;
} {
  if (!session.signedIn) {
    return {
      signedIn: false,
      actorType: null,
      hasCompany: false,
      isTradeCustomer: false,
      canViewOrders: false,
      canCreateOrders: false,
      userIdSuffix: null,
    };
  }
  const { user } = session;
  return {
    signedIn: true,
    actorType: user.actorType,
    hasCompany: Boolean(user.companyId),
    isTradeCustomer: user.actorType === "TRADE" && Boolean(user.companyId),
    canViewOrders: user.navPermissions.includes("orders.view"),
    canCreateOrders: user.navPermissions.includes("orders.create"),
    userIdSuffix: user.id.slice(-6),
  };
}

export function clientMetaFromRequestHeaders(headers: Headers) {
  return {
    ipAddress:
      headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null,
    userAgent: headers.get("user-agent"),
  };
}
