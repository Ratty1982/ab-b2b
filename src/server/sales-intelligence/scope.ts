/**
 * Shared Sales Intelligence company scope — used by Sales Enquiry and Gap Analysis.
 */
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";

/**
 * - sales.view_all / admin → all
 * - own/team sales → assigned
 * - sales_intelligence.view without sales scope (e.g. Accounts) → all
 */
export async function resolveSalesIntelligenceCompanyScope(
  profile: LoadedAccessProfile,
): Promise<string[] | "all"> {
  if (hasPermission(profile, "sales.view_all_accounts") || hasPermission(profile, "admin.access")) {
    return "all";
  }
  const scoped = await getAccessibleCompanyIdsForSales(profile);
  if (scoped === "all") return "all";
  if (scoped.length > 0) return scoped;
  if (hasPermission(profile, "sales_intelligence.view")) return "all";
  return [];
}
