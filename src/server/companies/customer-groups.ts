/**
 * Customer Group — Automotive Brands reporting/commercial aggregation.
 * Group → Company → MAM account(s). Never Autopart hierarchy.
 * Trade users denied. CompanyUser membership is unchanged by grouping.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";

async function requireGroupView(userId: string) {
  const profile = await requireSystemPermission(userId, "customer_groups.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade customers cannot access Customer Groups", "FORBIDDEN", 403);
  }
  return profile;
}

async function requireGroupManage(userId: string) {
  const profile = await requireSystemPermission(userId, "customer_groups.manage");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade customers cannot manage Customer Groups", "FORBIDDEN", 403);
  }
  return profile;
}

function serializeGroup(row: {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count?: { companies: number };
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    companyCount: row._count?.companies ?? 0,
  };
}

export async function listCustomerGroups(
  actorUserId: string,
  raw?: { q?: string; includeInactive?: boolean },
) {
  await requireGroupView(actorUserId);
  const q = raw?.q?.trim();
  const rows = await prisma.customerGroup.findMany({
    where: {
      ...(raw?.includeInactive ? {} : { active: true }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    include: { _count: { select: { companies: true } } },
  });
  return { items: rows.map(serializeGroup) };
}

export async function getCustomerGroup(actorUserId: string, groupId: string) {
  await requireGroupView(actorUserId);
  const group = await prisma.customerGroup.findUnique({
    where: { id: groupId },
    include: {
      _count: { select: { companies: true } },
      companies: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          tradingName: true,
          status: true,
          autopartCustomerCode: true,
          autopartAccountAliases: {
            select: { alias: true, label: true },
            orderBy: { alias: "asc" },
          },
          assignments: {
            where: { isPrimary: true },
            take: 1,
            select: {
              salesRep: {
                select: {
                  id: true,
                  displayName: true,
                  user: { select: { name: true, email: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!group) throw new AuthError("Customer Group not found", "NOT_FOUND", 404);

  return {
    ...serializeGroup(group),
    companies: group.companies.map((c) => {
      const rep = c.assignments[0]?.salesRep;
      const aliases = c.autopartAccountAliases;
      return {
        id: c.id,
        name: c.name,
        tradingName: c.tradingName,
        status: c.status,
        autopartCustomerCode: c.autopartCustomerCode,
        aliases: aliases.map((a) => ({
          accountCode: a.alias,
          label: a.label,
        })),
        mamAccountCount: (c.autopartCustomerCode ? 1 : 0) + aliases.length,
        salesperson: rep
          ? {
              id: rep.id,
              name: rep.displayName || rep.user.name || rep.user.email,
            }
          : null,
      };
    }),
  };
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

export async function createCustomerGroup(actorUserId: string, raw: unknown) {
  await requireGroupManage(actorUserId);
  const input = createSchema.parse(raw);
  const row = await prisma.customerGroup.create({
    data: {
      name: input.name,
      description: input.description?.trim() || null,
      createdById: actorUserId,
    },
    include: { _count: { select: { companies: true } } },
  });
  await recordAuditEvent({
    action: "customer_group.created",
    entityType: "CustomerGroup",
    entityId: row.id,
    actorUserId,
    after: { name: row.name, description: row.description },
  });
  return serializeGroup(row);
}

const updateSchema = z.object({
  id: z.string().cuid(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional(),
});

export async function updateCustomerGroup(actorUserId: string, raw: unknown) {
  await requireGroupManage(actorUserId);
  const input = updateSchema.parse(raw);
  const before = await prisma.customerGroup.findUnique({ where: { id: input.id } });
  if (!before) throw new AuthError("Customer Group not found", "NOT_FOUND", 404);

  const row = await prisma.customerGroup.update({
    where: { id: input.id },
    data: {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.active != null ? { active: input.active } : {}),
    },
    include: { _count: { select: { companies: true } } },
  });

  const action =
    before.active && input.active === false
      ? "customer_group.deactivated"
      : "customer_group.updated";

  await recordAuditEvent({
    action,
    entityType: "CustomerGroup",
    entityId: row.id,
    actorUserId,
    before: { name: before.name, description: before.description, active: before.active },
    after: { name: row.name, description: row.description, active: row.active },
  });
  return serializeGroup(row);
}

const membershipSchema = z.object({
  groupId: z.string().cuid(),
  companyId: z.string().cuid(),
});

export async function addCompanyToCustomerGroup(actorUserId: string, raw: unknown) {
  await requireGroupManage(actorUserId);
  const input = membershipSchema.parse(raw);
  const [group, company] = await Promise.all([
    prisma.customerGroup.findUnique({ where: { id: input.groupId } }),
    prisma.company.findUnique({
      where: { id: input.companyId },
      select: { id: true, name: true, customerGroupId: true },
    }),
  ]);
  if (!group) throw new AuthError("Customer Group not found", "NOT_FOUND", 404);
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);

  if (company.customerGroupId === group.id) {
    return { ok: true as const, alreadyMember: true };
  }

  const previousGroupId = company.customerGroupId;
  await prisma.company.update({
    where: { id: company.id },
    data: { customerGroupId: group.id },
  });

  if (previousGroupId) {
    const previous = await prisma.customerGroup.findUnique({
      where: { id: previousGroupId },
      select: { name: true },
    });
    await recordAuditEvent({
      action: "customer_group.company_moved",
      entityType: "CustomerGroup",
      entityId: group.id,
      actorUserId,
      companyId: company.id,
      metadata: {
        companyId: company.id,
        companyName: company.name,
        fromGroupId: previousGroupId,
        fromGroupName: previous?.name ?? null,
        toGroupId: group.id,
        toGroupName: group.name,
      },
    });
  } else {
    await recordAuditEvent({
      action: "customer_group.company_added",
      entityType: "CustomerGroup",
      entityId: group.id,
      actorUserId,
      companyId: company.id,
      metadata: {
        companyId: company.id,
        companyName: company.name,
        groupId: group.id,
        groupName: group.name,
      },
    });
  }

  return { ok: true as const, alreadyMember: false, moved: Boolean(previousGroupId) };
}

export async function removeCompanyFromCustomerGroup(actorUserId: string, raw: unknown) {
  await requireGroupManage(actorUserId);
  const input = z
    .object({
      companyId: z.string().cuid(),
      groupId: z.string().cuid().optional(),
    })
    .parse(raw);

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { id: true, name: true, customerGroupId: true },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);
  if (!company.customerGroupId) {
    return { ok: true as const, alreadyRemoved: true };
  }
  if (input.groupId && company.customerGroupId !== input.groupId) {
    throw new AuthError("Company is not in that Customer Group", "VALIDATION", 400);
  }

  const group = await prisma.customerGroup.findUnique({
    where: { id: company.customerGroupId },
    select: { id: true, name: true },
  });

  await prisma.company.update({
    where: { id: company.id },
    data: { customerGroupId: null },
  });

  await recordAuditEvent({
    action: "customer_group.company_removed",
    entityType: "CustomerGroup",
    entityId: company.customerGroupId,
    actorUserId,
    companyId: company.id,
    metadata: {
      companyId: company.id,
      companyName: company.name,
      groupId: company.customerGroupId,
      groupName: group?.name ?? null,
    },
  });

  return { ok: true as const, alreadyRemoved: false };
}

export async function setCompanyCustomerGroup(
  actorUserId: string,
  raw: { companyId: string; customerGroupId: string | null },
) {
  if (raw.customerGroupId) {
    return addCompanyToCustomerGroup(actorUserId, {
      companyId: raw.companyId,
      groupId: raw.customerGroupId,
    });
  }
  return removeCompanyFromCustomerGroup(actorUserId, { companyId: raw.companyId });
}

/** Resolve group → company IDs for Sales Intelligence aggregation (scoped). */
export async function resolveCustomerGroupCompanyIds(
  groupId: string,
  scope: string[] | "all",
): Promise<{ group: { id: string; name: string; active: boolean }; companyIds: string[] }> {
  const group = await prisma.customerGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      active: true,
      companies: { select: { id: true } },
    },
  });
  if (!group) throw new AuthError("Customer Group not found", "NOT_FOUND", 404);
  let companyIds = group.companies.map((c) => c.id);
  if (scope !== "all") {
    const allowed = new Set(scope);
    companyIds = companyIds.filter((id) => allowed.has(id));
  }
  return {
    group: { id: group.id, name: group.name, active: group.active },
    companyIds,
  };
}

export async function searchCustomerGroupsForPicker(
  actorUserId: string,
  raw: { q?: string; limit?: number },
) {
  const profile = await requireGroupView(actorUserId);
  // Sales Intelligence users may also search groups via SI permission
  if (
    !hasPermission(profile, "customer_groups.view") &&
    !hasPermission(profile, "sales_intelligence.view")
  ) {
    throw new AuthError("Forbidden", "FORBIDDEN", 403);
  }
  const q = raw.q?.trim() ?? "";
  const limit = Math.min(40, Math.max(1, raw.limit ?? 20));
  if (q.length < 1) return { items: [] as const };
  const rows = await prisma.customerGroup.findMany({
    where: {
      active: true,
      name: { contains: q, mode: "insensitive" },
    },
    take: limit,
    orderBy: { name: "asc" },
    include: { _count: { select: { companies: true } } },
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: "GROUP" as const,
      companyCount: r._count.companies,
      description: r.description,
    })),
  };
}
