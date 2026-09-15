import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { tradeAccessToCompanyRole } from "@/server/rbac/access";
import type { TradeAccessKey } from "@/domain/permissions";

/** Grant company membership and audit COMPANY_ACCESS_GRANTED */
export async function grantCompanyAccess(opts: {
  actorUserId: string;
  targetUserId: string;
  companyId: string;
  role: TradeAccessKey;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const role = tradeAccessToCompanyRole(opts.role);
  const row = await prisma.companyUser.upsert({
    where: {
      companyId_userId: { companyId: opts.companyId, userId: opts.targetUserId },
    },
    create: {
      companyId: opts.companyId,
      userId: opts.targetUserId,
      role,
      status: "ACTIVE",
    },
    update: { role, status: "ACTIVE" },
  });

  await recordAuditEvent({
    action: "COMPANY_ACCESS_GRANTED",
    entityType: "CompanyUser",
    entityId: row.id,
    actorUserId: opts.actorUserId,
    targetUserId: opts.targetUserId,
    companyId: opts.companyId,
    after: { role: opts.role },
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  });

  return row;
}

export async function revokeCompanyAccess(opts: {
  actorUserId: string;
  targetUserId: string;
  companyId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const existing = await prisma.companyUser.findUnique({
    where: {
      companyId_userId: { companyId: opts.companyId, userId: opts.targetUserId },
    },
  });
  if (!existing) return null;

  await prisma.companyUser.update({
    where: { id: existing.id },
    data: { status: "DISABLED" },
  });

  await recordAuditEvent({
    action: "COMPANY_ACCESS_REVOKED",
    entityType: "CompanyUser",
    entityId: existing.id,
    actorUserId: opts.actorUserId,
    targetUserId: opts.targetUserId,
    companyId: opts.companyId,
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  });

  return existing;
}

export async function assignSystemRole(opts: {
  actorUserId: string;
  targetUserId: string;
  roleKey: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: opts.roleKey } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: opts.targetUserId, roleId: role.id } },
    create: { userId: opts.targetUserId, roleId: role.id },
    update: {},
  });

  await recordAuditEvent({
    action: "ROLE_ASSIGNED",
    entityType: "UserRole",
    entityId: `${opts.targetUserId}:${role.id}`,
    actorUserId: opts.actorUserId,
    targetUserId: opts.targetUserId,
    after: { roleKey: opts.roleKey },
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  });
}

export async function removeSystemRole(opts: {
  actorUserId: string;
  targetUserId: string;
  roleKey: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: opts.roleKey } });
  await prisma.userRole.deleteMany({
    where: { userId: opts.targetUserId, roleId: role.id },
  });

  await recordAuditEvent({
    action: "ROLE_REMOVED",
    entityType: "UserRole",
    entityId: `${opts.targetUserId}:${role.id}`,
    actorUserId: opts.actorUserId,
    targetUserId: opts.targetUserId,
    before: { roleKey: opts.roleKey },
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  });
}
