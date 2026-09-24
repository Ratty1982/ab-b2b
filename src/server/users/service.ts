import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import type { SystemRoleKey } from "@/domain/permissions";
import { SYSTEM_ROLE_META } from "@/domain/role-permissions";
import { internalUserCreateSchema, internalUserPasswordResetSchema, internalUserUpdateSchema } from "@/domain/users";

export type StaffUserRecord = {
  id: string;
  name: string;
  email: string;
  role: SystemRoleKey | null;
  roleLabel: string;
  status: string;
  actorType: string;
  createdAt: string;
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

function mapUser(user: {
  id: string;
  name: string | null;
  email: string;
  status: string;
  actorType: string;
  createdAt: Date;
  userRoles: Array<{ role: { key: string } }>;
}): StaffUserRecord {
  const role = (user.userRoles[0]?.role.key as SystemRoleKey | undefined) ?? null;
  return {
    id: user.id,
    name: user.name?.trim() || user.email.split("@")[0] || user.email,
    email: user.email,
    role,
    roleLabel: roleLabel(role),
    status: user.status,
    actorType: user.actorType,
    createdAt: user.createdAt.toISOString(),
  };
}

const staffInclude = {
  userRoles: { include: { role: true }, take: 8 },
} as const;

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
  return {
    items: rows.map(mapUser),
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

export async function createStaffUser(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "users.manage");
  const input = internalUserCreateSchema.parse(raw);
  const email = input.email.toLowerCase();

  if (input.role === "SUPER_ADMIN" && !profile.systemRoles.includes("SUPER_ADMIN")) {
    throw new AuthError("Only a Super Admin can create another Super Admin", "FORBIDDEN", 403);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AuthError("A user with that email already exists", "VALIDATION", 400);

  const role = await prisma.role.findUnique({ where: { key: input.role } });
  if (!role) throw new AuthError("Unknown role", "VALIDATION", 400);

  const suppliedPassword = input.password?.trim() || "";
  const temporaryPassword = suppliedPassword ? null : generateTemporaryPassword();
  const password = suppliedPassword || temporaryPassword!;
  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        name: input.name,
        actorType: "INTERNAL",
        status: "ACTIVE",
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });
    await tx.authAccount.create({
      data: {
        userId: created.id,
        accountId: created.id,
        providerId: "credential",
        password: passwordHash,
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
    after: { email, role: input.role },
  });

  const listed = mapUser(
    await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: staffInclude }),
  );
  return { user: listed, temporaryPassword };
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
    const others = await prisma.userRole.count({
      where: { role: { key: "SUPER_ADMIN" }, userId: { not: existing.id } },
    });
    if (others === 0) {
      throw new AuthError("Keep at least one Super Admin", "VALIDATION", 400);
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

  return mapUser(
    await prisma.user.findUniqueOrThrow({ where: { id: existing.id }, include: staffInclude }),
  );
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
 * Does NOT set or reveal a password — user chooses their own via the email link.
 */
export async function sendUserPasswordResetEmail(actorUserId: string, userId: string) {
  await requireSystemPermission(actorUserId, "users.manage");
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    throw new AuthError("User not found", "NOT_FOUND", 404);
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
