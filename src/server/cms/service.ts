import type { CmsSectionType, Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import {
  cmsPageUpdateSchema,
  cmsSectionInputSchema,
  validateSectionConfig,
  type CmsSectionTypeKey,
} from "@/domain/cms";
import { defaultHomepageSections } from "@/server/cms/homepage-seed";

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

export async function getCmsPageDraft(actorUserId: string, slug: string) {
  await requireSystemPermission(actorUserId, "cms.page.read");
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
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    seoTitle: page.seoTitle,
    metaDescription: page.metaDescription,
    status: page.status,
    publishedAt: page.publishedAt?.toISOString() ?? null,
    draftVersionId: page.draftVersionId,
    publishedVersionId: page.publishedVersionId,
    version: version
      ? {
          id: version.id,
          version: version.version,
          sections: version.sections.map((s) => ({
            id: s.id,
            type: s.type,
            config: s.config,
            sortOrder: s.sortOrder,
            enabled: s.enabled,
          })),
        }
      : null,
  };
}

/** Public: published version only. Returns null when nothing published. */
export async function getPublishedHomepage() {
  const page = await prisma.cmsPage.findUnique({
    where: { slug: "home" },
    include: {
      publishedVersion: {
        include: { sections: { orderBy: { sortOrder: "asc" }, where: { enabled: true } } },
      },
    },
  });
  if (!page?.publishedVersion) return null;
  return {
    title: page.title,
    seoTitle: page.seoTitle ?? page.publishedVersion.seoTitle,
    metaDescription: page.metaDescription ?? page.publishedVersion.metaDescription,
    sections: page.publishedVersion.sections.map((s) => ({
      id: s.id,
      type: s.type as CmsSectionTypeKey,
      config: s.config,
    })),
  };
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
  await requireSystemPermission(actorUserId, "cms.page.edit");
  const input = cmsPageUpdateSchema.parse(raw);
  const page = await prisma.cmsPage.update({
    where: { slug: input.slug },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle } : {}),
      ...(input.metaDescription !== undefined
        ? { metaDescription: input.metaDescription }
        : {}),
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
  await requireSystemPermission(actorUserId, "cms.page.edit");
  const page = await prisma.cmsPage.findUnique({ where: { slug } });
  if (!page) throw new AuthError("Page not found", "NOT_FOUND", 404);

  const draft = await ensureDraftVersion(page.id, actorUserId);
  const parsed = sections.map((s) => {
    const row = cmsSectionInputSchema.parse(s);
    const config = validateSectionConfig(row.type, row.config);
    return { ...row, config };
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
  const profile = await requireSystemPermission(actorUserId, "cms.page.publish");
  // Prefer granular; cms.publish still valid for MARKETING
  if (
    !hasPermission(profile, "cms.page.publish") &&
    !hasPermission(profile, "cms.publish")
  ) {
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
  await requireSystemPermission(actorUserId, "cms.page.edit");
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

/**
 * Idempotent homepage CMS bootstrap for production.
 * Creates home page + published seed sections if missing.
 */
export async function bootstrapHomepageCms(
  prismaClient: typeof prisma = prisma,
): Promise<{ created: boolean; pageId: string }> {
  const existing = await prismaClient.cmsPage.findUnique({ where: { slug: "home" } });
  if (existing?.publishedVersionId) {
    return { created: false, pageId: existing.id };
  }

  const sections = defaultHomepageSections();

  const page = await prismaClient.$transaction(async (tx) => {
    const p =
      existing ??
      (await tx.cmsPage.create({
        data: {
          slug: "home",
          title: "Homepage",
          seoTitle: "Automotive Brands — The brands behind the automotive aftermarket",
          metaDescription:
            "Trade supply of Power Maxed, Steel Seal, Street Rhino, Bramley Power and Kidzmotion to UK motor factors, retailers, workshops and distributors.",
          status: "DRAFT",
        },
      }));

    if (p.publishedVersionId) return p;

    const version = await tx.cmsPageVersion.create({
      data: {
        pageId: p.id,
        version: 1,
        label: "Phase 2 homepage seed",
        seoTitle: p.seoTitle,
        metaDescription: p.metaDescription,
        sections: {
          create: sections.map((s, i) => ({
            type: s.type,
            config: s.config as Prisma.InputJsonValue,
            sortOrder: i,
            enabled: true,
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
      },
    });
  });

  return { created: true, pageId: page.id };
}
