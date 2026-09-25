import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import type { SystemRoleKey } from "@/domain/permissions";
import { SYSTEM_ROLE_META } from "@/domain/role-permissions";
import { generateInviteToken } from "@/domain/invitation";
import {
  internalUserCreateSchema,
  internalUserPasswordResetSchema,
  internalUserUpdateSchema,
  staffUserDeleteSchema,
  staffUserIdSchema,
} from "@/domain/users";
import { formatDateTime } from "@/lib/datetime";

export type StaffInvitationStatus =
  | "NONE"
  | "PENDING"
  | "SENT"
  | "DEFERRED"
  | "EXPIRED"
  | "ACCEPTED";

export type StaffUserRecord = {
  id: string;
  name: string;
  email: string;
  role: SystemRoleKey | null;
  roleLabel: string;
  status: string;
  actorType: string;
  createdAt: string;
  lastLoginAt: string | null;
  invitationStatus: StaffInvitationStatus;
  invitationExpiresAt: string | null;
  invitationCreatedAt: string | null;
  invitationLabel: string;
  /** Disposable invite — delete without transfer. */
  canHardDelete: boolean;
  /** Has history — delete allowed only after transferring ownership. */
  requiresTransferToDelete: boolean;
  deletionReasons: string[];
  canResendInvitation: boolean;
  canSendPasswordReset: boolean;
};

function generateTemporaryPassword(): string {
  return `Ab-${randomBytes(9).toString("base64url")}`;
}

function roleLabel(key: string | null): string {
  if (key && key in SYSTEM_ROLE_META) {
    return SYSTEM_ROLE_META[key as SystemRoleKey].name;
  }
  return key ?? "No role";
}

function invitationLabel(input: {
  userStatus: string;
  invite: {
    status: string;
    emailDeferred: boolean;
    expiresAt: Date;
    createdAt: Date;
  } | null;
}): { invitationStatus: StaffInvitationStatus; invitationLabel: string } {
  if (input.userStatus === "ACTIVE") {
    return { invitationStatus: "ACCEPTED", invitationLabel: "Active" };
  }
  if (input.userStatus === "DISABLED") {
    return { invitationStatus: "NONE", invitationLabel: "Disabled" };
  }
  const invite = input.invite;
  if (!invite) {
    return { invitationStatus: "NONE", invitationLabel: "Invite pending" };
  }
  if (invite.status === "ACCEPTED") {
    return { invitationStatus: "ACCEPTED", invitationLabel: "Active" };
  }
  if (invite.status === "EXPIRED" || invite.expiresAt.getTime() < Date.now()) {
    return { invitationStatus: "EXPIRED", invitationLabel: "Invite expired" };
  }
  if (invite.status === "PENDING") {
    if (invite.emailDeferred) {
      return { invitationStatus: "DEFERRED", invitationLabel: "Invite pending" };
    }
    const sent = formatDateTime(invite.createdAt, { seconds: false });
    return {
      invitationStatus: "SENT",
      invitationLabel: sent ? `Invite sent ${sent}` : "Invite sent",
    };
  }
  return { invitationStatus: "NONE", invitationLabel: "Invite pending" };
}

function mapUser(
  user: {
    id: string;
    name: string | null;
    email: string;
    status: string;
    actorType: string;
    createdAt: Date;
    lastLoginAt: Date | null;
    userRoles: Array<{ role: { key: string } }>;
    invitations?: Array<{
      status: string;
      emailDeferred: boolean;
      expiresAt: Date;
      createdAt: Date;
    }>;
  },
  deletion: { safe: boolean; reasons: string[] },
): StaffUserRecord {
  const role = (user.userRoles[0]?.role.key as SystemRoleKey | undefined) ?? null;
  const pendingInvite =
    user.invitations?.find((i) => i.status === "PENDING") ??
    user.invitations?.[0] ??
    null;
  const inv = invitationLabel({ userStatus: user.status, invite: pendingInvite });
  return {
    id: user.id,
    name: user.name?.trim() || user.email.split("@")[0] || user.email,
    email: user.email,
    role,
    roleLabel: roleLabel(role),
    status: user.status,
    actorType: user.actorType,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    invitationStatus: inv.invitationStatus,
    invitationExpiresAt: pendingInvite?.expiresAt.toISOString() ?? null,
    invitationCreatedAt: pendingInvite?.createdAt.toISOString() ?? null,
    invitationLabel: inv.invitationLabel,
    canHardDelete: deletion.safe,
    requiresTransferToDelete: !deletion.safe,
    deletionReasons: deletion.reasons,
    canResendInvitation: user.status === "INVITED",
    canSendPasswordReset: user.status === "ACTIVE",
  };
}

const staffInclude = {
  userRoles: { include: { role: true }, take: 8 },
  invitations: {
    where: { kind: "STAFF_USER" as const },
    orderBy: { createdAt: "desc" as const },
    take: 3,
  },
} as const;

async function countEffectiveSuperAdmins(excludeUserId?: string): Promise<number> {
  return prisma.userRole.count({
    where: {
      role: { key: "SUPER_ADMIN" },
      user: {
        status: "ACTIVE",
        actorType: "INTERNAL",
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
    },
  });
}

/**
 * Server-side hard-delete eligibility without ownership transfer.
 * Disposable invited users with no meaningful business history may be
 * removed directly. Established users require transferToUserId.
 */
export async function evaluateUserDeletionSafety(userId: string): Promise<{
  safe: boolean;
  reasons: string[];
}> {
  const reasons: string[] = [];
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      salesRep: { include: { assignments: { take: 1 }, applications: { take: 1 }, teamMembers: { take: 1 } } },
      companyUsers: { take: 1 },
      productImports: { take: 1 },
      ownedLeads: { take: 1 },
      ownedOpportunities: { take: 1 },
      assignedTasks: { take: 1 },
      createdTasks: { take: 1 },
      activities: { take: 1 },
      notes: { take: 1 },
      tradeAppsReviewed: { take: 1 },
      accounts: { take: 1 },
    },
  });
  if (!user) {
    return { safe: false, reasons: ["User not found"] };
  }

  if (user.status === "ACTIVE" || user.lastLoginAt) {
    reasons.push("User has activated or signed in");
  }
  if (user.accounts.length > 0 && user.status !== "INVITED") {
    reasons.push("User has credential history");
  }
  if (user.productImports.length > 0) reasons.push("Product import history");
  if (user.ownedLeads.length > 0) reasons.push("CRM lead ownership");
  if (user.ownedOpportunities.length > 0) reasons.push("CRM opportunity ownership");
  if (user.assignedTasks.length > 0 || user.createdTasks.length > 0) {
    reasons.push("Task history");
  }
  if (user.activities.length > 0) reasons.push("Activity history");
  if (user.notes.length > 0) reasons.push("Note authorship");
  if (user.tradeAppsReviewed.length > 0) reasons.push("Application review history");
  if (user.salesRep?.assignments.length) reasons.push("Sales company assignments");
  if (user.salesRep?.applications.length) reasons.push("Assigned trade applications");
  if (user.salesRep?.teamMembers.length) reasons.push("Sales team management");

  const orderCount = await prisma.order.count({
    where: {
      OR: [{ orderedByUserId: userId }, { onBehalfOfUserId: userId }],
    },
  });
  if (orderCount > 0) reasons.push("Order history (snapshots retained)");

  // Invited-only staff with no history are safe even if SalesRep row exists unused.
  if (user.status === "INVITED" && reasons.length === 0) {
    return { safe: true, reasons: [] };
  }

  return { safe: reasons.length === 0 && user.status === "INVITED", reasons };
}

async function mapStaffUser(userId: string): Promise<StaffUserRecord> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: staffInclude,
  });
  const deletion = await evaluateUserDeletionSafety(userId);
  return mapUser(user, deletion);
}

export async function listStaffUsers(actorUserId: string): Promise<{
  items: StaffUserRecord[];
  currentUserId: string;
  canGrantSuperAdmin: boolean;
}> {
  const profile = await requireSystemPermission(actorUserId, "users.manage");
  const rows = await prisma.user.findMany({
    where: { actorType: "INTERNAL" },
    include: staffInclude,
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take: 500,
  });

  const items: StaffUserRecord[] = [];
  for (const row of rows) {
    const deletion = await evaluateUserDeletionSafety(row.id);
    items.push(mapUser(row, deletion));
  }

  return {
    items,
    currentUserId: actorUserId,
    canGrantSuperAdmin: profile.systemRoles.includes("SUPER_ADMIN"),
  };
}

async function ensureSalesRep(userId: string, email: string) {
  const existing = await prisma.salesRep.findUnique({ where: { userId } });
  if (existing) {
    if (!existing.active) {
      await prisma.salesRep.update({ where: { id: existing.id }, data: { active: true } });
    }
    return;
  }
  const code = email.split("@")[0]?.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toUpperCase() || "REP";
  await prisma.salesRep.create({
    data: { userId, code: `${code}-${userId.slice(-4).toUpperCase()}`, active: true },
  });
}

async function issueStaffInvitation(input: {
  userId: string;
  email: string;
  systemRoleKey: string;
  invitedById: string;
  expiresInDays: number;
}): Promise<{ invitationId: string; token: string; activationPath: string; emailSent: boolean }> {
  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

  await prisma.userInvitation.updateMany({
    where: { userId: input.userId, kind: "STAFF_USER", status: "PENDING" },
    data: { status: "REVOKED" },
  });

  const invitation = await prisma.userInvitation.create({
    data: {
      kind: "STAFF_USER",
      userId: input.userId,
      email: input.email,
      systemRoleKey: input.systemRoleKey,
      role: null,
      companyId: null,
      tokenHash,
      invitedById: input.invitedById,
      expiresAt,
      emailDeferred: true,
    },
  });

  const activationPath = `/activate?token=${encodeURIComponent(token)}`;
  let emailSent = false;
  try {
    const { sendUserInvitationEmail } = await import("@/server/email/transactional");
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { name: true },
    });
    emailSent = await sendUserInvitationEmail({
      invitationId: invitation.id,
      userId: input.userId,
      email: input.email,
      displayName: user.name?.trim() || input.email,
      roleLabel: roleLabel(input.systemRoleKey),
      activationPath,
    });
    if (emailSent) {
      await prisma.userInvitation.update({
        where: { id: invitation.id },
        data: { emailDeferred: false },
      });
    }
  } catch {
    emailSent = false;
  }

  return { invitationId: invitation.id, token, activationPath, emailSent };
}

/**
 * Create an INTERNAL staff user in INVITED state and email a set-password link.
 * Does NOT create AuthAccount credentials or return a password.
 */
export async function createStaffUser(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "users.manage");
  const input = internalUserCreateSchema.parse(raw);
  const email = input.email.toLowerCase();
  const name = `${input.firstName} ${input.lastName}`.trim();

  if (input.role === "SUPER_ADMIN" && !profile.systemRoles.includes("SUPER_ADMIN")) {
    throw new AuthError("Only a Super Admin can create another Super Admin", "FORBIDDEN", 403);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AuthError("User already exists", "VALIDATION", 400);
  }

  const role = await prisma.role.findUnique({ where: { key: input.role } });
  if (!role) throw new AuthError("Unknown role", "VALIDATION", 400);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        name,
        actorType: "INTERNAL",
        status: "INVITED",
        emailVerified: false,
      },
    });
    await tx.userRole.create({
      data: { userId: created.id, roleId: role.id },
    });
    return created;
  });

  if (input.role === "SALES_MANAGER" || input.role === "SALES_REPRESENTATIVE") {
    await ensureSalesRep(user.id, email);
  }

  await recordAuditEvent({
    action: "USER_CREATED",
    entityType: "User",
    entityId: user.id,
    actorUserId,
    targetUserId: user.id,
    after: { email, role: input.role, status: "INVITED" },
  });

  const invite = await issueStaffInvitation({
    userId: user.id,
    email,
    systemRoleKey: input.role,
    invitedById: actorUserId,
    expiresInDays: input.expiresInDays,
  });

  await recordAuditEvent({
    action: "USER_INVITATION_SENT",
    entityType: "UserInvitation",
    entityId: invite.invitationId,
    actorUserId,
    targetUserId: user.id,
    metadata: { emailSent: invite.emailSent, email },
  });

  const listed = await mapStaffUser(user.id);
  return {
    user: listed,
    invitationSent: invite.emailSent,
    invitationDeferred: !invite.emailSent,
    invitationId: invite.invitationId,
  };
}

export async function resendStaffInvitation(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "users.manage");
  const { id } = staffUserIdSchema.parse(raw);
  const existing = await prisma.user.findUnique({
    where: { id },
    include: staffInclude,
  });
  if (!existing || existing.actorType !== "INTERNAL") {
    throw new AuthError("User not found", "NOT_FOUND", 404);
  }
  if (existing.status !== "INVITED") {
    throw new AuthError(
      "Only invited users can receive an invitation. Use Send password reset for active users.",
      "VALIDATION",
      400,
    );
  }

  const roleKey = existing.userRoles[0]?.role.key;
  if (!roleKey) throw new AuthError("User has no role assigned", "VALIDATION", 400);

  const invite = await issueStaffInvitation({
    userId: existing.id,
    email: existing.email,
    systemRoleKey: roleKey,
    invitedById: actorUserId,
    expiresInDays: 14,
  });

  await recordAuditEvent({
    action: "USER_INVITATION_RESENT",
    entityType: "UserInvitation",
    entityId: invite.invitationId,
    actorUserId,
    targetUserId: existing.id,
    metadata: { emailSent: invite.emailSent },
  });

  return {
    user: await mapStaffUser(existing.id),
    invitationSent: invite.emailSent,
    invitationDeferred: !invite.emailSent,
  };
}

export async function updateStaffUser(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "users.manage");
  const input = internalUserUpdateSchema.parse(raw);
  const existing = await prisma.user.findUnique({
    where: { id: input.id },
    include: staffInclude,
  });
  if (!existing || existing.actorType !== "INTERNAL") {
    throw new AuthError("User not found", "NOT_FOUND", 404);
  }

  if (input.id === actorUserId && input.status === "DISABLED") {
    throw new AuthError("You cannot disable your own account", "VALIDATION", 400);
  }

  if (input.role === "SUPER_ADMIN" && !profile.systemRoles.includes("SUPER_ADMIN")) {
    throw new AuthError("Only a Super Admin can assign Super Admin", "FORBIDDEN", 403);
  }

  const currentRole = existing.userRoles[0]?.role.key;
  if (currentRole === "SUPER_ADMIN" && input.role && input.role !== "SUPER_ADMIN") {
    const others = await countEffectiveSuperAdmins(existing.id);
    if (others === 0) {
      throw new AuthError("Keep at least one Super Admin", "VALIDATION", 400);
    }
  }

  if (
    existing.status === "ACTIVE" &&
    input.status === "DISABLED" &&
    currentRole === "SUPER_ADMIN"
  ) {
    const others = await countEffectiveSuperAdmins(existing.id);
    if (others === 0) {
      throw new AuthError(
        "Cannot deactivate the last effective administrator",
        "VALIDATION",
        400,
      );
    }
  }

  if (input.name !== undefined || input.status !== undefined) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
  }

  if (input.status === "DISABLED") {
    await prisma.authSession.deleteMany({ where: { userId: existing.id } });
    const rep = await prisma.salesRep.findUnique({ where: { userId: existing.id } });
    if (rep?.active) {
      await prisma.salesRep.update({ where: { id: rep.id }, data: { active: false } });
    }
  }

  if (input.role && input.role !== currentRole) {
    const role = await prisma.role.findUnique({ where: { key: input.role } });
    if (!role) throw new AuthError("Unknown role", "VALIDATION", 400);
    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: existing.id } });
      await tx.userRole.create({ data: { userId: existing.id, roleId: role.id } });
    });
    if (input.role === "SALES_MANAGER" || input.role === "SALES_REPRESENTATIVE") {
      await ensureSalesRep(existing.id, existing.email);
    }
  }

  await recordAuditEvent({
    action: "USER_UPDATED",
    entityType: "User",
    entityId: existing.id,
    actorUserId,
    targetUserId: existing.id,
    after: { role: input.role, status: input.status, name: input.name },
  });

  return mapStaffUser(existing.id);
}

export async function deactivateStaffUser(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "users.manage");
  const { id } = staffUserIdSchema.parse(raw);
  if (id === actorUserId) {
    throw new AuthError("You cannot deactivate your own account", "VALIDATION", 400);
  }
  const existing = await prisma.user.findUnique({
    where: { id },
    include: { userRoles: { include: { role: true } } },
  });
  if (!existing || existing.actorType !== "INTERNAL") {
    throw new AuthError("User not found", "NOT_FOUND", 404);
  }
  if (existing.status === "DISABLED") {
    return mapStaffUser(existing.id);
  }

  const currentRole = existing.userRoles[0]?.role.key;
  if (currentRole === "SUPER_ADMIN" && existing.status === "ACTIVE") {
    const others = await countEffectiveSuperAdmins(existing.id);
    if (others === 0) {
      throw new AuthError(
        "Cannot deactivate the last effective administrator",
        "VALIDATION",
        400,
      );
    }
  }

  await prisma.user.update({
    where: { id: existing.id },
    data: { status: "DISABLED" },
  });
  await prisma.authSession.deleteMany({ where: { userId: existing.id } });
  const rep = await prisma.salesRep.findUnique({ where: { userId: existing.id } });
  if (rep?.active) {
    await prisma.salesRep.update({ where: { id: rep.id }, data: { active: false } });
  }

  await recordAuditEvent({
    action: "USER_DEACTIVATED",
    entityType: "User",
    entityId: existing.id,
    actorUserId,
    targetUserId: existing.id,
  });

  return mapStaffUser(existing.id);
}

export async function reactivateStaffUser(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "users.manage");
  const { id } = staffUserIdSchema.parse(raw);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.actorType !== "INTERNAL") {
    throw new AuthError("User not found", "NOT_FOUND", 404);
  }
  if (existing.status !== "DISABLED") {
    throw new AuthError("Only disabled users can be reactivated", "VALIDATION", 400);
  }

  const hasCredential = await prisma.authAccount.findFirst({
    where: { userId: existing.id, providerId: "credential" },
  });
  const nextStatus = hasCredential ? "ACTIVE" : "INVITED";

  await prisma.user.update({
    where: { id: existing.id },
    data: { status: nextStatus },
  });

  const rep = await prisma.salesRep.findUnique({ where: { userId: existing.id } });
  if (rep && !rep.active) {
    await prisma.salesRep.update({ where: { id: rep.id }, data: { active: true } });
  }

  await recordAuditEvent({
    action: "USER_REACTIVATED",
    entityType: "User",
    entityId: existing.id,
    actorUserId,
    targetUserId: existing.id,
    after: { status: nextStatus },
  });

  return mapStaffUser(existing.id);
}

/**
 * Reassign sales / CRM / attribution ownership from one staff user to another
 * inside an open transaction, then remove the source SalesRep row.
 */
async function transferStaffOwnershipInTx(
  tx: Prisma.TransactionClient,
  fromUserId: string,
  toUserId: string,
) {
  const target = await tx.user.findUnique({ where: { id: toUserId } });
  if (!target || target.actorType !== "INTERNAL") {
    throw new AuthError("Transfer target must be an internal user", "VALIDATION", 400);
  }
  if (target.id === fromUserId) {
    throw new AuthError("Cannot transfer ownership to the same user", "VALIDATION", 400);
  }

  const fromRep = await tx.salesRep.findUnique({ where: { userId: fromUserId } });
  let toRep = await tx.salesRep.findUnique({ where: { userId: toUserId } });

  if (fromRep && !toRep) {
    const code =
      target.email.split("@")[0]?.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toUpperCase() || "REP";
    toRep = await tx.salesRep.create({
      data: {
        userId: toUserId,
        code: `${code}-${toUserId.slice(-4).toUpperCase()}`,
        active: target.status !== "DISABLED",
        region: fromRep.region,
        managerId: fromRep.managerId === fromRep.id ? null : fromRep.managerId,
      },
    });
  }

  if (fromRep && toRep) {
    const assignments = await tx.companyAssignment.findMany({
      where: { salesRepId: fromRep.id },
    });
    for (const assignment of assignments) {
      const clash = await tx.companyAssignment.findUnique({
        where: {
          companyId_salesRepId: {
            companyId: assignment.companyId,
            salesRepId: toRep.id,
          },
        },
      });
      if (clash) {
        await tx.companyAssignment.delete({ where: { id: assignment.id } });
      } else {
        await tx.companyAssignment.update({
          where: { id: assignment.id },
          data: { salesRepId: toRep.id },
        });
      }
    }

    await tx.tradeApplication.updateMany({
      where: { assignedRepId: fromRep.id },
      data: { assignedRepId: toRep.id },
    });

    await tx.salesRep.updateMany({
      where: { managerId: fromRep.id },
      data: { managerId: toRep.id },
    });

    // TeamMember.salesRepId is unique — move link or clear if target already linked.
    const sourceTeam = await tx.teamMember.findUnique({ where: { salesRepId: fromRep.id } });
    if (sourceTeam) {
      const targetTeam = await tx.teamMember.findUnique({ where: { salesRepId: toRep.id } });
      if (targetTeam) {
        await tx.teamMember.update({
          where: { id: sourceTeam.id },
          data: { salesRepId: null },
        });
      } else {
        await tx.teamMember.update({
          where: { id: sourceTeam.id },
          data: { salesRepId: toRep.id },
        });
      }
    }

    await tx.salesRep.delete({ where: { id: fromRep.id } });
  } else if (fromRep && !toRep) {
    await tx.salesRep.delete({ where: { id: fromRep.id } });
  }

  await tx.lead.updateMany({
    where: { ownerId: fromUserId },
    data: { ownerId: toUserId },
  });
  await tx.opportunity.updateMany({
    where: { ownerId: fromUserId },
    data: { ownerId: toUserId },
  });
  await tx.task.updateMany({
    where: { assigneeId: fromUserId },
    data: { assigneeId: toUserId },
  });
  await tx.task.updateMany({
    where: { createdById: fromUserId },
    data: { createdById: toUserId },
  });
  await tx.activity.updateMany({
    where: { userId: fromUserId },
    data: { userId: toUserId },
  });
  await tx.note.updateMany({
    where: { authorId: fromUserId },
    data: { authorId: toUserId },
  });
  await tx.productImportJob.updateMany({
    where: { uploadedById: fromUserId },
    data: { uploadedById: toUserId },
  });
  await tx.tradeApplication.updateMany({
    where: { reviewedById: fromUserId },
    data: { reviewedById: toUserId },
  });
  await tx.company.updateMany({
    where: { autopartCustomerCodeVerifiedById: fromUserId },
    data: { autopartCustomerCodeVerifiedById: toUserId },
  });
}

export async function deleteStaffUser(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "users.manage");
  const input = staffUserDeleteSchema.parse(raw);
  const { id, transferToUserId } = input;
  if (id === actorUserId) {
    throw new AuthError("You cannot delete your own account", "VALIDATION", 400);
  }
  if (transferToUserId === actorUserId) {
    // Allowed — admin can absorb ownership themselves.
  }
  if (transferToUserId === id) {
    throw new AuthError("Cannot transfer ownership to the user being deleted", "VALIDATION", 400);
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    include: { userRoles: { include: { role: true } }, salesRep: true },
  });
  if (!existing || existing.actorType !== "INTERNAL") {
    throw new AuthError("User not found", "NOT_FOUND", 404);
  }

  const currentRole = existing.userRoles[0]?.role.key;
  if (currentRole === "SUPER_ADMIN" && existing.status === "ACTIVE") {
    const others = await countEffectiveSuperAdmins(existing.id);
    if (others === 0) {
      throw new AuthError(
        "Cannot delete the last effective administrator",
        "VALIDATION",
        400,
      );
    }
  }

  const safety = await evaluateUserDeletionSafety(existing.id);
  if (!safety.safe && !transferToUserId) {
    throw new AuthError(
      `This user has business history. Select another internal user to transfer sales and CRM ownership to, then delete. (${safety.reasons.join("; ")})`,
      "VALIDATION",
      400,
    );
  }

  if (transferToUserId) {
    const target = await prisma.user.findUnique({ where: { id: transferToUserId } });
    if (!target || target.actorType !== "INTERNAL") {
      throw new AuthError("Transfer target must be an internal user", "VALIDATION", 400);
    }
  }

  await prisma.$transaction(async (tx) => {
    if (transferToUserId) {
      await transferStaffOwnershipInTx(tx, existing.id, transferToUserId);
    } else if (existing.salesRep) {
      await tx.salesRep.delete({ where: { id: existing.salesRep.id } });
    }

    // Disposable attribution that should not block delete when no transfer was needed,
    // or residual rows after transfer.
    await tx.authSession.deleteMany({ where: { userId: existing.id } });
    await tx.userInvitation.deleteMany({ where: { userId: existing.id } });
    await tx.user.delete({ where: { id: existing.id } });
  });

  await recordAuditEvent({
    action: "USER_DELETED",
    entityType: "User",
    entityId: id,
    actorUserId,
    metadata: {
      email: existing.email,
      transferToUserId: transferToUserId ?? null,
      reasons: safety.reasons,
    },
  });

  return {
    ok: true as const,
    id,
    transferredToUserId: transferToUserId ?? null,
  };
}

export async function resetStaffUserPassword(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "users.manage");
  const input = internalUserPasswordResetSchema.parse(raw);
  const existing = await prisma.user.findUnique({ where: { id: input.id } });
  if (!existing || existing.actorType !== "INTERNAL") {
    throw new AuthError("User not found", "NOT_FOUND", 404);
  }

  const suppliedPassword = input.password?.trim() || "";
  const temporaryPassword = suppliedPassword ? null : generateTemporaryPassword();
  const password = suppliedPassword || temporaryPassword!;
  const passwordHash = await hashPassword(password);

  const credential = await prisma.authAccount.findFirst({
    where: { userId: existing.id, providerId: "credential" },
  });

  await prisma.$transaction(async (tx) => {
    if (credential) {
      await tx.authAccount.update({
        where: { id: credential.id },
        data: { password: passwordHash },
      });
    } else {
      await tx.authAccount.create({
        data: {
          userId: existing.id,
          accountId: existing.id,
          providerId: "credential",
          password: passwordHash,
        },
      });
    }
    await tx.authSession.deleteMany({ where: { userId: existing.id } });
    if (existing.status === "INVITED") {
      await tx.user.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() },
      });
    }
  });

  await recordAuditEvent({
    action: "USER_PASSWORD_RESET",
    entityType: "User",
    entityId: existing.id,
    actorUserId,
    targetUserId: existing.id,
    after: { generated: !suppliedPassword },
  });

  return { email: existing.email, temporaryPassword: password };
}

/**
 * Admin-initiated secure password reset email (Better Auth flow).
 * ACTIVE users only — invited users use Resend Invitation instead.
 */
export async function sendUserPasswordResetEmail(actorUserId: string, userId: string) {
  await requireSystemPermission(actorUserId, "users.manage");
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    throw new AuthError("User not found", "NOT_FOUND", 404);
  }
  if (existing.status === "INVITED") {
    throw new AuthError(
      "This user has not activated yet. Use Resend Invitation instead of password reset.",
      "VALIDATION",
      400,
    );
  }
  if (existing.status === "DISABLED") {
    throw new AuthError("Reactivate the user before sending a password reset", "VALIDATION", 400);
  }

  const { auth } = await import("@/infra/auth/auth");
  try {
    await auth.api.requestPasswordReset({
      body: {
        email: existing.email,
        redirectTo: "/reset-password",
      },
    });
  } catch {
    throw new AuthError("Unable to send password reset email", "EMAIL_FAILED", 502);
  }

  await recordAuditEvent({
    action: "ADMIN_PASSWORD_RESET_REQUESTED",
    entityType: "User",
    entityId: existing.id,
    actorUserId,
    targetUserId: existing.id,
    metadata: { email: existing.email },
  });

  return { ok: true as const, email: existing.email };
}
