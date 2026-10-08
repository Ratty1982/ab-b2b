/**
 * Trade Solutions CMS: draft edits stay unpublished, publish updates the live page,
 * and other website pages are left unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { parseTradeSolutionsContent } from "@/domain/trade-solutions-content";
import {
  bootstrapMarketingCmsPages,
  ensureTradeSolutionsSection,
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

describe("trade solutions CMS publish", () => {
  let restoreConfig: ReturnType<typeof parseTradeSolutionsContent> | null = null;
  let restoreSeo: { seoTitle: string | null; metaDescription: string | null } | null = null;

  beforeAll(async () => {
    await bootstrapRbac(prisma);
    adminId = await ensureUser("trade-cms.admin@example.invalid", ["SUPER_ADMIN"]);
    salesRepId = await ensureUser("trade-cms.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
    await bootstrapMarketingCmsPages(prisma);
  });

  afterAll(async () => {
    if (restoreConfig) {
      await saveCmsDraftSections(adminId, "trade-solutions", [
        { type: "TRADE_SOLUTIONS", enabled: true, config: restoreConfig },
      ]);
      await publishCmsPage(adminId, "trade-solutions", "Restore trade solutions after CMS test");
    }
    if (restoreSeo) {
      await prisma.cmsPage.update({
        where: { slug: "trade-solutions" },
        data: restoreSeo,
      });
    }
    await prisma.$disconnect();
  });

  it("publishes trade solutions edits and leaves other pages alone", async () => {
    const whyBefore = await prisma.cmsPage.findUnique({
      where: { slug: "why-automotive-brands" },
      include: { publishedVersion: { include: { sections: { orderBy: { sortOrder: "asc" } } } } },
    });

    const first = await ensureTradeSolutionsSection(prisma);
    const draft = await getCmsPageDraft(adminId, "trade-solutions");
    expect(draft.version?.sections.map((section) => section.type)).toEqual(["TRADE_SOLUTIONS"]);
    const baseline = parseTradeSolutionsContent(draft.version?.sections[0]?.config);
    restoreConfig = baseline;
    const page = await prisma.cmsPage.findUnique({ where: { slug: "trade-solutions" } });
    restoreSeo = { seoTitle: page?.seoTitle ?? null, metaDescription: page?.metaDescription ?? null };

    const marker = `Trade CMS marker ${Date.now()}`;
    const edited = parseTradeSolutionsContent({
      ...baseline,
      hero: { ...baseline.hero, headline: marker },
      portal: {
        ...baseline.portal,
        media: { src: "/api/cms-media/real-portal", alt: "Trade portal catalogue" },
      },
      benefits: {
        ...baseline.benefits,
        items: baseline.benefits.items.map((item, index) =>
          index === 0 ? { ...item, body: "Custom trade pricing copy that must survive a later migration." } : item,
        ),
      },
    });

    await saveCmsDraftSections(adminId, "trade-solutions", [
      { type: "TRADE_SOLUTIONS", enabled: true, config: edited },
    ]);
    const liveBefore = await getPublishedCmsPage("trade-solutions");
    expect(JSON.stringify(liveBefore?.sections[0]?.config ?? {})).not.toContain(marker);

    await publishCmsPage(adminId, "trade-solutions", "Publish trade solutions test");
    const live = await getPublishedCmsPage("trade-solutions");
    const published = parseTradeSolutionsContent(live?.sections[0]?.config);
    expect(published.hero.headline).toBe(marker);
    expect(published.portal.media.src).toBe("/api/cms-media/real-portal");
    expect(published.portal.media.alt).toBe("Trade portal catalogue");
    expect(published.benefits.items[0]?.body).toBe("Custom trade pricing copy that must survive a later migration.");
    expect(live?.sections.map((section) => section.type)).toEqual(["TRADE_SOLUTIONS"]);

    const second = await ensureTradeSolutionsSection(prisma);
    expect(second.migratedVersionIds).toEqual([]);
    const afterEnsure = await getPublishedCmsPage("trade-solutions");
    expect(parseTradeSolutionsContent(afterEnsure?.sections[0]?.config).hero.headline).toBe(marker);
    expect(first.migratedVersionIds.length).toBeGreaterThanOrEqual(0);

    await prisma.cmsPage.update({
      where: { slug: "trade-solutions" },
      data: { seoTitle: "Custom trade SEO title" },
    });
    await ensureTradeSolutionsSection(prisma);
    const seo = await prisma.cmsPage.findUnique({ where: { slug: "trade-solutions" } });
    expect(seo?.seoTitle).toBe("Custom trade SEO title");

    const whyAfter = await prisma.cmsPage.findUnique({
      where: { slug: "why-automotive-brands" },
      include: { publishedVersion: { include: { sections: { orderBy: { sortOrder: "asc" } } } } },
    });
    expect(whyAfter?.publishedVersion?.sections.map((section) => section.type)).toEqual(
      whyBefore?.publishedVersion?.sections.map((section) => section.type),
    );
    expect(whyAfter?.publishedVersionId).toBe(whyBefore?.publishedVersionId);
    expect(whyAfter?.seoTitle).toBe(whyBefore?.seoTitle);

    await expect(
      saveCmsDraftSections(salesRepId, "trade-solutions", [
        { type: "TRADE_SOLUTIONS", enabled: true, config: edited },
      ]),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
