/**
 * CRM company / ownership scope — reuses sales assignment access.
 */
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";

export async function requireCrmViewer(actorUserId: string): Promise<LoadedAccessProfile> {
  const profile = await requireSystemPermission(actorUserId, "crm.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("CRM is internal only", "FORBIDDEN", 403);
  }
  return profile;
}

export function canMutateCrmRecords(profile: LoadedAccessProfile): boolean {
  if (hasPermission(profile, "crm.manage") || hasPermission(profile, "admin.access")) {
    return true;
  }
  // Sales staff with crm.view + any sales account scope may work their book.
  return (
    hasPermission(profile, "crm.view") &&
    (hasPermission(profile, "sales.view_own_accounts") ||
      hasPermission(profile, "sales.view_team_accounts") ||
      hasPermission(profile, "sales.view_all_accounts"))
  );
}

export function requireCrmMutator(profile: LoadedAccessProfile) {
  if (!canMutateCrmRecords(profile)) {
    throw new AuthError("Not permitted to change CRM records", "FORBIDDEN", 403);
  }
}

export function canLogCrmActivity(profile: LoadedAccessProfile): boolean {
  return (
    hasPermission(profile, "crm.activities.create") ||
    hasPermission(profile, "crm.manage") ||
    hasPermission(profile, "admin.access")
  );
}

/** Company IDs the actor may see in CRM, or "all". */
export async function resolveCrmCompanyScope(
  profile: LoadedAccessProfile,
): Promise<string[] | "all"> {
  if (
    hasPermission(profile, "crm.manage") ||
    hasPermission(profile, "sales.view_all_accounts") ||
    hasPermission(profile, "admin.access")
  ) {
    return "all";
  }
  const scoped = await getAccessibleCompanyIdsForSales(profile);
  if (scoped === "all") return "all";
  return scoped;
}

export async function assertCrmCompanyAccess(
  profile: LoadedAccessProfile,
  companyId: string,
): Promise<void> {
  const scope = await resolveCrmCompanyScope(profile);
  if (scope === "all") return;
  if (!scope.includes(companyId)) {
    throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
  }
}

/** Lead visibility: owned by actor, or linked company in scope, or manage-all. */
export async function leadVisibleWhere(profile: LoadedAccessProfile) {
  if (
    hasPermission(profile, "crm.manage") ||
    hasPermission(profile, "sales.view_all_accounts") ||
    hasPermission(profile, "admin.access")
  ) {
    return {};
  }
  const scope = await resolveCrmCompanyScope(profile);
  const companyFilter =
    scope === "all"
      ? {}
      : scope.length
        ? { companyId: { in: scope } }
        : { companyId: { in: ["__none__"] } };

  return {
    OR: [
      { ownerId: profile.userId },
      { ...companyFilter, companyId: { not: null } },
      ...(scope !== "all" && scope.length
        ? [{ companyId: { in: scope } }]
        : []),
    ],
  };
}

export async function assertLeadAccess(profile: LoadedAccessProfile, leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, ownerId: true, companyId: true },
  });
  if (!lead) throw new AuthError("Lead not found", "NOT_FOUND", 404);
  if (
    hasPermission(profile, "crm.manage") ||
    hasPermission(profile, "sales.view_all_accounts") ||
    hasPermission(profile, "admin.access")
  ) {
    return lead;
  }
  if (lead.ownerId === profile.userId) return lead;
  if (lead.companyId) {
    await assertCrmCompanyAccess(profile, lead.companyId);
    return lead;
  }
  throw new AuthError("No access to this lead", "FORBIDDEN", 403);
}

export async function assertOpportunityAccess(
  profile: LoadedAccessProfile,
  opportunityId: string,
) {
  const opp = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: { id: true, companyId: true, ownerId: true, stage: true },
  });
  if (!opp) throw new AuthError("Opportunity not found", "NOT_FOUND", 404);
  await assertCrmCompanyAccess(profile, opp.companyId);
  if (
    !hasPermission(profile, "crm.manage") &&
    !hasPermission(profile, "sales.view_all_accounts") &&
    !hasPermission(profile, "admin.access") &&
    !hasPermission(profile, "sales.view_team_accounts")
  ) {
    // Own-account sales: also allow if they own the opportunity
    if (opp.ownerId && opp.ownerId !== profile.userId) {
      // company access already checked — company assignment is enough for own-book
    }
  }
  return opp;
}

export function londonDayBounds(dateOnly: string): { start: Date; end: Date } {
  // Store due dates at UTC noon; compare calendar day via UTC date-only window around London day.
  // For task due filtering we treat dueAt's UTC calendar date as the business date (project convention).
  const start = new Date(`${dateOnly}T00:00:00.000Z`);
  const end = new Date(`${dateOnly}T23:59:59.999Z`);
  return { start, end };
}
