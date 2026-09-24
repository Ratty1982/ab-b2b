import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import {
  AuthError,
  requireSystemPermission,
} from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { cmsMediaPublicPath, cmsFocalStyle } from "@/lib/cms-media";
import {
  DEFAULT_TEAM_DEPARTMENTS,
  normalizeTeamDepartmentInput,
  normalizeTeamMemberInput,
  publicTeamBio,
  publicTeamJobTitle,
  teamDepartmentUpsertSchema,
  teamMemberDisplayName,
  teamMemberInitials,
  teamMemberListQuerySchema,
  teamMemberUpsertSchema,
} from "@/domain/team";

type Db = PrismaClient | Prisma.TransactionClient;

export async function bootstrapTeamDepartments(db: Db = prisma) {
  // Only seed when the table is empty so admin deletes of default departments stick.
  const existingCount = await db.teamDepartment.count();
  if (existingCount > 0) return { created: 0 };

  let created = 0;
  for (const dept of DEFAULT_TEAM_DEPARTMENTS) {
    await db.teamDepartment.create({
      data: {
        slug: dept.slug,
        name: dept.name,
        description: dept.description,
        sortOrder: dept.sortOrder,
        isPublic: true,
      },
    });
    created += 1;
  }
  return { created };
}

function photoSelect() {
  return {
    id: true,
    altText: true,
    width: true,
    height: true,
  } satisfies Prisma.CmsMediaSelect;
}

function memberAdminInclude() {
  return {
    department: { select: { id: true, name: true, slug: true, sortOrder: true, isPublic: true } },
    photoMedia: { select: photoSelect() },
    salesRep: {
      select: {
        id: true,
        code: true,
        active: true,
        user: { select: { id: true, name: true, email: true } },
      },
    },
  } satisfies Prisma.TeamMemberInclude;
}

function serializePhoto(
  media: { id: string; altText: string | null; width: number | null; height: number | null } | null,
  alt: string | null,
  focalX: number,
  focalY: number,
) {
  if (!media) return null;
  return {
    mediaId: media.id,
    src: cmsMediaPublicPath(media.id),
    alt: alt || media.altText || "",
    width: media.width,
    height: media.height,
    focalX,
    focalY,
    objectPosition: cmsFocalStyle({ focalX, focalY }).objectPosition as string,
  };
}

function serializeAdminMember(
  row: Prisma.TeamMemberGetPayload<{ include: ReturnType<typeof memberAdminInclude> }>,
) {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: teamMemberDisplayName(row.firstName, row.lastName),
    initials: teamMemberInitials(row.firstName, row.lastName),
    jobTitle: row.jobTitle,
    bio: row.bio,
    email: row.email,
    phone: row.phone,
    linkedInUrl: row.linkedInUrl,
    sortOrder: row.sortOrder,
    isPublic: row.isPublic,
    isFeatured: row.isFeatured,
    isContactable: row.isContactable,
    departmentId: row.departmentId,
    department: row.department,
    photoMediaId: row.photoMediaId,
    photoAlt: row.photoAlt,
    photoFocalX: row.photoFocalX,
    photoFocalY: row.photoFocalY,
    photo: serializePhoto(row.photoMedia, row.photoAlt, row.photoFocalX, row.photoFocalY),
    salesRepId: row.salesRepId,
    salesRep: row.salesRep
      ? {
          id: row.salesRep.id,
          code: row.salesRep.code,
          active: row.salesRep.active,
          label: row.salesRep.user.name || row.salesRep.user.email,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Public-safe member shape — omits contact fields unless contactable. */
function serializePublicMember(
  row: Prisma.TeamMemberGetPayload<{
    include: {
      department: { select: { id: true; name: true; slug: true } };
      photoMedia: { select: ReturnType<typeof photoSelect> };
    };
  }>,
) {
  const displayName = teamMemberDisplayName(row.firstName, row.lastName);
  const photo = serializePhoto(row.photoMedia, row.photoAlt, row.photoFocalX, row.photoFocalY);
  const base = {
    id: row.id,
    displayName,
    initials: teamMemberInitials(row.firstName, row.lastName),
    jobTitle: publicTeamJobTitle(row.jobTitle),
    bio: publicTeamBio(row.bio),
    isFeatured: row.isFeatured,
    isContactable: row.isContactable,
    department: row.department
      ? { id: row.department.id, name: row.department.name, slug: row.department.slug }
      : null,
    photo: photo
      ? {
          ...photo,
          alt: photo.alt || displayName,
        }
      : null,
  };
  if (!row.isContactable) {
    return { ...base, email: null, phone: null, linkedInUrl: null };
  }
  return {
    ...base,
    email: row.email,
    phone: row.phone,
    linkedInUrl: row.linkedInUrl,
  };
}

export type PublicTeamMember = ReturnType<typeof serializePublicMember>;

export async function listPublicTeamPage() {
  await bootstrapTeamDepartments();
  const departments = await prisma.teamDepartment.findMany({
    where: {
      isPublic: true,
      members: { some: { isPublic: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      members: {
        where: { isPublic: true },
        orderBy: [{ sortOrder: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
        include: {
          department: { select: { id: true, name: true, slug: true } },
          photoMedia: { select: photoSelect() },
        },
      },
    },
  });

  return {
    departments: departments.map((dept) => ({
      id: dept.id,
      name: dept.name,
      slug: dept.slug,
      description: dept.description,
      members: dept.members.map(serializePublicMember),
    })),
  };
}

export async function listFeaturedPublicTeamMembers(limit = 4) {
  await bootstrapTeamDepartments();
  const rows = await prisma.teamMember.findMany({
    where: {
      isPublic: true,
      isFeatured: true,
      OR: [{ departmentId: null }, { department: { isPublic: true } }],
    },
    orderBy: [{ sortOrder: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    take: Math.min(12, Math.max(1, limit)),
    include: {
      department: { select: { id: true, name: true, slug: true } },
      photoMedia: { select: photoSelect() },
    },
  });
  return rows.map(serializePublicMember);
}

/**
 * Future Account Manager helper: resolve an optional public TeamMember for a SalesRep.
 * Returns null when no public profile is linked — portal AM UI continues without it.
 */
export async function getPublicTeamMemberForSalesRep(salesRepId: string) {
  const row = await prisma.teamMember.findFirst({
    where: {
      salesRepId,
      isPublic: true,
      OR: [{ departmentId: null }, { department: { isPublic: true } }],
    },
    include: {
      department: { select: { id: true, name: true, slug: true } },
      photoMedia: { select: photoSelect() },
    },
  });
  return row ? serializePublicMember(row) : null;
}

export async function listTeamDepartmentsAdmin(actorUserId: string) {
  await requireSystemPermission(actorUserId, "cms.page.read");
  await bootstrapTeamDepartments();
  const rows = await prisma.teamDepartment.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { members: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sortOrder,
    isPublic: row.isPublic,
    memberCount: row._count.members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function upsertTeamDepartment(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.page.edit");
  const input = normalizeTeamDepartmentInput(teamDepartmentUpsertSchema.parse(raw));

  if (input.id) {
    const before = await prisma.teamDepartment.findUnique({ where: { id: input.id } });
    if (!before) throw new AuthError("Department not found", "NOT_FOUND", 404);
    const clash = await prisma.teamDepartment.findFirst({
      where: { slug: input.slug, NOT: { id: input.id } },
    });
    if (clash) throw new AuthError("Department slug already in use", "CONFLICT", 409);
    const updated = await prisma.teamDepartment.update({
      where: { id: input.id },
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        sortOrder: input.sortOrder,
        isPublic: input.isPublic,
      },
    });
    await recordAuditEvent({
      action: "team.department_updated",
      entityType: "TeamDepartment",
      entityId: updated.id,
      actorUserId,
      before: { name: before.name, slug: before.slug, isPublic: before.isPublic },
      after: { name: updated.name, slug: updated.slug, isPublic: updated.isPublic },
    });
    return updated;
  }

  const clash = await prisma.teamDepartment.findUnique({ where: { slug: input.slug } });
  if (clash) throw new AuthError("Department slug already in use", "CONFLICT", 409);
  const created = await prisma.teamDepartment.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description,
      sortOrder: input.sortOrder,
      isPublic: input.isPublic,
    },
  });
  await recordAuditEvent({
    action: "team.department_created",
    entityType: "TeamDepartment",
    entityId: created.id,
    actorUserId,
    metadata: { slug: created.slug },
  });
  return created;
}

export async function listTeamMembersAdmin(actorUserId: string, rawQuery: unknown) {
  await requireSystemPermission(actorUserId, "cms.page.read");
  await bootstrapTeamDepartments();
  const query = teamMemberListQuerySchema.parse(rawQuery ?? {});
  const where: Prisma.TeamMemberWhereInput = {};
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.visibility === "public") where.isPublic = true;
  if (query.visibility === "hidden") where.isPublic = false;
  if (query.q) {
    const q = query.q;
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { jobTitle: { contains: q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.teamMember.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    include: memberAdminInclude(),
  });
  return rows.map(serializeAdminMember);
}

export async function getTeamMemberAdmin(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "cms.page.read");
  const row = await prisma.teamMember.findUnique({
    where: { id },
    include: memberAdminInclude(),
  });
  if (!row) throw new AuthError("Team member not found", "NOT_FOUND", 404);
  return serializeAdminMember(row);
}

export async function upsertTeamMember(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "cms.page.edit");
  const input = normalizeTeamMemberInput(teamMemberUpsertSchema.parse(raw));

  if (input.departmentId) {
    const dept = await prisma.teamDepartment.findUnique({ where: { id: input.departmentId } });
    if (!dept) throw new AuthError("Department not found", "NOT_FOUND", 404);
  }
  if (input.photoMediaId) {
    const media = await prisma.cmsMedia.findUnique({ where: { id: input.photoMediaId } });
    if (!media) throw new AuthError("Photo media not found", "NOT_FOUND", 404);
  }
  if (input.salesRepId) {
    const rep = await prisma.salesRep.findUnique({ where: { id: input.salesRepId } });
    if (!rep) throw new AuthError("Sales rep not found", "NOT_FOUND", 404);
    const linked = await prisma.teamMember.findFirst({
      where: {
        salesRepId: input.salesRepId,
        ...(input.id ? { NOT: { id: input.id } } : {}),
      },
    });
    if (linked) {
      throw new AuthError("That sales rep is already linked to another team member", "CONFLICT", 409);
    }
  }

  const data: Prisma.TeamMemberUncheckedCreateInput = {
    firstName: input.firstName,
    lastName: input.lastName,
    jobTitle: input.jobTitle,
    bio: input.bio,
    email: input.email,
    phone: input.phone,
    linkedInUrl: input.linkedInUrl,
    sortOrder: input.sortOrder,
    isPublic: input.isPublic,
    isFeatured: input.isFeatured,
    isContactable: input.isContactable,
    departmentId: input.departmentId,
    photoMediaId: input.photoMediaId,
    photoAlt: input.photoAlt,
    photoFocalX: input.photoFocalX,
    photoFocalY: input.photoFocalY,
    salesRepId: input.salesRepId,
  };

  if (input.id) {
    const before = await prisma.teamMember.findUnique({ where: { id: input.id } });
    if (!before) throw new AuthError("Team member not found", "NOT_FOUND", 404);
    const updated = await prisma.teamMember.update({
      where: { id: input.id },
      data,
      include: memberAdminInclude(),
    });
    await recordAuditEvent({
      action: "team.member_updated",
      entityType: "TeamMember",
      entityId: updated.id,
      actorUserId: profile.userId,
      before: {
        isPublic: before.isPublic,
        isFeatured: before.isFeatured,
        salesRepId: before.salesRepId,
      },
      after: {
        isPublic: updated.isPublic,
        isFeatured: updated.isFeatured,
        salesRepId: updated.salesRepId,
      },
      metadata: {
        name: teamMemberDisplayName(updated.firstName, updated.lastName),
        visibilityChanged: before.isPublic !== updated.isPublic,
        salesRepLinked: !before.salesRepId && Boolean(updated.salesRepId),
        salesRepUnlinked: Boolean(before.salesRepId) && !updated.salesRepId,
      },
    });
    if (before.isPublic !== updated.isPublic) {
      await recordAuditEvent({
        action: updated.isPublic ? "team.member_published" : "team.member_hidden",
        entityType: "TeamMember",
        entityId: updated.id,
        actorUserId: profile.userId,
      });
    }
    return serializeAdminMember(updated);
  }

  const created = await prisma.teamMember.create({
    data,
    include: memberAdminInclude(),
  });
  await recordAuditEvent({
    action: "team.member_created",
    entityType: "TeamMember",
    entityId: created.id,
    actorUserId: profile.userId,
    metadata: {
      name: teamMemberDisplayName(created.firstName, created.lastName),
      isPublic: created.isPublic,
      salesRepId: created.salesRepId,
    },
  });
  return serializeAdminMember(created);
}

export async function deleteTeamMember(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "cms.page.edit");
  const before = await prisma.teamMember.findUnique({ where: { id } });
  if (!before) throw new AuthError("Team member not found", "NOT_FOUND", 404);
  await prisma.teamMember.delete({ where: { id } });
  await recordAuditEvent({
    action: "team.member_deleted",
    entityType: "TeamMember",
    entityId: id,
    actorUserId,
    metadata: {
      name: teamMemberDisplayName(before.firstName, before.lastName),
      wasPublic: before.isPublic,
    },
  });
  return { ok: true as const, id };
}

export async function deleteTeamDepartment(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "cms.page.edit");
  const before = await prisma.teamDepartment.findUnique({
    where: { id },
    include: { _count: { select: { members: true } } },
  });
  if (!before) throw new AuthError("Department not found", "NOT_FOUND", 404);

  // Members keep their profiles; departmentId is SetNull via schema relation.
  await prisma.teamDepartment.delete({ where: { id } });
  await recordAuditEvent({
    action: "team.department_deleted",
    entityType: "TeamDepartment",
    entityId: id,
    actorUserId,
    metadata: {
      name: before.name,
      slug: before.slug,
      memberCount: before._count.members,
    },
  });
  return { ok: true as const, id, memberCount: before._count.members };
}

export async function assertCanManageTeam(actorUserId: string) {
  const profile = await requireSystemPermission(actorUserId, "cms.page.read");
  return {
    canEdit: hasPermission(profile, "cms.page.edit") || hasPermission(profile, "admin.access"),
  };
}
