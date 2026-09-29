/**
 * Operations → Sales Team — production SalesRep management.
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
  salesRepAssignCompanySchema,
  salesRepCreateSchema,
  salesRepProfileUpdateSchema,
  salesRepUnassignCompanySchema,
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

function parseOrThrow<T>(schema: { parse: (raw: unknown) => T }, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      throw new AuthError(first?.message || "Invalid input", "VALIDATION", 400);
    }
    throw error;
  }
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
  user: {
    id: string;
    name: string | null;
    email: string;
    status: string;
    roleLabels: string[];
  };
  photoSrc: string | null;
  /** Active companies with a CompanyAssignment to this SalesRep. */
  customerCount: number;
  assignmentCount: number;
  openCallbackTasks: number;
  openQuotes: number;
  linkedTeamMember: { id: string; isPublic: boolean } | null;
};

export type AssignedCompanyRow = {
  assignmentId: string;
  companyId: string;
  companyName: string;
  accountNumber: string | null;
  status: string;
  isPrimary: boolean;
};

export type SalesRepAdminDetail = SalesRepAdminListItem & {
  photoMediaId: string | null;
  photoAlt: string | null;
  photoFocalX: number;
  photoFocalY: number;
  emailFallbackHint: string;
  customerPreview: AccountManagerPublic | null;
  assignments: AssignedCompanyRow[];
};

export type LinkableUserOption = {
  id: string;
  name: string | null;
  email: string;
  status: string;
  roleLabels: string[];
};

export type CompanySearchOption = {
  id: string;
  name: string;
  accountNumber: string | null;
  status: string;
  primarySalesRepId: string | null;
  primarySalesRepName: string | null;
};

const salesRepListInclude = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      userRoles: { select: { role: { select: { key: true, name: true } } } },
    },
  },
  photoMedia: { select: { id: true } },
  publicTeamProfile: { select: { id: true, isPublic: true } },
  assignments: {
    select: {
      id: true,
      isPrimary: true,
      company: { select: { id: true, name: true, accountNumber: true, status: true } },
    },
  },
} as const;

type RepListRow = {
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
  user: {
    id: string;
    name: string | null;
    email: string;
    status: string;
    userRoles: Array<{ role: { key: string; name: string } }>;
  };
  photoMedia: { id: string } | null;
  publicTeamProfile: { id: string; isPublic: boolean } | null;
  assignments: Array<{
    id: string;
    isPrimary: boolean;
    company: { id: string; name: string; accountNumber: string | null; status: string };
  }>;
};

function roleLabels(user: RepListRow["user"]): string[] {
  return user.userRoles.map((r) => r.role.name).filter(Boolean);
}

function mapListItem(
  rep: RepListRow,
  counts: { openCallbackTasks: number; openQuotes: number },
): SalesRepAdminListItem {
  const resolvedName = rep.displayName?.trim() || rep.user.name?.trim() || rep.user.email;
  const resolvedEmail =
    rep.customerContactEnabled === false
      ? null
      : rep.businessEmail?.trim().toLowerCase() || rep.user.email.trim().toLowerCase();
  const currentPrimaryActive = rep.assignments.filter(
    (a) => a.isPrimary && a.company.status === "ACTIVE",
  );
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
    user: {
      id: rep.user.id,
      name: rep.user.name,
      email: rep.user.email,
      status: rep.user.status,
      roleLabels: roleLabels(rep.user),
    },
    photoSrc: rep.photoMedia ? cmsMediaPublicPath(rep.photoMedia.id) : null,
    customerCount: currentPrimaryActive.length,
    assignmentCount: rep.assignments.filter((a) => a.isPrimary).length,
    openCallbackTasks: counts.openCallbackTasks,
    openQuotes: counts.openQuotes,
    linkedTeamMember: rep.publicTeamProfile
      ? { id: rep.publicTeamProfile.id, isPublic: rep.publicTeamProfile.isPublic }
      : null,
  };
}

async function loadOperationalCounts(
  reps: Array<{ id: string; userId: string }>,
): Promise<Map<string, { openCallbackTasks: number; openQuotes: number }>> {
  const map = new Map<string, { openCallbackTasks: number; openQuotes: number }>();
  for (const r of reps) map.set(r.id, { openCallbackTasks: 0, openQuotes: 0 });
  if (reps.length === 0) return map;

  const userIds = reps.map((r) => r.userId);
  const repIds = reps.map((r) => r.id);

  const [callbackGroups, quoteGroups] = await Promise.all([
    prisma.task.groupBy({
      by: ["assigneeId"],
      where: {
        assigneeId: { in: userIds },
        status: "OPEN",
        title: "Call customer",
      },
      _count: { _all: true },
    }),
    prisma.quote.groupBy({
      by: ["salesRepIdSnapshot"],
      where: {
        salesRepIdSnapshot: { in: repIds },
        status: { in: ["DRAFT", "SENT", "VIEWED"] },
      },
      _count: { _all: true },
    }),
  ]);

  const userToRep = new Map(reps.map((r) => [r.userId, r.id]));
  for (const row of callbackGroups) {
    if (!row.assigneeId) continue;
    const repId = userToRep.get(row.assigneeId);
    if (!repId) continue;
    const cur = map.get(repId)!;
    cur.openCallbackTasks = row._count._all;
  }
  for (const row of quoteGroups) {
    if (!row.salesRepIdSnapshot) continue;
    const cur = map.get(row.salesRepIdSnapshot);
    if (!cur) continue;
    cur.openQuotes = row._count._all;
  }
  return map;
}

export async function listSalesRepProfiles(actorUserId: string): Promise<SalesRepAdminListItem[]> {
  await requireSalesTeamView(actorUserId);
  const rows = await prisma.salesRep.findMany({
    include: salesRepListInclude,
  });
  const counts = await loadOperationalCounts(rows.map((r) => ({ id: r.id, userId: r.userId })));
  const mapped = rows.map((rep) => mapListItem(rep, counts.get(rep.id) ?? { openCallbackTasks: 0, openQuotes: 0 }));
  mapped.sort((a, b) => a.resolvedName.localeCompare(b.resolvedName, "en", { sensitivity: "base" }));
  return mapped;
}

export async function getSalesRepProfile(
  actorUserId: string,
  salesRepId: string,
): Promise<SalesRepAdminDetail> {
  await requireSalesTeamView(actorUserId);
  const rep = await prisma.salesRep.findUnique({
    where: { id: salesRepId },
    include: salesRepListInclude,
  });
  if (!rep) throw new AuthError("Sales representative not found", "NOT_FOUND", 404);

  const counts = await loadOperationalCounts([{ id: rep.id, userId: rep.userId }]);
  const base = mapListItem(rep, counts.get(rep.id) ?? { openCallbackTasks: 0, openQuotes: 0 });
  const customerPreview = await resolveAccountManagerForSalesRep(rep.id);

  const assignments: AssignedCompanyRow[] = [...rep.assignments]
    .sort((a, b) => a.company.name.localeCompare(b.company.name, "en", { sensitivity: "base" }))
    .map((a) => ({
      assignmentId: a.id,
      companyId: a.company.id,
      companyName: a.company.name,
      accountNumber: a.company.accountNumber,
      status: a.company.status,
      isPrimary: a.isPrimary,
    }));

  return {
    ...base,
    photoMediaId: rep.photoMediaId,
    photoAlt: rep.photoAlt,
    photoFocalX: rep.photoFocalX,
    photoFocalY: rep.photoFocalY,
    emailFallbackHint: `Falls back to login email ${rep.user.email} when business email is blank and customer contact is enabled.`,
    customerPreview,
    assignments,
  };
}

export async function listLinkableUsersForSalesRep(
  actorUserId: string,
): Promise<LinkableUserOption[]> {
  await requireSalesTeamEdit(actorUserId);
  const rows = await prisma.user.findMany({
    where: {
      actorType: "INTERNAL",
      salesRep: null,
      status: { in: ["ACTIVE", "INVITED"] },
    },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      userRoles: { select: { role: { select: { name: true } } } },
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take: 500,
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    status: u.status,
    roleLabels: u.userRoles.map((r) => r.role.name),
  }));
}

export async function createSalesRep(actorUserId: string, raw: unknown): Promise<SalesRepAdminDetail> {
  await requireSalesTeamEdit(actorUserId);
  const input = parseOrThrow(salesRepCreateSchema, raw);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      email: true,
      name: true,
      actorType: true,
      status: true,
      salesRep: { select: { id: true } },
    },
  });
  if (!user || user.actorType !== "INTERNAL") {
    throw new AuthError("Select an internal staff user", "VALIDATION", 400);
  }
  if (user.salesRep) {
    throw new AuthError("That user already has a SalesRep profile", "VALIDATION", 400);
  }

  if (input.photoMediaId) {
    const media = await prisma.cmsMedia.findUnique({
      where: { id: input.photoMediaId },
      select: { id: true },
    });
    if (!media) throw new AuthError("Profile photo not found", "VALIDATION", 400);
  }

  const codeBase =
    user.email.split("@")[0]?.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toUpperCase() || "REP";
  const code = `${codeBase}-${user.id.slice(-4).toUpperCase()}`;

  const created = await prisma.salesRep.create({
    data: {
      userId: user.id,
      code,
      active: input.active ?? true,
      customerContactEnabled: input.customerContactEnabled ?? true,
      displayName: input.displayName ?? null,
      jobTitle: input.jobTitle ?? null,
      businessEmail: input.businessEmail ?? null,
      phone: input.phone ?? null,
      mobile: input.mobile ?? null,
      photoMediaId: input.photoMediaId ?? null,
      photoAlt: input.photoAlt ?? null,
    },
  });

  await recordAuditEvent({
    action: "sales_rep.created",
    entityType: "SalesRep",
    entityId: created.id,
    actorUserId,
    metadata: {
      userId: user.id,
      displayName: created.displayName,
      jobTitle: created.jobTitle,
      businessEmail: created.businessEmail,
      phone: created.phone,
      mobile: created.mobile,
      customerContactEnabled: created.customerContactEnabled,
      active: created.active,
      photoMediaId: created.photoMediaId,
    },
  });

  return getSalesRepProfile(actorUserId, created.id);
}

export async function updateSalesRepProfile(actorUserId: string, raw: unknown) {
  await requireSalesTeamEdit(actorUserId);
  const input = parseOrThrow(salesRepProfileUpdateSchema, raw);

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

export async function searchCompaniesForSalesAssignment(
  actorUserId: string,
  q: string,
): Promise<CompanySearchOption[]> {
  await requireSalesTeamEdit(actorUserId);
  const term = q.trim();
  if (term.length < 2) return [];

  const rows = await prisma.company.findMany({
    where: {
      status: { not: "CLOSED" },
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { tradingName: { contains: term, mode: "insensitive" } },
        { accountNumber: { contains: term, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      accountNumber: true,
      status: true,
      assignments: {
        where: { isPrimary: true },
        take: 1,
        select: {
          salesRepId: true,
          salesRep: {
            select: {
              displayName: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
    take: 25,
  });

  return rows.map((c) => {
    const primary = c.assignments[0];
    const repName =
      primary?.salesRep.displayName?.trim() ||
      primary?.salesRep.user.name?.trim() ||
      primary?.salesRep.user.email ||
      null;
    return {
      id: c.id,
      name: c.name,
      accountNumber: c.accountNumber,
      status: c.status,
      primarySalesRepId: primary?.salesRepId ?? null,
      primarySalesRepName: repName,
    };
  });
}

export async function assignCompanyToSalesRep(actorUserId: string, raw: unknown) {
  await requireSalesTeamEdit(actorUserId);
  const input = parseOrThrow(salesRepAssignCompanySchema, raw);

  const [rep, company] = await Promise.all([
    prisma.salesRep.findUnique({
      where: { id: input.salesRepId },
      select: {
        id: true,
        displayName: true,
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.company.findUnique({
      where: { id: input.companyId },
      select: { id: true, name: true, status: true },
    }),
  ]);
  if (!rep) throw new AuthError("Sales representative not found", "NOT_FOUND", 404);
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const existingPrimary = await prisma.companyAssignment.findFirst({
    where: { companyId: company.id, isPrimary: true },
    include: {
      salesRep: {
        select: {
          id: true,
          displayName: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });

  const repLabel = rep.displayName?.trim() || rep.user.name?.trim() || rep.user.email;

  if (existingPrimary?.salesRepId === rep.id) {
    return getSalesRepProfile(actorUserId, rep.id);
  }

  if (existingPrimary) {
    await prisma.$transaction(async (tx) => {
      // Keep historic non-primary rows; demote current primary then set the new one.
      await tx.companyAssignment.updateMany({
        where: { companyId: company.id, isPrimary: true },
        data: { isPrimary: false },
      });
      await tx.companyAssignment.upsert({
        where: {
          companyId_salesRepId: { companyId: company.id, salesRepId: rep.id },
        },
        create: { companyId: company.id, salesRepId: rep.id, isPrimary: true },
        update: { isPrimary: true },
      });
    });
    const fromLabel =
      existingPrimary.salesRep.displayName?.trim() ||
      existingPrimary.salesRep.user.name?.trim() ||
      existingPrimary.salesRep.user.email;
    await recordAuditEvent({
      action: "sales_rep.company_reassigned",
      entityType: "CompanyAssignment",
      entityId: company.id,
      actorUserId,
      companyId: company.id,
      metadata: {
        companyId: company.id,
        companyName: company.name,
        fromSalesRepId: existingPrimary.salesRepId,
        fromSalesRepName: fromLabel,
        toSalesRepId: rep.id,
        toSalesRepName: repLabel,
      },
    });
    await recordAuditEvent({
      action: "company.sales_rep_changed",
      entityType: "Company",
      entityId: company.id,
      actorUserId,
      companyId: company.id,
      before: {
        salesRepId: existingPrimary.salesRepId,
        salesRepName: fromLabel,
      },
      after: { salesRepId: rep.id, salesRepName: repLabel },
    });
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.companyAssignment.updateMany({
        where: { companyId: company.id, isPrimary: true },
        data: { isPrimary: false },
      });
      await tx.companyAssignment.upsert({
        where: {
          companyId_salesRepId: { companyId: company.id, salesRepId: rep.id },
        },
        create: { companyId: company.id, salesRepId: rep.id, isPrimary: true },
        update: { isPrimary: true },
      });
    });
    await recordAuditEvent({
      action: "sales_rep.company_assigned",
      entityType: "CompanyAssignment",
      entityId: company.id,
      actorUserId,
      companyId: company.id,
      metadata: {
        companyId: company.id,
        companyName: company.name,
        salesRepId: rep.id,
        salesRepName: repLabel,
      },
    });
    await recordAuditEvent({
      action: "company.sales_rep_changed",
      entityType: "Company",
      entityId: company.id,
      actorUserId,
      companyId: company.id,
      before: { salesRepId: null },
      after: { salesRepId: rep.id, salesRepName: repLabel },
    });
  }

  return getSalesRepProfile(actorUserId, rep.id);
}

export async function unassignCompanyFromSalesRep(actorUserId: string, raw: unknown) {
  await requireSalesTeamEdit(actorUserId);
  const input = parseOrThrow(salesRepUnassignCompanySchema, raw);

  const assignment = await prisma.companyAssignment.findUnique({
    where: {
      companyId_salesRepId: {
        companyId: input.companyId,
        salesRepId: input.salesRepId,
      },
    },
    include: {
      company: { select: { id: true, name: true } },
      salesRep: {
        select: {
          id: true,
          displayName: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!assignment) throw new AuthError("Assignment not found", "NOT_FOUND", 404);

  await prisma.companyAssignment.delete({ where: { id: assignment.id } });

  const repLabel =
    assignment.salesRep.displayName?.trim() ||
    assignment.salesRep.user.name?.trim() ||
    assignment.salesRep.user.email;

  await recordAuditEvent({
    action: "sales_rep.company_unassigned",
    entityType: "CompanyAssignment",
    entityId: assignment.company.id,
    actorUserId,
    companyId: assignment.company.id,
    metadata: {
      companyId: assignment.company.id,
      companyName: assignment.company.name,
      salesRepId: assignment.salesRep.id,
      salesRepName: repLabel,
      wasPrimary: assignment.isPrimary,
    },
  });

  return getSalesRepProfile(actorUserId, assignment.salesRep.id);
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
