/**
 * Client session helpers.
 * Authoritative auth is server-side (HttpOnly cookies + RBAC guards).
 * This module exposes the same server session for public chrome and portal UI.
 *
 * Session is loaded once per navigation in the root route `beforeLoad`
 * (see `__root.tsx`) so SSR and hydration share one actor — no guest flash.
 */
import { useCallback } from "react";
import { getRouteApi, useRouter } from "@tanstack/react-router";

import type { ClientSession } from "@/server/auth/session";

export type { ClientSession } from "@/server/auth/session";

export const guestSession: ClientSession = { signedIn: false };

const rootRouteApi = getRouteApi("__root__");

/**
 * Subscribe to the server session for UI (prices, chrome, ordering).
 * Route protection must use beforeLoad + server guards — not this hook alone.
 *
 * Reads the root route context session produced by `getClientSession` on the
 * server. After login/logout call `refresh()` (router.invalidate) so chrome
 * updates without a second auth cookie or client-only parser.
 */
export function useSession(): ClientSession & {
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const router = useRouter();
  const { session } = rootRouteApi.useRouteContext();

  const refresh = useCallback(async () => {
    await router.invalidate();
  }, [router]);

  return { ...(session ?? guestSession), loading: false, refresh };
}

/** @deprecated Prototype localStorage sign-in removed — use signInWithPassword server fn */
export function signIn(): never {
  throw new Error("Client localStorage sign-in removed. Use /login.");
}

/** Prefer signOutCurrent server function from UI handlers */
export function signOut(): never {
  throw new Error("Client localStorage sign-out removed. Use signOutCurrent().");
}
