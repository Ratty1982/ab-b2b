/**
 * Client address for rate limiting.
 *
 * Production is described as Coolify plus a reverse proxy (`docs/deployment-coolify.md`).
 * The repository does not name that proxy, does not list its addresses, and does
 * not record a hop count. Cloudflare is not confirmed to be in front of the site,
 * and there is no shared secret that would prove a header was set by our proxy.
 *
 * `CF-Connecting-IP`, `X-Real-IP` and `X-Forwarded-For` are therefore not
 * authenticated client identity. A visitor, or anyone who can open the origin
 * directly, can set all three. This module does not invent an allowlist.
 *
 * Rate limits must use an application identity (account, email, telephone, reset
 * token, or the sign-in cookie). They must not use these headers.
 */
export type ClientAddress = {
  address: null;
  trusted: false;
  reason: "no-trusted-proxy-configured";
};

export function clientAddress(_headers: Headers): ClientAddress {
  return {
    address: null,
    trusted: false,
    reason: "no-trusted-proxy-configured",
  };
}
