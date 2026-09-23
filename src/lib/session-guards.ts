import type { ClientSession } from "@/server/auth/session";

type SignedInSession = Extract<ClientSession, { signedIn: true }>;

export function isTradeCustomerSession(session: ClientSession): session is SignedInSession & {
  user: SignedInSession["user"] & { actorType: "TRADE"; companyId: string };
} {
  if (!session.signedIn) return false;
  return session.user.actorType === "TRADE" && Boolean(session.user.companyId);
}

/**
 * Basket chrome for trade customers with a company.
 * Server still enforces orders.view / orders.create on basket APIs.
 */
export function canViewBasketSession(session: ClientSession): boolean {
  return isTradeCustomerSession(session);
}

export function canMutateBasketSession(session: ClientSession): boolean {
  if (!isTradeCustomerSession(session)) return false;
  return session.user.navPermissions.includes("orders.create");
}
