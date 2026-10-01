/**
 * Sales Intelligence → CRM Task follow-up bridge.
 * Human-initiated only. Validates SI context server-side before snapshotting.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { resolveSalesIntelligenceCompanyScope } from "@/server/sales-intelligence/scope";
import { resolveSalesRepAssignmentRoute } from "@/server/sales/account-manager";
import { recordAuditEvent } from "@/server/audit/record";
import { todayLondonDateOnly } from "@/domain/sales-history-period";
import {
  defaultFollowupSubject,
  dueAtFromDateOnly,
  formatFollowupDescription,
  resolveFollowupDueDate,
  siFollowupReasonLabel,
  siFollowupSourceLabel,
  type SiFollowupReason,
  type SiFollowupSnapshot,
  type SiFollowupSourceModule,
} from "@/domain/sales-followup";
import { getCustomerGapAnalysis } from "@/server/sales-intelligence/gap";
import { getCustomerRangeOpportunities } from "@/server/sales-intelligence/opportunity";
import { getCustomerSalesEnquiry } from "@/server/sales-intelligence/enquiry";
import { getCustomerRebateAnalysis } from "@/server/sales-intelligence/rebate";
import { ROUTES } from "@/lib/app-nav";

async function requireFollowupActor(actorUserId: string): Promise<LoadedAccessProfile> {
  const profile = await requireSystemPermission(actorUserId, "sales_intelligence.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Sales Intelligence follow-ups are internal only", "FORBIDDEN", 403);
  }
  if (!hasPermission(profile, "tasks.manage") && !hasPermission(profile, "crm.activities.create")) {
    throw new AuthError("Not permitted to create CRM tasks", "FORBIDDEN", 403);
  }
  return profile;
}

async function assertCompanyInScope(profile: LoadedAccessProfile, companyId: string) {
  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  if (scope === "all") return;
  if (!scope.includes(companyId)) {
    throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
  }
}

const periodBits = {
  period: z.string().optional().nullable(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  compare: z.string().optional().nullable(),
  compareFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  compareTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
};

const previewSchema = z.object({
  sourceModule: z.enum([
    "SALES_ENQUIRY",
    "GAP_ANALYSIS",
    "RANGE_OPPORTUNITY",
    "REBATE_ANALYSIS",
    "PORTFOLIO",
  ]),
  sourceReason: z
    .enum([
      "STOPPED",
      "DECREASED",
      "INCREASED",
      "NEW",
      "RANGE_GAP",
      "NET_SPEND_REVIEW",
      "CUSTOMER",
      "PRODUCT",
      "PURCHASE_GAP",
      "DORMANT",
      "DECLINING",
      "CROSS_SELL",
    ])
    .optional(),
  companyId: z.string().min(1),
  sku: z.string().max(120).optional().nullable(),
  ...periodBits,
  opportunityPeriod: z.string().optional().nullable(),
});

const createSchema = previewSchema.extend({
  title: z.string().min(1).max(200),
  notes: z.string().max(4000).optional().nullable(),
  assigneeId: z.string().min(1),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional(),
  duePreset: z.enum(["TODAY", "TOMORROW", "IN_3_DAYS", "IN_1_WEEK", "CUSTOM"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  allowDuplicate: z.boolean().optional(),
});

function periodLabel(from: string | null | undefined, to: string | null | undefined): string {
  if (!from && !to) return "All history";
  if (from && to) return `${from} → ${to}`;
  return from || to || "—";
}

function qs(params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function buildSnapshot(
  actorUserId: string,
  input: z.infer<typeof previewSchema>,
): Promise<SiFollowupSnapshot> {
  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { id: true, name: true, autopartCustomerCode: true },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const capturedAt = new Date().toISOString();

  if (input.sourceModule === "GAP_ANALYSIS") {
    const sku = input.sku?.trim();
    if (!sku) throw new AuthError("SKU is required for Gap Analysis follow-up", "BAD_REQUEST", 400);
    const gapStatus =
      input.sourceReason && ["STOPPED", "DECREASED", "INCREASED", "NEW"].includes(input.sourceReason)
        ? (input.sourceReason as "STOPPED")
        : ("ALL_CHANGES" as const);
    const gapForRow = await getCustomerGapAnalysis(actorUserId, {
      companyId: input.companyId,
      period: input.period ?? "CUSTOM",
      from: input.from ?? null,
      to: input.to ?? null,
      compare: input.compare ?? "PREVIOUS",
      compareFrom: input.compareFrom ?? null,
      compareTo: input.compareTo ?? null,
      q: sku,
      status: gapStatus,
      page: 1,
      pageSize: 100,
    });
    const row = gapForRow.items.items.find(
      (r) => r.sku.trim().toUpperCase() === sku.toUpperCase(),
    );
    if (!row) {
      throw new AuthError(
        "No matching Gap Analysis result for this customer/SKU in the selected periods",
        "NOT_FOUND",
        404,
      );
    }
    const reason = row.status as SiFollowupReason;
    if (!["STOPPED", "DECREASED", "INCREASED", "NEW"].includes(reason)) {
      throw new AuthError("Gap row has no actionable change status", "BAD_REQUEST", 400);
    }
    if (input.sourceReason && input.sourceReason !== reason) {
      throw new AuthError("Gap classification does not match the requested reason", "BAD_REQUEST", 400);
    }
    let productId: string | null = null;
    if (row.inCatalogue) {
      const v = await prisma.productVariant.findFirst({
        where: { sku: { equals: row.sku, mode: "insensitive" } },
        select: { productId: true },
      });
      productId = v?.productId ?? null;
    }
    return {
      sourceModule: "GAP_ANALYSIS",
      sourceReason: reason,
      companyId: company.id,
      companyName: company.name,
      autopartCustomerCode: company.autopartCustomerCode,
      productId,
      sku: row.sku,
      productName: row.name,
      brandName: row.brandName,
      categoryName: row.categoryName,
      historicOnly: !row.inCatalogue,
      selectedPeriod: {
        from: gapForRow.selectedPeriod.from,
        to: gapForRow.selectedPeriod.to,
        label: periodLabel(gapForRow.selectedPeriod.from, gapForRow.selectedPeriod.to),
      },
      comparisonPeriod: {
        from: gapForRow.comparisonPeriod.from,
        to: gapForRow.comparisonPeriod.to,
        label: periodLabel(gapForRow.comparisonPeriod.from, gapForRow.comparisonPeriod.to),
      },
      metrics: {
        "Comparison qty": row.comparisonQty,
        "Comparison net sales": row.comparisonNetSales,
        "Selected qty": row.selectedQty,
        "Selected net sales": row.selectedNetSales,
        "Last purchased": row.lastPurchasedDate,
      },
      deepLinkPath: `${ROUTES.salesIntelligenceGaps}${qs({
        mode: "customers",
        companyId: company.id,
        period: input.period ?? undefined,
        from: input.from ?? undefined,
        to: input.to ?? undefined,
        compare: input.compare ?? undefined,
        compareFrom: input.compareFrom ?? undefined,
        compareTo: input.compareTo ?? undefined,
        q: row.sku,
        status: reason,
      })}`,
      capturedAt,
    };
  }

  if (input.sourceModule === "RANGE_OPPORTUNITY") {
    const sku = input.sku?.trim();
    if (!sku) throw new AuthError("SKU is required for Range Opportunity follow-up", "BAD_REQUEST", 400);
    const opp = await getCustomerRangeOpportunities(actorUserId, {
      companyId: input.companyId,
      period: input.opportunityPeriod ?? input.period ?? "LAST_365",
      from: input.from ?? null,
      to: input.to ?? null,
      q: sku,
      includeBroader: true,
      page: 1,
      pageSize: 100,
    });
    const row = opp.items.items.find((r) => r.sku.trim().toUpperCase() === sku.toUpperCase());
    if (!row) {
      throw new AuthError(
        "No matching Range Opportunity candidate for this customer/SKU",
        "NOT_FOUND",
        404,
      );
    }
    const variant = await prisma.productVariant.findFirst({
      where: { sku: { equals: row.sku, mode: "insensitive" } },
      select: { productId: true },
    });
    return {
      sourceModule: "RANGE_OPPORTUNITY",
      sourceReason: "RANGE_GAP",
      companyId: company.id,
      companyName: company.name,
      autopartCustomerCode: company.autopartCustomerCode,
      productId: variant?.productId ?? null,
      sku: row.sku,
      productName: row.name,
      brandName: row.brandName,
      categoryName: row.categoryName,
      historicOnly: false,
      selectedPeriod: {
        from: opp.analysisPeriod.from,
        to: opp.analysisPeriod.to,
        label: periodLabel(opp.analysisPeriod.from, opp.analysisPeriod.to),
      },
      comparisonPeriod: null,
      metrics: {
        "Range match": row.rangeMatchLabel,
        "Comparable customers": row.cohort,
        "Comparable buyers": row.buyers,
        "Observed adoption": row.adoptionLabel,
        Availability: row.availabilityLabel,
      },
      deepLinkPath: `${ROUTES.salesIntelligenceOpportunities}${qs({
        companyId: company.id,
        period: input.opportunityPeriod ?? input.period ?? "LAST_365",
        from: input.from ?? undefined,
        to: input.to ?? undefined,
        q: row.sku,
      })}`,
      capturedAt,
    };
  }

  if (input.sourceModule === "PORTFOLIO") {
    const { getPortfolioCustomerDetail } = await import("@/server/sales-intelligence/portfolio");
    const detail = await getPortfolioCustomerDetail(actorUserId, {
      companyId: input.companyId,
      period: input.period ?? "THIS_MONTH",
      from: input.from ?? null,
      to: input.to ?? null,
    });
    const reason = (input.sourceReason ?? "CUSTOMER") as SiFollowupReason;
    const allowed = [
      "PURCHASE_GAP",
      "DORMANT",
      "DECLINING",
      "STOPPED",
      "CROSS_SELL",
      "RANGE_GAP",
      "CUSTOMER",
    ];
    if (!allowed.includes(reason)) {
      throw new AuthError("Unsupported portfolio follow-up reason", "BAD_REQUEST", 400);
    }
    let productId: string | null = null;
    const sku = input.sku?.trim() || null;
    if (sku) {
      const v = await prisma.productVariant.findFirst({
        where: { sku: { equals: sku, mode: "insensitive" } },
        select: { productId: true },
      });
      productId = v?.productId ?? null;
    }
    return {
      sourceModule: "PORTFOLIO",
      sourceReason: reason,
      companyId: company.id,
      companyName: company.name,
      autopartCustomerCode: company.autopartCustomerCode,
      productId,
      sku,
      productName: null,
      brandName: null,
      categoryName: null,
      historicOnly: false,
      selectedPeriod: {
        from: detail.period.displayFrom,
        to: detail.period.displayTo,
        label: detail.period.label,
      },
      comparisonPeriod: detail.comparison
        ? {
            from: detail.comparison.from,
            to: detail.comparison.to,
            label: detail.comparison.label,
          }
        : null,
      metrics: {
        "Current net sales": detail.customer.currentNetSales,
        "Previous net sales": detail.customer.previousNetSales,
        Movement: detail.customer.movement,
        Cadence: detail.customer.cadenceSummary,
        "Stopped products": detail.customer.stoppedProductCount,
        Opportunities: detail.customer.opportunityCount,
      },
      deepLinkPath: `${ROUTES.salesIntelligencePortfolio}${qs({
        companyId: company.id,
        period: input.period ?? "THIS_MONTH",
        from: input.from ?? undefined,
        to: input.to ?? undefined,
      })}`,
      capturedAt,
    };
  }

  if (input.sourceModule === "REBATE_ANALYSIS") {
    const rebate = await getCustomerRebateAnalysis(actorUserId, {
      companyId: input.companyId,
      period: input.period ?? "ALL",
      from: input.from ?? null,
      to: input.to ?? null,
    });
    return {
      sourceModule: "REBATE_ANALYSIS",
      sourceReason: "NET_SPEND_REVIEW",
      companyId: company.id,
      companyName: company.name,
      autopartCustomerCode: company.autopartCustomerCode,
      productId: null,
      sku: null,
      productName: null,
      brandName: null,
      categoryName: null,
      historicOnly: false,
      selectedPeriod: {
        from: rebate.period.from,
        to: rebate.period.to,
        label: rebate.period.label,
      },
      comparisonPeriod: null,
      metrics: {
        "Invoice sales": rebate.summary.invoiceSales,
        Credits: rebate.summary.credits,
        "Net spend": rebate.summary.netSpend,
      },
      deepLinkPath: `${ROUTES.salesIntelligenceRebates}${qs({
        companyId: company.id,
        period: input.period ?? "ALL",
        from: input.from ?? undefined,
        to: input.to ?? undefined,
      })}`,
      capturedAt,
    };
  }

  // SALES_ENQUIRY
  const sku = input.sku?.trim() || null;
  const enquiry = await getCustomerSalesEnquiry(actorUserId, {
    companyId: input.companyId,
    period: input.period ?? "CUSTOM",
    from: input.from ?? null,
    to: input.to ?? null,
    q: sku,
    page: 1,
    pageSize: 50,
  });
  let productId: string | null = null;
  let productName: string | null = null;
  let brandName: string | null = null;
  let categoryName: string | null = null;
  let historicOnly = false;
  let lastPurchased: string | null = null;
  let productNet: string | null = null;
  let productUnits: number | null = null;
  if (sku) {
    const row = enquiry.products.items.find((p) => p.sku.trim().toUpperCase() === sku.toUpperCase());
    if (!row) {
      throw new AuthError("Product not found in Sales Enquiry for this period", "NOT_FOUND", 404);
    }
    productName = row.name;
    brandName = row.brandName;
    categoryName = row.categoryName;
    historicOnly = !row.inCatalogue;
    lastPurchased = row.lastPurchasedDate;
    productNet = row.netSales;
    productUnits = row.units;
    if (row.inCatalogue) {
      const v = await prisma.productVariant.findFirst({
        where: { sku: { equals: row.sku, mode: "insensitive" } },
        select: { productId: true },
      });
      productId = v?.productId ?? null;
    }
  }
  return {
    sourceModule: "SALES_ENQUIRY",
    sourceReason: sku ? "PRODUCT" : "CUSTOMER",
    companyId: company.id,
    companyName: company.name,
    autopartCustomerCode: company.autopartCustomerCode,
    productId,
    sku,
    productName,
    brandName,
    categoryName,
    historicOnly,
    selectedPeriod: {
      from: enquiry.period.from,
      to: enquiry.period.to,
      label: periodLabel(enquiry.period.from, enquiry.period.to),
    },
    comparisonPeriod: null,
    metrics: sku
      ? {
          "Net sales": productNet,
          Units: productUnits,
          "Last purchased": lastPurchased,
        }
      : {
          "Invoice sales": enquiry.summary.invoiceSales,
          Credits: enquiry.summary.credits,
          "Net sales": enquiry.summary.netSales,
          Units: enquiry.summary.units,
        },
    deepLinkPath: `${ROUTES.salesIntelligence}${qs({
      mode: "customers",
      companyId: company.id,
      period: input.period ?? undefined,
      from: input.from ?? undefined,
      to: input.to ?? undefined,
      ...(sku ? { q: sku } : {}),
    })}`,
    capturedAt,
  };
}

async function findOpenDuplicate(snapshot: SiFollowupSnapshot) {
  return prisma.task.findFirst({
    where: {
      companyId: snapshot.companyId,
      sourceModule: snapshot.sourceModule,
      sourceReason: snapshot.sourceReason,
      sourceSku: snapshot.sku,
      status: { in: ["OPEN", "IN_PROGRESS"] },
    },
    select: {
      id: true,
      title: true,
      status: true,
      dueAt: true,
      assignee: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function resolveDefaultAssignee(companyId: string, actorUserId: string) {
  const route = await resolveSalesRepAssignmentRoute(companyId);
  if (route?.assigneeUserId) {
    return {
      id: route.assigneeUserId,
      name: route.accountManagerName,
      salesRepId: route.salesRepId,
    };
  }
  const user = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new AuthError("User not found", "NOT_FOUND", 404);
  return {
    id: user.id,
    name: user.name || user.email,
    salesRepId: null as string | null,
  };
}

async function assertAssignable(profile: LoadedAccessProfile, assigneeId: string, companyId: string) {
  const user = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { id: true, status: true, actorType: true },
  });
  if (!user || user.status !== "ACTIVE" || user.actorType === "TRADE") {
    throw new AuthError("Invalid task assignee", "BAD_REQUEST", 400);
  }
  // Non-managers may only assign to the company's sales rep or themselves.
  if (!hasPermission(profile, "crm.manage") && !hasPermission(profile, "sales.view_all_accounts")) {
    const route = await resolveSalesRepAssignmentRoute(companyId);
    const allowed = new Set<string>([profile.userId]);
    if (route?.assigneeUserId) allowed.add(route.assigneeUserId);
    if (!allowed.has(assigneeId)) {
      throw new AuthError("Not permitted to assign this task to that user", "FORBIDDEN", 403);
    }
  }
}

export async function previewSalesIntelligenceFollowUp(actorUserId: string, raw: unknown) {
  const profile = await requireFollowupActor(actorUserId);
  const input = previewSchema.parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);
  const snapshot = await buildSnapshot(actorUserId, input);
  const defaultAssignee = await resolveDefaultAssignee(input.companyId, actorUserId);
  const duplicate = await findOpenDuplicate(snapshot);
  const title = defaultFollowupSubject({
    reason: snapshot.sourceReason,
    productName: snapshot.productName,
    sku: snapshot.sku,
    companyName: snapshot.companyName,
  });

  const assigneeOptions = [
    {
      id: defaultAssignee.id,
      name: defaultAssignee.name,
    },
  ];
  if (defaultAssignee.id !== actorUserId) {
    const me = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, name: true, email: true },
    });
    if (me) {
      assigneeOptions.push({ id: me.id, name: me.name || me.email });
    }
  }

  return {
    snapshot,
    title,
    reasonLabel: siFollowupReasonLabel(snapshot.sourceReason),
    sourceLabel: siFollowupSourceLabel(snapshot.sourceModule),
    defaultAssignee,
    assigneeOptions,
    defaultPriority: "NORMAL" as const,
    duplicate: duplicate
      ? {
          id: duplicate.id,
          title: duplicate.title,
          status: duplicate.status,
          dueAt: duplicate.dueAt?.toISOString() ?? null,
          assigneeName: duplicate.assignee?.name || duplicate.assignee?.email || null,
        }
      : null,
  };
}

export async function createSalesIntelligenceFollowUp(actorUserId: string, raw: unknown) {
  const profile = await requireFollowupActor(actorUserId);
  const input = createSchema.parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);
  const snapshot = await buildSnapshot(actorUserId, input);
  await assertAssignable(profile, input.assigneeId, input.companyId);

  const duplicate = await findOpenDuplicate(snapshot);
  if (duplicate && !input.allowDuplicate) {
    return {
      created: false as const,
      duplicate: {
        id: duplicate.id,
        title: duplicate.title,
        status: duplicate.status,
        dueAt: duplicate.dueAt?.toISOString() ?? null,
        assigneeName: duplicate.assignee?.name || duplicate.assignee?.email || null,
      },
      snapshot,
    };
  }

  const today = todayLondonDateOnly();
  const dueDateOnly = resolveFollowupDueDate({
    preset: input.duePreset,
    customDate: input.dueDate ?? null,
    today,
  });
  const dueAt = dueAtFromDateOnly(dueDateOnly);
  const description = formatFollowupDescription(snapshot, input.notes);

  const task = await prisma.task.create({
    data: {
      companyId: snapshot.companyId,
      assigneeId: input.assigneeId,
      createdById: actorUserId,
      title: input.title.trim().slice(0, 200),
      description,
      status: "OPEN",
      priority: input.priority ?? "NORMAL",
      taskType: "FOLLOW_UP",
      dueAt,
      sourceModule: snapshot.sourceModule,
      sourceReason: snapshot.sourceReason,
      sourceSku: snapshot.sku,
      productId: snapshot.productId,
      sourceContext: snapshot as unknown as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      title: true,
      dueAt: true,
      priority: true,
      status: true,
      assignee: { select: { id: true, name: true, email: true } },
    },
  });

  await prisma.activity.create({
    data: {
      companyId: snapshot.companyId,
      userId: actorUserId,
      type: "FOLLOW_UP",
      subject: "Sales follow-up created",
      body: `${profile.name || "Staff"} created a follow-up from ${siFollowupSourceLabel(snapshot.sourceModule)}${
        snapshot.productName || snapshot.sku
          ? ` for ${snapshot.productName ?? snapshot.sku}`
          : ""
      }.`,
      metadata: {
        kind: "sales_intelligence_followup",
        taskId: task.id,
        sourceModule: snapshot.sourceModule,
        sourceReason: snapshot.sourceReason,
        sku: snapshot.sku,
      },
    },
  });

  await recordAuditEvent({
    action: duplicate && input.allowDuplicate
      ? "sales_followup.duplicate_override"
      : "sales_followup.created",
    entityType: "Task",
    entityId: task.id,
    actorUserId,
    companyId: snapshot.companyId,
    metadata: {
      sourceModule: snapshot.sourceModule,
      sourceReason: snapshot.sourceReason,
      sku: snapshot.sku,
      assigneeId: input.assigneeId,
    },
  });

  return {
    created: true as const,
    task: {
      id: task.id,
      title: task.title,
      dueAt: task.dueAt?.toISOString() ?? null,
      dueDate: dueDateOnly,
      priority: task.priority,
      status: task.status,
      assigneeName: task.assignee?.name || task.assignee?.email || null,
      href: `${ROUTES.crmTasks}?taskId=${task.id}`,
    },
    snapshot,
  };
}

export async function listCrmTasks(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "tasks.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Tasks are internal only", "FORBIDDEN", 403);
  }
  const input = z
    .object({
      q: z.string().max(200).optional().nullable(),
      status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED", "OPEN_ACTIVE"]).optional().nullable(),
      sourceModule: z
        .enum([
          "SALES_ENQUIRY",
          "GAP_ANALYSIS",
          "RANGE_OPPORTUNITY",
          "REBATE_ANALYSIS",
          "PORTFOLIO",
          "ALL",
        ])
        .optional()
        .nullable(),
      assigneeId: z.string().optional().nullable(),
      companyId: z.string().optional().nullable(),
      due: z.enum(["ALL", "TODAY", "OVERDUE", "UPCOMING", "COMPLETED"]).optional().nullable(),
      priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional().nullable(),
      page: z.number().int().min(1).max(10_000).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    })
    .parse(raw ?? {});

  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  const where: Prisma.TaskWhereInput = {};
  if (scope !== "all") {
    where.companyId = { in: scope.length ? scope : ["__none__"] };
  }
  if (input.due === "COMPLETED") {
    where.status = "DONE";
  } else if (input.status === "OPEN_ACTIVE" || !input.status) {
    where.status = { in: ["OPEN", "IN_PROGRESS"] };
  } else {
    where.status = input.status;
  }
  if (input.sourceModule && input.sourceModule !== "ALL") {
    where.sourceModule = input.sourceModule;
  }
  if (input.assigneeId) where.assigneeId = input.assigneeId;
  if (input.companyId) {
    // Never let a client companyId expand past actor scope.
    await assertCompanyInScope(profile, input.companyId);
    where.companyId = input.companyId;
  }
  if (input.priority) where.priority = input.priority;

  const today = todayLondonDateOnly();
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const todayEnd = new Date(`${today}T23:59:59.999Z`);
  if (input.due === "TODAY") {
    where.dueAt = { gte: todayStart, lte: todayEnd };
  } else if (input.due === "OVERDUE") {
    where.dueAt = { lt: todayStart };
  } else if (input.due === "UPCOMING") {
    where.dueAt = { gt: todayEnd };
  }
  if (input.q?.trim()) {
    const qq = input.q.trim();
    where.OR = [
      { title: { contains: qq, mode: "insensitive" } },
      { sourceSku: { contains: qq, mode: "insensitive" } },
      { company: { name: { contains: qq, mode: "insensitive" } } },
    ];
  }

  // Sales reps without manage-all see assigned-to-them or created-by-them within scope.
  if (
    !hasPermission(profile, "crm.manage") &&
    !hasPermission(profile, "sales.view_all_accounts") &&
    !hasPermission(profile, "admin.access")
  ) {
    where.AND = [
      {
        OR: [{ assigneeId: actorUserId }, { createdById: actorUserId }],
      },
    ];
  }

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        sourceModule: true,
        sourceReason: true,
        sourceSku: true,
        company: { select: { id: true, name: true, autopartCustomerCode: true } },
        assignee: { select: { id: true, name: true, email: true } },
        createdAt: true,
      },
    }),
  ]);

  return {
    items: rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt?.toISOString() ?? null,
      sourceModule: t.sourceModule as SiFollowupSourceModule | null,
      sourceReason: t.sourceReason as SiFollowupReason | null,
      sourceLabel: t.sourceModule
        ? siFollowupSourceLabel(t.sourceModule as SiFollowupSourceModule)
        : null,
      sourceSku: t.sourceSku,
      company: t.company,
      assigneeName: t.assignee?.name || t.assignee?.email || null,
      createdAt: t.createdAt.toISOString(),
    })),
    page,
    pageSize,
    total,
  };
}

export async function getCrmTask(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "tasks.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Tasks are internal only", "FORBIDDEN", 403);
  }
  const { taskId } = z.object({ taskId: z.string().min(1) }).parse(raw ?? {});
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      company: {
        select: { id: true, name: true, autopartCustomerCode: true, accountNumber: true },
      },
      assignee: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      product: { select: { id: true, name: true } },
    },
  });
  if (!task) throw new AuthError("Task not found", "NOT_FOUND", 404);
  if (task.companyId) {
    await assertCompanyInScope(profile, task.companyId);
  }
  if (
    !hasPermission(profile, "crm.manage") &&
    !hasPermission(profile, "sales.view_all_accounts") &&
    !hasPermission(profile, "admin.access")
  ) {
    if (task.assigneeId !== actorUserId && task.createdById !== actorUserId) {
      throw new AuthError("No access to this task", "FORBIDDEN", 403);
    }
  }

  const snapshot = (task.sourceContext ?? null) as SiFollowupSnapshot | null;
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    sourceModule: task.sourceModule as SiFollowupSourceModule | null,
    sourceReason: task.sourceReason as SiFollowupReason | null,
    sourceLabel: task.sourceModule
      ? siFollowupSourceLabel(task.sourceModule as SiFollowupSourceModule)
      : null,
    reasonLabel: task.sourceReason
      ? siFollowupReasonLabel(task.sourceReason as SiFollowupReason)
      : null,
    sourceSku: task.sourceSku,
    company: task.company,
    assignee: task.assignee
      ? { id: task.assignee.id, name: task.assignee.name || task.assignee.email }
      : null,
    createdBy: task.createdBy
      ? { id: task.createdBy.id, name: task.createdBy.name || task.createdBy.email }
      : null,
    product: task.product,
    snapshot,
    deepLinkPath: snapshot?.deepLinkPath ?? null,
  };
}

export async function completeCrmTask(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "tasks.manage");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Tasks are internal only", "FORBIDDEN", 403);
  }
  const { taskId } = z.object({ taskId: z.string().min(1) }).parse(raw ?? {});
  const existing = await getCrmTask(actorUserId, { taskId });
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { status: "DONE", completedAt: new Date() },
    select: { id: true, status: true, completedAt: true, sourceModule: true },
  });
  if (existing.sourceModule) {
    await recordAuditEvent({
      action: "sales_followup.completed",
      entityType: "Task",
      entityId: updated.id,
      actorUserId,
      companyId: existing.company?.id ?? null,
      metadata: { sourceModule: existing.sourceModule, sourceReason: existing.sourceReason },
    });
  }
  return {
    id: updated.id,
    status: updated.status,
    completedAt: updated.completedAt?.toISOString() ?? null,
  };
}

export async function rescheduleCrmTask(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "tasks.manage");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Tasks are internal only", "FORBIDDEN", 403);
  }
  const input = z
    .object({
      taskId: z.string().min(1),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .parse(raw ?? {});
  await getCrmTask(actorUserId, { taskId: input.taskId });
  const updated = await prisma.task.update({
    where: { id: input.taskId },
    data: { dueAt: dueAtFromDateOnly(input.dueDate) },
    select: { id: true, dueAt: true },
  });
  return { id: updated.id, dueAt: updated.dueAt?.toISOString() ?? null };
}
