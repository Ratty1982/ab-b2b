import type { ClientSession } from "@/server/auth/session";

type SignedInSession = Extract<ClientSession, { signedIn: true }>;

export function isTradeCustomerSession(session: ClientSession): session is SignedInSession & {
  user: SignedInSession["user"] & { actorType: "TRADE"; companyId: string };
} {
  if (!session.signedIn) return false;
  return session.user.actorType === "TRADE" && Boolean(session.user.companyId);
}

function adminTradeTestOrderingEnabled(session: SignedInSession): boolean {
  if (session.user.actorType !== "INTERNAL") return false;
  const mode = session.user.tradeTestPricingMode;
  if (mode === "BASE_TRADE") return true;
  return mode === "PRICE_LIST" && Boolean(session.user.tradeTestPriceListId);
}

/**
 * Legitimate ordering context for basket chrome / PDP controls.
 * - TRADE + CompanyUser membership, or
 * - INTERNAL with Trade Test mode BASE_TRADE or PRICE_LIST.
 */
export function hasOrderingCompanyContext(session: ClientSession): boolean {
  if (!session.signedIn) return false;
  if (isTradeCustomerSession(session)) return true;
  return adminTradeTestOrderingEnabled(session);
}

export function canViewBasketSession(session: ClientSession): boolean {
  return hasOrderingCompanyContext(session);
}

export function canMutateBasketSession(session: ClientSession): boolean {
  if (!session.signedIn) return false;
  if (isTradeCustomerSession(session)) {
    return session.user.navPermissions.includes("orders.create");
  }
  if (adminTradeTestOrderingEnabled(session)) {
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
