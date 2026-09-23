import type { ClientSession } from "@/server/auth/session";

type SignedInSession = Extract<ClientSession, { signedIn: true }>;

export function isTradeCustomerSession(session: ClientSession): session is SignedInSession & {
  user: SignedInSession["user"] & { actorType: "TRADE"; companyId: string };
} {
  if (!session.signedIn) return false;
  return session.user.actorType === "TRADE" && Boolean(session.user.companyId);
}

/**
 * Legitimate ordering context for basket chrome / PDP controls.
 * - TRADE + CompanyUser membership, or
 * - INTERNAL with a persisted Trade Test Level (PriceList).
 */
export function hasOrderingCompanyContext(session: ClientSession): boolean {
  if (!session.signedIn) return false;
  if (isTradeCustomerSession(session)) return true;
  return (
    session.user.actorType === "INTERNAL" && Boolean(session.user.tradeTestPriceListId)
  );
}

export function canViewBasketSession(session: ClientSession): boolean {
  return hasOrderingCompanyContext(session);
}

export function canMutateBasketSession(session: ClientSession): boolean {
  if (!session.signedIn) return false;
  if (isTradeCustomerSession(session)) {
    return session.user.navPermissions.includes("orders.create");
  }
  if (session.user.actorType === "INTERNAL" && session.user.tradeTestPriceListId) {
    return (
      session.user.navPermissions.includes("admin.access") ||
      session.user.navPermissions.includes("pricing.view") ||
      session.user.navPermissions.includes("orders.create")
    );
  }
  return false;
}

export function isAuthenticatedNonTradeSession(session: ClientSession): boolean {
  return session.signedIn && !isTradeCustomerSession(session);
}
