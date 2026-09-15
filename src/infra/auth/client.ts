import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client. Credentials stay in HttpOnly cookies —
 * never store tokens in localStorage.
 */
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : undefined,
});
