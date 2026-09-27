/**
 * Request a Callback — public / trade contact enquiry workflow.
 *
 * Persistence is authoritative. Internal email is secondary and must not
 * fail the customer-facing success path.
 */
import { ZodError } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError } from "@/server/rbac/guards";
import { loadAccessProfile } from "@/server/rbac/access";
import {
  CALLBACK_DEDUP_WINDOW_MS,
  CALLBACK_REQUEST_ACTIVITY_KIND,
  CALLBACK_REQUEST_LEAD_SOURCE,
  callbackEnquirySchema,
  callbackSupportingCopy,
  formatCallbackActivityBody,
  type CallbackEnquiryInput,
} from "@/domain/callback";

export type CallbackEnquiryResult =
  | {
      ok: true;
      enquiryId: string;
      kind: "activity" | "lead";
      duplicate?: boolean;
      accountManagerName: string | null;
      customerFirstName: string;
    }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type CallbackPrefill = {
  name: string;
  company: string;
  email: string;
  telephone: string;
  accountManagerName: string | null;
  supportingCopy: string;
  authenticated: boolean;
};

type AssignmentRoute = {
  salesRepId: string;
  assigneeUserId: string;
  accountManagerName: string;
  notificationEmail: string | null;
};

function firstNameFrom(name: string): string {
  const part = name.trim().split(/\s+/)[0];
  return part || name.trim() || "there";
}

function parseFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

async function resolveActiveTradeMembership(userId: string) {
  const profile = await loadAccessProfile(userId);
  if (!profile) return null;
  if (profile.actorType !== "TRADE" && profile.actorType !== "INTERNAL") return null;

  const membership =
    profile.companyMemberships.find((m) => m.isDefault && m.status === "ACTIVE") ??
    profile.companyMemberships.find((m) => m.status === "ACTIVE") ??
    null;
  if (!membership) return null;

  const company = await prisma.company.findUnique({
    where: { id: membership.companyId },
    select: {
      id: true,
      name: true,
      tradingName: true,
      phone: true,
      primaryEmail: true,
    },
  });
  if (!company) return null;

  return {
    userId: profile.userId,
    userName: profile.name?.trim() || profile.email,
    userEmail: profile.email,
    company,
  };
}

async function resolveAssignmentRoute(companyId: string): Promise<AssignmentRoute | null> {
  const assignment = await prisma.companyAssignment.findFirst({
    where: { companyId, isPrimary: true },
    include: {
      salesRep: {
        include: {
          user: { select: { id: true, name: true, email: true, status: true } },
          publicTeamProfile: {
            select: {
              isPublic: true,
              isContactable: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      },
    },
  });
  const rep = assignment?.salesRep;
  if (!rep?.active || rep.user.status !== "ACTIVE") return null;

  const profile = rep.publicTeamProfile;
  const usePublic = Boolean(profile?.isPublic);
  const name =
    usePublic && profile
      ? `${profile.firstName} ${profile.lastName}`.trim()
      : rep.user.name?.trim() || rep.user.email;

  const contactable = Boolean(usePublic && profile?.isContactable);
  const notificationEmail =
    (contactable && profile?.email?.trim()
      ? profile.email.trim().toLowerCase()
      : rep.user.email.trim().toLowerCase()) || null;

  return {
    salesRepId: rep.id,
    assigneeUserId: rep.user.id,
    accountManagerName: name,
    notificationEmail,
  };
}

async function findContactForCompany(
  companyId: string,
  email: string,
  userName: string,
): Promise<{ id: string; firstName: string; lastName: string; phone: string | null; mobile: string | null; email: string | null } | null> {
  if (email) {
    const byEmail = await prisma.contact.findFirst({
      where: { companyId, email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        mobile: true,
        email: true,
      },
    });
    if (byEmail) return byEmail;
  }

  const primary = await prisma.contact.findFirst({
    where: { companyId, isPrimary: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      mobile: true,
      email: true,
    },
  });
  if (primary) return primary;

  // Prefer a contact whose name loosely matches the user display name.
  const contacts = await prisma.contact.findMany({
    where: { companyId },
    take: 5,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      mobile: true,
      email: true,
    },
  });
  const needle = userName.trim().toLowerCase();
  return (
    contacts.find((c) => `${c.firstName} ${c.lastName}`.trim().toLowerCase() === needle) ??
    contacts[0] ??
    null
  );
}

async function findCompanyByContactEmail(email: string) {
  if (!email) return null;
  const contact = await prisma.contact.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      companyId: true,
      firstName: true,
      lastName: true,
      phone: true,
      mobile: true,
      email: true,
      company: { select: { id: true, name: true, tradingName: true } },
    },
  });
  return contact;
}

export async function getCallbackPrefill(userId: string | null): Promise<CallbackPrefill> {
  const empty: CallbackPrefill = {
    name: "",
    company: "",
    email: "",
    telephone: "",
    accountManagerName: null,
    supportingCopy: callbackSupportingCopy(null),
    authenticated: false,
  };
  if (!userId) return empty;

  const membership = await resolveActiveTradeMembership(userId);
  if (!membership) return empty;

  const [contact, route] = await Promise.all([
    findContactForCompany(membership.company.id, membership.userEmail, membership.userName),
    resolveAssignmentRoute(membership.company.id),
  ]);

  const telephone =
    contact?.mobile?.trim() ||
    contact?.phone?.trim() ||
    membership.company.phone?.trim() ||
    "";

  const accountManagerName = route?.accountManagerName ?? null;

  return {
    name: membership.userName,
    company: membership.company.tradingName?.trim() || membership.company.name,
    email: membership.userEmail,
    telephone,
    accountManagerName,
    supportingCopy: callbackSupportingCopy(accountManagerName),
    authenticated: true,
  };
}

async function findRecentAuthenticatedDuplicate(input: {
  companyId: string;
  userId: string;
  clientRequestId: string;
  message: string;
}) {
  const since = new Date(Date.now() - CALLBACK_DEDUP_WINDOW_MS);
  const recent = await prisma.activity.findMany({
    where: {
      companyId: input.companyId,
      type: "CALLBACK_REQUEST",
      occurredAt: { gte: since },
      userId: input.userId,
    },
    orderBy: { occurredAt: "desc" },
    take: 5,
    select: { id: true, metadata: true, body: true },
  });

  for (const row of recent) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    if (input.clientRequestId && meta.clientRequestId === input.clientRequestId) {
      return row.id;
    }
    if (typeof meta.message === "string" && meta.message === input.message) {
      return row.id;
    }
    if (row.body?.includes(input.message)) {
      return row.id;
    }
  }
  return null;
}

async function findRecentLeadDuplicate(input: CallbackEnquiryInput) {
  const since = new Date(Date.now() - CALLBACK_DEDUP_WINDOW_MS);
  const or: Array<Record<string, unknown>> = [];
  if (input.email) or.push({ email: input.email });
  if (input.telephone) or.push({ phone: input.telephone });
  if (or.length === 0) return null;

  const recent = await prisma.lead.findFirst({
    where: {
      source: CALLBACK_REQUEST_LEAD_SOURCE,
      createdAt: { gte: since },
      OR: or,
      ...(input.clientRequestId
        ? {}
        : { notes: { contains: input.message.slice(0, 80) } }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, notes: true },
  });
  if (!recent) return null;
  if (recent.notes?.includes(input.message)) return recent.id;
  if (input.clientRequestId) return recent.id;
  return recent.id;
}

async function persistTradeCallback(opts: {
  input: CallbackEnquiryInput;
  companyId: string;
  companyName: string;
  contactId: string | null;
  actorUserId: string | null;
  route: AssignmentRoute | null;
  accountKind: "trade_customer" | "prospect";
}) {
  const { input, companyId, companyName, contactId, actorUserId, route, accountKind } = opts;
  const body = formatCallbackActivityBody({
    name: input.name,
    email: input.email,
    telephone: input.telephone,
    companyName,
    accountManagerName: route?.accountManagerName ?? null,
    message: input.message,
    accountKind,
  });

  const metadata = {
    kind: CALLBACK_REQUEST_ACTIVITY_KIND,
    name: input.name,
    email: input.email || null,
    telephone: input.telephone || null,
    companyName,
    contactId,
    salesRepId: route?.salesRepId ?? null,
    accountManagerName: route?.accountManagerName ?? null,
    accountKind,
    message: input.message,
    clientRequestId: input.clientRequestId || null,
  };

  const activity = await prisma.activity.create({
    data: {
      companyId,
      userId: actorUserId,
      type: "CALLBACK_REQUEST",
      subject: "Callback requested",
      body,
      metadata,
    },
  });

  const task = await prisma.task.create({
    data: {
      companyId,
      assigneeId: route?.assigneeUserId ?? null,
      createdById: actorUserId,
      title: "Call customer",
      description: body,
      status: "OPEN",
      priority: "NORMAL",
    },
  });

  await recordAuditEvent({
    action: "callback.request_submitted",
    entityType: "Activity",
    entityId: activity.id,
    actorUserId,
    companyId,
    metadata: {
      taskId: task.id,
      salesRepId: route?.salesRepId ?? null,
      accountKind,
      contactId,
    },
  });

  return { activityId: activity.id, taskId: task.id };
}

async function persistProspectLead(opts: {
  input: CallbackEnquiryInput;
  companyId: string | null;
  ownerId: string | null;
  route: AssignmentRoute | null;
}) {
  const { input, companyId, ownerId, route } = opts;
  const notes = formatCallbackActivityBody({
    name: input.name,
    email: input.email,
    telephone: input.telephone,
    companyName: input.company || null,
    accountManagerName: route?.accountManagerName ?? null,
    message: input.message,
    accountKind: "prospect",
  });

  const lead = await prisma.lead.create({
    data: {
      companyName: input.company || input.name,
      contactName: input.name,
      email: input.email || null,
      phone: input.telephone || null,
      source: CALLBACK_REQUEST_LEAD_SOURCE,
      status: "NEW",
      notes,
      companyId,
      ownerId,
    },
  });

  await recordAuditEvent({
    action: "callback.request_submitted",
    entityType: "Lead",
    entityId: lead.id,
    companyId,
    metadata: {
      source: CALLBACK_REQUEST_LEAD_SOURCE,
      salesRepId: route?.salesRepId ?? null,
      accountKind: "prospect",
    },
  });

  return lead.id;
}

/**
 * Submit a callback enquiry. Company identity for authenticated trade users
 * is resolved server-side from membership — never from a client companyId.
 */
export async function submitCallbackEnquiry(
  raw: unknown,
  meta?: { ip?: string | null; userId?: string | null },
): Promise<CallbackEnquiryResult> {
  let input: CallbackEnquiryInput;
  try {
    input = callbackEnquirySchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        error: "Please check the highlighted fields.",
        fieldErrors: parseFieldErrors(error),
      };
    }
    return { ok: false, error: "Invalid enquiry." };
  }

  if (input.websiteConfirm) {
    throw new AuthError("Rejected", "ABUSE", 400);
  }

  const membership = meta?.userId ? await resolveActiveTradeMembership(meta.userId) : null;
  const customerFirstName = firstNameFrom(input.name);

  // ── Authenticated trade customer ──────────────────────────────────────────
  if (membership) {
    const companyId = membership.company.id;
    const companyName = membership.company.tradingName?.trim() || membership.company.name;
    const route = await resolveAssignmentRoute(companyId);
    const contact = await findContactForCompany(companyId, input.email || membership.userEmail, input.name);

    const dupId = await findRecentAuthenticatedDuplicate({
      companyId,
      userId: membership.userId,
      clientRequestId: input.clientRequestId,
      message: input.message,
    });
    if (dupId) {
      return {
        ok: true,
        enquiryId: dupId,
        kind: "activity",
        duplicate: true,
        accountManagerName: route?.accountManagerName ?? null,
        customerFirstName,
      };
    }

    const { activityId } = await persistTradeCallback({
      input: {
        ...input,
        // Prefer submitted contact details for the enquiry snapshot,
        // but never trust client company identity.
        company: companyName,
      },
      companyId,
      companyName,
      contactId: contact?.id ?? null,
      actorUserId: membership.userId,
      route,
      accountKind: "trade_customer",
    });

    try {
      const { sendCallbackRequestInternalEmails } = await import("@/server/email/transactional");
      await sendCallbackRequestInternalEmails({
        enquiryId: activityId,
        entityType: "Activity",
        salesRepEmail: route?.notificationEmail ?? null,
      });
    } catch {
      /* email secondary — enquiry already persisted */
    }

    return {
      ok: true,
      enquiryId: activityId,
      kind: "activity",
      accountManagerName: route?.accountManagerName ?? null,
      customerFirstName,
    };
  }

  // ── Anonymous / prospect (optional safe company association by contact email) ─
  const matchedContact = input.email ? await findCompanyByContactEmail(input.email) : null;

  if (matchedContact) {
    const companyId = matchedContact.companyId;
    const companyName = matchedContact.company.tradingName?.trim() || matchedContact.company.name;
    const route = await resolveAssignmentRoute(companyId);

    const recentActivity = await prisma.activity.findFirst({
      where: {
        companyId,
        type: "CALLBACK_REQUEST",
        occurredAt: { gte: new Date(Date.now() - CALLBACK_DEDUP_WINDOW_MS) },
        OR: [
          ...(input.email ? [{ metadata: { path: ["email"], equals: input.email } }] : []),
          ...(input.clientRequestId
            ? [{ metadata: { path: ["clientRequestId"], equals: input.clientRequestId } }]
            : []),
        ],
      },
      select: { id: true, metadata: true, body: true },
    });
    if (
      recentActivity &&
      (input.clientRequestId ||
        (recentActivity.metadata as { message?: string } | null)?.message === input.message ||
        recentActivity.body?.includes(input.message))
    ) {
      return {
        ok: true,
        enquiryId: recentActivity.id,
        kind: "activity",
        duplicate: true,
        accountManagerName: route?.accountManagerName ?? null,
        customerFirstName,
      };
    }

    const { activityId } = await persistTradeCallback({
      input: { ...input, company: companyName },
      companyId,
      companyName,
      contactId: matchedContact.id,
      actorUserId: null,
      route,
      accountKind: "trade_customer",
    });

    try {
      const { sendCallbackRequestInternalEmails } = await import("@/server/email/transactional");
      await sendCallbackRequestInternalEmails({
        enquiryId: activityId,
        entityType: "Activity",
        salesRepEmail: route?.notificationEmail ?? null,
      });
    } catch {
      /* email secondary */
    }

    return {
      ok: true,
      enquiryId: activityId,
      kind: "activity",
      accountManagerName: route?.accountManagerName ?? null,
      customerFirstName,
    };
  }

  const leadDup = await findRecentLeadDuplicate(input);
  if (leadDup) {
    return {
      ok: true,
      enquiryId: leadDup,
      kind: "lead",
      duplicate: true,
      accountManagerName: null,
      customerFirstName,
    };
  }

  const leadId = await persistProspectLead({
    input,
    companyId: null,
    ownerId: null,
    route: null,
  });

  try {
    const { sendCallbackRequestInternalEmails } = await import("@/server/email/transactional");
    await sendCallbackRequestInternalEmails({
      enquiryId: leadId,
      entityType: "Lead",
      salesRepEmail: null,
    });
  } catch {
    /* email secondary */
  }

  return {
    ok: true,
    enquiryId: leadId,
    kind: "lead",
    accountManagerName: null,
    customerFirstName,
  };
}
