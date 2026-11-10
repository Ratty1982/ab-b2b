/**
 * Private-area and auth-page robots metadata for TanStack Router `head`.
 *
 * Layout routes set these tags so nested authenticated pages inherit them via
 * HeadContent. Child routes may still set titles/descriptions.
 *
 * Note: `public/robots.txt` already Disallows these path prefixes. Disallow can
 * stop some crawlers from fetching the HTML (and therefore reading noindex).
 * That combination does not guarantee removal of URLs already indexed — use
 * Search Console / Bing Webmaster URL removal when needed.
 */

export const PRIVATE_AREA_ROBOTS = "noindex, nofollow" as const;
export const LOGIN_ROBOTS = "noindex, follow" as const;

/** Path prefixes already listed in public/robots.txt Disallow rules. */
export const ROBOTS_TXT_DISALLOW_PREFIXES = [
  "/admin",
  "/portal",
  "/sales",
  "/crm",
  "/purchasing",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/activate",
  "/api/internal",
  "/api/auth",
  "/api/autopart-imports",
  "/api/customer-sales-uploads",
  "/api/microsoft-365",
] as const;

/** Public catalogue / marketing prefixes that must remain crawlable. */
export const PUBLIC_INDEXABLE_PREFIXES = [
  "/",
  "/products",
  "/brands",
  "/motorsport",
  "/meet-the-team",
  "/why-automotive-brands",
  "/trade-solutions",
  "/register",
  "/resources",
] as const;

export type RobotsMeta = { name: "robots"; content: string };

export function privateAreaRobotsMeta(): RobotsMeta {
  return { name: "robots", content: PRIVATE_AREA_ROBOTS };
}

export function loginRobotsMeta(): RobotsMeta {
  return { name: "robots", content: LOGIN_ROBOTS };
}

/** Auth-adjacent pages that are not the public catalogue. */
export function authFlowRobotsMeta(): RobotsMeta {
  return privateAreaRobotsMeta();
}

export function robotsMetaList(metas: Array<{ name?: string; content?: string }>): string[] {
  return metas
    .filter((meta) => meta.name === "robots" && typeof meta.content === "string")
    .map((meta) => meta.content!);
}

export function hasSingleRobotsDirective(
  metas: Array<{ name?: string; content?: string }>,
  expected: string,
): boolean {
  const robots = robotsMetaList(metas);
  return robots.length === 1 && robots[0] === expected;
}
