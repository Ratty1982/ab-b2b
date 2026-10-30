/**
 * Explicit legacy WordPress paths only.
 * This does not redirect the b2b hostname and does not rewrite unknown URLs.
 */

export type MigrationRedirect =
  | { status: 301 | 308; location: string }
  | { status: 410 };

const APP_TRAILING_SLASH = new Set([
  "/brands",
  "/customer-survey",
  "/free-prize-draw-terms-conditions",
  "/us-incorporation-documents",
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

function wwwApexOrigin(request: URL, appUrl: string | undefined): string | null {
  if (!appUrl) return null;
  let canonical: URL;
  try {
    canonical = new URL(appUrl);
  } catch {
    return null;
  }
  const apex = canonical.hostname.toLowerCase();
  if (!apex) return null;
  if (request.hostname.toLowerCase() !== `www.${apex}`) return null;
  return canonical.origin;
}

/**
 * One response for a public request.
 * www redirects to the APP_URL origin and keeps path plus query.
 * Any other host, including b2b, is left unchanged except for the explicit
 * WordPress paths above. API paths on b2b are not redirected.
 */
export function migrationRequestDecision(input: {
  method: string;
  requestUrl: string;
  appUrl?: string | undefined;
}): MigrationRedirect | null {
  let request: URL;
  try {
    request = new URL(input.requestUrl);
  } catch {
    return null;
  }

  const pathTarget = legacyPathLocation(request.pathname);
  const apex = wwwApexOrigin(request, input.appUrl);
  if (pathTarget === 410) return { status: 410 };
  if (typeof pathTarget === "string") {
    const origin = apex ?? request.origin;
    return {
      status: 301,
      location: new URL(`${pathTarget}${request.search}`, origin).toString(),
    };
  }
  if (!apex) return null;
  const method = input.method.toUpperCase();
  return {
    status: method === "GET" || method === "HEAD" ? 301 : 308,
    location: new URL(`${request.pathname}${request.search}`, apex).toString(),
  };
}
