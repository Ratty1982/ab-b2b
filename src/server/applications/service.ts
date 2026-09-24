import type { Prisma } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { generateInviteToken, hashInviteToken } from "@/domain/invitation";
import {
  acceptTradeInviteSchema,
  OPEN_APPLICATION_STATUSES,
  resolveBusinessTypeLabel,
  tradeApplicationDecisionSchema,
  tradeApplicationDeleteSchema,
  tradeApplicationMoreInfoSchema,
  tradeApplicationRejectSchema,
  tradeApplicationStaffEditSchema,
  tradeApplicationSubmitSchema,
  tradeApplicationWithdrawSchema,
} from "@/domain/trade-application";
import { emptyToNull } from "@/domain/company";
import { normalizeAutopartCustomerCode } from "@/server/companies/autopart-account";

function nextApplicationReference(): string {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `APP-${stamp}-${rand}`;
}

function contactEmail(primaryContact: unknown): string {
  if (primaryContact && typeof primaryContact === "object" && "email" in primaryContact) {
    return String((primaryContact as { email?: string }).email ?? "").toLowerCase();
  }
  return "";
}

function contactName(primaryContact: unknown): string {
  if (!primaryContact || typeof primaryContact !== "object") return "";
  const c = primaryContact as { firstName?: string; lastName?: string };
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
}

function tradingPostcode(tradingAddress: unknown): string {
  if (tradingAddress && typeof tradingAddress === "object" && "postcode" in tradingAddress) {
    return String((tradingAddress as { postcode?: string }).postcode ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }
  return "";
}

export type IdentityWarning = {
  code:
    | "EMAIL_INTERNAL_USER"
    | "EMAIL_OTHER_COMPANY"
    | "EMAIL_EXISTING_TRADE_USER"
    | "EMAIL_ALREADY_ACTIVE_MEMBER";
  message: string;
  userId?: string;
  companyIds?: string[];
};

export type PossibleDuplicate = {
  id: string;
  reference: string;
  status: string;
  companyName: string;
  matchReasons: string[];
  submittedAt: string;
};

async function findIdentityWarnings(email: string): Promise<IdentityWarning[]> {
  const warnings: IdentityWarning[] = [];
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      companyUsers: {
        select: { companyId: true, status: true, company: { select: { name: true } } },
      },
    },
  });
  if (!user) return warnings;

  if (user.actorType === "INTERNAL") {
    warnings.push({
      code: "EMAIL_INTERNAL_USER",
      message: "This email belongs to an internal Automotive Brands user. Do not auto-link.",
      userId: user.id,
    });
    return warnings;
  }

  const memberships = user.companyUsers;
  if (memberships.length === 0) {
    warnings.push({
      code: "EMAIL_EXISTING_TRADE_USER",
      message: "A trade user with this email already exists without an active company membership.",
      userId: user.id,
    });
    return warnings;
  }

  const active = memberships.filter((m) => m.status === "ACTIVE");
  if (active.length > 0) {
    warnings.push({
      code: "EMAIL_ALREADY_ACTIVE_MEMBER",
      message: `Email is already an active member of: ${active
        .map((m) => m.company.name)
        .join(", ")}. Confirm before linking another company.`,
      userId: user.id,
      companyIds: active.map((m) => m.companyId),
    });
  } else {
    warnings.push({
      code: "EMAIL_OTHER_COMPANY",
      message: `Email already has company memberships (${memberships
        .map((m) => m.company.name)
        .join(", ")}). Confirm before linking.`,
      userId: user.id,
      companyIds: memberships.map((m) => m.companyId),
    });
  }
  return warnings;
}

async function findPossibleDuplicates(input: {
  id?: string;
  email: string;
  companyName: string;
  companyNumber?: string | null;
  vatNumber?: string | null;
  claimedAutopartCustomerCode?: string | null;
  postcode?: string | null;
}): Promise<PossibleDuplicate[]> {
  const or: Prisma.TradeApplicationWhereInput[] = [
    {
      primaryContact: {
        path: ["email"],
        equals: input.email.toLowerCase(),
      },
    },
  ];
  if (input.companyNumber?.trim()) {
    or.push({ companyNumber: { equals: input.companyNumber.trim(), mode: "insensitive" } });
  }
  if (input.vatNumber?.trim()) {
    or.push({ vatNumber: { equals: input.vatNumber.trim(), mode: "insensitive" } });
  }
  if (input.claimedAutopartCustomerCode?.trim()) {
    or.push({
      claimedAutopartCustomerCode: {
        equals: input.claimedAutopartCustomerCode.trim(),
        mode: "insensitive",
      },
    });
  }

  const rows = await prisma.tradeApplication.findMany({
    where: {
      AND: [
        input.id ? { id: { not: input.id } } : {},
        { OR: or },
      ],
    },
    orderBy: { submittedAt: "desc" },
    take: 20,
    select: {
      id: true,
      reference: true,
      status: true,
      companyName: true,
      companyNumber: true,
      vatNumber: true,
      claimedAutopartCustomerCode: true,
      tradingAddress: true,
      primaryContact: true,
      submittedAt: true,
    },
  });

  const normalisedPostcode = (input.postcode ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const out: PossibleDuplicate[] = [];
  for (const row of rows) {
    const reasons: string[] = [];
    if (contactEmail(row.primaryContact) === input.email.toLowerCase()) reasons.push("Same email");
    if (
      input.companyNumber?.trim() &&
      row.companyNumber?.toLowerCase() === input.companyNumber.trim().toLowerCase()
    ) {
      reasons.push("Same company registration number");
    }
    if (
      input.vatNumber?.trim() &&
      row.vatNumber?.toLowerCase() === input.vatNumber.trim().toLowerCase()
    ) {
      reasons.push("Same VAT number");
    }
    if (
      input.claimedAutopartCustomerCode?.trim() &&
      row.claimedAutopartCustomerCode?.toLowerCase() ===
        input.claimedAutopartCustomerCode.trim().toLowerCase()
    ) {
      reasons.push("Same claimed Autopart account");
    }
    if (
      normalisedPostcode &&
      row.companyName.trim().toLowerCase() === input.companyName.trim().toLowerCase() &&
      tradingPostcode(row.tradingAddress) === normalisedPostcode
    ) {
      reasons.push("Same company name + postcode");
    }
    if (reasons.length) {
      out.push({
        id: row.id,
        reference: row.reference,
        status: row.status,
        companyName: row.companyName,
        matchReasons: reasons,
        submittedAt: row.submittedAt.toISOString(),
      });
    }
  }
  return out;
}

export async function submitTradeApplication(raw: unknown, meta?: { ip?: string | null }) {
  const input = tradeApplicationSubmitSchema.parse(raw);
  if (input.websiteConfirm) {
    throw new AuthError("Rejected", "ABUSE", 400);
  }

  const email = input.primaryContact.email.toLowerCase();
  const claimedCode =
    input.existingAccountClaim === "yes"
      ? normalizeAutopartCustomerCode(input.claimedAutopartCustomerCode)
      : null;

  // Hard abuse guard: same email+company within 10 minutes → return existing (no spam).
  const recent = await prisma.tradeApplication.findFirst({
    where: {
      companyName: input.companyName,
      submittedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      primaryContact: {
        path: ["email"],
        equals: email,
      },
      status: { in: [...OPEN_APPLICATION_STATUSES] },
    },
    select: { id: true, reference: true },
  });
  if (recent) {
    return { id: recent.id, reference: recent.reference, duplicate: true as const };
  }

  let reference = nextApplicationReference();
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.tradeApplication.findUnique({ where: { reference } });
    if (!clash) break;
    reference = nextApplicationReference();
  }

  const businessType = resolveBusinessTypeLabel(input.businessType, input.businessTypeOther);

  const app = await prisma.tradeApplication.create({
    data: {
      reference,
      status: "SUBMITTED",
      companyName: input.companyName,
      tradingName: emptyToNull(input.tradingName),
      companyNumber: emptyToNull(input.companyNumber),
      vatNumber: emptyToNull(input.vatNumber),
      businessType,
      website: emptyToNull(input.website),
      tradingAddress: input.tradingAddress as Prisma.InputJsonValue,
      primaryContact: {
        ...input.primaryContact,
        email,
      },
      estimatedSpend: emptyToNull(input.estimatedSpend),
      howHeardAboutUs: emptyToNull(input.howHeardAboutUs),
      brandsInterest: input.brandsInterest,
      notes: emptyToNull(input.notes),
      existingAccountClaim: input.existingAccountClaim,
      claimedAutopartCustomerCode: claimedCode,
      consentAcceptedAt: new Date(),
    },
  });

  await recordAuditEvent({
    action: "application.submitted",
    entityType: "TradeApplication",
    entityId: app.id,
    metadata: {
      reference: app.reference,
      ip: meta?.ip ?? null,
      claimedAutopartCustomerCode: Boolean(app.claimedAutopartCustomerCode),
      existingAccountClaim: input.existingAccountClaim,
    },
  });

  // Email is secondary — never roll back application create on SMTP failure.
  try {
    const { sendTradeApplicationEmailsAfterSubmit } = await import("@/server/email/transactional");
    await sendTradeApplicationEmailsAfterSubmit(app.id);
  } catch {
    /* recorded as FAILED/DEFERRED in outbox when possible */
  }

  return { id: app.id, reference: app.reference, duplicate: false as const };
}

export async function listTradeApplications(
  actorUserId: string,
  filters?: {
    status?: string;
    businessType?: string;
    existingAccount?: string;
    q?: string;
    assignedRepId?: string;
  },
) {
  await requireSystemPermission(actorUserId, "applications.view");
  const status = filters?.status;
  const q = filters?.q?.trim();

  const where: Prisma.TradeApplicationWhereInput = {};
  if (status && status !== "ALL") {
    where.status = status as Prisma.EnumTradeApplicationStatusFilter;
  }
  if (filters?.businessType?.trim()) {
    where.businessType = { contains: filters.businessType.trim(), mode: "insensitive" };
  }
  if (filters?.existingAccount === "claimed") {
    where.claimedAutopartCustomerCode = { not: null };
  } else if (filters?.existingAccount === "none") {
    where.claimedAutopartCustomerCode = null;
  }
  if (filters?.assignedRepId) {
    where.assignedRepId = filters.assignedRepId;
  }
  if (q) {
    where.OR = [
      { reference: { contains: q, mode: "insensitive" } },
      { companyName: { contains: q, mode: "insensitive" } },
      { tradingName: { contains: q, mode: "insensitive" } },
      { claimedAutopartCustomerCode: { contains: q, mode: "insensitive" } },
      { vatNumber: { contains: q, mode: "insensitive" } },
      { companyNumber: { contains: q, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.tradeApplication.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    take: 200,
    select: {
      id: true,
      reference: true,
      status: true,
      companyName: true,
      tradingName: true,
      businessType: true,
      submittedAt: true,
      decidedAt: true,
      companyId: true,
      primaryContact: true,
      claimedAutopartCustomerCode: true,
      existingAccountClaim: true,
      tradingAddress: true,
      assignedRep: {
        select: { id: true, user: { select: { name: true, email: true } } },
      },
    },
  });

  const qLower = q?.toLowerCase();
  return rows
    .map((r) => {
      const email = contactEmail(r.primaryContact);
      const applicant = contactName(r.primaryContact);
      const postcode = tradingPostcode(r.tradingAddress);
      return {
        id: r.id,
        reference: r.reference,
        status: r.status,
        companyName: r.companyName,
        tradingName: r.tradingName,
        businessType: r.businessType,
        submittedAt: r.submittedAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        companyId: r.companyId,
        claimedAutopartCustomerCode: r.claimedAutopartCustomerCode,
        existingAccountClaim: r.existingAccountClaim,
        contactEmail: email,
        applicantName: applicant,
        assignedRepName: r.assignedRep?.user?.name ?? null,
        hasClaimedAccount: Boolean(r.claimedAutopartCustomerCode),
        _postcode: postcode,
      };
    })
    .filter((r) => {
      if (!qLower) return true;
      return (
        r.reference.toLowerCase().includes(qLower) ||
        r.companyName.toLowerCase().includes(qLower) ||
        (r.tradingName ?? "").toLowerCase().includes(qLower) ||
        r.contactEmail.includes(qLower) ||
        r.applicantName.toLowerCase().includes(qLower) ||
        (r.claimedAutopartCustomerCode ?? "").toLowerCase().includes(qLower) ||
        r._postcode.toLowerCase().includes(qLower)
      );
    })
    .map(({ _postcode: _, ...rest }) => rest);
}

export async function getTradeApplication(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "applications.view");
  const app = await prisma.tradeApplication.findUnique({
    where: { id },
    include: {
      assignedRep: { select: { id: true, user: { select: { id: true, name: true, email: true } } } },
      reviewedBy: { select: { id: true, name: true, email: true } },
      company: {
        select: {
          id: true,
          name: true,
          accountNumber: true,
          autopartCustomerCode: true,
          autopartCustomerCodeVerifiedAt: true,
          priceListId: true,
          paymentTerms: true,
        },
      },
    },
  });
  if (!app) throw new AuthError("Application not found", "NOT_FOUND", 404);

  const email = contactEmail(app.primaryContact);
  const [identityWarnings, possibleDuplicates] = await Promise.all([
    email ? findIdentityWarnings(email) : Promise.resolve([]),
    findPossibleDuplicates({
      id: app.id,
      email: email || "nomail@invalid",
      companyName: app.companyName,
      companyNumber: app.companyNumber,
      vatNumber: app.vatNumber,
      claimedAutopartCustomerCode: app.claimedAutopartCustomerCode,
      postcode: tradingPostcode(app.tradingAddress),
    }),
  ]);

  return {
    ...app,
    submittedAt: app.submittedAt.toISOString(),
    decidedAt: app.decidedAt?.toISOString() ?? null,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    consentAcceptedAt: app.consentAcceptedAt?.toISOString() ?? null,
    company: app.company
      ? {
          ...app.company,
          autopartCustomerCodeVerifiedAt:
            app.company.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
        }
      : null,
    identityWarnings,
    possibleDuplicates,
  };
}

export async function markApplicationUnderReview(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "applications.review");
  const app = await prisma.tradeApplication.findUnique({ where: { id } });
  if (!app) throw new AuthError("Application not found", "NOT_FOUND", 404);
  if (app.status === "APPROVED" || app.status === "REJECTED") {
    throw new AuthError("Closed applications cannot move to under review", "CONFLICT", 409);
  }
  if (app.status === "UNDER_REVIEW") {
    return { id: app.id, status: app.status, already: true as const };
  }
  const updated = await prisma.tradeApplication.update({
    where: { id },
    data: { status: "UNDER_REVIEW", reviewedById: actorUserId },
  });
  await recordAuditEvent({
    action: "application.under_review",
    entityType: "TradeApplication",
    entityId: id,
    actorUserId,
  });
  return { id: updated.id, status: updated.status, already: false as const };
}

export async function requestApplicationMoreInfo(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "applications.review");
  const input = tradeApplicationMoreInfoSchema.parse(raw);
  const app = await prisma.tradeApplication.findUnique({ where: { id: input.id } });
  if (!app) throw new AuthError("Application not found", "NOT_FOUND", 404);
  if (app.status === "APPROVED" || app.status === "REJECTED") {
    throw new AuthError("Closed applications cannot request more information", "CONFLICT", 409);
  }

  const updated = await prisma.tradeApplication.update({
    where: { id: input.id },
    data: {
      status: "MORE_INFO_REQUIRED",
      reviewedById: actorUserId,
      customerMessage: input.customerMessage,
      reviewNotes: input.reviewNotes ?? app.reviewNotes,
    },
  });

  await recordAuditEvent({
    action: "application.more_info_required",
    entityType: "TradeApplication",
    entityId: input.id,
    actorUserId,
    after: {
      customerMessage: input.customerMessage,
    },
  });

  let emailSent = false;
  try {
    const { sendTradeApplicationMoreInfoEmail } = await import("@/server/email/transactional");
    emailSent = await sendTradeApplicationMoreInfoEmail(updated.id);
  } catch {
    emailSent = false;
  }

  return {
    id: updated.id,
    status: updated.status,
    customerMessage: updated.customerMessage,
    emailDeferred: !emailSent,
    emailSent,
  };
}

/**
 * Idempotent approval: if already APPROVED with companyId, return existing links.
 * Never creates a second company for the same application.
 */
export async function approveTradeApplication(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "applications.approve");
  const input = tradeApplicationDecisionSchema.parse(raw);

  const preview = await prisma.tradeApplication.findUnique({ where: { id: input.id } });
  if (!preview) throw new AuthError("Application not found", "NOT_FOUND", 404);
  if (preview.status === "REJECTED") {
    throw new AuthError("Rejected applications cannot be approved", "CONFLICT", 409);
  }

  // Idempotent fast-path before identity checks (membership may already be ACTIVE).
  if (preview.status === "APPROVED" && preview.companyId) {
    await recordAuditEvent({
      action: "application.approved",
      entityType: "TradeApplication",
      entityId: input.id,
      actorUserId,
      companyId: preview.companyId,
      after: { companyId: preview.companyId, created: false, idempotent: true },
    });
    return {
      applicationId: preview.id,
      companyId: preview.companyId,
      created: false as const,
      inviteToken: null as string | null,
      activationPath: null as string | null,
      emailDeferred: false,
      emailSent: false,
    };
  }

  const email = contactEmail(preview.primaryContact);
  if (!email) throw new AuthError("Application missing contact email", "VALIDATION", 400);

  const identityWarnings = await findIdentityWarnings(email);
  const blocking = identityWarnings.filter(
    (w) => w.code === "EMAIL_INTERNAL_USER" || w.code === "EMAIL_ALREADY_ACTIVE_MEMBER",
  );
  if (blocking.length && !input.confirmExistingUserLink) {
    throw new AuthError(
      "Applicant email has identity conflicts. Confirm existing-user link to proceed.",
      "CONFLICT",
      409,
    );
  }
  if (identityWarnings.some((w) => w.code === "EMAIL_INTERNAL_USER")) {
    throw new AuthError(
      "Cannot approve: applicant email belongs to an internal staff user.",
      "VALIDATION",
      400,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const app = await tx.tradeApplication.findUnique({ where: { id: input.id } });
    if (!app) throw new AuthError("Application not found", "NOT_FOUND", 404);

    if (app.status === "APPROVED" && app.companyId) {
      return {
        app,
        companyId: app.companyId,
        created: false as const,
        inviteToken: null as string | null,
        userId: null as string | null,
      };
    }
    if (app.status === "REJECTED") {
      throw new AuthError("Rejected applications cannot be approved", "CONFLICT", 409);
    }

    const contact = (app.primaryContact ?? {}) as {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      role?: string;
    };
    const contactEmailLower = (contact.email ?? "").toLowerCase();
    if (!contactEmailLower) throw new AuthError("Application missing contact email", "VALIDATION", 400);

    const company = await tx.company.create({
      data: {
        name: app.companyName,
        tradingName: app.tradingName,
        companyNumber: app.companyNumber,
        vatNumber: app.vatNumber,
        website: app.website,
        status: "ACTIVE",
        paymentTerms: input.paymentTerms ?? null,
        priceListId: input.priceListId ?? null,
        primaryEmail: contactEmailLower,
        phone: contact.phone ?? null,
        notes: app.notes,
      },
    });

    await tx.contact.create({
      data: {
        companyId: company.id,
        firstName: contact.firstName ?? "Trade",
        lastName: contact.lastName ?? "Contact",
        email: contactEmailLower,
        phone: contact.phone ?? null,
        jobTitle: contact.role ?? null,
        isPrimary: true,
        isPurchasing: true,
      },
    });

    const trading = (app.tradingAddress ?? null) as {
      line1?: string;
      line2?: string | null;
      town?: string;
      county?: string | null;
      postcode?: string;
      country?: string;
    } | null;

    if (trading?.line1 && trading.town && trading.postcode) {
      await tx.address.create({
        data: {
          companyId: company.id,
          type: "REGISTERED",
          label: "Registered / trading",
          line1: trading.line1,
          line2: trading.line2 ?? null,
          town: trading.town,
          county: trading.county ?? null,
          postcode: trading.postcode,
          country: trading.country ?? "GB",
          isDefaultBilling: true,
          isDefaultDelivery: true,
          isDefault: true,
        },
      });
    }

    if (input.salesRepId) {
      await tx.companyAssignment.create({
        data: {
          companyId: company.id,
          salesRepId: input.salesRepId,
          isPrimary: true,
        },
      });
    }

    let user = await tx.user.findUnique({ where: { email: contactEmailLower } });
    if (!user) {
      user = await tx.user.create({
        data: {
          email: contactEmailLower,
          name: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contactEmailLower,
          status: "INVITED",
          actorType: "TRADE",
        },
      });
    } else if (user.actorType === "INTERNAL") {
      throw new AuthError("Cannot link internal staff email to a trade company", "VALIDATION", 400);
    }

    await tx.companyUser.upsert({
      where: { companyId_userId: { companyId: company.id, userId: user.id } },
      create: {
        companyId: company.id,
        userId: user.id,
        role: "TRADE_ADMIN",
        status: "INVITED",
        isDefault: true,
      },
      update: { role: "TRADE_ADMIN", status: "INVITED", isDefault: true },
    });

    const { token, tokenHash } = generateInviteToken();
    await tx.userInvitation.create({
      data: {
        companyId: company.id,
        email: contactEmailLower,
        role: "TRADE_ADMIN",
        tokenHash,
        invitedById: actorUserId,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        emailDeferred: true,
      },
    });

    const updated = await tx.tradeApplication.update({
      where: { id: app.id },
      data: {
        status: "APPROVED",
        companyId: company.id,
        reviewedById: actorUserId,
        reviewNotes: input.reviewNotes ?? null,
        assignedRepId: input.salesRepId ?? null,
        decidedAt: new Date(),
      },
    });

    await tx.activity.create({
      data: {
        companyId: company.id,
        userId: actorUserId,
        type: "SYSTEM",
        subject: "Trade application approved",
        body: `Application ${app.reference} approved`,
        metadata: { action: "application.approved", applicationId: app.id },
      },
    });

    return {
      app: updated,
      companyId: company.id,
      created: true as const,
      inviteToken: token,
      userId: user.id,
      actorUserId: profile.userId,
    };
  });

  const activationPath = result.inviteToken
    ? `/activate?token=${encodeURIComponent(result.inviteToken)}`
    : null;

  let emailSent = false;
  try {
    const { sendTradeApplicationApprovedEmail } = await import("@/server/email/transactional");
    emailSent = await sendTradeApplicationApprovedEmail(input.id, activationPath);
  } catch {
    emailSent = false;
  }

  await recordAuditEvent({
    action: "application.approved",
    entityType: "TradeApplication",
    entityId: input.id,
    actorUserId,
    companyId: result.companyId,
    after: {
      companyId: result.companyId,
      created: result.created,
      priceListId: input.priceListId ?? null,
      salesRepId: input.salesRepId ?? null,
      activationInitiated: Boolean(result.inviteToken),
      emailSent,
    },
  });

  if (result.inviteToken) {
    await recordAuditEvent({
      action: "application.activation_initiated",
      entityType: "TradeApplication",
      entityId: input.id,
      actorUserId,
      companyId: result.companyId,
      metadata: { emailSent, userId: result.userId },
    });
  }

  return {
    applicationId: result.app.id,
    companyId: result.companyId,
    created: result.created,
    inviteToken: result.inviteToken,
    activationPath,
    emailDeferred: !emailSent,
    emailSent,
  };
}

export async function rejectTradeApplication(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "applications.approve");
  const input = tradeApplicationRejectSchema.parse(raw);

  const app = await prisma.tradeApplication.findUnique({ where: { id: input.id } });
  if (!app) throw new AuthError("Application not found", "NOT_FOUND", 404);
  if (app.status === "APPROVED") {
    throw new AuthError("Approved applications cannot be rejected", "CONFLICT", 409);
  }
  if (app.status === "REJECTED") {
    return { id: app.id, status: app.status, already: true as const };
  }

  const updated = await prisma.tradeApplication.update({
    where: { id: input.id },
    data: {
      status: "REJECTED",
      reviewedById: actorUserId,
      reviewNotes: input.reviewNotes,
      customerMessage: input.customerMessage ?? null,
      decidedAt: new Date(),
    },
  });

  let emailSent = false;
  try {
    const { sendTradeApplicationRejectedEmail } = await import("@/server/email/transactional");
    emailSent = await sendTradeApplicationRejectedEmail(updated.id);
  } catch {
    emailSent = false;
  }

  await recordAuditEvent({
    action: "application.rejected",
    entityType: "TradeApplication",
    entityId: input.id,
    actorUserId,
    after: {
      reviewNotes: input.reviewNotes,
      customerMessage: input.customerMessage ?? null,
      emailSent,
    },
  });

  return {
    id: updated.id,
    status: updated.status,
    already: false as const,
    emailDeferred: !emailSent,
    emailSent,
  };
}

/**
 * Staff amendment of applicant-submitted details while the application is still open.
 * Does not change status or create/update Company records.
 */
export async function updateTradeApplicationDetails(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "applications.review");
  const input = tradeApplicationStaffEditSchema.parse(raw);
  const app = await prisma.tradeApplication.findUnique({ where: { id: input.id } });
  if (!app) throw new AuthError("Application not found", "NOT_FOUND", 404);
  if (!(OPEN_APPLICATION_STATUSES as readonly string[]).includes(app.status)) {
    throw new AuthError("Only open applications can be edited", "CONFLICT", 409);
  }

  const claimedCode =
    input.existingAccountClaim === "yes"
      ? normalizeAutopartCustomerCode(input.claimedAutopartCustomerCode)
      : null;

  const businessType = resolveBusinessTypeLabel(input.businessType, input.businessTypeOther);

  const updated = await prisma.tradeApplication.update({
    where: { id: input.id },
    data: {
      companyName: input.companyName,
      tradingName: emptyToNull(input.tradingName),
      companyNumber: emptyToNull(input.companyNumber),
      vatNumber: emptyToNull(input.vatNumber),
      businessType,
      website: emptyToNull(input.website),
      tradingAddress: input.tradingAddress as Prisma.InputJsonValue,
      primaryContact: {
        ...input.primaryContact,
        email: input.primaryContact.email.toLowerCase(),
      } as Prisma.InputJsonValue,
      existingAccountClaim: input.existingAccountClaim,
      claimedAutopartCustomerCode: claimedCode,
      estimatedSpend: input.estimatedSpend ?? null,
      howHeardAboutUs: input.howHeardAboutUs ?? null,
      brandsInterest: input.brandsInterest,
      notes: emptyToNull(input.notes),
      reviewedById: actorUserId,
    },
  });

  await recordAuditEvent({
    action: "application.details_updated",
    entityType: "TradeApplication",
    entityId: input.id,
    actorUserId,
    before: {
      companyName: app.companyName,
      contactEmail: contactEmail(app.primaryContact),
    },
    after: {
      companyName: updated.companyName,
      contactEmail: input.primaryContact.email.toLowerCase(),
    },
  });

  return getTradeApplication(actorUserId, input.id);
}

/** Soft-delete: mark WITHDRAWN. Keeps history; hides from default open workflows. */
export async function withdrawTradeApplication(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "applications.review");
  const input = tradeApplicationWithdrawSchema.parse(raw);
  const app = await prisma.tradeApplication.findUnique({ where: { id: input.id } });
  if (!app) throw new AuthError("Application not found", "NOT_FOUND", 404);
  if (app.status === "APPROVED") {
    throw new AuthError(
      "Approved applications cannot be withdrawn. Close the customer account instead.",
      "CONFLICT",
      409,
    );
  }
  if (app.status === "WITHDRAWN") {
    return { id: app.id, status: app.status, already: true as const };
  }

  const updated = await prisma.tradeApplication.update({
    where: { id: input.id },
    data: {
      status: "WITHDRAWN",
      reviewedById: actorUserId,
      reviewNotes: input.reviewNotes ?? app.reviewNotes,
      decidedAt: new Date(),
    },
  });

  await recordAuditEvent({
    action: "application.withdrawn",
    entityType: "TradeApplication",
    entityId: input.id,
    actorUserId,
    companyId: app.companyId,
  });

  return { id: updated.id, status: updated.status, already: false as const };
}

/**
 * Permanent delete for unlinked spam/test applications only.
 * Blocked when a Company was created from approval.
 */
export async function deleteTradeApplication(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "applications.approve");
  const input = tradeApplicationDeleteSchema.parse(raw);
  const app = await prisma.tradeApplication.findUnique({ where: { id: input.id } });
  if (!app) throw new AuthError("Application not found", "NOT_FOUND", 404);
  if (app.companyId) {
    throw new AuthError(
      "Cannot delete an application linked to a customer. Withdraw it or close the customer instead.",
      "CONFLICT",
      409,
    );
  }
  if (app.status === "APPROVED") {
    throw new AuthError("Approved applications cannot be deleted", "CONFLICT", 409);
  }

  await prisma.document.updateMany({
    where: { applicationId: input.id },
    data: { applicationId: null },
  });
  await prisma.tradeApplication.delete({ where: { id: input.id } });

  await recordAuditEvent({
    action: "application.deleted",
    entityType: "TradeApplication",
    entityId: input.id,
    actorUserId,
    metadata: {
      reference: app.reference,
      companyName: app.companyName,
      status: app.status,
    },
  });

  return { ok: true as const, id: input.id };
}

/**
 * Public activation: applicant sets password from invite token, then can log in.
 * Does not trust companyId from the client — invitation record is authoritative.
 */
export async function acceptTradeInvitation(raw: unknown) {
  const input = acceptTradeInviteSchema.parse(raw);
  const tokenHash = hashInviteToken(input.token);

  const invite = await prisma.userInvitation.findUnique({ where: { tokenHash } });
  if (!invite || invite.status !== "PENDING") {
    throw new AuthError("Invitation is invalid or has already been used", "NOT_FOUND", 404);
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    await prisma.userInvitation.update({
      where: { id: invite.id },
      data: { status: "EXPIRED" },
    });
    throw new AuthError("Invitation has expired", "CONFLICT", 409);
  }

  const email = invite.email.toLowerCase();
  const passwordHash = await hashPassword(input.password);

  const result = await prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email } });
    if (!user) {
      user = await tx.user.create({
        data: {
          email,
          name: email,
          status: "ACTIVE",
          actorType: "TRADE",
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });
    } else {
      if (user.actorType === "INTERNAL") {
        throw new AuthError("This invitation cannot be accepted", "FORBIDDEN", 403);
      }
      user = await tx.user.update({
        where: { id: user.id },
        data: {
          status: "ACTIVE",
          emailVerified: true,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      });
    }

    const existingAccount = await tx.authAccount.findFirst({
      where: { userId: user.id, providerId: "credential" },
    });
    if (existingAccount) {
      await tx.authAccount.update({
        where: { id: existingAccount.id },
        data: { password: passwordHash },
      });
    } else {
      await tx.authAccount.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: passwordHash,
        },
      });
    }

    await tx.companyUser.upsert({
      where: { companyId_userId: { companyId: invite.companyId, userId: user.id } },
      create: {
        companyId: invite.companyId,
        userId: user.id,
        role: invite.role,
        status: "ACTIVE",
        isDefault: true,
      },
      update: {
        role: invite.role,
        status: "ACTIVE",
        isDefault: true,
      },
    });

    await tx.userInvitation.update({
      where: { id: invite.id },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedUserId: user.id,
      },
    });

    return { userId: user.id, companyId: invite.companyId, email };
  });

  await recordAuditEvent({
    action: "invitation.accepted",
    entityType: "UserInvitation",
    entityId: invite.id,
    companyId: result.companyId,
    targetUserId: result.userId,
    metadata: { email: result.email },
  });

  try {
    const company = await prisma.company.findUnique({
      where: { id: result.companyId },
      select: { name: true },
    });
    const { sendTradeAccountActivatedEmail } = await import("@/server/email/transactional");
    await sendTradeAccountActivatedEmail({
      userId: result.userId,
      companyId: result.companyId,
      contactEmail: result.email,
      contactName: result.email,
      companyName: company?.name ?? "your company",
    });
  } catch {
    /* email failure must not roll back activation */
  }

  return {
    userId: result.userId,
    companyId: result.companyId,
    email: result.email,
    loginPath: "/login",
    portalPath: "/portal",
  };
}

export async function getInvitationPreview(token: string) {
  const tokenHash = hashInviteToken(token);
  const invite = await prisma.userInvitation.findUnique({
    where: { tokenHash },
    include: { company: { select: { id: true, name: true, tradingName: true } } },
  });
  if (!invite) return null;
  if (invite.status !== "PENDING") {
    return { status: invite.status, expired: invite.status === "EXPIRED", email: invite.email };
  }
  const expired = invite.expiresAt.getTime() < Date.now();
  if (expired) {
    await prisma.userInvitation.update({
      where: { id: invite.id },
      data: { status: "EXPIRED" },
    });
    return { status: "EXPIRED" as const, expired: true, email: invite.email };
  }
  return {
    status: invite.status,
    expired: false,
    email: invite.email,
    companyName: invite.company.tradingName || invite.company.name,
    expiresAt: invite.expiresAt.toISOString(),
  };
}
