/**
 * Guided customer creation.
 * Phase 1 (shared onboarding summary and verification safety) is already on
 * production/phase-1-auth-rbac. This module does not add an onboarding table.
 * Writes go through the existing company, Autopart, commercial, history, and
 * invitation services.
 */
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants, hasPermission } from "@/server/rbac/access";
import {
  classifyCustomerDuplicate,
  customerCreationDetailsSchema,
  duplicateSearchSchema,
  mergeCustomerTypeNotes,
  splitCustomerTypeNotes,
  suggestWizardStep,
  type DuplicateMatchReason,
  type DuplicateStrength,
} from "@/domain/customer-creation-wizard";
import {
  createCompany,
  createContact,
  createAddress,
  getCompanyWorkspace,
  updateCompany,
} from "@/server/companies/service";

export type CustomerDuplicateMatch = {
  id: string;
  name: string;
  status: string;
  primaryEmail: string | null;
  phone: string | null;
  strength: DuplicateStrength;
  reason: DuplicateMatchReason;
};

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
}

async function findCustomerDuplicates(input: {
  name: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  excludeCompanyId?: string | null | undefined;
}): Promise<CustomerDuplicateMatch[]> {
  const name = input.name.trim();
  const email = blankToNull(input.email);
  const phone = blankToNull(input.phone);
  if (name.length < 2 && !email && !phone) return [];

  const or: Array<Record<string, unknown>> = [];
  if (name.length >= 2) {
    or.push({ name: { contains: name, mode: "insensitive" } });
    or.push({ tradingName: { contains: name, mode: "insensitive" } });
  }
  if (email) or.push({ primaryEmail: { equals: email, mode: "insensitive" } });
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length >= 6) or.push({ phone: { contains: digits.slice(-6) } });
  if (or.length === 0) return [];

  const rows = await prisma.company.findMany({
    where: {
      OR: or,
      ...(input.excludeCompanyId ? { id: { not: input.excludeCompanyId } } : {}),
    },
    select: {
      id: true,
      name: true,
      tradingName: true,
      status: true,
      primaryEmail: true,
      phone: true,
    },
    take: 20,
    orderBy: { name: "asc" },
  });

  const matches: CustomerDuplicateMatch[] = [];
  for (const row of rows) {
    const classified = classifyCustomerDuplicate({ name, email, phone }, row);
    if (!classified) continue;
    matches.push({
      id: row.id,
      name: row.name,
      status: row.status,
      primaryEmail: row.primaryEmail,
      phone: row.phone,
      strength: classified.strength,
      reason: classified.reason,
    });
  }
  matches.sort((a, b) => {
    if (a.strength === b.strength) return a.name.localeCompare(b.name);
    return a.strength === "strong" ? -1 : 1;
  });
  return matches;
}

export async function searchCustomerCreationDuplicates(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "companies.view");
  const query = duplicateSearchSchema.parse(raw);
  return findCustomerDuplicates(query);
}

function readyContact(
  contact:
    | {
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        email?: string | null | undefined;
        phone?: string | null | undefined;
        jobTitle?: string | null | undefined;
      }
    | null
    | undefined,
) {
  if (!contact?.firstName?.trim() || !contact.lastName?.trim()) return null;
  return {
    firstName: contact.firstName.trim(),
    lastName: contact.lastName.trim(),
    email: blankToNull(contact.email),
    phone: blankToNull(contact.phone),
    jobTitle: blankToNull(contact.jobTitle),
  };
}

function readyAddress(
  address:
    | {
        line1?: string | null | undefined;
        line2?: string | null | undefined;
        town?: string | null | undefined;
        county?: string | null | undefined;
        postcode?: string | null | undefined;
        country?: string | null | undefined;
      }
    | null
    | undefined,
) {
  if (!address?.line1?.trim() || !address.town?.trim() || !address.postcode?.trim()) return null;
  const country = address.country?.trim().toUpperCase() || "GB";
  return {
    line1: address.line1.trim(),
    line2: blankToNull(address.line2),
    town: address.town.trim(),
    county: blankToNull(address.county),
    postcode: address.postcode.trim(),
    country,
  };
}

export async function saveCustomerCreationDetails(actorUserId: string, raw: unknown) {
  const input = customerCreationDetailsSchema.parse(raw);
  const notes = mergeCustomerTypeNotes(input.notes, input.customerType);
  const contact = readyContact(input.contact);
  const address = readyAddress(input.address);
  const salesRepId = blankToNull(input.salesRepId);

  if (!input.companyId) {
    if (!input.confirmDespiteDuplicates) {
      const matches = await findCustomerDuplicates({
        name: input.name,
        email: input.primaryEmail,
        phone: input.phone,
      });
      const strong = matches.filter((match) => match.strength === "strong");
      if (strong.length > 0) {
        const names = strong
          .slice(0, 5)
          .map((match) => match.name)
          .join(", ");
        throw new AuthError(
          `A customer already matches this name or contact: ${names}. Open that customer, or confirm that this is a separate customer.`,
          "DUPLICATE_CUSTOMER",
          409,
        );
      }
    }
    const created = await createCompany(actorUserId, {
      name: input.name,
      tradingName: blankToNull(input.tradingName),
      status: input.status,
      taxStatus: input.taxStatus,
      phone: blankToNull(input.phone),
      primaryEmail: blankToNull(input.primaryEmail),
      notes,
      salesRepId,
      contact,
      address,
    });
    return { companyId: created.id, created: true as const };
  }

  await updateCompany(actorUserId, {
    id: input.companyId,
    name: input.name,
    tradingName: blankToNull(input.tradingName),
    status: input.status,
    taxStatus: input.taxStatus,
    phone: blankToNull(input.phone),
    primaryEmail: blankToNull(input.primaryEmail),
    notes,
    salesRepId,
  });

  if (contact) {
    const existing = await prisma.contact.count({ where: { companyId: input.companyId } });
    if (existing === 0) {
      await createContact(actorUserId, {
        companyId: input.companyId,
        ...contact,
        isPrimary: true,
        isPurchasing: true,
      });
    }
  }
  if (address) {
    const existing = await prisma.address.count({ where: { companyId: input.companyId } });
    if (existing === 0) {
      await createAddress(actorUserId, {
        companyId: input.companyId,
        type: "REGISTERED",
        label: "Registered / trading",
        ...address,
        isDefaultBilling: true,
        isDefaultDelivery: true,
      });
    }
  }
  return { companyId: input.companyId, created: false as const };
}

export async function getCustomerCreationWizard(actorUserId: string, companyId: string) {
  const profile = await requireSystemPermission(actorUserId, "companies.view");
  const workspace = await getCompanyWorkspace(actorUserId, companyId);
  const [cutover, masters] = await Promise.all([
    prisma.customerSalesCutover.findUnique({
      where: { companyId },
      select: { historyStatus: true, evidence: true },
    }),
    prisma.autopartAccount.findMany({
      where: { companyId },
      orderBy: { accountCode: "asc" },
      take: 8,
      select: { id: true, accountCode: true, originalName: true },
    }),
  ]);
  const historyKind =
    cutover?.evidence && typeof cutover.evidence === "object" && !Array.isArray(cutover.evidence)
      ? typeof (cutover.evidence as { kind?: unknown }).kind === "string"
        ? (cutover.evidence as { kind: string }).kind
        : null
      : null;
  const historyStatus = cutover?.historyStatus ?? "NOT_STARTED";
  const notes = splitCustomerTypeNotes(workspace.company.notes);
  const canEditCompany = grants(profile, "companies.edit", "admin.access");
  const canEditPricing = grants(profile, "pricing.edit", "admin.access");
  const suggestedStep = suggestWizardStep({
    contactCount: workspace.contacts.length,
    addressCount: workspace.addresses.length,
    salesCode: workspace.company.autopartAccount.code,
    salesCodeVerified: workspace.company.autopartAccount.verified,
    historyStatus,
    status: workspace.company.status,
  });

  return {
    company: {
      ...workspace.company,
      customerType: notes.customerType,
      staffNotes: notes.notes,
    },
    contacts: workspace.contacts,
    addresses: workspace.addresses,
    users: workspace.users.map((membership) => ({
      id: membership.id,
      role: membership.role,
      status: membership.status,
      email: membership.user.email,
      name: membership.user.name,
    })),
    invitations: workspace.invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
    })),
    masters: profile.permissions.has("autopart.customer.view") ? masters : [],
    masterRestricted: !profile.permissions.has("autopart.customer.view"),
    history: { status: historyStatus, kind: historyKind },
    onboarding: workspace.onboarding,
    suggestedStep,
    permissions: {
      canEditCompany,
      canVerifyAccount: canEditCompany,
      canEditPricing,
      canLinkMaster: hasPermission(profile, "autopart.mapping.manage"),
      canViewMaster: hasPermission(profile, "autopart.customer.view"),
      canManageGroups: hasPermission(profile, "customer_groups.manage"),
      canViewGroups: hasPermission(profile, "customer_groups.view"),
      canImportHistory:
        hasPermission(profile, "orders.view") && grants(profile, "admin.access", "orders.edit"),
      canManageUsers: grants(profile, "companies.manage_users", "admin.access"),
      canCreateContacts: hasPermission(profile, "contacts.create"),
    },
  };
}
