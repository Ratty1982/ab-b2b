import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants, hasPermission } from "@/server/rbac/access";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";
import { normaliseAssignedAutopartCode } from "@/domain/autopart-account-verification";
import { assertUnambiguousAutopartCode } from "@/server/companies/autopart-account-verification";

/**
 * Autopart customer account codes are ERP references only — never passwords,
 * session ids, or automatic company membership grants.
 *
 * Normalization: trim + collapse internal whitespace. Preserve case and leading zeros.
 */
export function normalizeAutopartCustomerCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim().replace(/\s+/g, " ");
  return trimmed.length ? trimmed : null;
}

const setSchema = z.object({
  companyId: z.string().cuid(),
  code: z.string().max(80).nullable(),
});

const companyIdSchema = z.object({
  companyId: z.string().cuid(),
});

async function assertCanEditCompanyCommercial(actorUserId: string, companyId: string) {
  const profile = await requireSystemPermission(actorUserId, "companies.edit");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade customers cannot edit Autopart account codes", "FORBIDDEN", 403);
  }
  if (grants(profile, "admin.access", "sales.view_all_accounts")) {
    return profile;
  }
  const hasSalesScope =
    hasPermission(profile, "sales.view_own_accounts") ||
    hasPermission(profile, "sales.view_team_accounts");
  if (hasSalesScope) {
    const ok = await canAccessCompanyAsSales(profile, companyId);
    if (!ok) throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
  }
  return profile;
}

export type AutopartAccountView = {
  code: string | null;
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: { id: string; name: string; email: string } | null;
};

function serializeAutopart(row: {
  autopartCustomerCode: string | null;
  autopartCustomerCodeVerifiedAt: Date | null;
  autopartCustomerCodeVerifiedBy: { id: string; name: string | null; email: string } | null;
}): AutopartAccountView {
  const verified = Boolean(row.autopartCustomerCode && row.autopartCustomerCodeVerifiedAt);
  return {
    code: row.autopartCustomerCode,
    verified,
    verifiedAt: row.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
    verifiedBy: row.autopartCustomerCodeVerifiedBy
      ? {
          id: row.autopartCustomerCodeVerifiedBy.id,
          name: row.autopartCustomerCodeVerifiedBy.name ?? row.autopartCustomerCodeVerifiedBy.email,
          email: row.autopartCustomerCodeVerifiedBy.email,
        }
      : null,
  };
}

const autopartSelect = {
  id: true,
  autopartCustomerCode: true,
  autopartCustomerCodeVerifiedAt: true,
  autopartCustomerCodeVerifiedById: true,
  autopartCustomerCodeVerifiedBy: {
    select: { id: true, name: true, email: true },
  },
} as const;

export async function getCompanyAutopartAccount(
  actorUserId: string,
  companyId: string,
): Promise<AutopartAccountView> {
  const profile = await requireSystemPermission(actorUserId, "companies.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Forbidden", "FORBIDDEN", 403);
  }
  const row = await prisma.company.findUnique({
    where: { id: companyId },
    select: autopartSelect,
  });
  if (!row) throw new AuthError("Company not found", "NOT_FOUND", 404);
  return serializeAutopart(row);
}

/**
 * Set or clear the Autopart customer code.
 * An unambiguous ID is verified as part of the assignment. Clearing removes verification.
 * A conflicting ID is rejected and is not stored as unverified.
 */
export async function setCompanyAutopartCustomerCode(actorUserId: string, raw: unknown) {
  const input = setSchema.parse(raw);
  await assertCanEditCompanyCommercial(actorUserId, input.companyId);
  const next = normalizeAutopartCustomerCode(input.code);

  const before = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: autopartSelect,
  });
  if (!before) throw new AuthError("Company not found", "NOT_FOUND", 404);

  if (!next) {
    if (!before.autopartCustomerCode && !before.autopartCustomerCodeVerifiedAt) {
      return serializeAutopart(before);
    }
    const updated = await prisma.company.update({
      where: { id: input.companyId },
      data: {
        autopartCustomerCode: null,
        autopartCustomerCodeVerifiedAt: null,
        autopartCustomerCodeVerifiedById: null,
      },
      select: autopartSelect,
    });
    await recordAuditEvent({
      action: "company.autopart_account.cleared",
      entityType: "Company",
      entityId: input.companyId,
      actorUserId,
      companyId: input.companyId,
      before: {
        autopartCustomerCode: before.autopartCustomerCode,
        verifiedAt: before.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
      },
      after: { autopartCustomerCode: null, verifiedAt: null },
    });
    return serializeAutopart(updated);
  }

  const normalised = await assertUnambiguousAutopartCode(next, input.companyId);
  const sameKey =
    normaliseAssignedAutopartCode(before.autopartCustomerCode).key === normalised.key;
  if (sameKey && before.autopartCustomerCodeVerifiedAt) {
    return serializeAutopart(before);
  }

  const verifiedAt = new Date();
  try {
    const updated = await prisma.company.update({
      where: { id: input.companyId },
      data: {
        autopartCustomerCode: sameKey ? before.autopartCustomerCode : normalised.display,
        autopartCustomerCodeVerifiedAt: verifiedAt,
        autopartCustomerCodeVerifiedById: null,
      },
      select: autopartSelect,
    });

    const action = sameKey
      ? "company.autopart_account.verified"
      : before.autopartCustomerCode
        ? "company.autopart_account.changed"
        : "company.autopart_account.set";

    await recordAuditEvent({
      action,
      entityType: "Company",
      entityId: input.companyId,
      actorUserId,
      companyId: input.companyId,
      before: {
        autopartCustomerCode: before.autopartCustomerCode,
        verifiedAt: before.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
      },
      after: {
        autopartCustomerCode: updated.autopartCustomerCode,
        verifiedAt: updated.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
        verifiedById: null,
      },
    });

    return serializeAutopart(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AuthError(
        "That Autopart customer code is already linked to another company",
        "AUTOPART_CODE_DUPLICATE",
        409,
      );
    }
    throw error;
  }
}

/** Explicit staff verification of the current Autopart customer code. */
export async function verifyCompanyAutopartCustomerCode(actorUserId: string, raw: unknown) {
  const input = companyIdSchema.parse(raw);
  await assertCanEditCompanyCommercial(actorUserId, input.companyId);

  const before = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: autopartSelect,
  });
  if (!before) throw new AuthError("Company not found", "NOT_FOUND", 404);
  if (!before.autopartCustomerCode) {
    throw new AuthError("Enter an Autopart customer code before verifying", "AUTOPART_CODE_MISSING", 400);
  }
  await assertUnambiguousAutopartCode(before.autopartCustomerCode, input.companyId);

  const updated = await prisma.company.update({
    where: { id: input.companyId },
    data: {
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: actorUserId,
    },
    select: autopartSelect,
  });

  await recordAuditEvent({
    action: "company.autopart_account.verified",
    entityType: "Company",
    entityId: input.companyId,
    actorUserId,
    companyId: input.companyId,
    after: {
      autopartCustomerCode: updated.autopartCustomerCode,
      verifiedAt: updated.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
      verifiedById: actorUserId,
    },
  });

  return serializeAutopart(updated);
}

/**
 * Set Autopart customer code and mark verified in one staff action.
 * Used by approval verification and post-approval VERIFY / LINK.
 */
export async function linkAndVerifyCompanyAutopartCustomerCode(
  actorUserId: string,
  raw: unknown,
) {
  const input = z
    .object({
      companyId: z.string().cuid(),
      code: z.string().max(80),
    })
    .parse(raw);
  await assertCanEditCompanyCommercial(actorUserId, input.companyId);
  const next = normalizeAutopartCustomerCode(input.code);
  if (!next) {
    throw new AuthError("Autopart customer code is required", "AUTOPART_CODE_MISSING", 400);
  }
  const normalised = await assertUnambiguousAutopartCode(next, input.companyId);

  const before = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: autopartSelect,
  });
  if (!before) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const history = await import("@/server/companies/autopart-history-all");
  const pending = await history.stagedHistoricReviewIsPending(next);
  if (pending) await history.beginHistoricAccountVerification(next, input.companyId);

  try {
    const updated = await prisma.company.update({
      where: { id: input.companyId },
      data: {
        autopartCustomerCode: normalised.display,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: actorUserId,
      },
      select: autopartSelect,
    });

    try {
      const promoted = await history.promoteStagedAutopartHistory(actorUserId, input.companyId, next);
      if (pending && !promoted.completed) {
        throw new AuthError(
          "The customer code was saved, but staged history was not fully applied. Retry verification.",
          "PROMOTION_INCOMPLETE",
          409,
        );
      }
    } catch (error) {
      if (pending) throw error;
      console.error("[ab:history-promote] verified account was saved; no staged history was waiting", error);
    }

    await recordAuditEvent({
      action: "company.autopart_account.linked_verified",
      entityType: "Company",
      entityId: input.companyId,
      actorUserId,
      companyId: input.companyId,
      before: {
        autopartCustomerCode: before.autopartCustomerCode,
        verifiedAt: before.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
      },
      after: {
        autopartCustomerCode: updated.autopartCustomerCode,
        verifiedAt: updated.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
        verifiedById: actorUserId,
      },
    });

    return serializeAutopart(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AuthError(
        "That Autopart customer code is already linked to another company",
        "AUTOPART_CODE_DUPLICATE",
        409,
      );
    }
    throw error;
  }
}

export async function clearCompanyAutopartCustomerCode(actorUserId: string, raw: unknown) {
  return setCompanyAutopartCustomerCode(actorUserId, {
    companyId: companyIdSchema.parse(raw).companyId,
    code: null,
  });
}
