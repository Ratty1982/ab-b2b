/**
 * Why Us CMS: draft edits stay unpublished, publish updates the live page,
 * team records stay in place, and other website pages are left unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { parseWhyUsContent } from "@/domain/why-us-content";
import {
  bootstrapMarketingCmsPages,
  ensureWhyUsSection,
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

describe("why us CMS publish", () => {
  let restoreConfig: ReturnType<typeof parseWhyUsContent> | null = null;
  let restoreSeo: { seoTitle: string | null; metaDescription: string | null } | null = null;

  beforeAll(async () => {
    await bootstrapRbac(prisma);
    adminId = await ensureUser("why-cms.admin@example.invalid", ["SUPER_ADMIN"]);
    salesRepId = await ensureUser("why-cms.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
    await bootstrapMarketingCmsPages(prisma);
  });

  afterAll(async () => {
    if (restoreConfig) {
      await saveCmsDraftSections(adminId, "why-automotive-brands", [
        { type: "WHY_US", enabled: true, config: restoreConfig },
      ]);
      await publishCmsPage(adminId, "why-automotive-brands", "Restore why us after CMS test");
    }
    if (restoreSeo) {
      await prisma.cmsPage.update({
        where: { slug: "why-automotive-brands" },
        data: restoreSeo,
      });
    }
    await prisma.$disconnect();
  });

  it("publishes why us edits, keeps team records, and leaves other pages alone", async () => {
    const teamBefore = await prisma.teamMember.findMany({
      select: { id: true, firstName: true, lastName: true, jobTitle: true, photoMediaId: true, isPublic: true },
      orderBy: { id: "asc" },
    });
    const brandsBefore = await prisma.cmsPage.findUnique({
      where: { slug: "brands" },
      include: { publishedVersion: { include: { sections: { orderBy: { sortOrder: "asc" } } } } },
    });
    const tradeBefore = await prisma.cmsPage.findUnique({
      where: { slug: "trade-solutions" },
      include: { publishedVersion: { include: { sections: { orderBy: { sortOrder: "asc" } } } } },
    });

    const first = await ensureWhyUsSection(prisma);
    const draft = await getCmsPageDraft(adminId, "why-automotive-brands");
    expect(draft.version?.sections.map((section) => section.type)).toEqual(["WHY_US"]);
    const baseline = parseWhyUsContent(draft.version?.sections[0]?.config);
    restoreConfig = baseline;
    expect(baseline.team.enabled).toBe(false);
    const page = await prisma.cmsPage.findUnique({ where: { slug: "why-automotive-brands" } });
    restoreSeo = { seoTitle: page?.seoTitle ?? null, metaDescription: page?.metaDescription ?? null };

    const marker = `Why CMS marker ${Date.now()}`;
    const edited = parseWhyUsContent({
      ...baseline,
      hero: {
        ...baseline.hero,
        headline: marker,
        media: { src: "/api/cms-media/real-aisle", alt: "Warehouse aisle", focalX: 22, focalY: 48 },
      },
      stats: {
        ...baseline.stats,
        items: baseline.stats.items.map((item, index) =>
          index === 0 ? { ...item, body: "Custom experience line that must survive a later migration." } : item,
        ),
      },
      testimonials: {
        ...baseline.testimonials,
        items: baseline.testimonials.items.map((item) => ({ ...item, published: false })),
      },
    });

    await saveCmsDraftSections(adminId, "why-automotive-brands", [{ type: "WHY_US", enabled: true, config: edited }]);
    const liveBefore = await getPublishedCmsPage("why-automotive-brands");
    expect(JSON.stringify(liveBefore?.sections[0]?.config ?? {})).not.toContain(marker);

    await publishCmsPage(adminId, "why-automotive-brands", "Publish why us test");
    const live = await getPublishedCmsPage("why-automotive-brands");
    const published = parseWhyUsContent(live?.sections[0]?.config);
    expect(published.hero.headline).toBe(marker);
    expect(published.hero.media.src).toBe("/api/cms-media/real-aisle");
    expect(published.hero.media.focalX).toBe(22);
    expect(published.stats.items[0]?.body).toBe("Custom experience line that must survive a later migration.");
    expect(published.testimonials.items.every((item) => item.published === false)).toBe(true);
    expect(published.team.enabled).toBe(false);
    expect(live?.sections.map((section) => section.type)).toEqual(["WHY_US"]);

    const second = await ensureWhyUsSection(prisma);
    expect(second.migratedVersionIds).toEqual([]);
    const afterEnsure = await getPublishedCmsPage("why-automotive-brands");
    expect(parseWhyUsContent(afterEnsure?.sections[0]?.config).hero.headline).toBe(marker);
    expect(first.migratedVersionIds.length).toBeGreaterThanOrEqual(0);

    await prisma.cmsPage.update({
      where: { slug: "why-automotive-brands" },
      data: { seoTitle: "Custom why us SEO title" },
    });
    await ensureWhyUsSection(prisma);
    const seo = await prisma.cmsPage.findUnique({ where: { slug: "why-automotive-brands" } });
    expect(seo?.seoTitle).toBe("Custom why us SEO title");

    const teamAfter = await prisma.teamMember.findMany({
      select: { id: true, firstName: true, lastName: true, jobTitle: true, photoMediaId: true, isPublic: true },
      orderBy: { id: "asc" },
    });
    expect(teamAfter).toEqual(teamBefore);

    const brandsAfter = await prisma.cmsPage.findUnique({
      where: { slug: "brands" },
      include: { publishedVersion: { include: { sections: { orderBy: { sortOrder: "asc" } } } } },
    });
    const tradeAfter = await prisma.cmsPage.findUnique({
      where: { slug: "trade-solutions" },
      include: { publishedVersion: { include: { sections: { orderBy: { sortOrder: "asc" } } } } },
    });
    expect(brandsAfter?.publishedVersionId).toBe(brandsBefore?.publishedVersionId);
    expect(brandsAfter?.publishedVersion?.sections.map((section) => section.type)).toEqual(
      brandsBefore?.publishedVersion?.sections.map((section) => section.type),
    );
    expect(tradeAfter?.publishedVersionId).toBe(tradeBefore?.publishedVersionId);
    expect(tradeAfter?.publishedVersion?.sections.map((section) => section.type)).toEqual(
      tradeBefore?.publishedVersion?.sections.map((section) => section.type),
    );

    await expect(
      saveCmsDraftSections(salesRepId, "why-automotive-brands", [{ type: "WHY_US", enabled: true, config: edited }]),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
