/**
 * Single-page Customer Setup: load workspace + readiness, and SAVE & ENABLE ORDERING.
 * Reuses existing company/contact/address/cutover services. Does not invent sales data.
 *
 * Save semantics: validate everything up front, then persist in one transaction so a
 * failed enable/validation never leaves a half-written setup while claiming nothing changed.
 * Autopart verify and historical import remain independent audited operations.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants, hasPermission } from "@/server/rbac/access";
import { recordAuditEventInTransaction } from "@/server/audit/record";
import {
  assessCustomerSalesReadiness,
  CUSTOMER_SALES_READY_ENFORCE_FROM,
  type CustomerSalesReadiness,
} from "@/domain/customer-sales-readiness";
import { getCustomerCreationWizard } from "@/server/companies/customer-creation-wizard";
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

type SaveSetupInput = z.infer<typeof saveSetupSchema>;

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function addressKey(input: { line1: string; postcode: string; town: string; country: string }) {
  return [input.line1, input.town, input.postcode, input.country]
    .map((part) => part.trim().toUpperCase().replace(/\s+/g, " "))
    .join("|");
}

function contactKey(input: {
  firstName: string;
  lastName: string;
  email?: string | null | undefined;
}) {
  return [input.firstName, input.lastName, input.email ?? ""]
    .map((part) => part.trim().toUpperCase().replace(/\s+/g, " "))
    .join("|");
}

function evidenceKind(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const kind = (evidence as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
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

async function assessCompanySalesReadinessFromDb(
  tx: Prisma.TransactionClient | typeof prisma,
  companyId: string,
): Promise<CustomerSalesReadiness> {
  const company = await tx.company.findUnique({
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
    },
  });
  if (!company) throw new AuthError("Customer not found", "NOT_FOUND", 404);

  const ownership = company.autopartCustomerCode
    ? await tx.company.count({
        where: {
          autopartCustomerCode: { equals: company.autopartCustomerCode, mode: "insensitive" },
          NOT: { id: companyId },
        },
      })
    : 0;

  const enforceFrom = new Date(CUSTOMER_SALES_READY_ENFORCE_FROM);
  const preRolloutOrderCount = await tx.order.count({
    where: {
      companyId,
      createdAt: { lt: enforceFrom },
    },
  });

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
    hasPreRolloutOrders: preRolloutOrderCount > 0,
  });
}

export async function loadCustomerSalesReadiness(
  companyId: string,
): Promise<CustomerSalesReadiness> {
  return assessCompanySalesReadinessFromDb(prisma, companyId);
}

export async function getCustomerSetup(actorUserId: string, companyId: string) {
  const wizard = await getCustomerCreationWizard(actorUserId, companyId);
  const salesReadiness = await loadCustomerSalesReadiness(companyId);
  return {
    ...wizard,
    salesReadiness,
  };
}

function validateSavePermissions(
  profile: Awaited<ReturnType<typeof requireSystemPermission>>,
  input: SaveSetupInput,
) {
  const needsContactCreate = input.contacts.some((contact) => !contact.id);
  const needsContactEdit = input.contacts.some((contact) => Boolean(contact.id));
  if (
    needsContactCreate &&
    !hasPermission(profile, "contacts.create") &&
    !grants(profile, "admin.access")
  ) {
    throw new AuthError("Missing contacts.create permission", "FORBIDDEN", 403);
  }
  if (
    needsContactEdit &&
    !hasPermission(profile, "contacts.edit") &&
    !grants(profile, "admin.access")
  ) {
    throw new AuthError("Missing contacts.edit permission", "FORBIDDEN", 403);
  }
}

export async function saveCustomerSetupAndEnableOrdering(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "companies.edit");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot complete customer setup", "FORBIDDEN", 403);
  }

  const input = saveSetupSchema.parse(raw);
  validateSavePermissions(profile, input);

  let parsedCredit: ReturnType<typeof parseCreditLimitInput> | null = null;
  if (input.creditLimit !== undefined) {
    parsedCredit = parseCreditLimitInput(input.creditLimit);
    if (!parsedCredit.ok) throw new AuthError(parsedCredit.message, "VALIDATION", 400);
  }

  const existing = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: {
      id: true,
      updatedAt: true,
      notes: true,
      contacts: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          isPrimary: true,
        },
      },
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

  const ownedContactIds = new Set(existing.contacts.map((contact) => contact.id));
  for (const contact of input.contacts) {
    if (contact.id && !ownedContactIds.has(contact.id)) {
      throw new AuthError("Contact does not belong to this customer", "VALIDATION", 400);
    }
  }

  const ownedAddressIds = new Set(existing.addresses.map((address) => address.id));
  for (const address of input.addresses) {
    if (address.id && !ownedAddressIds.has(address.id)) {
      throw new AuthError("Address does not belong to this customer", "VALIDATION", 400);
    }
  }

  if (input.salesRepId) {
    const salesRep = await prisma.salesRep.findUnique({
      where: { id: input.salesRepId },
      select: { id: true, active: true },
    });
    if (!salesRep || !salesRep.active) {
      throw new AuthError("Sales representative not found", "VALIDATION", 400);
    }
  }

  if (input.priceListId) {
    const priceList = await prisma.priceList.findUnique({
      where: { id: input.priceListId },
      select: { id: true },
    });
    if (!priceList) throw new AuthError("Price list not found", "VALIDATION", 400);
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

  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.company.findUnique({
      where: { id: input.companyId },
      select: { id: true, updatedAt: true },
    });
    if (!locked) throw new AuthError("Customer not found", "NOT_FOUND", 404);
    if (input.expectedUpdatedAt) {
      const expectedMs = Date.parse(input.expectedUpdatedAt);
      if (Number.isFinite(expectedMs) && locked.updatedAt.getTime() !== expectedMs) {
        throw new AuthError(
          "This customer was changed by someone else. Reload setup and try again.",
          "CONFLICT",
          409,
        );
      }
    }

    await tx.company.update({
      where: { id: input.companyId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.tradingName !== undefined ? { tradingName: blankToNull(input.tradingName) } : {}),
        ...(input.phone !== undefined ? { phone: blankToNull(input.phone) } : {}),
        ...(input.primaryEmail !== undefined
          ? { primaryEmail: blankToNull(input.primaryEmail) }
          : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(input.paymentTerms !== undefined
          ? { paymentTerms: blankToNull(input.paymentTerms) }
          : {}),
        ...(parsedCredit && parsedCredit.ok ? { creditLimit: parsedCredit.value ?? null } : {}),
        ...(input.priceListId !== undefined ? { priceListId: input.priceListId } : {}),
        ...(input.taxStatus !== undefined ? { taxStatus: input.taxStatus } : {}),
      },
    });

    if (input.salesRepId !== undefined) {
      await tx.companyAssignment.updateMany({
        where: { companyId: input.companyId, isPrimary: true },
        data: { isPrimary: false },
      });
      if (input.salesRepId) {
        await tx.companyAssignment.upsert({
          where: {
            companyId_salesRepId: {
              companyId: input.companyId,
              salesRepId: input.salesRepId,
            },
          },
          create: {
            companyId: input.companyId,
            salesRepId: input.salesRepId,
            isPrimary: true,
          },
          update: { isPrimary: true },
        });
        await tx.companyAssignment.updateMany({
          where: {
            companyId: input.companyId,
            isPrimary: true,
            salesRepId: { not: input.salesRepId },
          },
          data: { isPrimary: false },
        });
      }
    }

    if (input.creditLimitReviewed) {
      await tx.company.update({
        where: { id: input.companyId },
        data: {
          creditLimitReviewedAt: new Date(),
          creditLimitReviewedById: actorUserId,
        },
      });
      await recordAuditEventInTransaction(tx, {
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

    const knownContactKeys = new Map(
      existing.contacts.map((contact) => [contactKey(contact), contact.id]),
    );

    for (const contact of input.contacts) {
      const resolvedId =
        contact.id ??
        knownContactKeys.get(
          contactKey({
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: blankToNull(contact.email),
          }),
        );

      if (resolvedId) {
        if (contact.isPrimary) {
          await tx.contact.updateMany({
            where: { companyId: input.companyId, isPrimary: true, NOT: { id: resolvedId } },
            data: { isPrimary: false },
          });
        }
        await tx.contact.update({
          where: { id: resolvedId },
          data: {
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: blankToNull(contact.email),
            phone: blankToNull(contact.phone),
            jobTitle: blankToNull(contact.jobTitle),
            isPrimary: contact.isPrimary,
            isPurchasing: contact.isPurchasing,
            isAccounts: contact.isAccounts,
          },
        });
        knownContactKeys.set(
          contactKey({
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: blankToNull(contact.email),
          }),
          resolvedId,
        );
        continue;
      }

      if (contact.isPrimary) {
        await tx.contact.updateMany({
          where: { companyId: input.companyId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const created = await tx.contact.create({
        data: {
          companyId: input.companyId,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: blankToNull(contact.email),
          phone: blankToNull(contact.phone),
          jobTitle: blankToNull(contact.jobTitle),
          isPrimary: contact.isPrimary,
          isPurchasing: contact.isPurchasing,
          isAccounts: contact.isAccounts,
        },
      });
      knownContactKeys.set(
        contactKey({
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: blankToNull(contact.email),
        }),
        created.id,
      );
    }

    const knownAddressKeys = new Map(
      existing.addresses.map((address) => [addressKey(address), address.id]),
    );

    for (const address of input.addresses) {
      const resolvedId = address.id ?? knownAddressKeys.get(addressKey(address));
      if (resolvedId) {
        await clearDefaultFlags(tx, input.companyId, {
          billing: address.isDefaultBilling,
          delivery: address.isDefaultDelivery,
          exceptId: resolvedId,
        });
        await tx.address.update({
          where: { id: resolvedId },
          data: {
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
            isDefault: address.isDefaultBilling || address.isDefaultDelivery,
            contactName: blankToNull(address.contactName),
            contactPhone: blankToNull(address.contactPhone),
          },
        });
        knownAddressKeys.set(addressKey(address), resolvedId);
        continue;
      }

      await clearDefaultFlags(tx, input.companyId, {
        billing: address.isDefaultBilling,
        delivery: address.isDefaultDelivery,
      });
      const created = await tx.address.create({
        data: {
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
          isDefault: address.isDefaultBilling || address.isDefaultDelivery,
          contactName: blankToNull(address.contactName),
          contactPhone: blankToNull(address.contactPhone),
        },
      });
      knownAddressKeys.set(addressKey(address), created.id);
    }

    const salesReadiness = await assessCompanySalesReadinessFromDb(tx, input.companyId);

    if (input.enableOrdering) {
      if (!salesReadiness.setupRequirementsComplete) {
        throw new AuthError(
          salesReadiness.blockReason ??
            "Setup is incomplete. No changes were committed and ordering was not enabled.",
          "SETUP_INCOMPLETE",
          400,
        );
      }
      const enabledAt = new Date();
      await tx.company.update({
        where: { id: input.companyId },
        data: {
          orderingEnabledAt: enabledAt,
          orderingEnabledById: actorUserId,
        },
      });
      await recordAuditEventInTransaction(tx, {
        action: "company.ordering_enabled",
        entityType: "Company",
        entityId: input.companyId,
        actorUserId,
        companyId: input.companyId,
        metadata: {
          label: "READY_FOR_SALES",
          orderingEnabledAt: enabledAt.toISOString(),
          requirements: salesReadiness.requirements.map((item) => ({
            id: item.id,
            complete: item.complete,
          })),
        },
      });
    }

    return {
      mode: input.enableOrdering ? ("enabled" as const) : ("draft" as const),
      salesReadiness: await assessCompanySalesReadinessFromDb(tx, input.companyId),
    };
  });

  const setup = await getCustomerSetup(actorUserId, input.companyId);
  const message =
    result.mode === "enabled"
      ? setup.salesReadiness.readyForSales
        ? "Saved. Customer is READY FOR SALES."
        : "Saved and ordering approval recorded."
      : "Draft saved — ordering not enabled";

  return {
    ok: true as const,
    mode: result.mode,
    message,
    orderingEnabled: Boolean(setup.company.orderingEnabledAt),
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
