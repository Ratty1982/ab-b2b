/**
 * Preview and record verification for Autopart IDs already assigned to one company.
 * Nothing here runs on deploy. Apply timestamps the mapping only.
 */
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants } from "@/server/rbac/access";
import {
  AUTOPART_ACCOUNT_VERIFICATION_CONFIRMATION,
  autopartMappingDisplay,
  classifyCompanyAutopartCode,
  classifyLinkedMasterAccount,
  normaliseAssignedAutopartCode,
  planAutopartAccountVerification,
  type AutopartVerificationPlan,
  type CodeClaim,
} from "@/domain/autopart-account-verification";

async function requireVerificationAdmin(userId: string) {
  const profile = await requireSystemPermission(userId, "companies.edit");
  if (profile.actorType === "TRADE" || !grants(profile, "admin.access")) {
    throw new AuthError("Not permitted to verify Autopart account mappings", "FORBIDDEN", 403);
  }
  return profile;
}

type LoadedGraph = {
  companies: Array<{
    id: string;
    name: string;
    code: string | null;
    verifiedAt: string | null;
    verifiedById: string | null;
  }>;
  aliases: Array<{ companyId: string; alias: string }>;
  masterLinks: Array<{ companyId: string | null; accountCode: string }>;
};

async function loadOwnershipGraph(): Promise<LoadedGraph> {
  const [companies, aliases, masterLinks] = await Promise.all([
    prisma.company.findMany({
      where: { autopartCustomerCode: { not: null } },
      select: {
        id: true,
        name: true,
        autopartCustomerCode: true,
        autopartCustomerCodeVerifiedAt: true,
        autopartCustomerCodeVerifiedById: true,
      },
    }),
    prisma.autopartCustomerAccountAlias.findMany({
      select: { companyId: true, alias: true },
    }),
    prisma.autopartAccount.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, accountCode: true },
    }),
  ]);

  const rows = companies.flatMap((company) => {
    if (!company.autopartCustomerCode) return [];
    return [
      {
        id: company.id,
        name: company.name,
        code: company.autopartCustomerCode,
        verifiedAt: company.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
        verifiedById: company.autopartCustomerCodeVerifiedById,
      },
    ];
  });
  const aliasRows = aliases.map((alias) => ({ companyId: alias.companyId, alias: alias.alias }));
  const linkRows = masterLinks.map((link) => ({
    companyId: link.companyId,
    accountCode: link.accountCode,
  }));
  return { companies: rows, aliases: aliasRows, masterLinks: linkRows };
}

async function claimsForKey(key: string): Promise<CodeClaim[]> {
  const [primaries, aliases, links] = await Promise.all([
    prisma.company.findMany({
      where: { autopartCustomerCode: { equals: key, mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.autopartCustomerAccountAlias.findMany({
      where: { alias: { equals: key, mode: "insensitive" } },
      select: { companyId: true },
    }),
    prisma.autopartAccount.findMany({
      where: { accountCode: { equals: key, mode: "insensitive" }, companyId: { not: null } },
      select: { companyId: true },
    }),
  ]);
  return [
    ...primaries.map((row) => ({ companyId: row.id, kind: "PRIMARY" as const })),
    ...aliases.map((row) => ({ companyId: row.companyId, kind: "ALIAS" as const })),
    ...links.flatMap((row) =>
      row.companyId ? [{ companyId: row.companyId, kind: "MASTER_LINK" as const }] : [],
    ),
  ];
}

export async function foreignAutopartClaims(code: string, companyId: string): Promise<CodeClaim[]> {
  const normalised = normaliseAssignedAutopartCode(code);
  if (!normalised.valid || !normalised.key) return [];
  const claims = await claimsForKey(normalised.key);
  return claims.filter((claim) => claim.companyId !== companyId);
}

export async function assertUnambiguousAutopartCode(code: string, companyId: string) {
  const normalised = normaliseAssignedAutopartCode(code);
  if (!normalised.display || !normalised.valid) {
    throw new AuthError(
      normalised.reason ?? "Enter a valid Autopart customer ID",
      "AUTOPART_CODE_INVALID",
      400,
    );
  }
  const foreign = await foreignAutopartClaims(normalised.display, companyId);
  if (foreign.length > 0) {
    throw new AuthError(
      "That Autopart ID is already held by another company and was not verified",
      "AUTOPART_CODE_CONFLICT",
      409,
    );
  }
  return normalised;
}

export async function describeCompanyAutopartMapping(input: {
  companyId: string;
  code: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
}) {
  const normalised = normaliseAssignedAutopartCode(input.code);
  const claims = normalised.key ? await claimsForKey(normalised.key) : [];
  const assessment = classifyCompanyAutopartCode({
    companyId: input.companyId,
    code: input.code,
    verifiedAt: input.verifiedAt,
    claims,
  });
  const display = autopartMappingDisplay({
    decision: assessment.decision,
    reason: assessment.reason,
    verifiedByName: input.verifiedByName,
  });
  return { assessment, ...display };
}

export async function describeCompanyMasterLinks(input: {
  companyId: string;
  primaryCode: string | null;
}) {
  const links = await prisma.autopartAccount.findMany({
    where: { companyId: input.companyId },
    select: { accountCode: true },
  });
  const primaryKey = normaliseAssignedAutopartCode(input.primaryCode).key;
  const assessments = [];
  for (const link of links) {
    const normalised = normaliseAssignedAutopartCode(link.accountCode);
    const claims = normalised.key ? await claimsForKey(normalised.key) : [];
    assessments.push(
      classifyLinkedMasterAccount({
        companyId: input.companyId,
        accountCode: link.accountCode,
        primaryKey,
        claims,
      }),
    );
  }
  return assessments;
}

export type AutopartVerificationPreview = Omit<AutopartVerificationPlan, "eligibleCompanyIds">;

export async function previewAutopartAccountVerification(
  actorUserId: string,
): Promise<AutopartVerificationPreview> {
  await requireVerificationAdmin(actorUserId);
  const graph = await loadOwnershipGraph();
  const plan = planAutopartAccountVerification(graph);
  return {
    companiesWithAssignedIds: plan.companiesWithAssignedIds,
    alreadyVerified: plan.alreadyVerified,
    eligible: plan.eligible,
    linked407exp: plan.linked407exp,
    conflicts: plan.conflicts,
    manualReview: plan.manualReview,
    samples: plan.samples,
  };
}

/**
 * Timestamp eligible mappings. Does not set a staff verifier, and does not change
 * company status, portal access, pricing, credit, invoices, orders, or sales history.
 */
export async function applyAutopartAccountVerification(
  actorUserId: string,
  raw: { confirmation?: string | null },
) {
  await requireVerificationAdmin(actorUserId);
  if (raw.confirmation !== AUTOPART_ACCOUNT_VERIFICATION_CONFIRMATION) {
    throw new AuthError(
      "Confirmation phrase is required before recording Autopart verification",
      "CONFIRMATION_REQUIRED",
      400,
    );
  }

  const graph = await loadOwnershipGraph();
  const plan = planAutopartAccountVerification(graph);
  const verifiedAt = new Date();
  let applied = 0;
  const chunkSize = 200;
  for (let index = 0; index < plan.eligibleCompanyIds.length; index += chunkSize) {
    const ids = plan.eligibleCompanyIds.slice(index, index + chunkSize);
    const result = await prisma.company.updateMany({
      where: { id: { in: ids }, autopartCustomerCodeVerifiedAt: null },
      data: { autopartCustomerCodeVerifiedAt: verifiedAt },
    });
    applied += result.count;
  }

  await recordAuditEvent({
    action: "company.autopart_account.bulk_verified",
    entityType: "Company",
    actorUserId,
    metadata: {
      attribution: "automatic",
      confirmation: AUTOPART_ACCOUNT_VERIFICATION_CONFIRMATION,
      applied,
      eligible: plan.eligible,
      alreadyVerified: plan.alreadyVerified,
      conflicts: plan.conflicts,
      manualReview: plan.manualReview,
      linked407exp: plan.linked407exp,
      sampleCodes: plan.samples.eligible.map((row) => row.code),
    },
  });

  return {
    applied,
    alreadyVerified: plan.alreadyVerified,
    eligible: plan.eligible,
    conflicts: plan.conflicts,
    manualReview: plan.manualReview,
    linked407exp: plan.linked407exp,
    attribution: "automatic" as const,
  };
}
