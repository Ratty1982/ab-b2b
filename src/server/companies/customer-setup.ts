/**
 * Single-page Customer Setup: load workspace + readiness, and SAVE & ENABLE ORDERING.
 * Reuses existing company/contact/address/cutover services. Does not invent sales data.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants, hasPermission } from "@/server/rbac/access";
import { recordAuditEvent } from "@/server/audit/record";
import {
  assessCustomerSalesReadiness,
  type CustomerSalesReadiness,
} from "@/domain/customer-sales-readiness";
import { getCustomerCreationWizard } from "@/server/companies/customer-creation-wizard";
import {
  createAddress,
  createContact,
  updateAddress,
  updateCompany,
  updateContact,
} from "@/server/companies/service";
import { parseCreditLimitInput } from "@/domain/credit-limit";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().or(z.literal(""));

const contactDraftSchema = z.object({
  id: z.string().cuid().optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: optionalText(120),
  phone: optionalText(40),
  jobTitle: optionalText(80),
  isPrimary: z.boolean().optional().default(false),
  isPurchasing: z.boolean().optional().default(false),
  isAccounts: z.boolean().optional().default(false),
});

const addressDraftSchema = z.object({
  id: z.string().cuid().optional(),
  type: z.enum(["TRADING", "DELIVERY", "BILLING", "REGISTERED"]).optional().default("DELIVERY"),
  label: optionalText(80),
  line1: z.string().trim().min(1).max(120),
  line2: optionalText(120),
  town: z.string().trim().min(1).max(80),
  county: optionalText(80),
  postcode: z.string().trim().min(1).max(20),
  country: z.string().trim().min(2).max(2).default("GB"),
  isDefaultBilling: z.boolean().optional().default(false),
  isDefaultDelivery: z.boolean().optional().default(false),
  contactName: optionalText(80),
  contactPhone: optionalText(40),
});

const saveSetupSchema = z.object({
  companyId: z.string().cuid(),
  name: z.string().trim().min(1).max(160).optional(),
  tradingName: optionalText(160),
  phone: optionalText(40),
  primaryEmail: optionalText(120),
  customerType: optionalText(80),
  notes: optionalText(4000),
  paymentTerms: optionalText(80),
  creditLimit: z.union([z.string(), z.null()]).optional(),
  creditLimitReviewed: z.boolean(),
  priceListId: z.string().cuid().nullable().optional(),
  salesRepId: z.string().cuid().nullable().optional(),
  taxStatus: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT", "OUTSIDE_SCOPE"]).optional(),
  contacts: z.array(contactDraftSchema).max(40).default([]),
  addresses: z.array(addressDraftSchema).max(40).default([]),
  enableOrdering: z.boolean().default(true),
  expectedUpdatedAt: z.string().datetime().optional(),
});

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function addressKey(input: { line1: string; postcode: string; town: string; country: string }) {
  return [input.line1, input.town, input.postcode, input.country]
    .map((part) => part.trim().toUpperCase().replace(/\s+/g, " "))
    .join("|");
}

function evidenceKind(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const kind = (evidence as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

export async function loadCustomerSalesReadiness(
  companyId: string,
): Promise<CustomerSalesReadiness> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      status: true,
      paymentTerms: true,
      creditLimit: true,
      creditLimitReviewedAt: true,
      orderingEnabledAt: true,
      createdAt: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      contacts: { select: { isPrimary: true } },
      addresses: { select: { isDefaultBilling: true, isDefaultDelivery: true, type: true } },
      salesCutover: { select: { historyStatus: true, evidence: true } },
      _count: { select: { orders: true } },
    },
  });
  if (!company) throw new AuthError("Customer not found", "NOT_FOUND", 404);

  const ownership = company.autopartCustomerCode
    ? await prisma.company.count({
        where: {
          autopartCustomerCode: { equals: company.autopartCustomerCode, mode: "insensitive" },
          NOT: { id: companyId },
        },
      })
    : 0;

  return assessCustomerSalesReadiness({
    status: company.status,
    salesCode: company.autopartCustomerCode,
    salesCodeVerified: Boolean(
      company.autopartCustomerCode && company.autopartCustomerCodeVerifiedAt,
    ),
    ownershipAmbiguous: ownership > 0,
    historyStatus: company.salesCutover?.historyStatus ?? "NOT_STARTED",
    historyKind: evidenceKind(company.salesCutover?.evidence ?? null),
    hasPrimaryContact: company.contacts.some((contact) => contact.isPrimary),
    hasBillingAddress: company.addresses.some(
      (address) => address.isDefaultBilling || address.type === "BILLING",
    ),
    hasDeliveryAddress: company.addresses.some(
      (address) => address.isDefaultDelivery || address.type === "DELIVERY",
    ),
    paymentTerms: company.paymentTerms,
    creditLimitReviewed: Boolean(company.creditLimitReviewedAt),
    creditLimit: company.creditLimit?.toString() ?? null,
    orderingEnabledAt: company.orderingEnabledAt?.toISOString() ?? null,
    createdAt: company.createdAt.toISOString(),
    hasExistingOrders: company._count.orders > 0,
  });
}

export async function getCustomerSetup(actorUserId: string, companyId: string) {
  const wizard = await getCustomerCreationWizard(actorUserId, companyId);
  const salesReadiness = await loadCustomerSalesReadiness(companyId);
  return {
    ...wizard,
    salesReadiness,
  };
}

export async function saveCustomerSetupAndEnableOrdering(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "companies.edit");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot complete customer setup", "FORBIDDEN", 403);
  }
  const input = saveSetupSchema.parse(raw);

  const existing = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: {
      id: true,
      updatedAt: true,
      notes: true,
      addresses: {
        select: {
          id: true,
          line1: true,
          town: true,
          postcode: true,
          country: true,
        },
      },
    },
  });
  if (!existing) throw new AuthError("Customer not found", "NOT_FOUND", 404);

  if (input.expectedUpdatedAt) {
    const expected = Date.parse(input.expectedUpdatedAt);
    if (Number.isFinite(expected) && existing.updatedAt.getTime() !== expected) {
      throw new AuthError(
        "This customer was changed by someone else. Reload setup and try again.",
        "CONFLICT",
        409,
      );
    }
  }

  if (input.creditLimit !== undefined) {
    const parsed = parseCreditLimitInput(input.creditLimit);
    if (!parsed.ok) throw new AuthError(parsed.message, "VALIDATION", 400);
  }

  const notes =
    input.customerType !== undefined || input.notes !== undefined
      ? [
          input.customerType?.trim() ? `Customer type: ${input.customerType.trim()}` : null,
          input.notes !== undefined
            ? blankToNull(input.notes)
            : existing.notes
                ?.split("\n")
                .filter((line) => !/^Customer type:/i.test(line.trim()))
                .join("\n")
                .trim() || null,
        ]
          .filter(Boolean)
          .join("\n") || null
      : undefined;

  await updateCompany(actorUserId, {
    id: input.companyId,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.tradingName !== undefined ? { tradingName: blankToNull(input.tradingName) } : {}),
    ...(input.phone !== undefined ? { phone: blankToNull(input.phone) } : {}),
    ...(input.primaryEmail !== undefined ? { primaryEmail: blankToNull(input.primaryEmail) } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(input.paymentTerms !== undefined ? { paymentTerms: blankToNull(input.paymentTerms) } : {}),
    ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
    ...(input.priceListId !== undefined ? { priceListId: input.priceListId } : {}),
    ...(input.salesRepId !== undefined ? { salesRepId: input.salesRepId } : {}),
    ...(input.taxStatus !== undefined ? { taxStatus: input.taxStatus } : {}),
  });

  if (input.creditLimitReviewed) {
    await prisma.company.update({
      where: { id: input.companyId },
      data: {
        creditLimitReviewedAt: new Date(),
        creditLimitReviewedById: actorUserId,
      },
    });
    await recordAuditEvent({
      action: "company.credit_limit_reviewed",
      entityType: "Company",
      entityId: input.companyId,
      actorUserId,
      companyId: input.companyId,
      metadata: {
        creditLimit: input.creditLimit === undefined ? "unchanged" : input.creditLimit,
      },
    });
  }

  for (const contact of input.contacts) {
    if (contact.id) {
      if (!hasPermission(profile, "contacts.edit") && !grants(profile, "admin.access")) {
        throw new AuthError("Missing contacts.edit permission", "FORBIDDEN", 403);
      }
      await updateContact(actorUserId, {
        id: contact.id,
        companyId: input.companyId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: blankToNull(contact.email),
        phone: blankToNull(contact.phone),
        jobTitle: blankToNull(contact.jobTitle),
        isPrimary: contact.isPrimary,
        isPurchasing: contact.isPurchasing,
        isAccounts: contact.isAccounts,
      });
      continue;
    }
    if (!hasPermission(profile, "contacts.create") && !grants(profile, "admin.access")) {
      throw new AuthError("Missing contacts.create permission", "FORBIDDEN", 403);
    }
    await createContact(actorUserId, {
      companyId: input.companyId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: blankToNull(contact.email),
      phone: blankToNull(contact.phone),
      jobTitle: blankToNull(contact.jobTitle),
      isPrimary: contact.isPrimary,
      isPurchasing: contact.isPurchasing,
      isAccounts: contact.isAccounts,
    });
  }

  const knownKeys = new Map(existing.addresses.map((address) => [addressKey(address), address.id]));

  for (const address of input.addresses) {
    if (address.id) {
      await updateAddress(actorUserId, {
        id: address.id,
        companyId: input.companyId,
        type: address.type,
        label: blankToNull(address.label),
        line1: address.line1,
        line2: blankToNull(address.line2),
        town: address.town,
        county: blankToNull(address.county),
        postcode: address.postcode,
        country: address.country,
        isDefaultBilling: address.isDefaultBilling,
        isDefaultDelivery: address.isDefaultDelivery,
        contactName: blankToNull(address.contactName),
        contactPhone: blankToNull(address.contactPhone),
      });
      continue;
    }
    const key = addressKey(address);
    const duplicateId = knownKeys.get(key);
    if (duplicateId) {
      await updateAddress(actorUserId, {
        id: duplicateId,
        companyId: input.companyId,
        type: address.type,
        label: blankToNull(address.label),
        line1: address.line1,
        line2: blankToNull(address.line2),
        town: address.town,
        county: blankToNull(address.county),
        postcode: address.postcode,
        country: address.country,
        isDefaultBilling: address.isDefaultBilling,
        isDefaultDelivery: address.isDefaultDelivery,
        contactName: blankToNull(address.contactName),
        contactPhone: blankToNull(address.contactPhone),
      });
      continue;
    }
    const created = await createAddress(actorUserId, {
      companyId: input.companyId,
      type: address.type,
      label: blankToNull(address.label),
      line1: address.line1,
      line2: blankToNull(address.line2),
      town: address.town,
      county: blankToNull(address.county),
      postcode: address.postcode,
      country: address.country,
      isDefaultBilling: address.isDefaultBilling,
      isDefaultDelivery: address.isDefaultDelivery,
      contactName: blankToNull(address.contactName),
      contactPhone: blankToNull(address.contactPhone),
    });
    knownKeys.set(key, created.id);
  }

  const salesReadiness = await loadCustomerSalesReadiness(input.companyId);

  if (input.enableOrdering) {
    if (!salesReadiness.readyForSales) {
      throw new AuthError(
        salesReadiness.blockReason ?? "Setup is incomplete. Ordering was not enabled.",
        "SETUP_INCOMPLETE",
        400,
      );
    }
    await prisma.company.update({
      where: { id: input.companyId },
      data: {
        orderingEnabledAt: new Date(),
        orderingEnabledById: actorUserId,
      },
    });
    await recordAuditEvent({
      action: "company.ordering_enabled",
      entityType: "Company",
      entityId: input.companyId,
      actorUserId,
      companyId: input.companyId,
      metadata: {
        label: "READY_FOR_SALES",
        requirements: salesReadiness.requirements.map((item) => ({
          id: item.id,
          complete: item.complete,
        })),
      },
    });
  }

  const setup = await getCustomerSetup(actorUserId, input.companyId);
  return {
    ok: true as const,
    orderingEnabled: Boolean(setup.company.orderingEnabledAt) || setup.salesReadiness.readyForSales,
    salesReadiness: setup.salesReadiness,
    setup,
  };
}

export async function assertCompanyReadyForStaffOrders(companyId: string) {
  const readiness = await loadCustomerSalesReadiness(companyId);
  if (!readiness.canCreateStaffOrder) {
    throw new AuthError(
      readiness.blockReason ?? "Customer is not ready for sales order entry",
      readiness.label === "BLOCKED" ? "COMPANY_NOT_ACTIVE" : "SETUP_INCOMPLETE",
      403,
    );
  }
  return readiness;
}
