import type { CmsSectionType, Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAuthenticatedUser, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import {
  cmsPageUpdateSchema,
  cmsSectionInputSchema,
  formatZodError,
  validateSectionConfig,
  type CmsSectionTypeKey,
} from "@/domain/cms";
import { listPublicBrandLogos } from "@/server/catalogue/service";
import { listPublicBrands } from "@/server/catalogue/products";
import { attachFeaturedBrandLogos } from "@/domain/featured-brands";
import { mergeBrandLogoMaps, readBrandLogos } from "@/lib/cms-media";
import {
  ensureBrandsShowcaseSection,
  ensureTradeSolutionsSection,
  ensureWhyUsSection,
} from "@/server/cms/system-bootstrap";

export async function listCmsPages(actorUserId: string) {
  await requireSystemPermission(actorUserId, "cms.page.read");
  const pages = await prisma.cmsPage.findMany({
    orderBy: { slug: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
      draftVersionId: true,
      publishedVersionId: true,
    },
  });
  return pages.map((p) => ({
    ...p,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    updatedAt: p.updatedAt.toISOString(),
    hasUnpublishedChanges: Boolean(
      p.draftVersionId && p.draftVersionId !== p.publishedVersionId,
    ),
  }));
}

function cmsViewKey(slug: string): "cms.homepage.view" | "cms.page.read" {
  return slug === "home" ? "cms.homepage.view" : "cms.page.read";
}

function cmsEditKey(slug: string): "cms.homepage.edit" | "cms.page.edit" {
  return slug === "home" ? "cms.homepage.edit" : "cms.page.edit";
}

export async function getCmsPageDraft(actorUserId: string, slug: string) {
  await requireSystemPermission(actorUserId, cmsViewKey(slug));
  if (slug === "brands") await ensureBrandsShowcaseSection();
  if (slug === "trade-solutions") await ensureTradeSolutionsSection();
  if (slug === "why-automotive-brands") await ensureWhyUsSection();
  const page = await prisma.cmsPage.findUnique({
    where: { slug },
    include: {
      draftVersion: {
        include: { sections: { orderBy: { sortOrder: "asc" } } },
      },
      publishedVersion: {
        include: { sections: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!page) throw new AuthError("Page not found", "NOT_FOUND", 404);

  const version = page.draftVersion ?? page.publishedVersion;
  let catalogueLogos: Awaited<ReturnType<typeof listPublicBrandLogos>> = {};
  let catalogueBrands: Array<{ slug: string; name: string }> = [];
  try {
    catalogueLogos = await listPublicBrandLogos();
    catalogueBrands = (await listPublicBrands()).map((b) => ({ slug: b.slug, name: b.name }));
  } catch (error) {
    console.error("[ab:cms] brand logos unavailable", error);
  }
  const latestPublish = await prisma.cmsPublishEvent.findFirst({
    where: { pageId: page.id },
    orderBy: { createdAt: "desc" },
  });
  const versions = await prisma.cmsPageVersion.findMany({
    where: { pageId: page.id },
    orderBy: { version: "desc" },
    take: 20,
    select: { id: true, version: true, label: true, createdAt: true, createdById: true },
  });
  const userIds = [
    ...new Set(
      [page.updatedById, page.createdById, latestPublish?.publishedById, ...versions.map((v) => v.createdById)].filter(
        Boolean,
      ) as string[],
    ),
  ];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const nameOf = (id: string | null | undefined) => {
    if (!id) return null;
    const u = users.find((row) => row.id === id);
    return u?.name?.trim() || u?.email || null;
  };

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    seoTitle: page.seoTitle,
    metaDescription: page.metaDescription,
    ogImageMediaId: page.ogImageMediaId,
    ogImageSrc: page.ogImageMediaId ? `/api/cms-media/${page.ogImageMediaId}` : null,
    status: page.status,
    publishedAt: page.publishedAt?.toISOString() ?? null,
    publishedByName: nameOf(latestPublish?.publishedById),
    draftSavedAt: page.updatedAt.toISOString(),
    draftSavedByName: nameOf(page.updatedById),
    hasUnpublishedChanges: Boolean(page.draftVersionId && page.draftVersionId !== page.publishedVersionId),
    draftVersionId: page.draftVersionId,
    publishedVersionId: page.publishedVersionId,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      label: v.label,
      createdAt: v.createdAt.toISOString(),
      createdByName: nameOf(v.createdById),
      isDraft: v.id === page.draftVersionId,
      isPublished: v.id === page.publishedVersionId,
    })),
    version: version
      ? {
          id: version.id,
          version: version.version,
          sections: version.sections.map((s) => ({
            id: s.id,
            type: s.type,
            config: attachBrandLogos(
              s.type as CmsSectionTypeKey,
              s.config,
              catalogueLogos,
              catalogueBrands,
            ),
            sortOrder: s.sortOrder,
            enabled: s.enabled,
          })),
        }
      : null,
  };
}

/** Public: published version only. Returns null when nothing published. */
export async function getPublishedHomepage() {
  return getPublishedCmsPage("home");
}

/** Public: any published CMS page by slug. Returns null when missing/unpublished. */
export async function getPublishedCmsPage(slug: string) {
  const page = await prisma.cmsPage.findUnique({
    where: { slug },
    include: {
      publishedVersion: {
        include: { sections: { orderBy: { sortOrder: "asc" }, where: { enabled: true } } },
      },
    },
  });
  if (!page?.publishedVersion) return null;
  let catalogueLogos: Awaited<ReturnType<typeof listPublicBrandLogos>> = {};
  let catalogueBrands: Array<{ slug: string; name: string }> = [];
  try {
    catalogueLogos = await listPublicBrandLogos();
    catalogueBrands = (await listPublicBrands()).map((b) => ({ slug: b.slug, name: b.name }));
  } catch (error) {
    console.error("[ab:cms] brand logos unavailable", error);
  }
  return {
    slug: page.slug,
    title: page.title,
    seoTitle: page.seoTitle ?? page.publishedVersion.seoTitle,
    metaDescription: page.metaDescription ?? page.publishedVersion.metaDescription,
    ogImageSrc: page.ogImageMediaId ? `/api/cms-media/${page.ogImageMediaId}` : null,
    sections: page.publishedVersion.sections.map((s) => {
      const withLogos = attachBrandLogos(s.type, s.config, catalogueLogos, catalogueBrands);
      return {
        id: s.id,
        type: s.type as CmsSectionTypeKey,
        config: (withLogos && typeof withLogos === "object" && !Array.isArray(withLogos)
          ? withLogos
          : {}) as { [key: string]: import("@/domain/homepage").HomepageJson },
      };
    }),
  };
}

function attachBrandLogos(
  type: CmsSectionTypeKey,
  config: Prisma.JsonValue,
  catalogueLogos: Awaited<ReturnType<typeof listPublicBrandLogos>>,
  catalogueBrands: Array<{ slug: string; name: string }> = [],
): Prisma.JsonValue {
  if (type !== "FEATURED_BRANDS" && type !== "BRAND_LOGO_STRIP") return config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;
  const record = config as Record<string, unknown>;
  if (type === "FEATURED_BRANDS") {
    return attachFeaturedBrandLogos(record, catalogueLogos) as Prisma.JsonValue;
  }
  const logos = mergeBrandLogoMaps(readBrandLogos(record), catalogueLogos);
  return { ...record, logos, catalogueBrands };
}

async function ensureDraftVersion(pageId: string, actorUserId: string) {
  const page = await prisma.cmsPage.findUniqueOrThrow({
    where: { id: pageId },
    include: {
      draftVersion: { include: { sections: { orderBy: { sortOrder: "asc" } } } },
      publishedVersion: { include: { sections: { orderBy: { sortOrder: "asc" } } } },
    },
  });

  if (page.draftVersionId && page.draftVersion) {
    // If draft is same as published, fork a new draft version
    if (page.draftVersionId === page.publishedVersionId) {
      return forkDraftFrom(page, actorUserId);
    }
    return page.draftVersion;
  }

  if (page.publishedVersion) {
    return forkDraftFrom(page, actorUserId);
  }

  const version = await prisma.cmsPageVersion.create({
    data: {
      pageId: page.id,
      version: 1,
      label: "Initial draft",
      seoTitle: page.seoTitle,
      metaDescription: page.metaDescription,
      createdById: actorUserId,
    },
    include: { sections: true },
  });
  await prisma.cmsPage.update({
    where: { id: page.id },
    data: { draftVersionId: version.id, updatedById: actorUserId },
  });
  return version;
}

async function forkDraftFrom(
  page: {
    id: string;
    seoTitle: string | null;
    metaDescription: string | null;
    publishedVersion: {
      version: number;
      seoTitle: string | null;
      metaDescription: string | null;
      sections: Array<{
        type: CmsSectionType;
        config: Prisma.JsonValue;
        sortOrder: number;
        enabled: boolean;
      }>;
    } | null;
    draftVersion: {
      version: number;
      seoTitle: string | null;
      metaDescription: string | null;
      sections: Array<{
        type: CmsSectionType;
        config: Prisma.JsonValue;
        sortOrder: number;
        enabled: boolean;
      }>;
    } | null;
  },
  actorUserId: string,
) {
  const source = page.draftVersion ?? page.publishedVersion;
  const nextVersion = (source?.version ?? 0) + 1;
  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.cmsPageVersion.create({
      data: {
        pageId: page.id,
        version: nextVersion,
        label: `Draft v${nextVersion}`,
        seoTitle: source?.seoTitle ?? page.seoTitle,
        metaDescription: source?.metaDescription ?? page.metaDescription,
        createdById: actorUserId,
        ...(source
          ? {
              sections: {
                create: source.sections.map((s) => ({
                  type: s.type,
                  config: s.config as Prisma.InputJsonValue,
                  sortOrder: s.sortOrder,
                  enabled: s.enabled,
                })),
              },
            }
          : {}),
      },
      include: { sections: { orderBy: { sortOrder: "asc" } } },
    });
    await tx.cmsPage.update({
      where: { id: page.id },
      data: { draftVersionId: created.id, updatedById: actorUserId, status: "DRAFT" },
    });
    return created;
  });
  return version;
}

export async function updateCmsPageMeta(actorUserId: string, raw: unknown) {
  const input = cmsPageUpdateSchema.parse(raw);
  await requireSystemPermission(actorUserId, cmsEditKey(input.slug));
  const page = await prisma.cmsPage.update({
    where: { slug: input.slug },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle } : {}),
      ...(input.metaDescription !== undefined
        ? { metaDescription: input.metaDescription }
        : {}),
      ...(input.ogImageMediaId !== undefined ? { ogImageMediaId: input.ogImageMediaId } : {}),
      updatedById: actorUserId,
    },
  });
  await ensureDraftVersion(page.id, actorUserId);
  return page;
}

export async function saveCmsDraftSections(
  actorUserId: string,
  slug: string,
  sections: unknown[],
) {
  await requireSystemPermission(actorUserId, cmsEditKey(slug));
  const page = await prisma.cmsPage.findUnique({ where: { slug } });
  if (!page) throw new AuthError("Page not found", "NOT_FOUND", 404);

  const draft = await ensureDraftVersion(page.id, actorUserId);
  const parsed = sections.map((s, index) => {
    const row = cmsSectionInputSchema.safeParse(s);
    if (!row.success) {
      throw new AuthError(
        `Section ${index + 1}: ${formatZodError(row.error) ?? "Invalid section"}`,
        "VALIDATION",
        400,
      );
    }
    try {
      const config = validateSectionConfig(row.data.type, row.data.config);
      return { ...row.data, config };
    } catch (error) {
      const detail = formatZodError(error) ?? (error instanceof Error ? error.message : "Invalid section config");
      throw new AuthError(
        `Section ${index + 1} (${row.data.type.replaceAll("_", " ")}): ${detail}`,
        "VALIDATION",
        400,
      );
    }
  });

  await prisma.$transaction(async (tx) => {
    await tx.cmsSection.deleteMany({ where: { versionId: draft.id } });
    if (parsed.length) {
      await tx.cmsSection.createMany({
        data: parsed.map((s, i) => ({
          versionId: draft.id,
          type: s.type,
          config: s.config as Prisma.InputJsonValue,
          sortOrder: i,
          enabled: s.enabled,
        })),
      });
    }
    await tx.cmsPage.update({
      where: { id: page.id },
      data: { updatedById: actorUserId, status: "DRAFT" },
    });
  });

  await recordAuditEvent({
    action: "cms.draft_saved",
    entityType: "CmsPage",
    entityId: page.id,
    actorUserId,
    metadata: { slug, sectionCount: parsed.length },
  });

  return getCmsPageDraft(actorUserId, slug);
}

export async function publishCmsPage(actorUserId: string, slug: string, note?: string) {
  const profile = await requireAuthenticatedUser(actorUserId);
  if (
    !hasPermission(profile, "cms.page.publish") &&
    !hasPermission(profile, "cms.publish")
  ) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }
  if (slug === "home" && !hasPermission(profile, "cms.homepage.edit")) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }
  if (slug !== "home" && !hasPermission(profile, "cms.page.edit") && !hasPermission(profile, "cms.edit")) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }

  const page = await prisma.cmsPage.findUnique({ where: { slug } });
  if (!page) throw new AuthError("Page not found", "NOT_FOUND", 404);
  if (!page.draftVersionId) throw new AuthError("No draft to publish", "VALIDATION", 400);

  const published = await prisma.$transaction(async (tx) => {
    const updated = await tx.cmsPage.update({
      where: { id: page.id },
      data: {
        publishedVersionId: page.draftVersionId,
        status: "PUBLISHED",
        publishedAt: new Date(),
        updatedById: actorUserId,
      },
    });
    await tx.cmsPublishEvent.create({
      data: {
        pageId: page.id,
        versionId: page.draftVersionId!,
        publishedById: actorUserId,
        note: note ?? null,
      },
    });
    return updated;
  });

  await recordAuditEvent({
    action: "cms.published",
    entityType: "CmsPage",
    entityId: page.id,
    actorUserId,
    metadata: { slug, versionId: page.draftVersionId },
  });

  return {
    id: published.id,
    slug: published.slug,
    status: published.status,
    publishedAt: published.publishedAt?.toISOString() ?? null,
  };
}

export async function restoreCmsVersion(actorUserId: string, slug: string, versionId: string) {
  await requireSystemPermission(actorUserId, cmsEditKey(slug));
  const page = await prisma.cmsPage.findUnique({ where: { slug } });
  if (!page) throw new AuthError("Page not found", "NOT_FOUND", 404);

  const version = await prisma.cmsPageVersion.findFirst({
    where: { id: versionId, pageId: page.id },
    include: { sections: { orderBy: { sortOrder: "asc" } } },
  });
  if (!version) throw new AuthError("Version not found", "NOT_FOUND", 404);

  // Fork restored content into a new draft
  const forked = await prisma.$transaction(async (tx) => {
    const latest = await tx.cmsPageVersion.findFirst({
      where: { pageId: page.id },
      orderBy: { version: "desc" },
    });
    const created = await tx.cmsPageVersion.create({
      data: {
        pageId: page.id,
        version: (latest?.version ?? 0) + 1,
        label: `Restored from v${version.version}`,
        seoTitle: version.seoTitle,
        metaDescription: version.metaDescription,
        createdById: actorUserId,
        sections: {
          create: version.sections.map((s) => ({
            type: s.type,
            config: s.config as Prisma.InputJsonValue,
            sortOrder: s.sortOrder,
            enabled: s.enabled,
          })),
        },
      },
    });
    await tx.cmsPage.update({
      where: { id: page.id },
      data: { draftVersionId: created.id, status: "DRAFT", updatedById: actorUserId },
    });
    return created;
  });

  await recordAuditEvent({
    action: "cms.version_restored",
    entityType: "CmsPage",
    entityId: page.id,
    actorUserId,
    metadata: { fromVersionId: versionId, newDraftId: forked.id },
  });

  return getCmsPageDraft(actorUserId, slug);
}

export {
  bootstrapHomepageCms,
  bootstrapMarketingCmsPages,
  bootstrapPublicCms,
  ensureBrandsShowcaseSection,
  ensureTradeSolutionsSection,
  ensureWhyUsSection,
} from "@/server/cms/system-bootstrap";
