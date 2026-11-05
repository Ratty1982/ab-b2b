/**
 * Site header logo branding — upload, public eligibility, reset, permissions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  getPublicCmsMediaBytes,
  isCmsMediaPubliclyEligible,
} from "@/server/cms/media";
import {
  getPublicSiteBranding,
  getSiteBrandingSettingsForActor,
  resetSiteHeaderLogo,
  uploadSiteHeaderLogo,
} from "@/server/branding/settings";
import { DEFAULT_SITE_HEADER_LOGO_SRC } from "@/domain/site-branding";

const prisma = new PrismaClient();
const stamp = Date.now();
let adminId = "";
let salesRepUserId = "";

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
      },
    });
  }
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`site.branding.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  salesRepUserId = await ensureUser(`site.branding.rep.${stamp}@example.invalid`, [
    "SALES_REPRESENTATIVE",
  ]);
  await prisma.siteBrandingSettings.deleteMany({ where: { id: "singleton" } }).catch(() => undefined);
});

afterAll(async () => {
  const row = await prisma.siteBrandingSettings.findUnique({ where: { id: "singleton" } });
  if (row?.headerLogoMediaId) {
    await prisma.siteBrandingSettings.update({
      where: { id: "singleton" },
      data: { headerLogoMediaId: null },
    });
    await prisma.cmsMedia.delete({ where: { id: row.headerLogoMediaId } }).catch(() => undefined);
  }
  await prisma.siteBrandingSettings.deleteMany({ where: { id: "singleton" } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("site header logo branding", () => {
  it("defaults to the static AB mark when unset", async () => {
    const publicBranding = await getPublicSiteBranding();
    expect(publicBranding.headerLogoSrc).toBe(DEFAULT_SITE_HEADER_LOGO_SRC);
    expect(publicBranding.isCustom).toBe(false);

    const adminView = await getSiteBrandingSettingsForActor(adminId);
    expect(adminView.isCustom).toBe(false);
    expect(adminView.headerLogoSrc).toBe(DEFAULT_SITE_HEADER_LOGO_SRC);
  });

  it("uploads a valid logo, serves it anonymously, and audits the change", async () => {
    const sharp = (await import("sharp")).default;
    const raw = await sharp({
      create: { width: 128, height: 128, channels: 3, background: { r: 180, g: 20, b: 20 } },
    })
      .png()
      .toBuffer();

    const saved = await uploadSiteHeaderLogo(adminId, {
      filename: `header-${stamp}.png`,
      contentType: "image/png",
      base64: raw.toString("base64"),
      altText: "AB header",
    });

    expect(saved.isCustom).toBe(true);
    expect(saved.headerLogoMediaId).toBeTruthy();
    expect(saved.width).toBe(128);
    expect(saved.height).toBe(128);
    expect(saved.headerLogoSrc).toMatch(/^\/api\/cms-media\/.+\?v=\d+$/);

    expect(await isCmsMediaPubliclyEligible(saved.headerLogoMediaId!)).toBe(true);
    const bytes = await getPublicCmsMediaBytes(saved.headerLogoMediaId!);
    expect(bytes?.contentType).toBe("image/png");
    expect(bytes?.bytes.length).toBeGreaterThan(0);

    const publicBranding = await getPublicSiteBranding();
    expect(publicBranding.isCustom).toBe(true);
    expect(publicBranding.headerLogoSrc).toBe(saved.headerLogoSrc);

    const audit = await prisma.auditEvent.findFirst({
      where: {
        action: "settings.site_branding_updated",
        entityType: "SiteBrandingSettings",
        actorUserId: adminId,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit?.metadata ?? {})).toContain("header_logo_replaced");
  });

  it("rejects SVG, oversize, and undersized uploads", async () => {
    await expect(
      uploadSiteHeaderLogo(adminId, {
        filename: "mark.svg",
        contentType: "image/svg+xml",
        base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64"),
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const sharp = (await import("sharp")).default;
    const tiny = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    await expect(
      uploadSiteHeaderLogo(adminId, {
        filename: "tiny.png",
        contentType: "image/png",
        base64: tiny.toString("base64"),
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      uploadSiteHeaderLogo(adminId, {
        filename: "huge.png",
        contentType: "image/png",
        base64: Buffer.alloc(2 * 1024 * 1024 + 16, 1).toString("base64"),
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("denies upload/reset without settings.edit", async () => {
    const sharp = (await import("sharp")).default;
    const raw = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .png()
      .toBuffer();

    await expect(
      uploadSiteHeaderLogo(salesRepUserId, {
        filename: "nope.png",
        contentType: "image/png",
        base64: raw.toString("base64"),
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(resetSiteHeaderLogo(salesRepUserId)).rejects.toBeInstanceOf(AuthError);
  });

  it("resets to the default static logo", async () => {
    const before = await getPublicSiteBranding();
    expect(before.isCustom).toBe(true);

    const reset = await resetSiteHeaderLogo(adminId);
    expect(reset.isCustom).toBe(false);
    expect(reset.headerLogoSrc).toBe(DEFAULT_SITE_HEADER_LOGO_SRC);

    const publicBranding = await getPublicSiteBranding();
    expect(publicBranding.isCustom).toBe(false);
    expect(publicBranding.headerLogoSrc).toBe(DEFAULT_SITE_HEADER_LOGO_SRC);

    const audit = await prisma.auditEvent.findFirst({
      where: {
        action: "settings.site_branding_updated",
        actorUserId: adminId,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(audit?.metadata ?? {})).toContain("header_logo_reset");
  });
});
