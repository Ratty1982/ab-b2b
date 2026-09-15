import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";
import { AuthError } from "@/server/rbac/guards";

const DEFAULT_CONTEXT_HOURS = 8;

/**
 * Acting context = salesperson remains themselves while ordering/quoting
 * on behalf of a trade company. Never acquires the customer session.
 */
export async function startActingContext(opts: {
  profile: LoadedAccessProfile;
  onBehalfOfCompanyId: string;
  reason?: string;
  lifetimeHours?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const { profile, onBehalfOfCompanyId } = opts;

  if (!hasPermission(profile, "impersonation.order_for_customer")) {
    throw new AuthError("Acting-for-customer permission required", "ACTING_FORBIDDEN", 403);
  }

  const companyOk = await canAccessCompanyAsSales(profile, onBehalfOfCompanyId);
  if (!companyOk) {
    throw new AuthError(
      "No access to this company for acting context",
      "ACTING_COMPANY_FORBIDDEN",
      403,
    );
  }

  // End any open contexts for this actor first
  await prisma.actingContext.updateMany({
    where: { actorUserId: profile.userId, endedAt: null },
    data: { endedAt: new Date() },
  });

  const hours = opts.lifetimeHours ?? DEFAULT_CONTEXT_HOURS;
  const endsAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const ctx = await prisma.actingContext.create({
    data: {
      actorUserId: profile.userId,
      onBehalfOfCompanyId,
      endsAt,
      reason: opts.reason ?? null,
    },
  });

  await recordAuditEvent({
    action: "ACTING_CONTEXT_STARTED",
    entityType: "ActingContext",
    entityId: ctx.id,
    actorUserId: profile.userId,
    companyId: onBehalfOfCompanyId,
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
    metadata: { endsAt: endsAt.toISOString(), reason: opts.reason ?? null },
  });

  return ctx;
}

export async function endActingContext(opts: {
  profile: LoadedAccessProfile;
  actingContextId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const open = await prisma.actingContext.findMany({
    where: {
      actorUserId: opts.profile.userId,
      endedAt: null,
      ...(opts.actingContextId ? { id: opts.actingContextId } : {}),
    },
  });

  for (const ctx of open) {
    await prisma.actingContext.update({
      where: { id: ctx.id },
      data: { endedAt: new Date() },
    });
    await recordAuditEvent({
      action: "ACTING_CONTEXT_ENDED",
      entityType: "ActingContext",
      entityId: ctx.id,
      actorUserId: opts.profile.userId,
      companyId: ctx.onBehalfOfCompanyId,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
    });
  }

  return open.length;
}

export async function getActiveActingContext(userId: string) {
  const now = new Date();
  const ctx = await prisma.actingContext.findFirst({
    where: {
      actorUserId: userId,
      endedAt: null,
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    include: {
      onBehalfOfCompany: { select: { id: true, name: true, accountNumber: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  if (!ctx) return null;

  // Expire lazily
  if (ctx.endsAt && ctx.endsAt <= now) {
    await prisma.actingContext.update({
      where: { id: ctx.id },
      data: { endedAt: now },
    });
    return null;
  }

  return ctx;
}

/**
 * Authorise an action while acting for a company:
 * 1. permission impersonation.order_for_customer
 * 2. sales access to company
 * 3. active acting context for that company
 */
export async function requireActingForCompany(profile: LoadedAccessProfile, companyId: string) {
  if (!hasPermission(profile, "impersonation.order_for_customer")) {
    throw new AuthError("Acting permission required", "ACTING_FORBIDDEN", 403);
  }
  const companyOk = await canAccessCompanyAsSales(profile, companyId);
  if (!companyOk) {
    throw new AuthError("No company access", "ACTING_COMPANY_FORBIDDEN", 403);
  }
  const ctx = await getActiveActingContext(profile.userId);
  if (!ctx || ctx.onBehalfOfCompanyId !== companyId) {
    throw new AuthError("No active acting context for company", "ACTING_CONTEXT_REQUIRED", 403);
  }
  return ctx;
}
