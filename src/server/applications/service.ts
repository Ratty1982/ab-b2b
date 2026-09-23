import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { generateInviteToken } from "@/domain/invitation";
import {
  tradeApplicationDecisionSchema,
  tradeApplicationSubmitSchema,
} from "@/domain/trade-application";
import { emptyToNull } from "@/domain/company";
import { normalizeAutopartCustomerCode } from "@/server/companies/autopart-account";

function nextApplicationReference(): string {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `APP-${stamp}-${rand}`;
}

export async function submitTradeApplication(raw: unknown, meta?: { ip?: string | null }) {
  const input = tradeApplicationSubmitSchema.parse(raw);
  if (input.websiteConfirm) {
    throw new AuthError("Rejected", "ABUSE", 400);
  }

  // Basic abuse guard: same email+company within 10 minutes
  const recent = await prisma.tradeApplication.findFirst({
    where: {
      companyName: input.companyName,
      submittedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      primaryContact: {
        path: ["email"],
        equals: input.primaryContact.email.toLowerCase(),
      },
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

  const app = await prisma.tradeApplication.create({
    data: {
      reference,
      status: "SUBMITTED",
      companyName: input.companyName,
      tradingName: emptyToNull(input.tradingName),
      companyNumber: emptyToNull(input.companyNumber),
      vatNumber: emptyToNull(input.vatNumber),
      businessType: emptyToNull(input.businessType),
      website: emptyToNull(input.website),
      ...(input.tradingAddress
        ? { tradingAddress: input.tradingAddress as Prisma.InputJsonValue }
        : {}),
      primaryContact: {
        ...input.primaryContact,
        email: input.primaryContact.email.toLowerCase(),
      },
      estimatedSpend: emptyToNull(input.estimatedSpend),
      brandsInterest: input.brandsInterest,
      notes: emptyToNull(input.notes),
      claimedAutopartCustomerCode: normalizeAutopartCustomerCode(input.claimedAutopartCustomerCode),
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
    },
  });

  return { id: app.id, reference: app.reference, duplicate: false as const };
}

export async function listTradeApplications(actorUserId: string, status?: string) {
  await requireSystemPermission(actorUserId, "applications.view");
  const rows = await prisma.tradeApplication.findMany({
    where:
      status && status !== "ALL"
        ? { status: status as "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "MORE_INFO_REQUIRED" | "DRAFT" | "WITHDRAWN" }
        : {},
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
      assignedRep: {
        select: { id: true, user: { select: { name: true, email: true } } },
      },
    },
  });
  return rows.map((r) => ({
    ...r,
    submittedAt: r.submittedAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    contactEmail:
      r.primaryContact && typeof r.primaryContact === "object" && "email" in r.primaryContact
        ? String((r.primaryContact as { email?: string }).email ?? "")
        : "",
  }));
}

export async function getTradeApplication(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "applications.view");
  const app = await prisma.tradeApplication.findUnique({ where: { id } });
  if (!app) throw new AuthError("Application not found", "NOT_FOUND", 404);
  return {
    ...app,
    submittedAt: app.submittedAt.toISOString(),
    decidedAt: app.decidedAt?.toISOString() ?? null,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
  };
}

export async function markApplicationUnderReview(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "applications.review");
  const app = await prisma.tradeApplication.findUnique({ where: { id } });
  if (!app) throw new AuthError("Application not found", "NOT_FOUND", 404);
  if (app.status === "APPROVED" || app.status === "REJECTED") {
    return app;
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
  return updated;
}

/**
 * Idempotent approval: if already APPROVED with companyId, return existing links.
 * Never creates a second company for the same application.
 */
export async function approveTradeApplication(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "applications.approve");
  const input = tradeApplicationDecisionSchema.parse(raw);

  const result = await prisma.$transaction(async (tx) => {
    const app = await tx.tradeApplication.findUnique({ where: { id: input.id } });
    if (!app) throw new AuthError("Application not found", "NOT_FOUND", 404);

    if (app.status === "APPROVED" && app.companyId) {
      return { app, companyId: app.companyId, created: false as const, inviteToken: null as string | null };
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
    const email = (contact.email ?? "").toLowerCase();
    if (!email) throw new AuthError("Application missing contact email", "VALIDATION", 400);

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
        primaryEmail: email,
        phone: contact.phone ?? null,
        notes: app.notes,
      },
    });

    await tx.contact.create({
      data: {
        companyId: company.id,
        firstName: contact.firstName ?? "Trade",
        lastName: contact.lastName ?? "Contact",
        email,
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

    let user = await tx.user.findUnique({ where: { email } });
    if (!user) {
      user = await tx.user.create({
        data: {
          email,
          name: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || email,
          status: "INVITED",
          actorType: "TRADE",
        },
      });
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
        email,
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
      actorUserId: profile.userId,
    };
  });

  await recordAuditEvent({
    action: "application.approved",
    entityType: "TradeApplication",
    entityId: input.id,
    actorUserId,
    companyId: result.companyId,
    after: { companyId: result.companyId, created: result.created },
  });

  return {
    applicationId: result.app.id,
    companyId: result.companyId,
    created: result.created,
    inviteToken: result.inviteToken,
    emailDeferred: true,
  };
}

export async function rejectTradeApplication(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "applications.approve");
  const input = tradeApplicationDecisionSchema.parse(raw);

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
      reviewNotes: input.reviewNotes ?? null,
      decidedAt: new Date(),
    },
  });

  await recordAuditEvent({
    action: "application.rejected",
    entityType: "TradeApplication",
    entityId: input.id,
    actorUserId,
    after: { reviewNotes: input.reviewNotes ?? null },
  });

  return { id: updated.id, status: updated.status, already: false as const };
}
