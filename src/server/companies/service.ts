import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import {
  getAccessibleCompanyIdsForSales,
  canAccessCompanyAsSales,
} from "@/server/rbac/sales-access";
import {
  requireAuthenticatedUser,
  requireCompanyAccess,
  requireSystemPermission,
  requireAnySystemPermission,
  AuthError,
} from "@/server/rbac/guards";
import { grants, hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { normaliseAssignedAutopartCode } from "@/domain/autopart-account-verification";
import { describeCompanyAutopartMapping } from "@/server/companies/autopart-account-verification";
import {
  companyCreateSchema,
  companyDeleteSchema,
  companyListQuerySchema,
  companyUpdateSchema,
  resolveCompanyListStatusScope,
  contactSchema,
  contactUpdateSchema,
  addressSchema,
  addressUpdateSchema,
  emptyToNull,
  type CompanyStatusKey,
} from "@/domain/company";
import { companyMembershipUpdateSchema, generateInviteToken, inviteUserSchema } from "@/domain/invitation";

function companySelect() {
  return {
    id: true,
    accountNumber: true,
    name: true,
    tradingName: true,
    companyNumber: true,
    vatNumber: true,
    status: true,
    taxStatus: true,
    paymentTerms: true,
    currency: true,
    priceListId: true,
    externalRef: true,
    autopartCustomerCode: true,
    autopartCustomerCodeVerifiedAt: true,
    autopartCustomerCodeVerifiedById: true,
    website: true,
    phone: true,
    primaryEmail: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
    priceList: { select: { id: true, code: true, name: true } },
    autopartCustomerCodeVerifiedBy: {
      select: { id: true, name: true, email: true },
    },
    assignments: {
      where: { isPrimary: true },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: {
        salesRepId: true,
        salesRep: {
          select: {
            id: true,
            code: true,
            displayName: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    },
    autopartAccountAliases: {
      select: { id: true, alias: true },
      orderBy: { alias: "asc" },
      take: 12,
    },
    customerGroupId: true,
    customerGroup: { select: { id: true, name: true, active: true } },
  } satisfies Prisma.CompanySelect;
}

async function assertCompanyReadable(profile: LoadedAccessProfile, companyId: string) {
  if (grants(profile, "sales.view_all_accounts", "admin.access")) {
    return;
  }
  if (
    profile.actorType === "INTERNAL" &&
    hasPermission(profile, "companies.view") &&
    !hasPermission(profile, "sales.view_own_accounts") &&
    !hasPermission(profile, "sales.view_team_accounts")
  ) {
    return;
  }
  if (hasPermission(profile, "companies.view")) {
    const ok = await canAccessCompanyAsSales(profile, companyId);
    if (ok) return;
  }
  await requireCompanyAccess(profile.userId, companyId);
}

export async function listCompaniesForActor(
  actorUserId: string,
  rawQuery: unknown,
) {
  const profile = await requireSystemPermission(actorUserId, "companies.view");
  const query = companyListQuerySchema.parse(rawQuery);

  let scope = await getAccessibleCompanyIdsForSales(profile);
  // Internal ops roles with companies.view but no sales-scope keys see all accounts
  if (
    scope !== "all" &&
    profile.actorType === "INTERNAL" &&
    !hasPermission(profile, "sales.view_own_accounts") &&
    !hasPermission(profile, "sales.view_team_accounts")
  ) {
    scope = "all";
  }
  const where: Prisma.CompanyWhereInput = {};

  if (scope !== "all") {
    where.id = { in: scope.length ? scope : ["__none__"] };
  }
  const statusScope = resolveCompanyListStatusScope({
    ...(query.q ? { q: query.q } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.statusGroup ? { statusGroup: query.statusGroup } : {}),
    ...(query.statusScope ? { statusScope: query.statusScope } : {}),
  });
  const [onlyStatus, ...moreStatuses] = statusScope.statuses;
  if (onlyStatus && moreStatuses.length === 0) where.status = onlyStatus;
  else if (statusScope.statuses.length > 1) where.status = { in: statusScope.statuses };
  if (query.salesRepId) {
    where.assignments = { some: { salesRepId: query.salesRepId } };
  }
  if (query.customerGroupId === "__none__") {
    where.customerGroupId = null;
  } else if (query.customerGroupId) {
    where.customerGroupId = query.customerGroupId;
  }
  if (query.q) {
    const q = query.q;
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { tradingName: { contains: q, mode: "insensitive" } },
      { accountNumber: { contains: q, mode: "insensitive" } },
      { primaryEmail: { contains: q, mode: "insensitive" } },
      { vatNumber: { contains: q, mode: "insensitive" } },
      { companyNumber: { contains: q, mode: "insensitive" } },
      { autopartCustomerCode: { contains: q, mode: "insensitive" } },
      { autopartAccountAliases: { some: { alias: { contains: q, mode: "insensitive" } } } },
      { contacts: { some: { email: { contains: q, mode: "insensitive" } } } },
    ];
  }
  const and: Prisma.CompanyWhereInput[] = [];
  if (query.autopartLink === "linked") {
    and.push({
      OR: [{ autopartAccounts: { some: {} } }, { autopartCustomerCode: { not: null } }],
    });
  } else if (query.autopartLink === "unlinked") {
    and.push({ autopartAccounts: { none: {} }, autopartCustomerCode: null });
  }
  const ongoingSales = {
    OR: [
      { has504: true },
      { hasTrm21qc: true },
      { source: { in: ["ONGOING_504", "ONGOING_TRM21QC", "ONGOING_504_BRIDGE"] } },
    ],
  };
  if (query.historicalSales === "with") {
    and.push({ autopartSalesDocuments: { some: ongoingSales } });
  } else if (query.historicalSales === "without") {
    and.push({ NOT: { autopartSalesDocuments: { some: ongoingSales } } });
  }
  if (and.length) where.AND = and;

  const skip = (query.page - 1) * query.pageSize;
  const [total, rows] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      select: companySelect(),
      orderBy: [{ name: "asc" }],
      skip,
      take: query.pageSize,
    }),
  ]);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    statusScope,
    items: rows.map(serializeCompany),
  };
}

function serializeCompany(row: {
  id: string;
  accountNumber: string | null;
  name: string;
  tradingName: string | null;
  companyNumber: string | null;
  vatNumber: string | null;
  status: string;
  taxStatus: string;
  paymentTerms: string | null;
  currency: string;
  priceListId: string | null;
  externalRef: string | null;
  autopartCustomerCode: string | null;
  autopartCustomerCodeVerifiedAt: Date | null;
  autopartCustomerCodeVerifiedBy?: { id: string; name: string | null; email: string } | null;
  website: string | null;
  phone: string | null;
  primaryEmail: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  priceList?: { id: string; code: string; name: string } | null;
  assignments?: Array<{
    salesRepId: string;
    salesRep: {
      id: string;
      code: string | null;
      displayName?: string | null;
      user: { id: string; name: string | null; email: string };
    };
  }>;
  autopartAccountAliases?: Array<{ id: string; alias: string }>;
  customerGroupId?: string | null;
  customerGroup?: { id: string; name: string; active: boolean } | null;
}) {
  const assignment = row.assignments?.[0];
  const autopartVerified = Boolean(row.autopartCustomerCode && row.autopartCustomerCodeVerifiedAt);
  const aliases = row.autopartAccountAliases ?? [];
  return {
    id: row.id,
    accountNumber: row.accountNumber,
    name: row.name,
    tradingName: row.tradingName,
    companyNumber: row.companyNumber,
    vatNumber: row.vatNumber,
    status: row.status as CompanyStatusKey,
    customerGroup: row.customerGroup
      ? { id: row.customerGroup.id, name: row.customerGroup.name, active: row.customerGroup.active }
      : null,
    taxStatus: row.taxStatus,
    paymentTerms: row.paymentTerms,
    currency: row.currency,
    priceListId: row.priceListId,
    priceList: row.priceList ?? null,
    externalRef: row.externalRef,
    autopartAccount: {
      code: row.autopartCustomerCode,
      verified: autopartVerified,
      verificationRecorded: autopartVerified,
      attention: null as string | null,
      verifiedAt: row.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
      verifiedBy: row.autopartCustomerCodeVerifiedBy
        ? {
            id: row.autopartCustomerCodeVerifiedBy.id,
            name:
              row.autopartCustomerCodeVerifiedBy.name ??
              row.autopartCustomerCodeVerifiedBy.email,
            email: row.autopartCustomerCodeVerifiedBy.email,
          }
        : null,
      verifiedByLabel: autopartVerified
        ? (row.autopartCustomerCodeVerifiedBy?.name ??
          row.autopartCustomerCodeVerifiedBy?.email ??
          "Automatic")
        : null,
      aliasCount: aliases.length,
      aliases: aliases.map((a) => a.alias),
    },
    website: row.website,
    phone: row.phone,
    primaryEmail: row.primaryEmail,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    salesperson: assignment
      ? {
          salesRepId: assignment.salesRep.id,
          code: assignment.salesRep.code,
          name:
            assignment.salesRep.displayName?.trim() ||
            assignment.salesRep.user.name ||
            assignment.salesRep.user.email,
          email: assignment.salesRep.user.email,
        }
      : null,
  };
}

export async function getCompanyWorkspace(actorUserId: string, companyId: string) {
  const profile = await requireAuthenticatedUser(actorUserId);
  if (!grants(profile, "companies.view", "admin.access")) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }
  await assertCompanyReadable(profile, companyId);

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      ...companySelect(),
      contacts: { orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }] },
      addresses: { orderBy: [{ isDefaultBilling: "desc" }, { isDefaultDelivery: "desc" }, { label: "asc" }] },
      users: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              status: true,
              emailVerified: true,
              lastLoginAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      invitations: {
        where: { status: { in: ["PENDING", "EXPIRED"] } },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const signupApplication = await prisma.tradeApplication.findFirst({
    where: {
      companyId,
      claimedAutopartCustomerCode: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      reference: true,
      claimedAutopartCustomerCode: true,
      status: true,
    },
  });

  const canEditPricing =
    grants(profile, "pricing.edit", "admin.access");

  const serialized = serializeCompany(company);
  const mapping = await describeCompanyAutopartMapping({
    companyId,
    code: company.autopartCustomerCode,
    verifiedAt: company.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
    verifiedByName: serialized.autopartAccount.verifiedBy?.name ?? null,
  });
  serialized.autopartAccount = {
    ...serialized.autopartAccount,
    verified: mapping.verified,
    verificationRecorded: mapping.verificationRecorded,
    attention: mapping.attention,
    verifiedByLabel: mapping.verifiedByLabel,
  };

  const claimedCode = signupApplication?.claimedAutopartCustomerCode?.trim() || null;
  const assignedKey = normaliseAssignedAutopartCode(serialized.autopartAccount.code).key;
  const claimKey = normaliseAssignedAutopartCode(claimedCode).key;
  const verifiedLinked = Boolean(assignedKey && claimKey && assignedKey === claimKey && mapping.verified);

  return {
    company: serialized,
    registrationAutopartClaim: claimedCode
      ? {
          code: claimedCode,
          applicationId: signupApplication!.id,
          applicationReference: signupApplication!.reference,
          status: signupApplication!.status,
          needsVerification: !verifiedLinked,
        }
      : null,
    permissions: {
      canEdit: grants(profile, "companies.edit", "admin.access"),
      canEditContacts: grants(profile, "contacts.edit", "admin.access"),
      canDelete:
        grants(profile, "companies.delete", "admin.access"),
      canManageUsers:
        grants(profile, "companies.manage_users", "admin.access"),
      canEditPricing,
    },
    contacts: company.contacts.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    addresses: company.addresses.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
    users: await Promise.all(
      company.users.map(async (cu) => {
        const otherCompanyCount = await prisma.companyUser.count({
          where: { userId: cu.userId, NOT: { companyId } },
        });
        return {
          id: cu.id,
          role: cu.role,
          status: cu.status,
          isDefault: cu.isDefault,
          otherCompanyCount,
          createdAt: cu.createdAt.toISOString(),
          user: {
            id: cu.user.id,
            email: cu.user.email,
            name: cu.user.name,
            status: cu.user.status,
            emailVerified: cu.user.emailVerified,
            lastLoginAt: cu.user.lastLoginAt?.toISOString() ?? null,
          },
        };
      }),
    ),
    invitations: company.invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      status: inv.status,
      emailDeferred: inv.emailDeferred,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
    })),
  };
}

export async function createCompany(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "companies.create");
  const input = companyCreateSchema.parse(raw);

  if (input.accountNumber) {
    const clash = await prisma.company.findUnique({ where: { accountNumber: input.accountNumber } });
    if (clash) throw new AuthError("Account number already in use", "CONFLICT", 409);
  }

  const company = await prisma.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: {
        name: input.name,
        tradingName: emptyToNull(input.tradingName),
        companyNumber: emptyToNull(input.companyNumber),
        vatNumber: emptyToNull(input.vatNumber),
        accountNumber: emptyToNull(input.accountNumber),
        status: input.status,
        taxStatus: input.taxStatus,
        website: emptyToNull(input.website) ,
        phone: emptyToNull(input.phone),
        primaryEmail: emptyToNull(input.primaryEmail),
        notes: emptyToNull(input.notes),
        paymentTerms: emptyToNull(input.paymentTerms),
        // null = Default Trade Price (ProductVariant.tradePrice) until sales assigns a list.
        priceListId: input.priceListId ?? null,
        externalRef: emptyToNull(input.externalRef),
      },
      select: companySelect(),
    });

    if (input.salesRepId) {
      await tx.companyAssignment.create({
        data: {
          companyId: created.id,
          salesRepId: input.salesRepId,
          isPrimary: true,
        },
      });
    }

    await tx.activity.create({
      data: {
        companyId: created.id,
        userId: actorUserId,
        type: "SYSTEM",
        subject: "Company created",
        body: `${created.name} was created`,
        metadata: { action: "company.created" },
      },
    });

    return created;
  });

  await recordAuditEvent({
    action: "company.created",
    entityType: "Company",
    entityId: company.id,
    actorUserId,
    companyId: company.id,
    after: { name: company.name, status: company.status },
  });

  const full = await prisma.company.findUniqueOrThrow({
    where: { id: company.id },
    select: companySelect(),
  });
  return serializeCompany(full);
}

export async function updateCompany(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "companies.edit");
  const input = companyUpdateSchema.parse(raw);
  await assertCompanyReadable(profile, input.id);

  const before = await prisma.company.findUnique({ where: { id: input.id } });
  if (!before) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const data: Prisma.CompanyUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.tradingName !== undefined) data.tradingName = emptyToNull(input.tradingName);
  if (input.companyNumber !== undefined) data.companyNumber = emptyToNull(input.companyNumber);
  if (input.vatNumber !== undefined) data.vatNumber = emptyToNull(input.vatNumber);
  if (input.accountNumber !== undefined) data.accountNumber = emptyToNull(input.accountNumber);
  if (input.status !== undefined) data.status = input.status;
  if (input.taxStatus !== undefined) data.taxStatus = input.taxStatus;
  if (input.website !== undefined) data.website = emptyToNull(input.website);
  if (input.phone !== undefined) data.phone = emptyToNull(input.phone);
  if (input.primaryEmail !== undefined) data.primaryEmail = emptyToNull(input.primaryEmail);
  if (input.notes !== undefined) data.notes = emptyToNull(input.notes);
  if (input.paymentTerms !== undefined) data.paymentTerms = emptyToNull(input.paymentTerms);
  if (input.priceListId !== undefined) {
    data.priceList = input.priceListId
      ? { connect: { id: input.priceListId } }
      : { disconnect: true };
  }
  if (input.externalRef !== undefined) data.externalRef = emptyToNull(input.externalRef);

  let portalRevoked = 0;
  const priorPrimary = await prisma.companyAssignment.findFirst({
    where: { companyId: input.id, isPrimary: true },
    orderBy: { createdAt: "desc" },
    select: {
      salesRepId: true,
      salesRep: {
        select: {
          id: true,
          displayName: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.company.update({
      where: { id: input.id },
      data,
      select: companySelect(),
    });

    if (input.salesRepId !== undefined) {
      // Exactly one current primary: demote/remove prior primaries, then set the new one.
      await tx.companyAssignment.updateMany({
        where: { companyId: input.id, isPrimary: true },
        data: { isPrimary: false },
      });
      if (input.salesRepId) {
        await tx.companyAssignment.upsert({
          where: {
            companyId_salesRepId: { companyId: input.id, salesRepId: input.salesRepId },
          },
          create: { companyId: input.id, salesRepId: input.salesRepId, isPrimary: true },
          update: { isPrimary: true },
        });
        // Legacy safety: never leave multiple isPrimary=true rows.
        await tx.companyAssignment.updateMany({
          where: {
            companyId: input.id,
            isPrimary: true,
            salesRepId: { not: input.salesRepId },
          },
          data: { isPrimary: false },
        });
      }
    }

    const changes: string[] = [];
    if (input.status !== undefined && input.status !== before.status) {
      changes.push(`Status → ${input.status}`);
    }
    if (input.salesRepId !== undefined) changes.push("Salesperson updated");
    if (input.priceListId !== undefined && input.priceListId !== before.priceListId) {
      changes.push("Price list updated");
    }
    if (changes.length) {
      await tx.activity.create({
        data: {
          companyId: input.id,
          userId: actorUserId,
          type: "SYSTEM",
          subject: "Company updated",
          body: changes.join("; "),
          metadata: { action: "company.updated", changes },
        },
      });
    }

    const closingPortal =
      input.status !== undefined &&
      input.status !== before.status &&
      (input.status === "CLOSED" || input.status === "SUSPENDED" || input.status === "ON_HOLD");
    if (closingPortal) {
      const memberships = await tx.companyUser.updateMany({
        where: { companyId: input.id, status: { in: ["ACTIVE", "INVITED"] } },
        data: { status: "DISABLED" },
      });
      const invites = await tx.userInvitation.updateMany({
        where: { companyId: input.id, status: "PENDING" },
        data: { status: "REVOKED" },
      });
      portalRevoked = memberships.count + invites.count;
      if (portalRevoked > 0) {
        await tx.activity.create({
          data: {
            companyId: input.id,
            userId: actorUserId,
            type: "SYSTEM",
            subject: "Portal access revoked",
            body: "Portal memberships were disabled and pending invitations revoked. Historical records were kept.",
            metadata: { action: "company.portal_access_revoked" },
          },
        });
      }
    }

    return row;
  });

  await recordAuditEvent({
    action: "company.updated",
    entityType: "Company",
    entityId: input.id,
    actorUserId,
    companyId: input.id,
    before: {
      status: before.status,
      priceListId: before.priceListId,
      paymentTerms: before.paymentTerms,
    },
    after: {
      status: updated.status,
      priceListId: updated.priceListId,
      paymentTerms: updated.paymentTerms,
    },
  });

  if (input.status !== undefined && input.status !== before.status) {
    await recordAuditEvent({
      action: "company.status_changed",
      entityType: "Company",
      entityId: input.id,
      actorUserId,
      companyId: input.id,
      before: { status: before.status },
      after: { status: input.status },
    });
  }

  if (portalRevoked > 0 && input.status) {
    await recordAuditEvent({
      action: "company.portal_access_revoked",
      entityType: "Company",
      entityId: input.id,
      actorUserId,
      companyId: input.id,
      after: { status: input.status },
    });
  }

  if (input.salesRepId !== undefined) {
    const nextId = input.salesRepId;
    const prevId = priorPrimary?.salesRepId ?? null;
    if (nextId !== prevId) {
      const prevLabel = priorPrimary
        ? priorPrimary.salesRep.displayName?.trim() ||
          priorPrimary.salesRep.user.name?.trim() ||
          priorPrimary.salesRep.user.email
        : null;
      await recordAuditEvent({
        action: "company.sales_rep_changed",
        entityType: "Company",
        entityId: input.id,
        actorUserId,
        companyId: input.id,
        before: { salesRepId: prevId, salesRepName: prevLabel },
        after: { salesRepId: nextId },
      });
    }
  }

  const full = await prisma.company.findUniqueOrThrow({
    where: { id: input.id },
    select: companySelect(),
  });
  return serializeCompany(full);
}

/**
 * Permanently delete a customer company.
 * Blocked when orders, quotes, or invoices exist — close the account instead.
 * Cascades contacts/addresses/memberships/prices/baskets; detaches CRM/audit/application links.
 */
export async function deleteCompany(actorUserId: string, raw: unknown) {
  const profile = await requireAnySystemPermission(actorUserId, [
    "companies.delete",
    "admin.access",
  ]);
  const input = companyDeleteSchema.parse(raw);
  await assertCompanyReadable(profile, input.id);

  const existing = await prisma.company.findUnique({
    where: { id: input.id },
    include: {
      _count: {
        select: {
          orders: true,
          quotes: true,
          invoices: true,
          opportunities: true,
          contacts: true,
          addresses: true,
          users: true,
        },
      },
    },
  });
  if (!existing) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const orderCount = existing._count.orders;
  const quoteCount = existing._count.quotes;
  const invoiceCount = existing._count.invoices;
  if (orderCount > 0 || quoteCount > 0 || invoiceCount > 0) {
    throw new AuthError(
      "Cannot delete a customer with orders, quotes, or invoices. Set status to Closed instead.",
      "COMPANY_HAS_COMMERCIAL_HISTORY",
      409,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.tradeApplication.updateMany({
      where: { companyId: input.id },
      data: { companyId: null },
    });
    await tx.lead.updateMany({
      where: { companyId: input.id },
      data: { companyId: null },
    });
    await tx.activity.updateMany({
      where: { companyId: input.id },
      data: { companyId: null },
    });
    await tx.task.updateMany({
      where: { companyId: input.id },
      data: { companyId: null },
    });
    await tx.note.updateMany({
      where: { companyId: input.id },
      data: { companyId: null },
    });
    await tx.document.updateMany({
      where: { companyId: input.id },
      data: { companyId: null },
    });
    await tx.auditEvent.updateMany({
      where: { companyId: input.id },
      data: { companyId: null },
    });
    await tx.opportunity.deleteMany({ where: { companyId: input.id } });
    await tx.company.delete({ where: { id: input.id } });
  });

  await recordAuditEvent({
    action: "company.deleted",
    entityType: "Company",
    entityId: input.id,
    actorUserId,
    metadata: {
      name: existing.name,
      accountNumber: existing.accountNumber,
      status: existing.status,
      opportunityCount: existing._count.opportunities,
      contactCount: existing._count.contacts,
      addressCount: existing._count.addresses,
      membershipCount: existing._count.users,
    },
  });

  return {
    ok: true as const,
    id: input.id,
    name: existing.name,
  };
}

export async function createContact(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "contacts.create");
  const input = contactSchema.parse(raw);
  await requireCompanyAccess(actorUserId, input.companyId);

  const contact = await prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.contact.updateMany({
        where: { companyId: input.companyId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    const created = await tx.contact.create({
      data: {
        companyId: input.companyId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: emptyToNull(input.email),
        phone: emptyToNull(input.phone),
        mobile: emptyToNull(input.mobile),
        jobTitle: emptyToNull(input.jobTitle),
        isPrimary: input.isPrimary,
        isPurchasing: input.isPurchasing,
        isAccounts: input.isAccounts,
        notes: emptyToNull(input.notes),
      },
    });
    await tx.activity.create({
      data: {
        companyId: input.companyId,
        userId: actorUserId,
        type: "SYSTEM",
        subject: "Contact created",
        body: `${created.firstName} ${created.lastName}`,
        metadata: { action: "contact.created", contactId: created.id },
      },
    });
    return created;
  });

  await recordAuditEvent({
    action: "contact.created",
    entityType: "Contact",
    entityId: contact.id,
    actorUserId,
    companyId: input.companyId,
    after: { firstName: contact.firstName, lastName: contact.lastName, email: contact.email },
  });

  return contact;
}

export async function updateContact(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "contacts.edit");
  const input = contactUpdateSchema.parse(raw);
  await requireCompanyAccess(actorUserId, input.companyId);

  const existing = await prisma.contact.findFirst({
    where: { id: input.id, companyId: input.companyId },
  });
  if (!existing) throw new AuthError("Contact not found", "NOT_FOUND", 404);

  const contact = await prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.contact.updateMany({
        where: { companyId: input.companyId, isPrimary: true, NOT: { id: input.id } },
        data: { isPrimary: false },
      });
    }
    const updated = await tx.contact.update({
      where: { id: input.id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.email !== undefined ? { email: emptyToNull(input.email) } : {}),
        ...(input.phone !== undefined ? { phone: emptyToNull(input.phone) } : {}),
        ...(input.mobile !== undefined ? { mobile: emptyToNull(input.mobile) } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: emptyToNull(input.jobTitle) } : {}),
        ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        ...(input.isPurchasing !== undefined ? { isPurchasing: input.isPurchasing } : {}),
        ...(input.isAccounts !== undefined ? { isAccounts: input.isAccounts } : {}),
        ...(input.notes !== undefined ? { notes: emptyToNull(input.notes) } : {}),
      },
    });
    await tx.activity.create({
      data: {
        companyId: input.companyId,
        userId: actorUserId,
        type: "SYSTEM",
        subject: "Contact updated",
        body: `${updated.firstName} ${updated.lastName}`,
        metadata: { action: "contact.updated", contactId: updated.id },
      },
    });
    return updated;
  });

  await recordAuditEvent({
    action: "contact.updated",
    entityType: "Contact",
    entityId: contact.id,
    actorUserId,
    companyId: input.companyId,
  });

  return contact;
}

async function clearDefaultFlags(
  tx: Prisma.TransactionClient,
  companyId: string,
  opts: { billing?: boolean; delivery?: boolean; exceptId?: string },
) {
  if (opts.billing) {
    await tx.address.updateMany({
      where: {
        companyId,
        isDefaultBilling: true,
        ...(opts.exceptId ? { NOT: { id: opts.exceptId } } : {}),
      },
      data: { isDefaultBilling: false },
    });
  }
  if (opts.delivery) {
    await tx.address.updateMany({
      where: {
        companyId,
        isDefaultDelivery: true,
        ...(opts.exceptId ? { NOT: { id: opts.exceptId } } : {}),
      },
      data: { isDefaultDelivery: false },
    });
  }
}

export async function createAddress(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "companies.edit");
  const input = addressSchema.parse(raw);
  await requireCompanyAccess(actorUserId, input.companyId);

  const address = await prisma.$transaction(async (tx) => {
    await clearDefaultFlags(tx, input.companyId, {
      billing: input.isDefaultBilling,
      delivery: input.isDefaultDelivery,
    });
    const created = await tx.address.create({
      data: {
        companyId: input.companyId,
        type: input.type,
        label: emptyToNull(input.label),
        line1: input.line1,
        line2: emptyToNull(input.line2),
        town: input.town,
        county: emptyToNull(input.county),
        postcode: input.postcode,
        country: input.country,
        isDefault: input.isDefaultBilling || input.isDefaultDelivery,
        isDefaultBilling: input.isDefaultBilling,
        isDefaultDelivery: input.isDefaultDelivery,
        contactName: emptyToNull(input.contactName),
        contactPhone: emptyToNull(input.contactPhone),
      },
    });
    await tx.activity.create({
      data: {
        companyId: input.companyId,
        userId: actorUserId,
        type: "SYSTEM",
        subject: "Address created",
        body: created.label ?? `${created.line1}, ${created.town}`,
        metadata: { action: "address.created", addressId: created.id },
      },
    });
    return created;
  });

  await recordAuditEvent({
    action: "address.created",
    entityType: "Address",
    entityId: address.id,
    actorUserId,
    companyId: input.companyId,
  });

  return address;
}

export async function updateAddress(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "companies.edit");
  const input = addressUpdateSchema.parse(raw);
  await requireCompanyAccess(actorUserId, input.companyId);

  const existing = await prisma.address.findFirst({
    where: { id: input.id, companyId: input.companyId },
  });
  if (!existing) throw new AuthError("Address not found", "NOT_FOUND", 404);

  const address = await prisma.$transaction(async (tx) => {
    await clearDefaultFlags(tx, input.companyId, {
      billing: input.isDefaultBilling === true,
      delivery: input.isDefaultDelivery === true,
      exceptId: input.id,
    });
    const updated = await tx.address.update({
      where: { id: input.id },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.label !== undefined ? { label: emptyToNull(input.label) } : {}),
        ...(input.line1 !== undefined ? { line1: input.line1 } : {}),
        ...(input.line2 !== undefined ? { line2: emptyToNull(input.line2) } : {}),
        ...(input.town !== undefined ? { town: input.town } : {}),
        ...(input.county !== undefined ? { county: emptyToNull(input.county) } : {}),
        ...(input.postcode !== undefined ? { postcode: input.postcode } : {}),
        ...(input.country !== undefined ? { country: input.country } : {}),
        ...(input.isDefaultBilling !== undefined
          ? { isDefaultBilling: input.isDefaultBilling }
          : {}),
        ...(input.isDefaultDelivery !== undefined
          ? { isDefaultDelivery: input.isDefaultDelivery }
          : {}),
        ...(input.isDefaultBilling === true || input.isDefaultDelivery === true
          ? { isDefault: true }
          : input.isDefaultBilling === false && input.isDefaultDelivery === false
            ? { isDefault: false }
            : {}),
        ...(input.contactName !== undefined
          ? { contactName: emptyToNull(input.contactName) }
          : {}),
        ...(input.contactPhone !== undefined
          ? { contactPhone: emptyToNull(input.contactPhone) }
          : {}),
      },
    });
    await tx.activity.create({
      data: {
        companyId: input.companyId,
        userId: actorUserId,
        type: "SYSTEM",
        subject: "Address updated",
        body: updated.label ?? `${updated.line1}, ${updated.town}`,
        metadata: { action: "address.updated", addressId: updated.id },
      },
    });
    return updated;
  });

  await recordAuditEvent({
    action: "address.updated",
    entityType: "Address",
    entityId: address.id,
    actorUserId,
    companyId: input.companyId,
  });

  return address;
}

export async function inviteCompanyUser(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "companies.manage_users");
  const input = inviteUserSchema.parse(raw);
  await requireCompanyAccess(actorUserId, input.companyId);
  const companyStatus = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { status: true },
  });
  if (!companyStatus) throw new AuthError("Company not found", "NOT_FOUND", 404);
  if (companyStatus.status !== "ACTIVE") {
    throw new AuthError(
      "Invite the customer to the trade portal only after the account is active. Prospects do not receive logins.",
      "VALIDATION",
      400,
    );
  }

  const email = input.email.toLowerCase();
  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

  const invitation = await prisma.$transaction(async (tx) => {
    // Revoke prior pending invites for same email+company
    await tx.userInvitation.updateMany({
      where: { companyId: input.companyId, email, status: "PENDING" },
      data: { status: "REVOKED" },
    });

    // Ensure User + CompanyUser exist in INVITED state for future acceptance
    let user = await tx.user.findUnique({ where: { email } });
    if (!user) {
      user = await tx.user.create({
        data: {
          email,
          name: email.split("@")[0] ?? email,
          status: "INVITED",
          actorType: "TRADE",
        },
      });
    }

    await tx.companyUser.upsert({
      where: { companyId_userId: { companyId: input.companyId, userId: user.id } },
      create: {
        companyId: input.companyId,
        userId: user.id,
        role: input.role,
        status: "INVITED",
      },
      update: {
        role: input.role,
        status: "INVITED",
      },
    });

    const inv = await tx.userInvitation.create({
      data: {
        kind: "COMPANY_USER",
        companyId: input.companyId,
        userId: user.id,
        email,
        role: input.role,
        tokenHash,
        invitedById: actorUserId,
        expiresAt,
        emailDeferred: true,
      },
    });

    await tx.activity.create({
      data: {
        companyId: input.companyId,
        userId: actorUserId,
        type: "SYSTEM",
        subject: "User invited",
        body: `${email} (${input.role})`,
        metadata: { action: "user.invited", invitationId: inv.id },
      },
    });

    return inv;
  });

  await recordAuditEvent({
    action: "user.invited",
    entityType: "UserInvitation",
    entityId: invitation.id,
    actorUserId,
    companyId: input.companyId,
    after: { email, role: input.role },
  });

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { name: true },
  });
  const activationPath = `/activate?token=${encodeURIComponent(token)}`;
  let emailSent = false;
  try {
    const { sendCompanyUserInviteEmail } = await import("@/server/email/transactional");
    emailSent = await sendCompanyUserInviteEmail({
      invitationId: invitation.id,
      email,
      companyId: input.companyId,
      companyName: company?.name ?? "your company",
      role: input.role,
      activationPath,
    });
    if (emailSent) {
      await prisma.userInvitation.update({
        where: { id: invitation.id },
        data: { emailDeferred: false },
      });
    }
  } catch {
    emailSent = false;
  }

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    emailDeferred: !emailSent,
    emailSent,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export async function revokeCompanyUserInvitation(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "companies.manage_users");
  const input = z.object({ invitationId: z.string().cuid() }).parse(raw);
  const invitation = await prisma.userInvitation.findUnique({ where: { id: input.invitationId } });
  if (!invitation || !invitation.companyId) {
    throw new AuthError("Invitation was not found", "NOT_FOUND", 404);
  }
  await requireCompanyAccess(actorUserId, invitation.companyId);
  if (invitation.status !== "PENDING") {
    return { id: invitation.id, status: invitation.status };
  }
  await prisma.$transaction(async (tx) => {
    await tx.userInvitation.update({
      where: { id: invitation.id },
      data: { status: "REVOKED" },
    });
    if (invitation.userId) {
      await tx.companyUser.updateMany({
        where: {
          companyId: invitation.companyId!,
          userId: invitation.userId,
          status: "INVITED",
        },
        data: { status: "DISABLED" },
      });
    }
  });
  await recordAuditEvent({
    action: "user.invitation_revoked",
    entityType: "UserInvitation",
    entityId: invitation.id,
    actorUserId,
    companyId: invitation.companyId,
    after: { email: invitation.email, status: "REVOKED" },
  });
  return { id: invitation.id, status: "REVOKED" as const };
}

/**
 * Change this customer's portal membership only.
 * Login email, display name, sessions, and other company memberships stay as they are.
 */
export async function updateCompanyMembership(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "companies.manage_users");
  const input = companyMembershipUpdateSchema.parse(raw);
  await requireCompanyAccess(actorUserId, input.companyId);

  const membership = await prisma.companyUser.findFirst({
    where: { id: input.membershipId, companyId: input.companyId },
    include: {
      user: { select: { id: true, email: true, name: true, status: true, actorType: true, emailVerified: true } },
      company: { select: { status: true } },
    },
  });
  if (!membership) throw new AuthError("Portal user was not found for this customer", "NOT_FOUND", 404);
  if (membership.user.actorType !== "TRADE") {
    throw new AuthError(
      "Internal staff access cannot be changed from a customer portal role",
      "VALIDATION",
      400,
    );
  }
  if (input.status === "ACTIVE" && membership.company.status !== "ACTIVE") {
    throw new AuthError(
      "Reactivate portal access only after this customer account is Active",
      "VALIDATION",
      400,
    );
  }
  if (membership.status === "INVITED" && input.status) {
    throw new AuthError(
      "Pending invitations are resent or revoked. Membership status changes after the person activates.",
      "VALIDATION",
      400,
    );
  }

  const nextRole = input.role ?? membership.role;
  const nextStatus = input.status ?? membership.status;
  if (nextRole === membership.role && nextStatus === membership.status) {
    return {
      id: membership.id,
      role: membership.role,
      status: membership.status,
      unchanged: true as const,
    };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.companyUser.update({
      where: { id: membership.id },
      data: { role: nextRole, status: nextStatus },
    });
    if (input.role && input.role !== membership.role) {
      await tx.userInvitation.updateMany({
        where: { companyId: input.companyId, userId: membership.userId, status: "PENDING" },
        data: { role: input.role },
      });
    }
    await tx.activity.create({
      data: {
        companyId: input.companyId,
        userId: actorUserId,
        type: "SYSTEM",
        subject: "Portal user updated",
        body: `${membership.user.email}: role ${membership.role} → ${nextRole}; membership ${membership.status} → ${nextStatus}`,
        metadata: {
          action: "company.user_membership_updated",
          membershipId: membership.id,
          userId: membership.userId,
        },
      },
    });
    return row;
  });

  await recordAuditEvent({
    action: "company.user_membership_updated",
    entityType: "CompanyUser",
    entityId: membership.id,
    actorUserId,
    companyId: input.companyId,
    before: { role: membership.role, status: membership.status, email: membership.user.email },
    after: { role: updated.role, status: updated.status, email: membership.user.email },
  });

  return {
    id: updated.id,
    role: updated.role,
    status: updated.status,
    email: membership.user.email,
    loginStatus: membership.user.status,
    unchanged: false as const,
  };
}

export async function listCompanyActivity(actorUserId: string, companyId: string, limit = 40) {
  const profile = await requireAuthenticatedUser(actorUserId);
  if (!hasPermission(profile, "companies.view") && !hasPermission(profile, "audit.view")) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }
  await assertCompanyReadable(profile, companyId);

  const [activities, audits] = await Promise.all([
    prisma.activity.findMany({
      where: { companyId },
      orderBy: { occurredAt: "desc" },
      take: limit,
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    grants(profile, "audit.view", "admin.access")
      ? prisma.auditEvent.findMany({
          where: { companyId },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            createdAt: true,
            metadata: true,
            actor: { select: { id: true, name: true, email: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const timeline = [
    ...activities.map((a) => ({
      id: `act-${a.id}`,
      kind: "activity" as const,
      at: a.occurredAt.toISOString(),
      title: a.subject ?? a.type,
      body: a.body,
      actor: a.user?.name ?? a.user?.email ?? null,
    })),
    ...audits.map((a) => ({
      id: `aud-${a.id}`,
      kind: "audit" as const,
      at: a.createdAt.toISOString(),
      title: a.action,
      body: `${a.entityType}${a.entityId ? ` · ${a.entityId}` : ""}`,
      actor: a.actor?.name ?? a.actor?.email ?? null,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);

  return timeline;
}

export async function listSalesRepsForSelect(actorUserId: string) {
  await requireSystemPermission(actorUserId, "companies.view");
  const reps = await prisma.salesRep.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      user: { select: { name: true, email: true } },
    },
  });
  return reps.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.user.name ?? r.user.email,
  }));
}

export async function listPriceListsForSelect(actorUserId: string) {
  await requireSystemPermission(actorUserId, "companies.view");
  return prisma.priceList.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, isDefault: true },
  });
}
