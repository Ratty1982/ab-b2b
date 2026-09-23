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
  key: "my-account" | "admin" | "area-home";
  label: string;
  to: string;
};

/**
 * Role-aware public header destinations.
 *
 * Trade customers → My Account (/portal) — never /admin.
 * Internal admin-capable users → Admin (/admin) — never ambiguous "Account".
 * Other signed-in internal roles → their area home with an explicit label.
 *
 * Destinations are derived from the server-built SafeSession (actorType +
 * permissions), not from client-supplied role claims.
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

  if (canUseAdminShell(ctx)) {
    return [{ key: "admin", label: "Admin", to: ROUTES.admin }];
  }

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
