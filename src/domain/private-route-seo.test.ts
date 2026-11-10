import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOGIN_ROBOTS,
  PRIVATE_AREA_ROBOTS,
  PUBLIC_INDEXABLE_PREFIXES,
  ROBOTS_TXT_DISALLOW_PREFIXES,
  authFlowRobotsMeta,
  hasSingleRobotsDirective,
  loginRobotsMeta,
  privateAreaRobotsMeta,
  robotsMetaList,
} from "@/domain/private-route-seo";
import { Route as AdminRoute } from "@/routes/admin";
import { Route as CrmRoute } from "@/routes/crm";
import { Route as SalesRoute } from "@/routes/sales";
import { Route as PortalRoute } from "@/routes/portal";
import { Route as PurchasingRoute } from "@/routes/purchasing";
import { Route as LoginRoute } from "@/routes/login";
import { Route as ForgotPasswordRoute } from "@/routes/forgot-password";
import { Route as ResetPasswordRoute } from "@/routes/reset-password";
import { Route as ActivateRoute } from "@/routes/activate";
import { Route as AccountSecurityRoute } from "@/routes/account.security";
import { Route as MotorsportRoute } from "@/routes/motorsport";
import { Route as ProductsIndexRoute } from "@/routes/products.index";
import { Route as AdminIndexRoute } from "@/routes/admin.index";
import { Route as PortalIndexRoute } from "@/routes/portal.index";
import { Route as SalesIndexRoute } from "@/routes/sales.index";

type HeadMetaItem = { name?: string; content?: string; title?: string };

function headMeta(route: unknown, headArgs: unknown = {}): HeadMetaItem[] {
  const head = (route as { options?: { head?: (ctx: never) => unknown } }).options?.head;
  expect(head).toBeTypeOf("function");
  const result = head!(headArgs as never) as
    { meta?: HeadMetaItem[] } | Promise<{ meta?: HeadMetaItem[] }>;
  expect(result).not.toBeInstanceOf(Promise);
  return (result as { meta?: HeadMetaItem[] }).meta ?? [];
}

describe("private route SEO helpers", () => {
  it("defines private and login robots directives", () => {
    expect(privateAreaRobotsMeta()).toEqual({ name: "robots", content: PRIVATE_AREA_ROBOTS });
    expect(loginRobotsMeta()).toEqual({ name: "robots", content: LOGIN_ROBOTS });
    expect(authFlowRobotsMeta()).toEqual({ name: "robots", content: PRIVATE_AREA_ROBOTS });
    expect(hasSingleRobotsDirective([privateAreaRobotsMeta()], PRIVATE_AREA_ROBOTS)).toBe(true);
    expect(
      robotsMetaList([privateAreaRobotsMeta(), { name: "description", content: "x" }]),
    ).toEqual([PRIVATE_AREA_ROBOTS]);
  });
});

describe("authenticated layout route head metadata", () => {
  it.each([
    ["admin", AdminRoute],
    ["crm", CrmRoute],
    ["sales", SalesRoute],
    ["portal", PortalRoute],
    ["purchasing", PurchasingRoute],
  ] as const)("%s layout sets noindex, nofollow once", (_label, route) => {
    const meta = headMeta(route);
    expect(hasSingleRobotsDirective(meta, PRIVATE_AREA_ROBOTS)).toBe(true);
  });

  it("login sets noindex, follow and keeps its title", () => {
    const meta = headMeta(LoginRoute);
    expect(hasSingleRobotsDirective(meta, LOGIN_ROBOTS)).toBe(true);
    expect(meta.some((item) => item.title === "Trade Login — Automotive Brands")).toBe(true);
  });

  it("auth-adjacent pages set noindex, nofollow", () => {
    for (const route of [
      ForgotPasswordRoute,
      ResetPasswordRoute,
      ActivateRoute,
      AccountSecurityRoute,
    ]) {
      const meta = headMeta(route);
      expect(hasSingleRobotsDirective(meta, PRIVATE_AREA_ROBOTS)).toBe(true);
    }
  });

  it("nested private child routes do not override layout robots with a conflicting tag", () => {
    for (const route of [AdminIndexRoute, PortalIndexRoute, SalesIndexRoute]) {
      const meta = headMeta(route);
      const robots = robotsMetaList(meta);
      expect(robots).not.toContain("index,follow");
      expect(robots).not.toContain("index, follow");
      // Nested titles may set meta without robots; layout head supplies noindex via HeadContent merge.
      expect(robots.every((value) => value === PRIVATE_AREA_ROBOTS || value === LOGIN_ROBOTS)).toBe(
        true,
      );
    }
  });
});

describe("public pages remain indexable", () => {
  it("motorsport keeps index,follow", () => {
    const meta = headMeta(MotorsportRoute, { loaderData: null });
    expect(robotsMetaList(meta)).toContain("index,follow");
    expect(robotsMetaList(meta)).not.toContain(PRIVATE_AREA_ROBOTS);
  });

  it("products index does not set private noindex", () => {
    const meta = headMeta(ProductsIndexRoute);
    expect(robotsMetaList(meta)).not.toContain(PRIVATE_AREA_ROBOTS);
    expect(robotsMetaList(meta)).not.toContain(LOGIN_ROBOTS);
  });
});

describe("public/robots.txt", () => {
  const robots = readFileSync(resolve(process.cwd(), "public/robots.txt"), "utf8");

  it("retains existing private and API Disallow rules without duplicates per agent block", () => {
    const blocks = robots.split(/\n(?=User-agent:)/);
    const restricted = blocks.filter((block) => /User-agent: \*|Googlebot|Bingbot/.test(block));
    expect(restricted.length).toBeGreaterThanOrEqual(3);
    for (const block of restricted) {
      for (const prefix of ROBOTS_TXT_DISALLOW_PREFIXES) {
        const matches = block.match(
          new RegExp(`^Disallow: ${prefix.replace(/\//g, "\\/")}$`, "gm"),
        );
        expect(matches, `missing or duplicate ${prefix}`).toHaveLength(1);
      }
    }
  });

  it("does not disallow public catalogue or marketing prefixes", () => {
    for (const prefix of PUBLIC_INDEXABLE_PREFIXES) {
      if (prefix === "/") continue;
      expect(robots).not.toMatch(new RegExp(`Disallow:\\s*${prefix}(/|$)`, "m"));
    }
    expect(robots).toMatch(/^Allow: \/$/m);
  });
});

describe("sitemap coverage note", () => {
  it("records that this repository has no generated sitemap yet", () => {
    // No public/sitemap.xml or sitemap route exists today. When one is added it
    // must exclude authenticated prefixes listed in ROBOTS_TXT_DISALLOW_PREFIXES.
    expect(ROBOTS_TXT_DISALLOW_PREFIXES).toContain("/admin");
    expect(ROBOTS_TXT_DISALLOW_PREFIXES).toContain("/login");
  });
});
