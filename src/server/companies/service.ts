import type { Prisma } from "@prisma/client";
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
  AuthError,
} from "@/server/rbac/guards";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import {
  companyCreateSchema,
  companyListQuerySchema,
  companyUpdateSchema,
  contactSchema,
  contactUpdateSchema,
  addressSchema,
  addressUpdateSchema,
  emptyToNull,
  type CompanyStatusKey,
} from "@/domain/company";
import { generateInviteToken, inviteUserSchema } from "@/domain/invitation";

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
    creditLimit: true,
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
      take: 1,
      select: {
        salesRepId: true,
        salesRep: {
          select: {
            id: true,
            code: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    },
  } satisfies Prisma.CompanySelect;
}

async function assertCompanyReadable(profile: LoadedAccessProfile, companyId: string) {
  if (hasPermission(profile, "sales.view_all_accounts") || hasPermission(profile, "admin.access")) {
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
  if (query.status) where.status = query.status;
  if (query.salesRepId) {
    where.assignments = { some: { salesRepId: query.salesRepId } };
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
    ];
  }

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
  creditLimit: { toNumber?: () => number } | number | null;
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
      user: { id: string; name: string | null; email: string };
    };
  }>;
}) {
  const assignment = row.assignments?.[0];
  const credit =
    row.creditLimit == null
      ? null
      : typeof row.creditLimit === "number"
        ? row.creditLimit
        : typeof row.creditLimit.toNumber === "function"
          ? row.creditLimit.toNumber()
          : Number(row.creditLimit);
  const autopartVerified = Boolean(row.autopartCustomerCode && row.autopartCustomerCodeVerifiedAt);
  return {
    id: row.id,
    accountNumber: row.accountNumber,
    name: row.name,
    tradingName: row.tradingName,
    companyNumber: row.companyNumber,
    vatNumber: row.vatNumber,
    status: row.status as CompanyStatusKey,
    taxStatus: row.taxStatus,
    paymentTerms: row.paymentTerms,
    creditLimit: credit,
    currency: row.currency,
    priceListId: row.priceListId,
    priceList: row.priceList ?? null,
    externalRef: row.externalRef,
    autopartAccount: {
      code: row.autopartCustomerCode,
      verified: autopartVerified,
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
          name: assignment.salesRep.user.name ?? assignment.salesRep.user.email,
          email: assignment.salesRep.user.email,
        }
      : null,
  };
}

export async function getCompanyWorkspace(actorUserId: string, companyId: string) {
  const profile = await requireAuthenticatedUser(actorUserId);
  if (!hasPermission(profile, "companies.view") && !hasPermission(profile, "admin.access")) {
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

  const canViewCredit =
    hasPermission(profile, "credit.view") || hasPermission(profile, "admin.access");
  const canEditCredit =
    hasPermission(profile, "credit.edit") || hasPermission(profile, "admin.access");

  const serialized = serializeCompany(company);
  if (!canViewCredit) {
    serialized.creditLimit = null;
  }

  return {
    company: serialized,
    permissions: {
      canEdit: hasPermission(profile, "companies.edit") || hasPermission(profile, "admin.access"),
      canManageUsers:
        hasPermission(profile, "companies.manage_users") || hasPermission(profile, "admin.access"),
      canViewCredit,
      canEditCredit,
      canEditPricing:
        hasPermission(profile, "pricing.edit") || hasPermission(profile, "admin.access"),
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
    users: company.users.map((cu) => ({
      id: cu.id,
      role: cu.role,
      status: cu.status,
      isDefault: cu.isDefault,
      createdAt: cu.createdAt.toISOString(),
      user: {
        id: cu.user.id,
        email: cu.user.email,
        name: cu.user.name,
        status: cu.user.status,
        lastLoginAt: cu.user.lastLoginAt?.toISOString() ?? null,
      },
    })),
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
        creditLimit:
          input.creditLimit != null &&
          (hasPermission(profile, "credit.edit") || hasPermission(profile, "admin.access"))
            ? input.creditLimit
            : null,
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

  const canEditCredit =
    hasPermission(profile, "credit.edit") || hasPermission(profile, "admin.access");

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
  if (input.creditLimit !== undefined && canEditCredit) {
    data.creditLimit = input.creditLimit;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.company.update({
      where: { id: input.id },
      data,
      select: companySelect(),
    });

    if (input.salesRepId !== undefined) {
      await tx.companyAssignment.deleteMany({ where: { companyId: input.id, isPrimary: true } });
      if (input.salesRepId) {
        await tx.companyAssignment.upsert({
          where: {
            companyId_salesRepId: { companyId: input.id, salesRepId: input.salesRepId },
          },
          create: { companyId: input.id, salesRepId: input.salesRepId, isPrimary: true },
          update: { isPrimary: true },
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

  const full = await prisma.company.findUniqueOrThrow({
    where: { id: input.id },
    select: companySelect(),
  });
  return serializeCompany(full);
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

  const email = input.email.toLowerCase();
  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

  const invitation = await prisma.$transaction(async (tx) => {
    // Revoke prior pending invites for same email+company
    await tx.userInvitation.updateMany({
      where: { companyId: input.companyId, email, status: "PENDING" },
      data: { status: "REVOKED" },
    });

    const inv = await tx.userInvitation.create({
      data: {
        companyId: input.companyId,
        email,
        role: input.role,
        tokenHash,
        invitedById: actorUserId,
        expiresAt,
        emailDeferred: true,
      },
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

    await tx.activity.create({
      data: {
        companyId: input.companyId,
        userId: actorUserId,
        type: "SYSTEM",
        subject: "User invited",
        body: `${email} (${input.role}) — email deferred`,
        metadata: { action: "user.invited", invitationId: inv.id, emailDeferred: true },
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
    after: { email, role: input.role, emailDeferred: true },
  });

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    emailDeferred: true,
    expiresAt: invitation.expiresAt.toISOString(),
    /** Opaque token for admin copy / future email — only returned at creation time */
    inviteToken: token,
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
    hasPermission(profile, "audit.view") || hasPermission(profile, "admin.access")
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
