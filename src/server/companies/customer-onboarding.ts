/**
 * Read model for customer onboarding. Does not create companies, import sales,
 * send invitations, or change verification.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { deriveCustomerOnboarding, type CustomerOnboarding } from "@/domain/customer-onboarding";
import type { LoadedAccessProfile } from "@/server/rbac/access";
import { grants, hasPermission } from "@/server/rbac/access";

function historyKind(evidence: Prisma.JsonValue | null | undefined): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const kind = evidence["kind"];
  return typeof kind === "string" ? kind : null;
}

export async function loadCustomerOnboarding(input: {
  profile: LoadedAccessProfile;
  companyId: string;
  status: string;
  salesCode: string | null;
  salesCodeVerified: boolean;
  ownershipAmbiguous: boolean;
  ownershipNote: string | null;
  priceListName: string | null;
  paymentTerms: string | null;
  customerGroupName: string | null;
  taxStatus: string;
  contactCount: number;
  addressCount: number;
  portalActiveUsers: number;
  portalPending: number;
}): Promise<
  CustomerOnboarding & {
    orders: { count: number; recent: Array<{ id: string; orderNumber: string; status: string; at: string }> };
    quotes: { count: number };
    masterLinked: boolean;
  }
> {
  const canViewMaster = input.profile.permissions.has("autopart.customer.view");
  const [cutover, masterAccounts, orderCount, recentOrders, quoteCount] = await Promise.all([
    prisma.customerSalesCutover.findUnique({
      where: { companyId: input.companyId },
      select: { historyStatus: true, evidence: true },
    }),
    prisma.autopartAccount.findMany({
      where: { companyId: input.companyId },
      orderBy: { accountCode: "asc" },
      take: 8,
      select: { accountCode: true },
    }),
    prisma.order.count({ where: { companyId: input.companyId } }),
    prisma.order.findMany({
      where: { companyId: input.companyId },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, orderNumber: true, status: true, placedAt: true, createdAt: true },
    }),
    prisma.quote.count({ where: { companyId: input.companyId } }),
  ]);

  const historyStatus = cutover?.historyStatus ?? "NOT_STARTED";
  const progress = deriveCustomerOnboarding({
    status: input.status,
    contactCount: input.contactCount,
    addressCount: input.addressCount,
    salesCode: input.salesCode,
    salesCodeVerified: input.salesCodeVerified,
    ownershipAmbiguous: input.ownershipAmbiguous,
    ownershipNote: input.ownershipNote,
    masterLinked: masterAccounts.length > 0,
    masterCodes: canViewMaster ? masterAccounts.map((account) => account.accountCode) : [],
    masterRestricted: !canViewMaster,
    priceListName: input.priceListName,
    paymentTerms: input.paymentTerms,
    customerGroupName: input.customerGroupName,
    taxStatus: input.taxStatus,
    historyStatus,
    historyKind: historyKind(cutover?.evidence ?? null),
    portalActiveUsers: input.portalActiveUsers,
    portalPending: input.portalPending,
    canEditCompany: grants(input.profile, "companies.edit", "admin.access"),
    canEditContacts: grants(input.profile, "contacts.edit", "admin.access"),
    canManageUsers: grants(input.profile, "companies.manage_users", "admin.access"),
    canImportHistory:
      hasPermission(input.profile, "orders.view") &&
      grants(input.profile, "admin.access", "orders.edit"),
  });

  return {
    ...progress,
    masterLinked: masterAccounts.length > 0,
    orders: {
      count: orderCount,
      recent: recentOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        at: (order.placedAt ?? order.createdAt).toISOString(),
      })),
    },
    quotes: { count: quoteCount },
  };
}
