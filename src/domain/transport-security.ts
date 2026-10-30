/**
 * HSTS for this host only.
 * `includeSubDomains` is omitted so a policy learned on the apex cannot force
 * HTTPS onto mail, ftp, or a future b2b virtual-warehouse host.
 * Preload is omitted so the policy is not submitted to the browser preload list.
 */
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000";
