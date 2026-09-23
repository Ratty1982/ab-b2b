import type { ClientSession } from "@/server/auth/session";

export function isTradeCustomerSession(session: ClientSession): boolean {
  if (!session.signedIn) return false;
  return session.user.actorType === "TRADE" && Boolean(session.user.companyId);
}

export function canViewBasketSession(session: ClientSession): boolean {
  if (!session.signedIn) return false;
  if (session.user.actorType !== "TRADE" || !session.user.companyId) return false;
  return session.user.navPermissions.includes("orders.view");
}
