/**
 * Client session helpers.
 * Authoritative auth is server-side (HttpOnly cookies + RBAC guards).
 *
 * Prefer:
 * 1. Loader-provided request session (same createServerFn / cookie path as pricing)
 * 2. Root route beforeLoad session
 *
 * Never invent a second cookie or localStorage auth state.
 */
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { getRouteApi, useRouter } from "@tanstack/react-router";

import type { ClientSession } from "@/server/auth/session";

export type { ClientSession } from "@/server/auth/session";
export { canViewBasketSession, isTradeCustomerSession } from "@/lib/session-guards";

export const guestSession: ClientSession = { signedIn: false };

const rootRouteApi = getRouteApi("__root__");

const RequestSessionOverrideContext = createContext<ClientSession | null>(null);

/**
 * Catalogue / PDP loaders resolve the session with the same request cookies as
 * pricing, then wrap the public shell in this provider so header/ordering cannot
 * disagree with YOUR PRICE for the same request.
 */
export function RequestSessionProvider({
  session,
  children,
}: {
  session: ClientSession;
  children: ReactNode;
}) {
  return (
    <RequestSessionOverrideContext.Provider value={session}>{children}</RequestSessionOverrideContext.Provider>
  );
}

/**
 * Subscribe to the server session for UI (prices, chrome, ordering).
 * Route protection must use beforeLoad + server guards — not this hook alone.
 */
export function useSession(): ClientSession & {
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const router = useRouter();
  const override = useContext(RequestSessionOverrideContext);
  const rootCtx = rootRouteApi.useRouteContext();
  const session = override ?? rootCtx.session ?? guestSession;

  const refresh = useCallback(async () => {
    await router.invalidate();
  }, [router]);

  return { ...session, loading: false, refresh };
}

/** @deprecated Prototype localStorage sign-in removed — use signInWithPassword server fn */
export function signIn(): never {
  throw new Error("Client localStorage sign-in removed. Use /login.");
}

/** Prefer signOutCurrent server function from UI handlers */
export function signOut(): never {
  throw new Error("Client localStorage sign-out removed. Use signOutCurrent().");
}
