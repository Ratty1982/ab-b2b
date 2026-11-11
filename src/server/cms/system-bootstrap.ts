/**
 * Production / DB CMS bootstrap — Prisma + domain only.
 * Kept out of cms/service.ts so Docker `bun build` of prisma/bootstrap does not
 * pull catalogue/products → stock → @tanstack/start-server-core virtual entries.
 */
import type { CmsSectionType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { validateSectionConfig } from "@/domain/cms";
import {
  defaultHomepageSections,
  HOMEPAGE_LAUNCH_CONTENT_KEY,
} from "@/server/cms/homepage-seed";
import {
  brandsShowcaseContentFromLegacy,
  LEGACY_BRANDS_PAGE_SEO,
  parseBrandsShowcaseContent,
  upgradeLegacyBrandsShowcaseContent,
} from "@/domain/brands-showcase-content";
import {
  PUBLIC_BRANDS_PAGE_DESCRIPTION,
  PUBLIC_BRANDS_PAGE_TITLE,
} from "@/domain/public-brands-showcase";
import { MARKETING_CMS_PAGES } from "@/domain/cms-marketing-pages";
import {
  applyShowcaseBrandMedia,
  LEGACY_TRADE_SOLUTIONS_SEO,
  parseTradeSolutionsContent,
  TRADE_SOLUTIONS_PAGE_DESCRIPTION,
  TRADE_SOLUTIONS_PAGE_TITLE,
  tradeSolutionsContentFromLegacy,
  upgradeMigratedTradeSolutions,
} from "@/domain/trade-solutions-content";
import {
  applyWhyUsBrandMedia,
  LEGACY_WHY_US_SEO,
  WHY_US_PAGE_DESCRIPTION,
  WHY_US_PAGE_TITLE,
  whyUsContentFromLegacy,
} from "@/domain/why-us-content";

function sectionContentKey(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const key = (config as Record<string, unknown>)["contentKey"];
  return typeof key === "string" ? key : null;
}

/**
 * Soft homepage launch sync.
 *
 * IMPORTANT: Never replace Website Builder section configs with seed defaults.
 * Bumping HOMEPAGE_LAUNCH_CONTENT_KEY must not wipe live/draft copy, brand cards,
 * product SKUs, CTAs, or other editor fields. Media is likewise left untouched.
 *
 * Safe actions only:
 * - stamp contentKey onto existing configs when it drifts
 * - keep RESOURCES / NEWS disabled for launch
 * - never overwrite seoTitle / metaDescription once a page already exists
 */
async function refreshHomepageLaunchContent(
  prismaClient: PrismaClient = prisma,
  pageId: string,
) {
  const page = await prismaClient.cmsPage.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      publishedVersionId: true,
      draftVersionId: true,
    },
  });
  if (!page) return;

  const versionIds = [
    ...new Set([page.publishedVersionId, page.draftVersionId].filter(Boolean) as string[]),
  ];

  for (const versionId of versionIds) {
    const existing = await prismaClient.cmsSection.findMany({
      where: { versionId },
      orderBy: { sortOrder: "asc" },
    });

    for (const row of existing) {
      const cfg =
        row.config && typeof row.config === "object"
          ? ({ ...(row.config as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const keyDrifted = sectionContentKey(cfg) !== HOMEPAGE_LAUNCH_CONTENT_KEY;
      const shouldDisable =
        (row.type === "RESOURCES" || row.type === "NEWS") && row.enabled;

      if (!keyDrifted && !shouldDisable) continue;

      if (keyDrifted) {
        cfg["contentKey"] = HOMEPAGE_LAUNCH_CONTENT_KEY;
      }

      await prismaClient.cmsSection.update({
        where: { id: row.id },
        data: {
          ...(keyDrifted ? { config: cfg as Prisma.InputJsonValue } : {}),
          ...(shouldDisable ? { enabled: false } : {}),
        },
      });
    }
  }
}

/**
 * Idempotent homepage CMS bootstrap for production.
 * Creates home page + published seed sections if missing.
 */
async function ensureCanonicalHomepageSections(
  prismaClient: PrismaClient = prisma,
  pageId: string,
) {
  const page = await prismaClient.cmsPage.findUnique({
    where: { id: pageId },
    select: { publishedVersionId: true, draftVersionId: true },
  });
  const versionIds = [...new Set([page?.publishedVersionId, page?.draftVersionId].filter(Boolean) as string[])];
  const defaults = defaultHomepageSections();
  for (const versionId of versionIds) {
    const existing = await prismaClient.cmsSection.findMany({
      where: { versionId },
      orderBy: { sortOrder: "asc" },
    });
    const have = new Set(existing.map((row) => row.type));
    const isLegacyPublishedShape =
      have.has("HERO") && have.has("FEATURED_BRANDS") && have.has("TRADE_CTA") && !have.has("NEW_PRODUCTS");
    if (!isLegacyPublishedShape) continue;
    const missing = defaults.filter((section) => !have.has(section.type as CmsSectionType));
    if (!missing.length) continue;
    const byType = new Map(existing.map((row) => [row.type, row]));
    const merged: Array<{ id?: string; type: CmsSectionType; config: Prisma.InputJsonValue; enabled: boolean }> = [];
    for (const section of defaults) {
      const current = byType.get(section.type as CmsSectionType);
      if (current) {
        merged.push({
          id: current.id,
          type: current.type,
          config: current.config as Prisma.InputJsonValue,
          enabled: current.enabled,
        });
        byType.delete(section.type as CmsSectionType);
      } else if (missing.some((row) => row.type === section.type)) {
        merged.push({
          type: section.type as CmsSectionType,
          config: section.config as Prisma.InputJsonValue,
          enabled: section.enabled !== false,
        });
      }
    }
    for (const leftover of byType.values()) {
      merged.push({
        id: leftover.id,
        type: leftover.type,
        config: leftover.config as Prisma.InputJsonValue,
        enabled: leftover.enabled,
      });
    }
    await prismaClient.$transaction(async (tx) => {
      for (const [index, row] of merged.entries()) {
        if (row.id) {
          await tx.cmsSection.update({ where: { id: row.id }, data: { sortOrder: index } });
        } else {
          await tx.cmsSection.create({
            data: {
              versionId,
              type: row.type,
              config: row.config,
              enabled: row.enabled,
              sortOrder: index,
            },
          });
        }
      }
    });
  }

  await refreshHomepageLaunchContent(prismaClient, pageId);
}

export async function bootstrapHomepageCms(
  prismaClient: PrismaClient = prisma,
): Promise<{ created: boolean; pageId: string }> {
  const existing = await prismaClient.cmsPage.findUnique({ where: { slug: "home" } });
  if (existing?.publishedVersionId) {
    await ensureCanonicalHomepageSections(prismaClient, existing.id);
    return { created: false, pageId: existing.id };
  }

  const sections = defaultHomepageSections();
  const seoTitle = "Automotive Brands — Automotive products built for the trade";
  const metaDescription =
    "Trade supply of Power Maxed and Steel Seal to UK motor factors, workshops, retailers and distributors. Open a trade account for account pricing and case ordering.";

  const page = await prismaClient.$transaction(async (tx) => {
    const p =
      existing ??
      (await tx.cmsPage.create({
        data: {
          slug: "home",
          title: "Homepage",
          seoTitle,
          metaDescription,
          status: "DRAFT",
        },
      }));

    if (p.publishedVersionId) return p;

    const version = await tx.cmsPageVersion.create({
      data: {
        pageId: p.id,
        version: 1,
        label: "Trade sales demo homepage",
        seoTitle,
        metaDescription,
        sections: {
          create: sections.map((s, i) => ({
            type: s.type,
            config: s.config as Prisma.InputJsonValue,
            sortOrder: i,
            enabled: s.enabled !== false,
          })),
        },
      },
    });

    return tx.cmsPage.update({
      where: { id: p.id },
      data: {
        draftVersionId: version.id,
        publishedVersionId: version.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
        seoTitle,
        metaDescription,
      },
    });
  });

  return { created: true, pageId: page.id };
}

/**
 * Idempotent seed for public marketing CMS pages (about, brands, trade-solutions, etc.).
 * Does not overwrite pages that already have a published version.
 */
export async function bootstrapMarketingCmsPages(
  prismaClient: PrismaClient = prisma,
): Promise<{ created: string[]; existing: string[] }> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const seed of MARKETING_CMS_PAGES) {
    const row = await prismaClient.cmsPage.findUnique({
      where: { slug: seed.slug },
      select: { id: true, publishedVersionId: true },
    });
    if (row?.publishedVersionId) {
      existing.push(seed.slug);
      continue;
    }

    await prismaClient.$transaction(async (tx) => {
      const page =
        row ??
        (await tx.cmsPage.create({
          data: {
            slug: seed.slug,
            title: seed.title,
            seoTitle: seed.seoTitle,
            metaDescription: seed.metaDescription,
            status: "DRAFT",
          },
        }));

      if (page.publishedVersionId) return;

      const version = await tx.cmsPageVersion.create({
        data: {
          pageId: page.id,
          version: 1,
          label: "Marketing page seed",
          seoTitle: seed.seoTitle,
          metaDescription: seed.metaDescription,
          sections: {
            create: seed.sections.map((section, index) => ({
              type: section.type,
              config: section.config as Prisma.InputJsonValue,
              sortOrder: index,
              enabled: section.enabled !== false,
            })),
          },
        },
      });

      await tx.cmsPage.update({
        where: { id: page.id },
        data: {
          draftVersionId: version.id,
          publishedVersionId: version.id,
          status: "PUBLISHED",
          publishedAt: new Date(),
          title: seed.title,
          seoTitle: seed.seoTitle,
          metaDescription: seed.metaDescription,
        },
      });
    });

    created.push(seed.slug);
  }

  await ensureBrandsShowcaseSection(prismaClient);
  await ensureTradeSolutionsSection(prismaClient);
  await ensureWhyUsSection(prismaClient);
  return { created, existing };
}

/**
 * Move an existing Brands page onto the showcase template once.
 * Leaves every other website page alone. Does not change SEO or publication status.
 * A version that already has BRANDS_SHOWCASE is not overwritten.
 */
export async function ensureBrandsShowcaseSection(
  prismaClient: PrismaClient = prisma,
): Promise<{ migratedVersionIds: string[] }> {
  const page = await prismaClient.cmsPage.findUnique({
    where: { slug: "brands" },
    select: {
      id: true,
      draftVersionId: true,
      publishedVersionId: true,
      seoTitle: true,
      metaDescription: true,
    },
  });
  if (!page) return { migratedVersionIds: [] };

  const seoData: { seoTitle?: string; metaDescription?: string } = {};
  if (page.seoTitle === LEGACY_BRANDS_PAGE_SEO.seoTitle) seoData.seoTitle = PUBLIC_BRANDS_PAGE_TITLE;
  if (page.metaDescription === LEGACY_BRANDS_PAGE_SEO.metaDescription) {
    seoData.metaDescription = PUBLIC_BRANDS_PAGE_DESCRIPTION;
  }
  if (seoData.seoTitle || seoData.metaDescription) {
    await prismaClient.cmsPage.update({ where: { id: page.id }, data: seoData });
    await prismaClient.cmsPageVersion.updateMany({
      where: {
        pageId: page.id,
        AND: [
          { OR: [{ seoTitle: LEGACY_BRANDS_PAGE_SEO.seoTitle }, { seoTitle: null }] },
          {
            OR: [
              { metaDescription: LEGACY_BRANDS_PAGE_SEO.metaDescription },
              { metaDescription: null },
            ],
          },
        ],
      },
      data: seoData,
    });
  }

  const versionIds = [...new Set([page.draftVersionId, page.publishedVersionId].filter((id): id is string => Boolean(id)))];
  const migratedVersionIds: string[] = [];

  for (const versionId of versionIds) {
    const sections = await prismaClient.cmsSection.findMany({
      where: { versionId },
      orderBy: { sortOrder: "asc" },
    });
    const showcase = sections.find((section) => section.type === "BRANDS_SHOWCASE");
    if (!showcase) {
      const upgraded = upgradeLegacyBrandsShowcaseContent(
        brandsShowcaseContentFromLegacy(
          sections.map((section) => ({
            type: section.type,
            config: section.config,
            enabled: section.enabled,
          })),
        ),
      ).content;
      const config = validateSectionConfig("BRANDS_SHOWCASE", upgraded);
      await prismaClient.$transaction(async (tx) => {
        await tx.cmsSection.deleteMany({ where: { versionId } });
        await tx.cmsSection.create({
          data: {
            versionId,
            type: "BRANDS_SHOWCASE",
            config: config as Prisma.InputJsonValue,
            sortOrder: 0,
            enabled: true,
          },
        });
      });
      migratedVersionIds.push(versionId);
      continue;
    }

    const upgraded = upgradeLegacyBrandsShowcaseContent(parseBrandsShowcaseContent(showcase.config));
    if (!upgraded.changed) continue;
    const config = validateSectionConfig("BRANDS_SHOWCASE", upgraded.content);
    await prismaClient.cmsSection.update({
      where: { id: showcase.id },
      data: { config: config as Prisma.InputJsonValue },
    });
    migratedVersionIds.push(versionId);
  }

  return { migratedVersionIds };
}

/**
 * Move an existing Trade Solutions page onto the structured template once.
 * Leaves every other website page alone and does not change publication status.
 * A version that already has TRADE_SOLUTIONS is not overwritten.
 */
export async function ensureTradeSolutionsSection(
  prismaClient: PrismaClient = prisma,
): Promise<{ migratedVersionIds: string[] }> {
  const page = await prismaClient.cmsPage.findUnique({
    where: { slug: "trade-solutions" },
    select: {
      id: true,
      draftVersionId: true,
      publishedVersionId: true,
      seoTitle: true,
      metaDescription: true,
    },
  });
  if (!page) return { migratedVersionIds: [] };

  const seoData: { seoTitle?: string; metaDescription?: string } = {};
  if (page.seoTitle === LEGACY_TRADE_SOLUTIONS_SEO.seoTitle) seoData.seoTitle = TRADE_SOLUTIONS_PAGE_TITLE;
  if (page.metaDescription === LEGACY_TRADE_SOLUTIONS_SEO.metaDescription) {
    seoData.metaDescription = TRADE_SOLUTIONS_PAGE_DESCRIPTION;
  }
  if (seoData.seoTitle || seoData.metaDescription) {
    await prismaClient.cmsPage.update({ where: { id: page.id }, data: seoData });
    await prismaClient.cmsPageVersion.updateMany({
      where: {
        pageId: page.id,
        AND: [
          { OR: [{ seoTitle: LEGACY_TRADE_SOLUTIONS_SEO.seoTitle }, { seoTitle: null }] },
          {
            OR: [
              { metaDescription: LEGACY_TRADE_SOLUTIONS_SEO.metaDescription },
              { metaDescription: null },
            ],
          },
        ],
      },
      data: seoData,
    });
  }

  const brandsPage = await prismaClient.cmsPage.findUnique({
    where: { slug: "brands" },
    select: {
      publishedVersion: {
        select: {
          sections: {
            where: { type: "BRANDS_SHOWCASE" },
            take: 1,
            select: { config: true },
          },
        },
      },
    },
  });
  const showcaseConfig = brandsPage?.publishedVersion?.sections[0]?.config ?? null;

  const versionIds = [...new Set([page.draftVersionId, page.publishedVersionId].filter((id): id is string => Boolean(id)))];
  const migratedVersionIds: string[] = [];

  for (const versionId of versionIds) {
    const sections = await prismaClient.cmsSection.findMany({
      where: { versionId },
      orderBy: { sortOrder: "asc" },
    });
    const existing = sections.find((section) => section.type === "TRADE_SOLUTIONS");
    if (existing) {
      const upgraded = upgradeMigratedTradeSolutions(parseTradeSolutionsContent(existing.config));
      if (!upgraded.changed) continue;
      const config = validateSectionConfig("TRADE_SOLUTIONS", upgraded.content);
      await prismaClient.cmsSection.update({
        where: { id: existing.id },
        data: { config: config as Prisma.InputJsonValue },
      });
      migratedVersionIds.push(versionId);
      continue;
    }

    const content = applyShowcaseBrandMedia(
      tradeSolutionsContentFromLegacy(
        sections.map((section) => ({
          type: section.type,
          config: section.config,
          enabled: section.enabled,
        })),
      ),
      showcaseConfig,
    );
    const config = validateSectionConfig("TRADE_SOLUTIONS", content);
    await prismaClient.$transaction(async (tx) => {
      await tx.cmsSection.deleteMany({ where: { versionId } });
      await tx.cmsSection.create({
        data: {
          versionId,
          type: "TRADE_SOLUTIONS",
          config: config as Prisma.InputJsonValue,
          sortOrder: 0,
          enabled: true,
        },
      });
    });
    migratedVersionIds.push(versionId);
  }

  return { migratedVersionIds };
}

/**
 * Move the Why Us page onto the company template once.
 * Leaves every other page alone and does not change publication status or team records.
 * A version that already has WHY_US is not overwritten.
 */
export async function ensureWhyUsSection(
  prismaClient: PrismaClient = prisma,
): Promise<{ migratedVersionIds: string[] }> {
  const page = await prismaClient.cmsPage.findUnique({
    where: { slug: "why-automotive-brands" },
    select: {
      id: true,
      draftVersionId: true,
      publishedVersionId: true,
      seoTitle: true,
      metaDescription: true,
    },
  });
  if (!page) return { migratedVersionIds: [] };

  const seoData: { seoTitle?: string; metaDescription?: string } = {};
  if (page.seoTitle === LEGACY_WHY_US_SEO.seoTitle) seoData.seoTitle = WHY_US_PAGE_TITLE;
  if (page.metaDescription === LEGACY_WHY_US_SEO.metaDescription) {
    seoData.metaDescription = WHY_US_PAGE_DESCRIPTION;
  }
  if (seoData.seoTitle || seoData.metaDescription) {
    await prismaClient.cmsPage.update({ where: { id: page.id }, data: seoData });
    await prismaClient.cmsPageVersion.updateMany({
      where: {
        pageId: page.id,
        AND: [
          { OR: [{ seoTitle: LEGACY_WHY_US_SEO.seoTitle }, { seoTitle: null }] },
          { OR: [{ metaDescription: LEGACY_WHY_US_SEO.metaDescription }, { metaDescription: null }] },
        ],
      },
      data: seoData,
    });
  }

  const brandsPage = await prismaClient.cmsPage.findUnique({
    where: { slug: "brands" },
    select: {
      publishedVersion: {
        select: { sections: { where: { type: "BRANDS_SHOWCASE" }, take: 1, select: { config: true } } },
      },
    },
  });
  const showcaseConfig = brandsPage?.publishedVersion?.sections[0]?.config ?? null;
  const versionIds = [...new Set([page.draftVersionId, page.publishedVersionId].filter((id): id is string => Boolean(id)))];
  const migratedVersionIds: string[] = [];

  for (const versionId of versionIds) {
    const sections = await prismaClient.cmsSection.findMany({
      where: { versionId },
      orderBy: { sortOrder: "asc" },
    });
    if (sections.some((section) => section.type === "WHY_US")) continue;
    const content = applyWhyUsBrandMedia(
      whyUsContentFromLegacy(
        sections.map((section) => ({ type: section.type, config: section.config, enabled: section.enabled })),
      ),
      showcaseConfig,
    );
    const config = validateSectionConfig("WHY_US", content);
    await prismaClient.$transaction(async (tx) => {
      await tx.cmsSection.deleteMany({ where: { versionId } });
      await tx.cmsSection.create({
        data: {
          versionId,
          type: "WHY_US",
          config: config as Prisma.InputJsonValue,
          sortOrder: 0,
          enabled: true,
        },
      });
    });
    migratedVersionIds.push(versionId);
  }

  return { migratedVersionIds };
}

/** Homepage + marketing pages used by production bootstrap and public loaders. */
export async function bootstrapPublicCms(
  prismaClient: PrismaClient = prisma,
): Promise<{ homepage: Awaited<ReturnType<typeof bootstrapHomepageCms>>; marketing: Awaited<ReturnType<typeof bootstrapMarketingCmsPages>> }> {
  const homepage = await bootstrapHomepageCms(prismaClient);
  const marketing = await bootstrapMarketingCmsPages(prismaClient);
  return { homepage, marketing };
}
