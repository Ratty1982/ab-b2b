/**
 * Operations → Sales Team — customer-facing SalesRep profile administration.
 * Does not manage User authentication (login, roles, passwords).
 */
import { ZodError } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAuthenticatedUser, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { cmsMediaPublicPath } from "@/lib/cms-media";
import {
  defaultSalesRepJobTitle,
  salesRepProfileUpdateSchema,
  telHrefFromPhone,
} from "@/domain/sales-rep-profile";
import {
  resolveAccountManagerForSalesRep,
  type AccountManagerPublic,
} from "@/server/sales/account-manager";

function canViewSalesTeam(profile: Awaited<ReturnType<typeof requireAuthenticatedUser>>) {
  return (
    hasPermission(profile, "sales.view_team_accounts") ||
    hasPermission(profile, "sales.view_all_accounts") ||
    hasPermission(profile, "reports.management") ||
    hasPermission(profile, "users.manage") ||
    hasPermission(profile, "admin.access")
  );
}

async function requireSalesTeamView(actorUserId: string) {
  const profile = await requireAuthenticatedUser(actorUserId);
  if (!canViewSalesTeam(profile)) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }
  return profile;
}

async function requireSalesTeamEdit(actorUserId: string) {
  return requireSystemPermission(actorUserId, "users.manage");
}

export type SalesRepAdminListItem = {
  id: string;
  code: string | null;
  active: boolean;
  customerContactEnabled: boolean;
  displayName: string | null;
  jobTitle: string | null;
  businessEmail: string | null;
  phone: string | null;
  mobile: string | null;
  resolvedName: string;
  resolvedJobTitle: string;
  resolvedEmail: string | null;
  user: { id: string; name: string | null; email: string; status: string };
  photoSrc: string | null;
  assignmentCount: number;
  linkedTeamMember: { id: string; isPublic: boolean } | null;
};

export type SalesRepAdminDetail = SalesRepAdminListItem & {
  photoMediaId: string | null;
  photoAlt: string | null;
  photoFocalX: number;
  photoFocalY: number;
  emailFallbackHint: string;
  customerPreview: AccountManagerPublic | null;
};

function mapListItem(rep: {
  id: string;
  code: string | null;
  active: boolean;
  customerContactEnabled: boolean;
  displayName: string | null;
  jobTitle: string | null;
  businessEmail: string | null;
  phone: string | null;
  mobile: string | null;
  photoMediaId: string | null;
  user: { id: string; name: string | null; email: string; status: string };
  photoMedia: { id: string } | null;
  publicTeamProfile: { id: string; isPublic: boolean } | null;
  _count: { assignments: number };
}): SalesRepAdminListItem {
  const resolvedName = rep.displayName?.trim() || rep.user.name?.trim() || rep.user.email;
  const resolvedEmail =
    rep.customerContactEnabled === false
      ? null
      : rep.businessEmail?.trim().toLowerCase() || rep.user.email.trim().toLowerCase();
  return {
    id: rep.id,
    code: rep.code,
    active: rep.active,
    customerContactEnabled: rep.customerContactEnabled,
    displayName: rep.displayName,
    jobTitle: rep.jobTitle,
    businessEmail: rep.businessEmail,
    phone: rep.phone,
    mobile: rep.mobile,
    resolvedName,
    resolvedJobTitle: defaultSalesRepJobTitle(rep.jobTitle),
    resolvedEmail,
    user: rep.user,
    photoSrc: rep.photoMedia ? cmsMediaPublicPath(rep.photoMedia.id) : null,
    assignmentCount: rep._count.assignments,
    linkedTeamMember: rep.publicTeamProfile
      ? { id: rep.publicTeamProfile.id, isPublic: rep.publicTeamProfile.isPublic }
      : null,
  };
}

export async function listSalesRepProfiles(actorUserId: string): Promise<SalesRepAdminListItem[]> {
  await requireSalesTeamView(actorUserId);
  const rows = await prisma.salesRep.findMany({
    orderBy: [{ active: "desc" }, { code: "asc" }],
    include: {
      user: { select: { id: true, name: true, email: true, status: true } },
      photoMedia: { select: { id: true } },
      publicTeamProfile: { select: { id: true, isPublic: true } },
      _count: { select: { assignments: true } },
    },
  });
  return rows.map(mapListItem);
}

export async function getSalesRepProfile(
  actorUserId: string,
  salesRepId: string,
): Promise<SalesRepAdminDetail> {
  await requireSalesTeamView(actorUserId);
  const rep = await prisma.salesRep.findUnique({
    where: { id: salesRepId },
    include: {
      user: { select: { id: true, name: true, email: true, status: true } },
      photoMedia: { select: { id: true } },
      publicTeamProfile: { select: { id: true, isPublic: true } },
      _count: { select: { assignments: true } },
    },
  });
  if (!rep) throw new AuthError("Sales representative not found", "NOT_FOUND", 404);

  const base = mapListItem(rep);
  const customerPreview = await resolveAccountManagerForSalesRep(rep.id);

  return {
    ...base,
    photoMediaId: rep.photoMediaId,
    photoAlt: rep.photoAlt,
    photoFocalX: rep.photoFocalX,
    photoFocalY: rep.photoFocalY,
    emailFallbackHint: `Falls back to login email ${rep.user.email} when business email is blank and customer contact is enabled.`,
    customerPreview,
  };
}

export async function updateSalesRepProfile(actorUserId: string, raw: unknown) {
  await requireSalesTeamEdit(actorUserId);

  let input;
  try {
    input = salesRepProfileUpdateSchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      throw new AuthError(first?.message || "Invalid profile", "VALIDATION", 400);
    }
    throw error;
  }

  const existing = await prisma.salesRep.findUnique({
    where: { id: input.id },
    include: {
      user: { select: { id: true, email: true, name: true } },
      photoMedia: { select: { id: true } },
    },
  });
  if (!existing) throw new AuthError("Sales representative not found", "NOT_FOUND", 404);

  if (input.photoMediaId) {
    const media = await prisma.cmsMedia.findUnique({
      where: { id: input.photoMediaId },
      select: { id: true },
    });
    if (!media) throw new AuthError("Profile photo not found", "VALIDATION", 400);
  }

  const nextDisplayName = input.displayName === undefined ? existing.displayName : input.displayName;
  const nextJobTitle = input.jobTitle === undefined ? existing.jobTitle : input.jobTitle;
  const nextBusinessEmail =
    input.businessEmail === undefined ? existing.businessEmail : input.businessEmail;
  const nextPhone = input.phone === undefined ? existing.phone : input.phone;
  const nextMobile = input.mobile === undefined ? existing.mobile : input.mobile;
  const nextPhotoMediaId =
    input.photoMediaId === undefined ? existing.photoMediaId : input.photoMediaId;
  const nextPhotoAlt = input.photoAlt === undefined ? existing.photoAlt : input.photoAlt;

  const updated = await prisma.salesRep.update({
    where: { id: existing.id },
    data: {
      displayName: nextDisplayName,
      jobTitle: nextJobTitle,
      businessEmail: nextBusinessEmail,
      phone: nextPhone,
      mobile: nextMobile,
      customerContactEnabled: input.customerContactEnabled,
      active: input.active,
      photoMediaId: nextPhotoMediaId,
      photoAlt: nextPhotoAlt,
      photoFocalX: input.photoFocalX ?? existing.photoFocalX,
      photoFocalY: input.photoFocalY ?? existing.photoFocalY,
    },
  });

  const changes: Record<string, unknown> = {};
  if ((existing.displayName ?? null) !== (updated.displayName ?? null)) {
    changes["displayName"] = { from: existing.displayName, to: updated.displayName };
  }
  if ((existing.jobTitle ?? null) !== (updated.jobTitle ?? null)) {
    changes["jobTitle"] = { from: existing.jobTitle, to: updated.jobTitle };
  }
  if ((existing.businessEmail ?? null) !== (updated.businessEmail ?? null)) {
    changes["businessEmail"] = { from: existing.businessEmail, to: updated.businessEmail };
  }
  if ((existing.phone ?? null) !== (updated.phone ?? null)) {
    changes["phone"] = { from: existing.phone, to: updated.phone };
  }
  if ((existing.mobile ?? null) !== (updated.mobile ?? null)) {
    changes["mobile"] = { from: existing.mobile, to: updated.mobile };
  }
  if (existing.customerContactEnabled !== updated.customerContactEnabled) {
    changes["customerContactEnabled"] = {
      from: existing.customerContactEnabled,
      to: updated.customerContactEnabled,
    };
  }
  if (existing.active !== updated.active) {
    changes["active"] = { from: existing.active, to: updated.active };
  }
  if ((existing.photoMediaId ?? null) !== (updated.photoMediaId ?? null)) {
    changes["photoMediaId"] = { from: existing.photoMediaId, to: updated.photoMediaId };
  }

  if (Object.keys(changes).length) {
    await recordAuditEvent({
      action: "sales_rep.profile_updated",
      entityType: "SalesRep",
      entityId: updated.id,
      actorUserId,
      metadata: changes,
    });
  }

  return getSalesRepProfile(actorUserId, updated.id);
}

/** Tiny helper exported for UI tests / previews. */
export function previewContactLinks(input: {
  email: string | null;
  phone: string | null;
  mobile: string | null;
}) {
  const mailto = input.email ? `mailto:${input.email}` : null;
  const tel = telHrefFromPhone(input.phone);
  const mobileTel = telHrefFromPhone(input.mobile);
  return {
    mailtoHref: mailto,
    telHref: tel,
    mobileTelHref: mobileTel,
    primaryContactHref: mailto || tel || mobileTel,
  };
}
