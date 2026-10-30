/**
 * Explicit legacy WordPress paths, www → APP_URL, and a temporary redirect
 * from the old b2b hostname to the APP_URL origin.
 *
 * The b2b redirect is HTTP 302 for GET and HEAD page navigations only.
 * It does not rewrite unknown URLs on the apex, and it does not move API,
 * webhook, auth-callback, or static responses.
 */

export type MigrationRedirect =
  | { status: 301 | 302 | 308; location: string }
  | { status: 410 };

const APP_TRAILING_SLASH = new Set([
  "/brands",
  "/customer-survey",
  "/free-prize-draw-terms-conditions",
  "/us-incorporation-documents",
]);

const STATIC_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".css",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".txt",
  ".xml",
  ".json",
  ".webmanifest",
  ".wasm",
  ".csv",
]);

function withoutTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function isWordpressGone(pathname: string): boolean {
  const path = pathname.toLowerCase();
  const bare = withoutTrailingSlash(path);
  if (
    bare === "/wp-login.php" ||
    bare === "/xmlrpc.php" ||
    bare === "/wp-cron.php" ||
    bare === "/wp-signup.php" ||
    bare === "/feed" ||
    bare === "/comments/feed"
  ) {
    return true;
  }
  const prefixes = ["/wp-admin", "/wp-json", "/wp-content", "/wp-includes", "/author"];
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Path-only decision. Null means the application should handle the request. */
export function legacyPathLocation(pathname: string): string | 410 | null {
  const bare = withoutTrailingSlash(pathname);
  if (bare === "/our-story") return "/why-automotive-brands";
  if (bare === "/sample-page") return "/";
  if (pathname !== bare && APP_TRAILING_SLASH.has(bare)) return bare;
  if (isWordpressGone(pathname)) return 410;
  return null;
}

function canonicalAppUrl(appUrl: string | undefined): URL | null {
  if (!appUrl) return null;
  try {
    const canonical = new URL(appUrl);
    if (!canonical.hostname) return null;
    return canonical;
  } catch {
    return null;
  }
}

function wwwApexOrigin(request: URL, appUrl: string | undefined): string | null {
  const canonical = canonicalAppUrl(appUrl);
  if (!canonical) return null;
  const apex = canonical.hostname.toLowerCase();
  if (request.hostname.toLowerCase() !== `www.${apex}`) return null;
  return canonical.origin;
}

/**
 * Temporary hostname redirect is on unless explicitly disabled.
 * `off`, `false`, `0`, and `no` turn it off so b2b can be given to the warehouse.
 */
export function isTemporaryB2bRedirectEnabled(flag: string | undefined): boolean {
  if (flag == null) return true;
  const value = flag.trim().toLowerCase();
  if (value === "") return true;
  return value !== "0" && value !== "false" && value !== "off" && value !== "no";
}

/**
 * Origin to send the legacy b2b host to, or null when this request must stay.
 * The request host must be exactly `b2b.` plus the APP_URL hostname, and must
 * not already be that origin.
 */
function temporaryB2bOrigin(request: URL, appUrl: string | undefined): string | null {
  const canonical = canonicalAppUrl(appUrl);
  if (!canonical) return null;
  const apex = canonical.hostname.toLowerCase();
  const host = request.hostname.toLowerCase();
  if (host !== `b2b.${apex}`) return null;
  if (host === apex || request.origin === canonical.origin) return null;
  return canonical.origin;
}

function isMachineReadablePath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  const bare = withoutTrailingSlash(path);
  if (bare === "/api" || path.startsWith("/api/")) return true;
  if (bare === "/assets" || path.startsWith("/assets/")) return true;
  if (bare === "/brand" || path.startsWith("/brand/")) return true;
  if (bare === "/company-documents" || path.startsWith("/company-documents/")) return true;
  if (bare === "/.well-known" || path.startsWith("/.well-known/")) return true;
  if (bare === "/favicon" || bare === "/favicon.ico" || bare === "/robots.txt") return true;
  const dot = bare.lastIndexOf(".");
  if (dot >= 0 && STATIC_EXTENSIONS.has(bare.slice(dot))) return true;
  return false;
}

function locationOn(origin: string, pathname: string, search: string): string {
  return new URL(`${pathname}${search}`, origin).toString();
}

/**
 * One response for a public request.
 * www redirects to the APP_URL origin and keeps path plus query.
 * The legacy b2b host 302s GET and HEAD pages to that same origin.
 * API, auth callbacks, webhooks, static files, and other methods stay put.
 */
export function migrationRequestDecision(input: {
  method: string;
  requestUrl: string;
  appUrl?: string | undefined;
  /** Unset enables the temporary b2b redirect. `off` / `false` / `0` / `no` disable it. */
  b2bLegacyRedirect?: string | undefined;
}): MigrationRedirect | null {
  let request: URL;
  try {
    request = new URL(input.requestUrl);
  } catch {
    return null;
  }

  const pathTarget = legacyPathLocation(request.pathname);
  if (pathTarget === 410) return { status: 410 };

  const method = input.method.toUpperCase();
  const b2bOrigin = isTemporaryB2bRedirectEnabled(input.b2bLegacyRedirect)
    ? temporaryB2bOrigin(request, input.appUrl)
    : null;
  if (b2bOrigin && (method === "GET" || method === "HEAD") && !isMachineReadablePath(request.pathname)) {
    const pathname = typeof pathTarget === "string" ? pathTarget : request.pathname;
    return {
      status: 302,
      location: locationOn(b2bOrigin, pathname, request.search),
    };
  }

  const apex = wwwApexOrigin(request, input.appUrl);
  if (typeof pathTarget === "string") {
    const origin = apex ?? request.origin;
    return {
      status: 301,
      location: locationOn(origin, pathTarget, request.search),
    };
  }
  if (!apex) return null;
  return {
    status: method === "GET" || method === "HEAD" ? 301 : 308,
    location: locationOn(apex, request.pathname, request.search),
  };
}
