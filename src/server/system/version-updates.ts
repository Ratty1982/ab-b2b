/**
 * Version Updates / What's New — Super Admin management + staff consumption.
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireAuthenticatedUser, requireSystemPermission } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import { SYSTEM_ROLE_KEYS } from "@/domain/permissions";
import {
  audienceLabel,
  audienceTargetsUser,
  defaultAudience,
  parseVersionUpdateAudience,
  parseVersionUpdateContent,
  sanitisePlainText,
  validateVersionLabel,
  type VersionUpdateAudience,
  type VersionUpdateContent,
} from "@/domain/version-updates";

async function requireVersionUpdatesManage(userId: string) {
  const profile = await requireSystemPermission(userId, "version_updates.manage");
  if (profile.actorType === "TRADE" || !profile.systemRoles.includes("SUPER_ADMIN")) {
    throw new AuthError("Only Super Admin can manage Version Updates", "FORBIDDEN", 403);
  }
  return profile;
}

async function requireInternalStaff(userId: string) {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Internal staff only", "FORBIDDEN", 403);
  }
  return profile;
}

function toAdminDto(row: {
  id: string;
  version: string;
  title: string;
  summary: string | null;
  content: unknown;
  status: string;
  audience: unknown;
  priority: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  updatedById: string | null;
  createdByName?: string | null;
}) {
  const audience = parseVersionUpdateAudience(row.audience);
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    summary: row.summary,
    content: parseVersionUpdateContent(row.content),
    status: row.status,
    audience,
    audienceLabel: audienceLabel(audience),
    priority: row.priority,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById,
    updatedById: row.updatedById,
    createdByName: row.createdByName ?? null,
  };
}

function toPublicDto(row: {
  id: string;
  version: string;
  title: string;
  summary: string | null;
  content: unknown;
  publishedAt: Date | null;
}) {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    summary: row.summary,
    content: parseVersionUpdateContent(row.content),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

const contentSchema = z.object({
  intro: z.string().max(4000).optional().default(""),
  sections: z
    .array(
      z.object({
        heading: z.string().max(200),
        body: z.string().max(8000),
      }),
    )
    .max(20)
    .default([]),
});

const audienceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("ALL_INTERNAL") }),
  z.object({
    mode: z.literal("ROLES"),
    roleKeys: z
      .array(z.string())
      .min(1)
      .max(20)
      .transform((keys) =>
        keys.filter((k): k is (typeof SYSTEM_ROLE_KEYS)[number] =>
          (SYSTEM_ROLE_KEYS as readonly string[]).includes(k),
        ),
      ),
  }),
]);

const upsertSchema = z.object({
  id: z.string().optional(),
  version: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  summary: z.string().max(500).optional().nullable(),
  content: contentSchema,
  audience: audienceSchema.optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

export async function listVersionUpdatesAdmin(
  actorUserId: string,
  raw?: { status?: string },
) {
  await requireVersionUpdatesManage(actorUserId);
  const status = raw?.status?.trim();
  const rows = await prisma.versionUpdate.findMany({
    where: {
      ...(status && ["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)
        ? { status: status as "DRAFT" | "PUBLISHED" | "ARCHIVED" }
        : {}),
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const creatorIds = [...new Set(rows.map((r) => r.createdById).filter(Boolean))] as string[];
  const creators = creatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const nameById = new Map(creators.map((u) => [u.id, u.name || u.email]));
  return rows.map((r) =>
    toAdminDto({
      ...r,
      createdByName: r.createdById ? nameById.get(r.createdById) ?? null : null,
    }),
  );
}

export async function getVersionUpdateAdmin(actorUserId: string, id: string) {
  await requireVersionUpdatesManage(actorUserId);
  const row = await prisma.versionUpdate.findUnique({ where: { id } });
  if (!row) throw new AuthError("Update not found", "NOT_FOUND", 404);
  return toAdminDto(row);
}

export async function upsertVersionUpdate(actorUserId: string, raw: unknown) {
  const profile = await requireVersionUpdatesManage(actorUserId);
  const input = upsertSchema.parse(raw);
  const versionError = validateVersionLabel(input.version);
  if (versionError) throw new AuthError(versionError, "VALIDATION", 400);

  const content: VersionUpdateContent = {
    intro: sanitisePlainText(input.content.intro ?? "", 4000),
    sections: (input.content.sections ?? [])
      .map((s) => ({
        heading: sanitisePlainText(s.heading, 200),
        body: sanitisePlainText(s.body, 8000),
      }))
      .filter((s) => s.heading || s.body),
  };
  if (!content.intro && !content.sections.length) {
    throw new AuthError("Add an intro or at least one section", "VALIDATION", 400);
  }

  const audience: VersionUpdateAudience = input.audience
    ? parseVersionUpdateAudience(input.audience)
    : defaultAudience();
  if (audience.mode === "ROLES" && !audience.roleKeys.length) {
    throw new AuthError("Select at least one role", "VALIDATION", 400);
  }

  const data = {
    version: input.version.trim(),
    title: sanitisePlainText(input.title, 200),
    summary: input.summary ? sanitisePlainText(input.summary, 500) : null,
    content: content as unknown as Prisma.InputJsonValue,
    audience: audience as unknown as Prisma.InputJsonValue,
    priority: input.priority ?? 0,
    updatedById: profile.userId,
  };

  if (input.id) {
    const existing = await prisma.versionUpdate.findUnique({ where: { id: input.id } });
    if (!existing) throw new AuthError("Update not found", "NOT_FOUND", 404);
    // Editing published content must NOT reset acknowledgements.
    const updated = await prisma.versionUpdate.update({
      where: { id: existing.id },
      data,
    });
    await recordAuditEvent({
      action: "version_update.updated",
      entityType: "VersionUpdate",
      entityId: updated.id,
      actorUserId: profile.userId,
      metadata: { version: updated.version, title: updated.title, status: updated.status },
    });
    return toAdminDto(updated);
  }

  const created = await prisma.versionUpdate.create({
    data: {
      ...data,
      status: "DRAFT",
      createdById: profile.userId,
    },
  });
  await recordAuditEvent({
    action: "version_update.created",
    entityType: "VersionUpdate",
    entityId: created.id,
    actorUserId: profile.userId,
    metadata: { version: created.version, title: created.title },
  });
  return toAdminDto(created);
}

export async function publishVersionUpdate(actorUserId: string, id: string) {
  const profile = await requireVersionUpdatesManage(actorUserId);
  const existing = await prisma.versionUpdate.findUnique({ where: { id } });
  if (!existing) throw new AuthError("Update not found", "NOT_FOUND", 404);
  if (existing.status === "ARCHIVED") {
    throw new AuthError("Archived updates cannot be published — create a new version", "VALIDATION", 400);
  }
  const updated = await prisma.versionUpdate.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      publishedAt: existing.publishedAt ?? new Date(),
      updatedById: profile.userId,
    },
  });
  await recordAuditEvent({
    action: "version_update.published",
    entityType: "VersionUpdate",
    entityId: updated.id,
    actorUserId: profile.userId,
    metadata: { version: updated.version, title: updated.title },
  });
  return toAdminDto(updated);
}

export async function archiveVersionUpdate(actorUserId: string, id: string) {
  const profile = await requireVersionUpdatesManage(actorUserId);
  const existing = await prisma.versionUpdate.findUnique({ where: { id } });
  if (!existing) throw new AuthError("Update not found", "NOT_FOUND", 404);
  const updated = await prisma.versionUpdate.update({
    where: { id },
    data: { status: "ARCHIVED", updatedById: profile.userId },
  });
  await recordAuditEvent({
    action: "version_update.archived",
    entityType: "VersionUpdate",
    entityId: updated.id,
    actorUserId: profile.userId,
    metadata: { version: updated.version, title: updated.title },
  });
  return toAdminDto(updated);
}

/** Preview DTO for Super Admin — does not publish or acknowledge. */
export async function previewVersionUpdate(actorUserId: string, id: string) {
  await requireVersionUpdatesManage(actorUserId);
  const row = await prisma.versionUpdate.findUnique({ where: { id } });
  if (!row) throw new AuthError("Update not found", "NOT_FOUND", 404);
  return {
    ...toPublicDto(row),
    status: row.status,
    audienceLabel: audienceLabel(parseVersionUpdateAudience(row.audience)),
    earlierUnreadCount: 0,
    isPreview: true as const,
  };
}

export async function getPendingWhatsNew(actorUserId: string) {
  const profile = await requireInternalStaff(actorUserId);
  const published = await prisma.versionUpdate.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  const eligible = published.filter((row) =>
    audienceTargetsUser(parseVersionUpdateAudience(row.audience), profile.systemRoles),
  );
  if (!eligible.length) return null;

  const reads = await prisma.versionUpdateRead.findMany({
    where: {
      userId: profile.userId,
      versionUpdateId: { in: eligible.map((e) => e.id) },
      acknowledgedAt: { not: null },
    },
    select: { versionUpdateId: true },
  });
  const ack = new Set(reads.map((r) => r.versionUpdateId));
  const unread = eligible.filter((e) => !ack.has(e.id));
  if (!unread.length) return null;

  const newest = unread[0]!;
  // Record firstSeen without acknowledging
  await prisma.versionUpdateRead.upsert({
    where: {
      versionUpdateId_userId: { versionUpdateId: newest.id, userId: profile.userId },
    },
    create: {
      versionUpdateId: newest.id,
      userId: profile.userId,
      firstSeenAt: new Date(),
    },
    update: {},
  });

  return {
    ...toPublicDto(newest),
    earlierUnreadCount: Math.max(0, unread.length - 1),
    isPreview: false as const,
  };
}

export async function acknowledgeWhatsNew(actorUserId: string, versionUpdateId: string) {
  const profile = await requireInternalStaff(actorUserId);
  const row = await prisma.versionUpdate.findUnique({ where: { id: versionUpdateId } });
  if (!row || row.status !== "PUBLISHED") {
    throw new AuthError("Update not found", "NOT_FOUND", 404);
  }
  if (!audienceTargetsUser(parseVersionUpdateAudience(row.audience), profile.systemRoles)) {
    throw new AuthError("Update not available", "FORBIDDEN", 403);
  }

  await prisma.versionUpdateRead.upsert({
    where: {
      versionUpdateId_userId: { versionUpdateId, userId: profile.userId },
    },
    create: {
      versionUpdateId,
      userId: profile.userId,
      firstSeenAt: new Date(),
      acknowledgedAt: new Date(),
    },
    update: { acknowledgedAt: new Date() },
  });

  return { ok: true as const };
}

export async function listWhatsNewHistory(actorUserId: string) {
  const profile = await requireInternalStaff(actorUserId);
  const published = await prisma.versionUpdate.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      version: true,
      title: true,
      summary: true,
      content: true,
      publishedAt: true,
      audience: true,
    },
  });
  const eligible = published.filter((row) =>
    audienceTargetsUser(parseVersionUpdateAudience(row.audience), profile.systemRoles),
  );
  const reads = await prisma.versionUpdateRead.findMany({
    where: {
      userId: profile.userId,
      versionUpdateId: { in: eligible.map((e) => e.id) },
    },
    select: { versionUpdateId: true, acknowledgedAt: true },
  });
  const ackById = new Map(reads.map((r) => [r.versionUpdateId, r.acknowledgedAt]));

  return {
    unreadCount: eligible.filter((e) => !ackById.get(e.id)).length,
    items: eligible.map((e) => ({
      ...toPublicDto(e),
      acknowledged: Boolean(ackById.get(e.id)),
    })),
  };
}

export async function getWhatsNewUnreadCount(actorUserId: string) {
  const history = await listWhatsNewHistory(actorUserId);
  return { unreadCount: history.unreadCount };
}

export async function getWhatsNewItem(actorUserId: string, id: string) {
  const profile = await requireInternalStaff(actorUserId);
  const row = await prisma.versionUpdate.findUnique({ where: { id } });
  if (!row || row.status !== "PUBLISHED") {
    throw new AuthError("Update not found", "NOT_FOUND", 404);
  }
  if (!audienceTargetsUser(parseVersionUpdateAudience(row.audience), profile.systemRoles)) {
    throw new AuthError("Update not available", "FORBIDDEN", 403);
  }
  return toPublicDto(row);
}
