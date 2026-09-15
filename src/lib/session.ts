/**
 * Client session helpers.
 * Authoritative auth is server-side (HttpOnly cookies + RBAC guards).
 * This module only exposes a safe client view for UI chrome.
 */
import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";

import { getClientSession, type ClientSession } from "@/server/auth/session";

export type { ClientSession } from "@/server/auth/session";

export const guestSession: ClientSession = { signedIn: false };

/**
 * Subscribe to the server session for UI (prices, chrome).
 * Route protection must use beforeLoad + server guards — not this hook alone.
 */
export function useSession(): ClientSession & {
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [session, setSession] = useState<ClientSession>(guestSession);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = async () => {
    try {
      const next = await getClientSession();
      setSession(next);
    } catch {
      setSession(guestSession);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Re-check when the router navigates (e.g. after login)
    const unsub = router.subscribe("onResolved", () => {
      void refresh();
    });
    return unsub;
  }, [router]);

  return { ...session, loading, refresh };
}

/** @deprecated Prototype localStorage sign-in removed — use signInWithPassword server fn */
export function signIn(): never {
  throw new Error("Client localStorage sign-in removed. Use /login.");
}

/** Prefer signOutCurrent server function from UI handlers */
export function signOut(): never {
  throw new Error("Client localStorage sign-out removed. Use signOutCurrent().");
}
