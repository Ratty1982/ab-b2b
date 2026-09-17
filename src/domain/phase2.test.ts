/**
 * Phase 2 domain unit tests — no database required.
 */
import { describe, expect, it } from "vitest";

import { companyCreateSchema, addressSchema, COMPANY_STATUSES } from "@/domain/company";
import { formatZodError, validateSectionConfig } from "@/domain/cms";
import { tradeApplicationSubmitSchema } from "@/domain/trade-application";
import { generateInviteToken, hashInviteToken } from "@/domain/invitation";
import { ROUTES } from "@/lib/app-nav";
import { cmsEditorPath, cmsPublicPath } from "@/lib/cms-pages";
import { cmsMediaDisplaySrc, cmsMediaPublicPath, mergeBrandLogoMaps } from "@/lib/cms-media";
import { isPermissionKey, ALL_PERMISSIONS } from "@/domain/permissions";

describe("company domain", () => {
  it("accepts lifecycle statuses including SUSPENDED", () => {
    expect(COMPANY_STATUSES).toContain("SUSPENDED");
    expect(COMPANY_STATUSES).toContain("PENDING_APPROVAL");
    const parsed = companyCreateSchema.parse({ name: "Acme Factors Ltd" });
    expect(parsed.status).toBe("PROSPECT");
  });

  it("enforces address required fields", () => {
    expect(() =>
      addressSchema.parse({
        companyId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        line1: "1 High Street",
        town: "Birmingham",
        postcode: "B1 1AA",
      }),
    ).not.toThrow();
  });
});

describe("CMS section validation", () => {
  it("validates hero config", () => {
    const cfg = validateSectionConfig("HERO", {
      headline: "Hello",
      supporting: "World",
      ctaLabel: "Go",
      ctaHref: "/register",
    });
    expect(cfg).toMatchObject({ headline: "Hello" });
  });

  it("rejects executable-looking rich text beyond max", () => {
    expect(() =>
      validateSectionConfig("RICH_TEXT", { content: "x".repeat(20001) }),
    ).toThrow();
  });

  it("accepts featured brands displayCount sent as a string from number inputs", () => {
    const cfg = validateSectionConfig("FEATURED_BRANDS", {
      heading: "Our brands",
      brandSlugs: ["power-maxed"],
      displayCount: "5",
      logos: {
        "power-maxed": { mediaId: "clxxxxxxxxxxxxxxxxxxxxxxxxx", src: "/api/cms-media/clxxxxxxxxxxxxxxxxxxxxxxxxx", alt: "Power Maxed" },
      },
    }) as { displayCount: number; logos?: Record<string, { mediaId?: string }> };
    expect(cfg.displayCount).toBe(5);
    expect(cfg.logos?.["power-maxed"]?.mediaId).toBe("clxxxxxxxxxxxxxxxxxxxxxxxxx");
  });

  it("describes invalid hero headlines", () => {
    try {
      validateSectionConfig("HERO", { headline: "x".repeat(401) });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(formatZodError(error)).toMatch(/headline/i);
    }
  });

  it("accepts a media library ref on hero config", () => {
    const cfg = validateSectionConfig("HERO", {
      headline: "Hello",
      supporting: "World",
      media: {
        mediaId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        src: "/api/cms-media/clxxxxxxxxxxxxxxxxxxxxxxxxx",
        alt: "Warehouse rack",
      },
    }) as { media?: { mediaId?: string; src?: string; alt: string } };
    expect(cfg.media?.mediaId).toBe("clxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(cfg.media?.src).toContain("/api/cms-media/");
    expect(cfg.media?.alt).toBe("Warehouse rack");
  });
});

describe("CMS media display src", () => {
  it("prefers library id over a stale src", () => {
    expect(
      cmsMediaDisplaySrc({
        mediaId: "abc",
        src: "https://example.invalid/old.jpg",
      }),
    ).toBe(cmsMediaPublicPath("abc"));
  });

  it("lets a section logo override the catalogue logo and an empty ref clear it", () => {
    const merged = mergeBrandLogoMaps(
      { "power-maxed": { mediaId: "cms-1" }, "steel-seal": { alt: "" } },
      {
        "power-maxed": { mediaId: "db-1" },
        "steel-seal": { mediaId: "db-2" },
        kidzmotion: { mediaId: "db-3" },
      },
    );
    expect(merged["power-maxed"]?.mediaId).toBe("cms-1");
    expect(merged["steel-seal"]).toBeUndefined();
    expect(merged["kidzmotion"]?.mediaId).toBe("db-3");
  });
});

describe("trade application schema", () => {
  it("requires company and contact", () => {
    const parsed = tradeApplicationSubmitSchema.parse({
      companyName: "Trade Co",
      primaryContact: {
        firstName: "Sam",
        lastName: "Lee",
        email: "sam@example.com",
      },
      brandsInterest: ["power-maxed"],
    });
    expect(parsed.companyName).toBe("Trade Co");
  });

  it("rejects honeypot", () => {
    expect(() =>
      tradeApplicationSubmitSchema.parse({
        companyName: "Trade Co",
        primaryContact: { firstName: "A", lastName: "B", email: "a@b.com" },
        websiteConfirm: "bot",
      }),
    ).toThrow();
  });
});

describe("invitations", () => {
  it("hashes tokens stably", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(tokenHash).toBe(hashInviteToken(token));
    expect(tokenHash).not.toBe(token);
  });
});

describe("navigation config", () => {
  it("maps homepage CMS paths without nesting under a dead leaf", () => {
    expect(cmsPublicPath("home")).toBe("/");
    expect(cmsEditorPath("home")).toBe("/admin/content/home");
    expect(ROUTES.adminHomepage).toBe("/admin/content/home");
    expect(ROUTES.adminMedia).toBe("/admin/content/media");
  });
});

describe("phase 2 permissions", () => {
  it("includes granular CMS keys", () => {
    for (const key of [
      "cms.page.read",
      "cms.page.edit",
      "cms.page.publish",
      "cms.media.read",
      "cms.media.manage",
    ]) {
      expect(isPermissionKey(key)).toBe(true);
    }
    expect(ALL_PERMISSIONS.length).toBeGreaterThan(50);
  });
});
