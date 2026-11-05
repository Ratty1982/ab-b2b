/**
 * Guided customer creation.
 * Phase 1 (shared onboarding summary and verification safety) is already on
 * production/phase-1-auth-rbac. This module does not add an onboarding table.
 * Writes go through the existing company, Autopart, commercial, history, and
 * invitation services.
 */
import { prisma } from "@/infra/database/client";
import { requireSystemPermission } from "@/server/rbac/guards";
import { grants, hasPermission } from "@/server/rbac/access";
import {
  customerCreationDetailsSchema,
  duplicateSearchSchema,
  mergeCustomerTypeNotes,
  splitCustomerTypeNotes,
  suggestWizardStep,
} from "@/domain/customer-creation-wizard";
import {
  assertNoStrongCustomerDuplicates,
  findCustomerDuplicates,
  type CustomerDuplicateMatch,
} from "@/server/companies/customer-duplicates";
import {
  createCompany,
  createContact,
  createAddress,
  getCompanyWorkspace,
  updateCompany,
} from "@/server/companies/service";

export type { CustomerDuplicateMatch };

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
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
    // Create-time enforcement (not only the preliminary search UI).
    await assertNoStrongCustomerDuplicates({
      name: input.name,
      email: input.primaryEmail,
      phone: input.phone,
      confirmDespiteDuplicates: input.confirmDespiteDuplicates,
    });
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
      // Already asserted above so createCompany does not double-throw with a
      // different call stack during the same wizard save.
      confirmDespiteDuplicates: true,
    });
    return {
      companyId: created.id,
      created: true as const,
      contactCreated: Boolean(contact),
      addressCreated: Boolean(address),
      contactAlreadyPresent: false,
      addressAlreadyPresent: false,
    };
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

  const existingContacts = await prisma.contact.count({ where: { companyId: input.companyId } });
  if (contact && existingContacts === 0) {
    await createContact(actorUserId, {
      companyId: input.companyId,
      ...contact,
      isPrimary: true,
      isPurchasing: true,
    });
  }
  const existingAddresses = await prisma.address.count({ where: { companyId: input.companyId } });
  if (address && existingAddresses === 0) {
    await createAddress(actorUserId, {
      companyId: input.companyId,
      type: "REGISTERED",
      label: "Registered / trading",
      ...address,
      isDefaultBilling: true,
      isDefaultDelivery: true,
    });
  }
  return {
    companyId: input.companyId,
    created: false as const,
    contactCreated: Boolean(contact && existingContacts === 0),
    addressCreated: Boolean(address && existingAddresses === 0),
    contactAlreadyPresent: existingContacts > 0,
    addressAlreadyPresent: existingAddresses > 0,
  };
}

async function resolveWizardSource(companyId: string, notes: string | null) {
  const [tradeApp, masterCount] = await Promise.all([
    prisma.tradeApplication.findFirst({
      where: { companyId, status: "APPROVED" },
      orderBy: { decidedAt: "desc" },
      select: {
        id: true,
        reference: true,
        claimedAutopartCustomerCode: true,
        decidedAt: true,
      },
    }),
    prisma.autopartAccount.count({ where: { companyId } }),
  ]);
  if (tradeApp) {
    return {
      key: "TRADE_APPLICATION" as const,
      label: "Trade application",
      reference: tradeApp.reference,
      applicationId: tradeApp.id,
      applicantClaimedAutopartCode: tradeApp.claimedAutopartCustomerCode,
      note: "Applicant-declared Autopart claims stay unverified until staff confirm on the Autopart step.",
    };
  }
  const noteText = notes ?? "";
  if (
    masterCount > 0 &&
    (noteText.includes("Source AUTOPART/407EXP") ||
      noteText.includes("Created from the Autopart customer master"))
  ) {
    return {
      key: "AUTOPART_PROSPECT" as const,
      label: "Autopart prospect",
      reference: null,
      applicationId: null,
      applicantClaimedAutopartCode: null,
      note: "Linked from the Autopart customer master. Sales-code verification remains a separate staff action.",
    };
  }
  // Do not invent a source for legacy or ambiguous records.
  return null;
}

export async function getCustomerCreationWizard(actorUserId: string, companyId: string) {
  const profile = await requireSystemPermission(actorUserId, "companies.view");
  const workspace = await getCompanyWorkspace(actorUserId, companyId);
  const [cutover, masters, source] = await Promise.all([
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
    resolveWizardSource(companyId, workspace.company.notes),
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
    source,
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
