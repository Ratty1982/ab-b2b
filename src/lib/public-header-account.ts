import type { ClientSession } from "@/server/auth/session";
import {
  ROUTES,
  areaHomeLabel,
  areaHomePath,
  canUseAdminShell,
  navCtxFromUser,
} from "@/lib/app-nav";
import { isTradeCustomerSession } from "@/lib/session-guards";

export type PublicHeaderAccountLink = {
  /** Stable key for tests / data attributes */
  key: "my-account" | "admin" | "trade-portal" | "area-home";
  label: string;
  to: string;
};

/**
 * Role-aware public header destinations.
 *
 * Trade customers → My Account (/portal) — never /admin.
 * Internal admin-capable users → Admin (/admin).
 * When an admin also has an active acting-for-customer context, also expose
 * Trade Portal (/portal) as a separate explicit destination.
 *
 * Destinations are derived from the server-built SafeSession (actorType +
 * permissions + actingFor), not from client-supplied role claims.
 */
export function publicHeaderAccountLinks(session: ClientSession): PublicHeaderAccountLink[] {
  if (!session.signedIn) return [];

  // Normal trade customers always land in the customer portal.
  if (isTradeCustomerSession(session)) {
    return [{ key: "my-account", label: "My Account", to: ROUTES.portal }];
  }

  // Remaining signed-in actors (INTERNAL and non-company trade).
  const user = session.user;
  const ctx = navCtxFromUser(user);
  const links: PublicHeaderAccountLink[] = [];

  // Admin Trade Test Level (BASE_TRADE or PRICE_LIST) enables isolated test basket + Trade Portal.
  if (
    user.actorType === "INTERNAL" &&
    (user.tradeTestPricingMode === "BASE_TRADE" ||
      (user.tradeTestPricingMode === "PRICE_LIST" && user.tradeTestPriceListId))
  ) {
    links.push({ key: "trade-portal", label: "Trade Portal", to: ROUTES.portal });
  }

  if (canUseAdminShell(ctx)) {
    links.push({ key: "admin", label: "Admin", to: ROUTES.admin });
    return links;
  }

  if (links.length) return links;

  // Signed-in but neither trade customer nor admin shell (e.g. sales-only).
  const label = areaHomeLabel(ctx);
  return [
    {
      key: "area-home",
      label: label === "Automotive Brands" ? "Home" : label,
      to: areaHomePath(ctx),
    },
  ];
}
