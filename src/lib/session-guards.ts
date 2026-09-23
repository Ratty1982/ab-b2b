import type { ClientSession } from "@/server/auth/session";

type SignedInSession = Extract<ClientSession, { signedIn: true }>;

export function isTradeCustomerSession(session: ClientSession): session is SignedInSession & {
  user: SignedInSession["user"] & { actorType: "TRADE"; companyId: string };
} {
  if (!session.signedIn) return false;
  return session.user.actorType === "TRADE" && Boolean(session.user.companyId);
}

/**
 * Legitimate company ordering context for basket chrome / PDP controls.
 * - TRADE + CompanyUser membership, or
 * - INTERNAL with an active acting-for-customer context (server-set actingFor).
 *
 * Never invents a company from the browser.
 */
export function hasOrderingCompanyContext(session: ClientSession): boolean {
  if (!session.signedIn) return false;
  if (isTradeCustomerSession(session)) return true;
  return session.user.actorType === "INTERNAL" && Boolean(session.user.actingFor?.companyId);
}

/**
 * Basket chrome only when a real company ordering context exists.
 * Server still enforces basket APIs.
 */
export function canViewBasketSession(session: ClientSession): boolean {
  return hasOrderingCompanyContext(session);
}

export function canMutateBasketSession(session: ClientSession): boolean {
  if (!session.signedIn) return false;
  if (isTradeCustomerSession(session)) {
    return session.user.navPermissions.includes("orders.create");
  }
  if (session.user.actorType === "INTERNAL" && session.user.actingFor?.companyId) {
    return (
      session.user.navPermissions.includes("orders.place_for_customer") ||
      session.user.navPermissions.includes("impersonation.order_for_customer")
    );
  }
  return false;
}

/** Signed-in but not a trade customer (admin / internal / incomplete trade). */
export function isAuthenticatedNonTradeSession(session: ClientSession): boolean {
  return session.signedIn && !isTradeCustomerSession(session);
}
