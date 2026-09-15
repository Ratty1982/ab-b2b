import { prisma } from "@/infra/database/client";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";

/**
 * Sales account access via CompanyAssignment.
 * - sales.view_all_accounts → any company
 * - sales.view_team_accounts → companies assigned to self or managed team
 * - sales.view_own_accounts → companies assigned to this SalesRep only
 */
export async function canAccessCompanyAsSales(
  profile: LoadedAccessProfile,
  companyId: string,
): Promise<boolean> {
  if (hasPermission(profile, "sales.view_all_accounts") || hasPermission(profile, "admin.access")) {
    return true;
  }

  if (!profile.salesRepId) return false;

  if (hasPermission(profile, "sales.view_own_accounts")) {
    const own = await prisma.companyAssignment.findFirst({
      where: { companyId, salesRepId: profile.salesRepId },
      select: { id: true },
    });
    if (own) return true;
  }

  if (hasPermission(profile, "sales.view_team_accounts")) {
    const teamRepIds = await getTeamSalesRepIds(profile.salesRepId);
    const teamHit = await prisma.companyAssignment.findFirst({
      where: { companyId, salesRepId: { in: teamRepIds } },
      select: { id: true },
    });
    if (teamHit) return true;
  }

  return false;
}

export async function getAccessibleCompanyIdsForSales(
  profile: LoadedAccessProfile,
): Promise<string[] | "all"> {
  if (hasPermission(profile, "sales.view_all_accounts") || hasPermission(profile, "admin.access")) {
    return "all";
  }

  if (!profile.salesRepId) return [];

  const repIds: string[] = [];
  if (hasPermission(profile, "sales.view_own_accounts")) {
    repIds.push(profile.salesRepId);
  }
  if (hasPermission(profile, "sales.view_team_accounts")) {
    const team = await getTeamSalesRepIds(profile.salesRepId);
    for (const id of team) {
      if (!repIds.includes(id)) repIds.push(id);
    }
  }

  if (repIds.length === 0) return [];

  const rows = await prisma.companyAssignment.findMany({
    where: { salesRepId: { in: repIds } },
    select: { companyId: true },
  });
  return [...new Set(rows.map((r) => r.companyId))];
}

async function getTeamSalesRepIds(managerOrSelfId: string): Promise<string[]> {
  const members = await prisma.salesRep.findMany({
    where: {
      OR: [{ id: managerOrSelfId }, { managerId: managerOrSelfId }],
      active: true,
    },
    select: { id: true },
  });
  return members.map((m) => m.id);
}
