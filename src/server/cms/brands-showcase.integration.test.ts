/**
 * Brands CMS: draft edits stay unpublished, publish updates /brands content,
 * and other website pages are left unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { parseBrandsShowcaseContent } from "@/domain/brands-showcase-content";
import {
  bootstrapMarketingCmsPages,
  ensureBrandsShowcaseSection,
  getCmsPageDraft,
  getPublishedCmsPage,
  publishCmsPage,
  saveCmsDraftSections,
} from "@/server/cms/service";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
let adminId = "";
let salesRepId = "";

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

function publishedTypes(page: { publishedVersion: { sections: { type: string }[] } | null } | null) {
  return page?.publishedVersion?.sections.map((section) => section.type) ?? [];
}

describe("brands showcase CMS publish", () => {
  let restoreConfig: ReturnType<typeof parseBrandsShowcaseContent> | null = null;

  beforeAll(async () => {
    await bootstrapRbac(prisma);
    adminId = await ensureUser("brands-cms.admin@example.invalid", ["SUPER_ADMIN"]);
    salesRepId = await ensureUser("brands-cms.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
    await bootstrapMarketingCmsPages(prisma);
  });

  afterAll(async () => {
    if (restoreConfig) {
      await saveCmsDraftSections(adminId, "brands", [
        { type: "BRANDS_SHOWCASE", enabled: true, config: restoreConfig },
      ]);
      await publishCmsPage(adminId, "brands", "Restore brands showcase after CMS test");
    }
    await prisma.$disconnect();
  });

  it("publishes showcase edits onto the live brands page and leaves other pages alone", async () => {
    const aboutBefore = await prisma.cmsPage.findUnique({
      where: { slug: "about" },
      include: { publishedVersion: { include: { sections: { orderBy: { sortOrder: "asc" } } } } },
    });
    const aboutSeo = aboutBefore?.seoTitle ?? null;

    const first = await ensureBrandsShowcaseSection(prisma);
    const draft = await getCmsPageDraft(adminId, "brands");
    expect(draft.version?.sections.map((section) => section.type)).toEqual(["BRANDS_SHOWCASE"]);
    const baseline = parseBrandsShowcaseContent(draft.version?.sections[0]?.config);
    restoreConfig = baseline;

    const marker = `Brands CMS marker ${Date.now()}`;
    const edited = parseBrandsShowcaseContent({
      ...baseline,
      hero: {
        ...baseline.hero,
        headline: marker,
        description: "Draft description must stay off the live page until publish.",
      },
      steelSeal: {
        ...baseline.steelSeal,
        media: {
          mediaId: undefined,
          src: "/api/cms-media/brands-engine",
          alt: "Engine photography selected in the CMS",
        },
      },
    });

    await saveCmsDraftSections(adminId, "brands", [
      { type: "BRANDS_SHOWCASE", enabled: true, config: edited },
    ]);

    const liveBeforePublish = await getPublishedCmsPage("brands");
    const liveHeroBefore = liveBeforePublish?.sections.find((section) => section.type === "BRANDS_SHOWCASE");
    expect(JSON.stringify(liveHeroBefore?.config ?? {})).not.toContain(marker);

    await publishCmsPage(adminId, "brands", "Publish brands showcase test");
    const live = await getPublishedCmsPage("brands");
    const section = live?.sections.find((item) => item.type === "BRANDS_SHOWCASE");
    const published = parseBrandsShowcaseContent(section?.config);
    expect(published.hero.headline).toBe(marker);
    expect(published.steelSeal.media.src).toBe("/api/cms-media/brands-engine");
    expect(published.steelSeal.media.alt).toBe("Engine photography selected in the CMS");
    expect(published.steelSeal.ctaHref).toBe("/brands/steel-seal");
    expect(published.powerMaxed.ctaHref).toBe("/brands/power-maxed");
    expect(live?.sections.map((item) => item.type)).toEqual(["BRANDS_SHOWCASE"]);

    const aboutAfter = await prisma.cmsPage.findUnique({
      where: { slug: "about" },
      include: { publishedVersion: { include: { sections: { orderBy: { sortOrder: "asc" } } } } },
    });
    expect(publishedTypes(aboutAfter)).toEqual(publishedTypes(aboutBefore));
    expect(aboutAfter?.seoTitle ?? null).toBe(aboutSeo);
    expect(aboutAfter?.publishedVersionId).toBe(aboutBefore?.publishedVersionId);

    const second = await ensureBrandsShowcaseSection(prisma);
    expect(second.migratedVersionIds).toEqual([]);
    expect(first.migratedVersionIds.length).toBeGreaterThanOrEqual(0);

    await expect(
      saveCmsDraftSections(salesRepId, "brands", [
        { type: "BRANDS_SHOWCASE", enabled: true, config: edited },
      ]),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
