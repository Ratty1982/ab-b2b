import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants } from "@/server/rbac/access";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";
import { normalizeAutopartCustomerCode } from "@/server/companies/autopart-account";
import { autopartAccountsEqual, normaliseAccountToken } from "@/domain/autopart-report-money";

const aliasSchema = z.object({
  companyId: z.string().cuid(),
  alias: z.string().min(1).max(80),
  note: z.string().max(500).optional().nullable(),
});

/**
 * Staff-verified extra Autopart account code for ongoing 504 / TRM21QC matching.
 * Does not import sales history, approve a trade application, or enable portal login.
 */
export async function verifyAutopartAccountAlias(actorUserId: string, raw: unknown) {
  const input = aliasSchema.parse(raw);
  const profile = await requireSystemPermission(actorUserId, "companies.edit");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade customers cannot manage Autopart account aliases", "FORBIDDEN", 403);
  }
  if (!grants(profile, "admin.access", "sales.view_all_accounts")) {
    const ok = await canAccessCompanyAsSales(profile, input.companyId);
    if (!ok) throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
  }

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { id: true, autopartCustomerCode: true, autopartCustomerCodeVerifiedAt: true },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);
  if (!company.autopartCustomerCode || !company.autopartCustomerCodeVerifiedAt) {
    throw new AuthError(
      "Verify the Autopart customer account before adding aliases",
      "AUTOPART_NOT_VERIFIED",
      400,
    );
  }
  const alias = normaliseAccountToken(input.alias);
  if (!alias) throw new AuthError("Invalid alias", "VALIDATION", 400);
  const primary = normalizeAutopartCustomerCode(company.autopartCustomerCode);
  if (primary && autopartAccountsEqual(alias, primary)) {
    throw new AuthError("Alias matches the verified account code — not needed", "VALIDATION", 400);
  }

  const row = await prisma.autopartCustomerAccountAlias.upsert({
    where: { companyId_alias: { companyId: input.companyId, alias } },
    create: {
      companyId: input.companyId,
      alias,
      verifiedById: actorUserId,
      note: input.note ?? null,
    },
    update: {
      verifiedById: actorUserId,
      verifiedAt: new Date(),
      note: input.note ?? null,
    },
  });

  await recordAuditEvent({
    action: "autopart.account_alias_verified",
    entityType: "Company",
    entityId: input.companyId,
    actorUserId,
    companyId: input.companyId,
    after: { alias, aliasId: row.id },
  });

  return { id: row.id, alias: row.alias, companyId: input.companyId };
}
