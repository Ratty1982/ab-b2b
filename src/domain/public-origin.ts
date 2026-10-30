/** Origin of APP_URL, with no path or trailing slash. */
export function canonicalOrigin(appUrl: string): string {
  return new URL(appUrl).origin;
}

export function canonicalHost(appUrl: string): string {
  return new URL(appUrl).host;
}

/**
 * Absolute canonical URL for an indexable public path.
 * Returns null when the path should not be indexed or the origin is empty.
 */
const INDEXABLE_EXACT = new Set([
  "/",
  "/about",
  "/brands",
  "/contact",
  "/customer-survey",
  "/free-prize-draw-terms-conditions",
  "/meet-the-team",
  "/motorsport",
  "/products",
  "/register",
  "/resources",
  "/trade-solutions",
  "/us-incorporation-documents",
  "/why-automotive-brands",
]);

const INDEXABLE_PREFIXES = ["/brands/", "/products/"];

export function isIndexablePublicPath(pathname: string): boolean {
  if (INDEXABLE_EXACT.has(pathname)) return true;
  return INDEXABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function absoluteCanonical(origin: string, pathname: string): string | null {
  if (!origin || !isIndexablePublicPath(pathname)) return null;
  try {
    return new URL(pathname, origin).toString();
  } catch {
    return null;
  }
}
