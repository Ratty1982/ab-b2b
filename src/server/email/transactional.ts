/**
 * Durable transactional email outbox.
 * Business transactions never roll back when send fails — rows stay PENDING/FAILED/DEFERRED.
 *
 * Transport: Admin → Settings → Email SMTP (provider-independent EmailTransport).
 */

import { Prisma, type TransactionalEmailPurpose, type TransactionalEmailStatus } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { resolveEmailAdapter, type EmailAdapter } from "@/infra/email";
import { getServerEnv } from "@/server/env";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import {
  buildOrderReceivedCustomerBodies,
  buildOrderReceivedInternalBodies,
  type OrderEmailSnapshot,
} from "@/server/orders/email";
import {
  buildTradeAccountActivatedBodies,
  buildTradeApplicationApprovedBodies,
  buildTradeApplicationInternalBodies,
  buildTradeApplicationMoreInfoBodies,
  buildTradeApplicationReceivedBodies,
  buildTradeApplicationRejectedBodies,
  type TradeApplicationEmailSnapshot,
} from "@/server/email/application-templates";
import {
  getEmailFooterMeta,
  getMotorsportEnquiryRecipients,
  getOrderNotificationRecipients,
  getTradeApplicationNotificationRecipients,
  isTransactionalEmailEnabled,
} from "@/server/email/settings";
import {
  buildCompanyUserInviteBodies,
  buildMotorsportEnquiryInternalBodies,
  buildPasswordResetBodies,
  passwordResetIdempotencyKey,
} from "@/server/email/extra-templates";
import { formatDateTime } from "@/lib/datetime";

export type { OrderEmailSnapshot };

function appBaseUrl(): string {
  return getServerEnv().APP_URL.replace(/\/$/, "");
}

function portalOrderUrl(orderId: string): string {
  return `${appBaseUrl()}/portal/orders/${orderId}`;
}

function adminOrderUrl(orderId: string): string {
  return `${appBaseUrl()}/admin/orders/${orderId}`;
}

function moneyStr(v: { toString(): string } | string): string {
  return String(v);
}

function contactFromJson(raw: unknown): { name: string; email: string } {
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const first = typeof c["firstName"] === "string" ? c["firstName"] : "";
  const last = typeof c["lastName"] === "string" ? c["lastName"] : "";
  const name =
    `${first} ${last}`.trim() ||
    (typeof c["name"] === "string" ? c["name"] : "") ||
    "Customer";
  const email = typeof c["email"] === "string" ? c["email"].toLowerCase() : "";
  return { name, email };
}

/** Load order + items into the snapshot used for email bodies (historical prices). */
export async function loadOrderEmailSnapshot(orderId: string): Promise<OrderEmailSnapshot | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { id: "asc" } },
      company: { select: { name: true } },
    },
  });
  if (!order) return null;

  const delivery =
    order.deliveryAddress && typeof order.deliveryAddress === "object"
      ? (order.deliveryAddress as Record<string, unknown>)
      : null;
  const contact =
    order.contactSnapshot && typeof order.contactSnapshot === "object"
      ? (order.contactSnapshot as Record<string, unknown>)
      : null;

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    companyName: order.company.name,
    status: order.status,
    poNumber: order.poNumber,
    currency: order.currency,
    subtotal: moneyStr(order.subtotal),
    vatTotal: moneyStr(order.vatTotal),
    deliveryTotal: moneyStr(order.deliveryTotal),
    grandTotal: moneyStr(order.grandTotal),
    placedAt: order.placedAt ?? order.createdAt,
    paymentTerms: order.paymentTermsSnapshot,
    deliveryInstructions: order.deliveryInstructions,
    deliveryAddress: delivery
      ? {
          line1: String(delivery["line1"] ?? ""),
          line2: delivery["line2"] != null ? String(delivery["line2"]) : null,
          town: String(delivery["town"] ?? ""),
          county: delivery["county"] != null ? String(delivery["county"]) : null,
          postcode: String(delivery["postcode"] ?? ""),
          country: String(delivery["country"] ?? "GB"),
        }
      : null,
    contact: {
      name: String(contact?.["name"] ?? "Customer"),
      email: String(contact?.["email"] ?? ""),
      phone: contact?.["phone"] != null ? String(contact["phone"]) : null,
    },
    items: order.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      qty: item.qty,
      customerUnitPrice: moneyStr(item.customerUnitPrice),
      lineTotal: moneyStr(item.lineTotal),
      orderingMode: item.orderingMode,
    })),
    autopartAccountLinked: order.autopartAccountLinked,
    autopartCustomerCodeSnapshot: order.autopartCustomerCodeSnapshot,
    salesRepNameSnapshot: order.salesRepNameSnapshot,
    salesRepCodeSnapshot: order.salesRepCodeSnapshot,
    portalOrderUrl: portalOrderUrl(order.id),
    adminOrderUrl: adminOrderUrl(order.id),
  };
}

export async function loadTradeApplicationEmailSnapshot(
  applicationId: string,
): Promise<TradeApplicationEmailSnapshot | null> {
  const app = await prisma.tradeApplication.findUnique({ where: { id: applicationId } });
  if (!app) return null;
  const contact = contactFromJson(app.primaryContact);
  return {
    applicationId: app.id,
    reference: app.reference,
    companyName: app.companyName,
    contactName: contact.name,
    contactEmail: contact.email,
    customerMessage: app.customerMessage,
    adminApplicationUrl: `${appBaseUrl()}/admin/applications/${app.id}`,
  };
}

export async function upsertPendingEmail(input: {
  purpose: TransactionalEmailPurpose;
  toEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  entityType: string;
  entityId: string;
  /** Defaults to purpose:entityId */
  idempotencyKey?: string;
}): Promise<{ id: string; created: boolean }> {
  const idempotencyKey = input.idempotencyKey ?? `${input.purpose}:${input.entityId}`;
  const existing = await prisma.transactionalEmail.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    return { id: existing.id, created: false };
  }
  try {
    const row = await prisma.transactionalEmail.create({
      data: {
        purpose: input.purpose,
        status: "PENDING",
        toEmail: input.toEmail,
        subject: input.subject,
        textBody: input.textBody,
        htmlBody: input.htmlBody,
        entityType: input.entityType,
        entityId: input.entityId,
        idempotencyKey,
      },
    });
    return { id: row.id, created: true };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await prisma.transactionalEmail.findUniqueOrThrow({
        where: { idempotencyKey },
      });
      return { id: raced.id, created: false };
    }
    throw error;
  }
}

export async function attemptSend(
  emailId: string,
  adapter?: EmailAdapter,
  options?: { bypassDeliveryToggle?: boolean },
) {
  const row = await prisma.transactionalEmail.findUniqueOrThrow({ where: { id: emailId } });
  if (row.status === "SENT") {
    return { ok: true as const, alreadySent: true, deferred: false };
  }

  if (!options?.bypassDeliveryToggle) {
    const enabled = await isTransactionalEmailEnabled();
    if (!enabled) {
      await prisma.transactionalEmail.update({
        where: { id: emailId },
        data: {
          status: "DEFERRED",
          lastError: "Transactional email delivery is disabled",
        },
      });
      return { ok: false as const, deferred: true, detail: "DELIVERY DISABLED" };
    }
  }

  const resolved = adapter ?? (await resolveEmailAdapter());
  const result = await resolved.send({
    to: row.toEmail,
    subject: row.subject,
    text: row.textBody,
    ...(row.htmlBody ? { html: row.htmlBody } : {}),
    tags: {
      purpose: row.purpose,
      entityType: row.entityType,
      entityId: row.entityId,
    },
  });

  if (result.ok) {
    await prisma.transactionalEmail.update({
      where: { id: emailId },
      data: {
        status: "SENT",
        attemptCount: { increment: 1 },
        providerId: result.id ?? null,
        sentAt: new Date(),
        lastError: null,
      },
    });
    return { ok: true as const, alreadySent: false, deferred: false };
  }

  await prisma.transactionalEmail.update({
    where: { id: emailId },
    data: {
      status: "FAILED",
      attemptCount: { increment: 1 },
      lastError: result.detail ?? "send failed",
    },
  });
  return { ok: false as const, deferred: false, detail: result.detail ?? "send failed" };
}

async function safeAttempt(emailId: string): Promise<boolean> {
  const result = await safeAttemptDetailed(emailId);
  return result.emailSent;
}

export type EmailDispatchResult = {
  emailSent: boolean;
  emailDeferred: boolean;
  emailStatus: TransactionalEmailStatus | "NONE";
  toEmail: string | null;
  sentAt: string | null;
  emailId: string | null;
};

export async function safeAttemptDetailed(emailId: string): Promise<EmailDispatchResult> {
  try {
    await attemptSend(emailId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    await prisma.transactionalEmail
      .update({
        where: { id: emailId },
        data: {
          status: "FAILED",
          attemptCount: { increment: 1 },
          lastError: detail.slice(0, 500),
        },
      })
      .catch(() => undefined);
  }
  return loadEmailDispatchResult(emailId);
}

export async function loadEmailDispatchResult(emailId: string | null | undefined): Promise<EmailDispatchResult> {
  if (!emailId) {
    return {
      emailSent: false,
      emailDeferred: false,
      emailStatus: "NONE",
      toEmail: null,
      sentAt: null,
      emailId: null,
    };
  }
  const row = await prisma.transactionalEmail.findUnique({ where: { id: emailId } });
  if (!row) {
    return {
      emailSent: false,
      emailDeferred: false,
      emailStatus: "NONE",
      toEmail: null,
      sentAt: null,
      emailId: null,
    };
  }
  return {
    emailSent: row.status === "SENT",
    emailDeferred: row.status === "DEFERRED",
    emailStatus: row.status,
    toEmail: row.toEmail,
    sentAt: row.sentAt?.toISOString() ?? null,
    emailId: row.id,
  };
}

export async function loadLatestPurposeDispatch(
  purpose: TransactionalEmailPurpose,
  entityId: string,
): Promise<EmailDispatchResult> {
  const row = await prisma.transactionalEmail.findFirst({
    where: { purpose, entityId },
    orderBy: { createdAt: "desc" },
  });
  return loadEmailDispatchResult(row?.id);
}

/**
 * After order commit: ensure PENDING outbox rows exist and attempt send.
 * Failures are recorded — never throw to the placeOrder caller for send errors.
 */
export async function sendOrderEmailsAfterCommit(orderId: string): Promise<{
  customerOk: boolean;
  internalOk: boolean | null;
  detail?: string;
}> {
  const snapshot = await loadOrderEmailSnapshot(orderId);
  if (!snapshot || !snapshot.contact.email) {
    return { customerOk: false, internalOk: null, detail: "order snapshot missing contact email" };
  }

  const footer = await getEmailFooterMeta();
  const customerBodies = buildOrderReceivedCustomerBodies(snapshot, footer);
  const customerUpsert = await upsertPendingEmail({
    purpose: "ORDER_RECEIVED",
    toEmail: snapshot.contact.email,
    subject: customerBodies.subject,
    textBody: customerBodies.text,
    htmlBody: customerBodies.html,
    entityType: "Order",
    entityId: orderId,
  });

  const customerOk = await safeAttempt(customerUpsert.id);
  let detail: string | undefined;

  const recipients = await getOrderNotificationRecipients();
  // Legacy env fallback only when Admin recipients are empty (transitional).
  const envFallback = (process.env["TRADE_ORDER_NOTIFICATION_EMAIL"] ?? "").trim();
  const internalList =
    recipients.length > 0 ? recipients : envFallback ? [envFallback] : [];

  let internalOk: boolean | null = null;
  if (internalList.length > 0) {
    const internalBodies = buildOrderReceivedInternalBodies(snapshot, footer);
    let anyOk = false;
    for (const toEmail of internalList) {
      const internalUpsert = await upsertPendingEmail({
        purpose: "ORDER_RECEIVED_INTERNAL",
        toEmail,
        subject: internalBodies.subject,
        textBody: internalBodies.text,
        htmlBody: internalBodies.html,
        entityType: "Order",
        entityId: orderId,
        idempotencyKey: `ORDER_RECEIVED_INTERNAL:${orderId}:${toEmail}`,
      });
      const ok = await safeAttempt(internalUpsert.id);
      if (ok) anyOk = true;
    }
    internalOk = anyOk;
  }

  return { customerOk, internalOk, ...(detail ? { detail } : {}) };
}

export async function sendTradeApplicationEmailsAfterSubmit(applicationId: string): Promise<void> {
  const snap = await loadTradeApplicationEmailSnapshot(applicationId);
  if (!snap?.contactEmail) return;

  const footer = await getEmailFooterMeta();
  const customer = buildTradeApplicationReceivedBodies(snap, footer);
  const customerUpsert = await upsertPendingEmail({
    purpose: "TRADE_APPLICATION_RECEIVED",
    toEmail: snap.contactEmail,
    subject: customer.subject,
    textBody: customer.text,
    htmlBody: customer.html,
    entityType: "TradeApplication",
    entityId: applicationId,
  });
  await safeAttempt(customerUpsert.id);

  const recipients = await getTradeApplicationNotificationRecipients();
  if (recipients.length === 0) return;
  const internal = buildTradeApplicationInternalBodies(snap, footer);
  for (const toEmail of recipients) {
    const upsert = await upsertPendingEmail({
      purpose: "TRADE_APPLICATION_INTERNAL_NOTIFICATION",
      toEmail,
      subject: internal.subject,
      textBody: internal.text,
      htmlBody: internal.html,
      entityType: "TradeApplication",
      entityId: applicationId,
      idempotencyKey: `TRADE_APPLICATION_INTERNAL_NOTIFICATION:${applicationId}:${toEmail}`,
    });
    await safeAttempt(upsert.id);
  }
}

export async function sendTradeApplicationMoreInfoEmail(applicationId: string): Promise<boolean> {
  const snap = await loadTradeApplicationEmailSnapshot(applicationId);
  if (!snap?.contactEmail) return false;
  const footer = await getEmailFooterMeta();
  const bodies = buildTradeApplicationMoreInfoBodies(snap, footer);
  const upsert = await upsertPendingEmail({
    purpose: "TRADE_APPLICATION_MORE_INFO",
    toEmail: snap.contactEmail,
    subject: bodies.subject,
    textBody: bodies.text,
    htmlBody: bodies.html,
    entityType: "TradeApplication",
    entityId: applicationId,
    idempotencyKey: `TRADE_APPLICATION_MORE_INFO:${applicationId}:${Date.now()}`,
  });
  return safeAttempt(upsert.id);
}

/**
 * Queue + attempt TRADE_APPLICATION_APPROVED.
 * Pass `refreshBodies: true` when reissuing a fresh activation token (resend).
 * Never logs or returns the activation token.
 */
export async function sendTradeApplicationApprovedEmail(
  applicationId: string,
  activationPath: string | null,
  options?: { refreshBodies?: boolean },
): Promise<EmailDispatchResult> {
  const snap = await loadTradeApplicationEmailSnapshot(applicationId);
  if (!snap?.contactEmail) {
    return {
      emailSent: false,
      emailDeferred: false,
      emailStatus: "NONE",
      toEmail: null,
      sentAt: null,
      emailId: null,
    };
  }
  const footer = await getEmailFooterMeta();
  const bodies = buildTradeApplicationApprovedBodies(
    {
      ...snap,
      activationPath,
    },
    footer,
  );
  const upsert = await upsertPendingEmail({
    purpose: "TRADE_APPLICATION_APPROVED",
    toEmail: snap.contactEmail,
    subject: bodies.subject,
    textBody: bodies.text,
    htmlBody: bodies.html,
    entityType: "TradeApplication",
    entityId: applicationId,
  });

  if (!upsert.created && options?.refreshBodies) {
    await prisma.transactionalEmail.update({
      where: { id: upsert.id },
      data: {
        subject: bodies.subject,
        textBody: bodies.text,
        htmlBody: bodies.html,
        toEmail: snap.contactEmail,
        status: "PENDING",
        lastError: null,
      },
    });
  }

  return safeAttemptDetailed(upsert.id);
}

export async function sendTradeApplicationRejectedEmail(applicationId: string): Promise<boolean> {
  const snap = await loadTradeApplicationEmailSnapshot(applicationId);
  if (!snap?.contactEmail) return false;
  const footer = await getEmailFooterMeta();
  const bodies = buildTradeApplicationRejectedBodies(snap, footer);
  const upsert = await upsertPendingEmail({
    purpose: "TRADE_APPLICATION_REJECTED",
    toEmail: snap.contactEmail,
    subject: bodies.subject,
    textBody: bodies.text,
    htmlBody: bodies.html,
    entityType: "TradeApplication",
    entityId: applicationId,
  });
  return safeAttempt(upsert.id);
}

export async function sendTradeAccountActivatedEmail(input: {
  userId: string;
  companyId: string;
  contactEmail: string;
  contactName: string;
  companyName: string;
}): Promise<boolean> {
  const footer = await getEmailFooterMeta();
  const bodies = buildTradeAccountActivatedBodies(
    {
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      companyName: input.companyName,
    },
    footer,
  );
  const upsert = await upsertPendingEmail({
    purpose: "TRADE_ACCOUNT_ACTIVATED",
    toEmail: input.contactEmail,
    subject: bodies.subject,
    textBody: bodies.text,
    htmlBody: bodies.html,
    entityType: "User",
    entityId: input.userId,
    idempotencyKey: `TRADE_ACCOUNT_ACTIVATED:${input.userId}:${input.companyId}`,
  });
  return safeAttempt(upsert.id);
}

/**
 * Password reset via Better Auth URL — outbox history, no token in audit metadata.
 * Delivery toggle applies (DEFERRED when disabled).
 */
export async function sendPasswordResetTransactionalEmail(input: {
  userId: string;
  email: string;
  resetUrl: string;
}): Promise<boolean> {
  const footer = await getEmailFooterMeta();
  const bodies = buildPasswordResetBodies({ resetUrl: input.resetUrl }, footer);
  const upsert = await upsertPendingEmail({
    purpose: "PASSWORD_RESET",
    toEmail: input.email,
    subject: bodies.subject,
    textBody: bodies.text,
    htmlBody: bodies.html,
    entityType: "User",
    entityId: input.userId,
    idempotencyKey: passwordResetIdempotencyKey(input.userId, input.resetUrl),
  });
  return safeAttempt(upsert.id);
}

export async function sendCompanyUserInviteEmail(input: {
  invitationId: string;
  email: string;
  companyId: string;
  companyName: string;
  role: string;
  activationPath: string;
}): Promise<boolean> {
  const footer = await getEmailFooterMeta();
  const base = getServerEnv().APP_URL.replace(/\/$/, "");
  const activationUrl = input.activationPath.startsWith("http")
    ? input.activationPath
    : `${base}${input.activationPath.startsWith("/") ? "" : "/"}${input.activationPath}`;
  const bodies = buildCompanyUserInviteBodies(
    {
      companyName: input.companyName,
      role: input.role,
      activationPath: activationUrl,
      inviteeEmail: input.email,
    },
    footer,
  );
  const upsert = await upsertPendingEmail({
    purpose: "COMPANY_USER_INVITED",
    toEmail: input.email,
    subject: bodies.subject,
    textBody: bodies.text,
    htmlBody: bodies.html,
    entityType: "UserInvitation",
    entityId: input.invitationId,
    idempotencyKey: `COMPANY_USER_INVITED:${input.invitationId}`,
  });
  return safeAttempt(upsert.id);
}

/**
 * Admin-created staff user invitation — set password / activate (not PASSWORD_RESET).
 */
export async function sendUserInvitationEmail(input: {
  invitationId: string;
  userId: string;
  email: string;
  displayName: string;
  roleLabel: string;
  activationPath: string;
}): Promise<boolean> {
  const footer = await getEmailFooterMeta();
  const base = getServerEnv().APP_URL.replace(/\/$/, "");
  const activationUrl = input.activationPath.startsWith("http")
    ? input.activationPath
    : `${base}${input.activationPath.startsWith("/") ? "" : "/"}${input.activationPath}`;
  const { buildUserInvitationBodies } = await import(
    "@/server/email/user-invitation-template"
  );
  const bodies = buildUserInvitationBodies(
    {
      email: input.email,
      displayName: input.displayName,
      roleLabel: input.roleLabel,
      activationUrl,
    },
    footer,
  );
  const upsert = await upsertPendingEmail({
    purpose: "USER_INVITATION",
    toEmail: input.email,
    subject: bodies.subject,
    textBody: bodies.text,
    htmlBody: bodies.html,
    entityType: "User",
    entityId: input.userId,
    idempotencyKey: `USER_INVITATION:${input.invitationId}`,
  });
  return safeAttempt(upsert.id);
}

export async function sendMotorsportEnquiryInternalEmails(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  const recipients = await getMotorsportEnquiryRecipients();
  if (recipients.length === 0) return;

  const footer = await getEmailFooterMeta();
  const base = getServerEnv().APP_URL.replace(/\/$/, "");
  // CRM leads list — no dedicated lead detail route yet.
  const adminLeadUrl = `${base}/admin/crm`;
  const submittedAtLabel =
    formatDateTime(lead.createdAt, { seconds: false }) ?? lead.createdAt.toISOString();
  const bodies = buildMotorsportEnquiryInternalBodies(
    {
      leadId: lead.id,
      companyName: lead.companyName,
      contactName: lead.contactName ?? "—",
      email: lead.email ?? "",
      telephone: lead.phone,
      messagePreview: (lead.notes ?? "").slice(0, 800),
      adminLeadUrl,
      submittedAtLabel,
    },
    footer,
  );

  for (const toEmail of recipients) {
    const upsert = await upsertPendingEmail({
      purpose: "MOTORSPORT_PARTNERSHIP_INTERNAL",
      toEmail,
      subject: bodies.subject,
      textBody: bodies.text,
      htmlBody: bodies.html,
      entityType: "Lead",
      entityId: lead.id,
      idempotencyKey: `MOTORSPORT_PARTNERSHIP_INTERNAL:${lead.id}:${toEmail}`,
    });
    await safeAttempt(upsert.id);
  }
}

export type TransactionalEmailListItem = {
  id: string;
  purpose: TransactionalEmailPurpose;
  status: string;
  toEmail: string;
  subject: string;
  entityType: string;
  entityId: string;
  reference: string | null;
  attemptCount: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type OrderEmailListItem = {
  id: string;
  purpose: TransactionalEmailPurpose;
  status: string;
  toEmail: string;
  subject: string;
  attemptCount: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
};

async function resolveReference(
  purpose: TransactionalEmailPurpose,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  if (entityType === "Order") {
    const order = await prisma.order.findUnique({
      where: { id: entityId },
      select: { orderNumber: true },
    });
    return order?.orderNumber ?? null;
  }
  if (entityType === "TradeApplication") {
    const app = await prisma.tradeApplication.findUnique({
      where: { id: entityId },
      select: { reference: true },
    });
    return app?.reference ?? null;
  }
  if (entityType === "UserInvitation") {
    return "INVITE";
  }
  if (entityType === "Lead") {
    return "LEAD";
  }
  if (purpose === "EMAIL_TEST") return "TEST";
  if (purpose === "PASSWORD_RESET") return "RESET";
  return null;
}

export async function listTransactionalEmails(
  actorUserId: string,
  filters?: { status?: string; purpose?: string; limit?: number },
): Promise<TransactionalEmailListItem[]> {
  await requireSystemPermission(actorUserId, "settings.view");

  const where: Prisma.TransactionalEmailWhereInput = {};
  if (filters?.status && filters.status !== "ALL") {
    where.status = filters.status as TransactionalEmailStatus;
  }
  if (filters?.purpose && filters.purpose !== "ALL") {
    where.purpose = filters.purpose as TransactionalEmailPurpose;
  }

  const rows = await prisma.transactionalEmail.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(filters?.limit ?? 20, 50),
  });

  const items: TransactionalEmailListItem[] = [];
  for (const row of rows) {
    const reference = await resolveReference(row.purpose, row.entityType, row.entityId);
    items.push({
      id: row.id,
      purpose: row.purpose,
      status: row.status,
      toEmail: row.toEmail,
      subject: row.subject,
      entityType: row.entityType,
      entityId: row.entityId,
      reference,
      attemptCount: row.attemptCount,
      lastError: row.lastError,
      sentAt: row.sentAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return items;
}

export async function listOrderEmails(
  actorUserId: string,
  orderId: string,
): Promise<OrderEmailListItem[]> {
  await requireSystemPermission(actorUserId, "orders.view");
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }

  const rows = await prisma.transactionalEmail.findMany({
    where: { entityType: "Order", entityId: orderId },
    orderBy: [{ purpose: "asc" }, { createdAt: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    purpose: row.purpose,
    status: row.status,
    toEmail: row.toEmail,
    subject: row.subject,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

function toListItem(
  row: {
    id: string;
    purpose: TransactionalEmailPurpose;
    status: string;
    toEmail: string;
    subject: string;
    attemptCount: number;
    lastError: string | null;
    sentAt: Date | null;
    createdAt: Date;
  },
): OrderEmailListItem {
  return {
    id: row.id,
    purpose: row.purpose,
    status: row.status,
    toEmail: row.toEmail,
    subject: row.subject,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Rebuild body from authoritative snapshot and re-attempt send.
 * Never recreates orders, reservations, approvals, or companies.
 */
export async function retryTransactionalEmail(
  actorUserId: string,
  emailId: string,
): Promise<OrderEmailListItem> {
  const canSettings = await requireSystemPermission(actorUserId, "settings.edit").catch(() => null);
  if (!canSettings) {
    await requireSystemPermission(actorUserId, "orders.view");
  }

  const row = await prisma.transactionalEmail.findUnique({ where: { id: emailId } });
  if (!row) {
    throw new AuthError("Email not found", "EMAIL_NOT_FOUND", 404);
  }
  if (row.status === "SENT") {
    throw new AuthError("Email was already sent", "CONFLICT", 409);
  }

  // Password-reset links expire — staff retry issues a fresh Better Auth reset email.
  if (row.purpose === "PASSWORD_RESET") {
    const { auth } = await import("@/infra/auth/auth");
    try {
      await auth.api.requestPasswordReset({
        body: {
          email: row.toEmail,
          redirectTo: "/reset-password",
        },
      });
    } catch {
      throw new AuthError("Unable to issue a new password reset email", "EMAIL_FAILED", 502);
    }
    await recordAuditEvent({
      action: "email.retried",
      entityType: "TransactionalEmail",
      entityId: emailId,
      actorUserId,
      metadata: { purpose: row.purpose, strategy: "reissue_reset", toEmail: row.toEmail },
    });
    const updated = await prisma.transactionalEmail.findFirst({
      where: { purpose: "PASSWORD_RESET", toEmail: row.toEmail },
      orderBy: { createdAt: "desc" },
    });
    if (!updated) {
      throw new AuthError("Reset email was requested but not recorded", "EMAIL_NOT_FOUND", 404);
    }
    return toListItem(updated);
  }

  // Staff invitations: delivery retry re-issues a fresh invitation (token may be expired).
  if (row.purpose === "USER_INVITATION") {
    if (!row.entityId) {
      throw new AuthError("Invitation email has no user reference", "VALIDATION", 400);
    }
    await requireSystemPermission(actorUserId, "users.manage");
    const { resendStaffInvitation } = await import("@/server/users/service");
    await resendStaffInvitation(actorUserId, { id: row.entityId });
    await recordAuditEvent({
      action: "email.retried",
      entityType: "TransactionalEmail",
      entityId: emailId,
      actorUserId,
      metadata: { purpose: row.purpose, strategy: "reissue_invitation", toEmail: row.toEmail },
    });
    const updated = await prisma.transactionalEmail.findFirst({
      where: { purpose: "USER_INVITATION", entityId: row.entityId },
      orderBy: { createdAt: "desc" },
    });
    if (!updated) {
      throw new AuthError("Invitation email was requested but not recorded", "EMAIL_NOT_FOUND", 404);
    }
    return toListItem(updated);
  }

  let subject = row.subject;
  let textBody = row.textBody;
  let htmlBody = row.htmlBody;
  let toEmail = row.toEmail;
  const footer = await getEmailFooterMeta();

  if (row.entityType === "Order") {
    const snapshot = await loadOrderEmailSnapshot(row.entityId);
    if (!snapshot) {
      throw new AuthError("Order not found for email", "ORDER_NOT_FOUND", 404);
    }
    if (row.purpose === "ORDER_RECEIVED") {
      const bodies = buildOrderReceivedCustomerBodies(snapshot, footer);
      subject = bodies.subject;
      textBody = bodies.text;
      htmlBody = bodies.html;
      toEmail = snapshot.contact.email || row.toEmail;
    } else if (row.purpose === "ORDER_RECEIVED_INTERNAL") {
      const bodies = buildOrderReceivedInternalBodies(snapshot, footer);
      subject = bodies.subject;
      textBody = bodies.text;
      htmlBody = bodies.html;
    }
  } else if (row.entityType === "TradeApplication") {
    const snap = await loadTradeApplicationEmailSnapshot(row.entityId);
    if (!snap) {
      throw new AuthError("Application not found for email", "NOT_FOUND", 404);
    }
    if (row.purpose === "TRADE_APPLICATION_RECEIVED") {
      const bodies = buildTradeApplicationReceivedBodies(snap, footer);
      subject = bodies.subject;
      textBody = bodies.text;
      htmlBody = bodies.html;
      toEmail = snap.contactEmail || row.toEmail;
    } else if (row.purpose === "TRADE_APPLICATION_INTERNAL_NOTIFICATION") {
      const bodies = buildTradeApplicationInternalBodies(snap, footer);
      subject = bodies.subject;
      textBody = bodies.text;
      htmlBody = bodies.html;
    } else if (row.purpose === "TRADE_APPLICATION_MORE_INFO") {
      const bodies = buildTradeApplicationMoreInfoBodies(snap, footer);
      subject = bodies.subject;
      textBody = bodies.text;
      htmlBody = bodies.html;
      toEmail = snap.contactEmail || row.toEmail;
    } else if (row.purpose === "TRADE_APPLICATION_APPROVED") {
      // Do not invent a new activation token — keep existing body / path from original send.
      // Rebuild message without changing activation URL already stored in text/html.
      toEmail = snap.contactEmail || row.toEmail;
    } else if (row.purpose === "TRADE_APPLICATION_REJECTED") {
      const bodies = buildTradeApplicationRejectedBodies(snap, footer);
      subject = bodies.subject;
      textBody = bodies.text;
      htmlBody = bodies.html;
      toEmail = snap.contactEmail || row.toEmail;
    }
  }

  await prisma.transactionalEmail.update({
    where: { id: emailId },
    data: {
      subject,
      textBody,
      htmlBody,
      toEmail,
      status: "PENDING",
      lastError: null,
    },
  });

  const sent = await attemptSend(emailId);
  const updated = await prisma.transactionalEmail.findUniqueOrThrow({ where: { id: emailId } });

  await recordAuditEvent({
    action: "email.retried",
    entityType: "TransactionalEmail",
    entityId: emailId,
    actorUserId,
    metadata: {
      entityType: row.entityType,
      entityId: row.entityId,
      purpose: row.purpose,
      ok: sent.ok,
      deferred: sent.deferred,
    },
  });

  return toListItem(updated);
}
