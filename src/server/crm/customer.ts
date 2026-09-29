/**
 * Customer CRM workspace snapshot + enriched timeline.
 * Read-only against Autopart history; does not alter company lifecycle.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";
import { ROUTES } from "@/lib/app-nav";
import { resolveSalesRepAssignmentRoute } from "@/server/sales/account-manager";
import {
  summarizeHistoricLinesDto,
  loadHistoricSalesLines,
} from "@/server/sales-intelligence/historic-lines";
import { ALL_DATED_HISTORY_QUERY_RANGE } from "@/domain/sales-history-period";
import { OPEN_OPPORTUNITY_STAGES } from "@/domain/crm";
import {
  assertCrmCompanyAccess,
  requireCrmViewer,
} from "@/server/crm/scope";

export async function getCompanyCrmWorkspace(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  const { companyId } = z.object({ companyId: z.string().min(1) }).parse(raw ?? {});
  await assertCrmCompanyAccess(profile, companyId);

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      tradingName: true,
      status: true,
      autopartCustomerCode: true,
      accountNumber: true,
      primaryEmail: true,
      phone: true,
      paymentTerms: true,
      contacts: {
        where: { isPrimary: true },
        take: 1,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          mobile: true,
        },
      },
      addresses: {
        where: { OR: [{ isDefaultBilling: true }, { isDefaultDelivery: true }] },
        take: 2,
        select: {
          line1: true,
          line2: true,
          town: true,
          county: true,
          postcode: true,
          isDefaultBilling: true,
          isDefaultDelivery: true,
        },
      },
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const route = await resolveSalesRepAssignmentRoute(companyId);

  const [
    openTasks,
    openOpps,
    openQuotes,
    recentOrders,
    activities,
    notes,
    lines,
  ] = await Promise.all([
    prisma.task.count({
      where: { companyId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    }),
    prisma.opportunity.count({
      where: { companyId, stage: { in: [...OPEN_OPPORTUNITY_STAGES] } },
    }),
    prisma.quote.count({
      where: {
        companyId,
        status: { in: ["DRAFT", "SENT", "VIEWED", "ACCEPTED"] },
      },
    }),
    prisma.order.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        grandTotal: true,
        createdAt: true,
      },
    }),
    prisma.activity.findMany({
      where: { companyId },
      orderBy: { occurredAt: "desc" },
      take: 40,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.note.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { author: { select: { name: true, email: true } } },
    }),
    company.autopartCustomerCode
      ? loadHistoricSalesLines({
          companyId,
          range: ALL_DATED_HISTORY_QUERY_RANGE,
        })
      : Promise.resolve([]),
  ]);

  const summary = lines.length ? summarizeHistoricLinesDto(lines) : null;
  let lastPurchased: string | null = null;
  for (const l of lines) {
    const d = l.document?.documentDate
      ? l.document.documentDate.toISOString().slice(0, 10)
      : null;
    if (d && (!lastPurchased || d > lastPurchased)) lastPurchased = d;
  }

  const primary = company.contacts[0] ?? null;
  const address =
    company.addresses.find((a) => a.isDefaultDelivery) ||
    company.addresses.find((a) => a.isDefaultBilling) ||
    null;

  const timeline = [
    ...activities.map((a) => ({
      id: `act-${a.id}`,
      kind: "activity" as const,
      type: a.type,
      at: a.occurredAt.toISOString(),
      title: a.subject ?? a.type,
      body: a.body,
      actor: a.user?.name || a.user?.email || null,
    })),
    ...notes.map((n) => ({
      id: `note-${n.id}`,
      kind: "note" as const,
      type: "NOTE",
      at: n.createdAt.toISOString(),
      title: "Note",
      body: n.body,
      actor: n.author?.name || n.author?.email || null,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 50);

  return {
    company: {
      id: company.id,
      name: company.name,
      tradingName: company.tradingName,
      status: company.status,
      autopartCustomerCode: company.autopartCustomerCode,
      accountNumber: company.accountNumber,
      primaryEmail: company.primaryEmail,
      phone: company.phone,
      paymentTerms: company.paymentTerms,
    },
    salesRep: route
      ? {
          salesRepId: route.salesRepId,
          name: route.accountManagerName,
          userId: route.assigneeUserId,
        }
      : null,
    primaryContact: primary
      ? {
          id: primary.id,
          name: `${primary.firstName} ${primary.lastName}`.trim(),
          email: primary.email,
          phone: primary.phone || primary.mobile,
        }
      : null,
    address: address
      ? {
          line1: address.line1,
          line2: address.line2,
          town: address.town,
          county: address.county,
          postcode: address.postcode,
        }
      : null,
    snapshot: {
      historicNetSales: summary?.netSales ?? null,
      lastPurchased,
      openTasks,
      openOpportunities: openOpps,
      openQuotes,
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        grandTotal: o.grandTotal.toString(),
        createdAt: o.createdAt.toISOString(),
      })),
    },
    timeline,
    links: {
      salesEnquiry: `${ROUTES.salesIntelligence}?mode=customers&companyId=${company.id}`,
      gapAnalysis: `${ROUTES.salesIntelligenceGaps}?mode=customers&companyId=${company.id}`,
      rangeOpportunities: `${ROUTES.salesIntelligenceOpportunities}?companyId=${company.id}`,
      customerAdmin: `/admin/customers/${company.id}`,
      salesCustomer: `/sales/customers/${company.id}`,
    },
  };
}
