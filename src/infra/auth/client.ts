import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

/**
 * Browser auth client. Credentials stay in HttpOnly cookies —
 * never store tokens in localStorage.
 */
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : undefined,
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        // Login page handles the TOTP step via server functions.
      },
    }),
  ],
});
