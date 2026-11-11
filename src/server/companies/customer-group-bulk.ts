/**
 * Bulk Customer Group assignment — assign many companies to one AB reporting group.
 * Does not merge companies, change Autopart mappings, verify sales codes, activate,
 * invite, or alter pricing / sales / cutovers.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { CompanyStatus, Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { addCompanyToCustomerGroup } from "@/server/companies/customer-groups";

const MAX_SELECTION = 500;
const PAGE_SIZE_DEFAULT = 50;

async function requireGroupManage(userId: string) {
  const profile = await requireSystemPermission(userId, "customer_groups.manage");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade customers cannot manage Customer Groups", "FORBIDDEN", 403);
  }
  return profile;
}

const searchSchema = z.object({
  q: z.string().trim().max(120).optional().nullable(),
  status: z
    .enum(["PROSPECT", "PENDING_APPROVAL", "ACTIVE", "ON_HOLD", "SUSPENDED", "CLOSED", "ALL"])
    .optional()
    .default("ALL"),
  membership: z.enum(["ALL", "UNGROUPED", "OTHER_GROUP", "TARGET"]).optional().default("ALL"),
  targetGroupId: z.string().cuid(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(PAGE_SIZE_DEFAULT),
});

function buildWhere(input: z.infer<typeof searchSchema>): Prisma.CompanyWhereInput {
  const where: Prisma.CompanyWhereInput = {};
  if (input.status !== "ALL") where.status = input.status as CompanyStatus;
  if (input.membership === "UNGROUPED") where.customerGroupId = null;
  else if (input.membership === "TARGET") where.customerGroupId = input.targetGroupId;
  else if (input.membership === "OTHER_GROUP") {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { customerGroupId: { not: null } },
      { customerGroupId: { not: input.targetGroupId } },
    ];
  }
  const q = input.q?.trim();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { tradingName: { contains: q, mode: "insensitive" } },
      { accountNumber: { contains: q, mode: "insensitive" } },
      { autopartCustomerCode: { contains: q, mode: "insensitive" } },
      { autopartAccountAliases: { some: { alias: { contains: q, mode: "insensitive" } } } },
      { autopartAccounts: { some: { accountCode: { contains: q, mode: "insensitive" } } } },
    ];
  }
  return where;
}

function classifyRow(input: {
  customerGroupId: string | null;
  targetGroupId: string;
  autopartCustomerCode: string | null;
  masterCodes: string[];
}) {
  const linkedCodes = [
    ...(input.autopartCustomerCode ? [input.autopartCustomerCode] : []),
    ...input.masterCodes.filter((code) => code !== input.autopartCustomerCode),
  ];
  const membership =
    input.customerGroupId === input.targetGroupId
      ? ("TARGET" as const)
      : input.customerGroupId
        ? ("OTHER_GROUP" as const)
        : ("UNGROUPED" as const);
  const needsReview = linkedCodes.length === 0;
  return { membership, linkedCodes, needsReview };
}

export async function searchCompaniesForBulkCustomerGroupAssign(
  actorUserId: string,
  raw: unknown,
) {
  await requireGroupManage(actorUserId);
  const input = searchSchema.parse(raw);
  const group = await prisma.customerGroup.findUnique({
    where: { id: input.targetGroupId },
    select: { id: true, name: true, active: true },
  });
  if (!group) throw new AuthError("Customer Group not found", "NOT_FOUND", 404);

  const where = buildWhere(input);
  const skip = (input.page - 1) * input.pageSize;
  const [total, rows] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take: input.pageSize,
      select: {
        id: true,
        name: true,
        tradingName: true,
        status: true,
        customerGroupId: true,
        autopartCustomerCode: true,
        updatedAt: true,
        customerGroup: { select: { id: true, name: true } },
        autopartAccounts: {
          select: { accountCode: true },
          orderBy: { accountCode: "asc" },
          take: 8,
        },
      },
    }),
  ]);

  const items = rows.map((row) => {
    const meta = classifyRow({
      customerGroupId: row.customerGroupId,
      targetGroupId: input.targetGroupId,
      autopartCustomerCode: row.autopartCustomerCode,
      masterCodes: row.autopartAccounts.map((a) => a.accountCode),
    });
    return {
      id: row.id,
      name: row.name,
      tradingName: row.tradingName,
      status: row.status,
      customerGroupId: row.customerGroupId,
      customerGroupName: row.customerGroup?.name ?? null,
      autopartCustomerCode: row.autopartCustomerCode,
      autopartAccountCodes: meta.linkedCodes,
      membership: meta.membership,
      needsReview: meta.needsReview,
      updatedAt: row.updatedAt.toISOString(),
    };
  });

  return {
    targetGroup: group,
    total,
    page: input.page,
    pageSize: input.pageSize,
    items,
    counts: {
      pageEligible: items.filter((i) => i.membership === "UNGROUPED").length,
      pageAlreadyInTarget: items.filter((i) => i.membership === "TARGET").length,
      pageOtherGroup: items.filter((i) => i.membership === "OTHER_GROUP").length,
      pageNeedsReview: items.filter((i) => i.needsReview).length,
    },
  };
}

const resolveSchema = searchSchema.omit({ page: true, pageSize: true });

export async function resolveAllCompaniesForBulkCustomerGroupAssign(
  actorUserId: string,
  raw: unknown,
) {
  await requireGroupManage(actorUserId);
  const input = resolveSchema.parse(raw);
  const where = buildWhere({ ...input, page: 1, pageSize: PAGE_SIZE_DEFAULT });
  const total = await prisma.company.count({ where });
  if (total > MAX_SELECTION) {
    throw new AuthError(
      `Too many matches (${total}). Narrow the search to ${MAX_SELECTION} or fewer companies.`,
      "VALIDATION",
      400,
    );
  }
  const rows = await prisma.company.findMany({
    where,
    orderBy: { name: "asc" },
    take: MAX_SELECTION,
    select: { id: true },
  });
  return { companyIds: rows.map((r) => r.id), total: rows.length };
}

function fingerprintRows(
  rows: Array<{ id: string; customerGroupId: string | null; updatedAt: Date }>,
) {
  const payload = rows
    .map((r) => `${r.id}:${r.customerGroupId ?? ""}:${r.updatedAt.toISOString()}`)
    .sort()
    .join("|");
  return createHash("sha256").update(payload).digest("hex");
}

const previewSchema = z.object({
  targetGroupId: z.string().cuid(),
  companyIds: z.array(z.string().cuid()).min(1).max(MAX_SELECTION),
  allowReassignment: z.boolean().optional().default(false),
});

export async function previewBulkCustomerGroupAssign(actorUserId: string, raw: unknown) {
  await requireGroupManage(actorUserId);
  const input = previewSchema.parse(raw);
  const uniqueIds = [...new Set(input.companyIds)];
  const group = await prisma.customerGroup.findUnique({
    where: { id: input.targetGroupId },
    select: { id: true, name: true, active: true },
  });
  if (!group) throw new AuthError("Customer Group not found", "NOT_FOUND", 404);
  if (!group.active) throw new AuthError("Cannot assign to an inactive Customer Group", "VALIDATION", 400);

  const rows = await prisma.company.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      name: true,
      status: true,
      customerGroupId: true,
      autopartCustomerCode: true,
      updatedAt: true,
      customerGroup: { select: { id: true, name: true } },
      autopartAccounts: { select: { accountCode: true }, take: 8, orderBy: { accountCode: "asc" } },
    },
  });
  if (rows.length !== uniqueIds.length) {
    throw new AuthError("One or more selected companies were not found", "NOT_FOUND", 404);
  }

  const assignable: typeof rows = [];
  const alreadyInTarget: typeof rows = [];
  const conflicts: typeof rows = [];
  const needsReview: typeof rows = [];

  for (const row of rows) {
    const meta = classifyRow({
      customerGroupId: row.customerGroupId,
      targetGroupId: input.targetGroupId,
      autopartCustomerCode: row.autopartCustomerCode,
      masterCodes: row.autopartAccounts.map((a) => a.accountCode),
    });
    if (meta.needsReview) needsReview.push(row);
    if (meta.membership === "TARGET") alreadyInTarget.push(row);
    else if (meta.membership === "OTHER_GROUP") {
      if (input.allowReassignment) assignable.push(row);
      else conflicts.push(row);
    } else assignable.push(row);
  }

  const token = fingerprintRows(rows);
  const serialize = (row: (typeof rows)[number]) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    autopartCustomerCode: row.autopartCustomerCode,
    autopartAccountCodes: [
      ...(row.autopartCustomerCode ? [row.autopartCustomerCode] : []),
      ...row.autopartAccounts
        .map((a) => a.accountCode)
        .filter((code) => code !== row.autopartCustomerCode),
    ],
    currentGroupId: row.customerGroupId,
    currentGroupName: row.customerGroup?.name ?? null,
  });

  return {
    previewToken: token,
    targetGroup: group,
    allowReassignment: input.allowReassignment,
    counts: {
      selected: rows.length,
      assignable: assignable.length,
      alreadyInTarget: alreadyInTarget.length,
      conflicts: conflicts.length,
      needsReview: needsReview.length,
    },
    assignable: assignable.map(serialize),
    alreadyInTarget: alreadyInTarget.map(serialize),
    conflicts: conflicts.map(serialize),
    needsReview: needsReview.map(serialize),
  };
}

const confirmSchema = previewSchema.extend({
  previewToken: z.string().min(16).max(128),
});

export async function confirmBulkCustomerGroupAssign(actorUserId: string, raw: unknown) {
  await requireGroupManage(actorUserId);
  const input = confirmSchema.parse(raw);
  const uniqueIds = [...new Set(input.companyIds)];
  const bulkOperationId = createHash("sha256")
    .update(`${input.targetGroupId}:${uniqueIds.slice().sort().join(",")}:${Date.now()}`)
    .digest("hex")
    .slice(0, 24);

  const fresh = await previewBulkCustomerGroupAssign(actorUserId, {
    targetGroupId: input.targetGroupId,
    companyIds: uniqueIds,
    allowReassignment: input.allowReassignment,
  });
  if (fresh.previewToken !== input.previewToken) {
    throw new AuthError(
      "Selection changed since preview (another staff member may have updated a company). Refresh and preview again.",
      "CONFLICT",
      409,
    );
  }

  const results = {
    assigned: [] as string[],
    alreadyAssigned: fresh.alreadyInTarget.map((c) => c.id),
    skipped: fresh.conflicts.map((c) => c.id),
    conflicts: fresh.conflicts.map((c) => ({
      companyId: c.id,
      companyName: c.name,
      currentGroupName: c.currentGroupName,
    })),
    failed: [] as Array<{ companyId: string; error: string }>,
    moved: [] as string[],
  };

  for (const company of fresh.assignable) {
    try {
      const outcome = await addCompanyToCustomerGroup(actorUserId, {
        groupId: input.targetGroupId,
        companyId: company.id,
      });
      if (outcome.alreadyMember) {
        results.alreadyAssigned.push(company.id);
      } else {
        results.assigned.push(company.id);
        if (outcome.moved) results.moved.push(company.id);
        await recordAuditEvent({
          action: "customer_group.bulk_company_assigned",
          entityType: "CustomerGroup",
          entityId: input.targetGroupId,
          actorUserId,
          companyId: company.id,
          metadata: {
            bulkOperationId,
            companyId: company.id,
            companyName: company.name,
            fromGroupId: company.currentGroupId,
            fromGroupName: company.currentGroupName,
            toGroupId: input.targetGroupId,
            toGroupName: fresh.targetGroup.name,
            allowReassignment: input.allowReassignment,
          },
        });
      }
    } catch (error) {
      results.failed.push({
        companyId: company.id,
        error: error instanceof Error ? error.message : "Assignment failed",
      });
    }
  }

  await recordAuditEvent({
    action: "customer_group.bulk_assign_completed",
    entityType: "CustomerGroup",
    entityId: input.targetGroupId,
    actorUserId,
    metadata: {
      bulkOperationId,
      selected: uniqueIds.length,
      assigned: results.assigned.length,
      alreadyAssigned: results.alreadyAssigned.length,
      skippedConflicts: results.skipped.length,
      failed: results.failed.length,
      moved: results.moved.length,
      allowReassignment: input.allowReassignment,
    },
  });

  return {
    bulkOperationId,
    targetGroupId: input.targetGroupId,
    targetGroupName: fresh.targetGroup.name,
    ...results,
    summary: {
      assigned: results.assigned.length,
      alreadyAssigned: results.alreadyAssigned.length,
      skipped: results.skipped.length,
      conflicts: results.conflicts.length,
      failed: results.failed.length,
      moved: results.moved.length,
    },
  };
}
