/**
 * Durable transactional email outbox.
 * Order creation never rolls back when send fails — rows stay PENDING/FAILED for retry.
 */

import { Prisma, type TransactionalEmailPurpose } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { getEmailAdapter, type EmailAdapter } from "@/infra/email";
import { getServerEnv } from "@/server/env";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import {
  buildOrderReceivedCustomerBodies,
  buildOrderReceivedInternalBodies,
  type OrderEmailSnapshot,
} from "@/server/orders/email";

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

function internalNotifyTo(): string {
  return (process.env["TRADE_ORDER_NOTIFICATION_EMAIL"] ?? "").trim();
}

function moneyStr(v: { toString(): string } | string): string {
  return String(v);
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

async function upsertPendingEmail(input: {
  purpose: TransactionalEmailPurpose;
  toEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  orderId: string;
}): Promise<{ id: string; created: boolean }> {
  const idempotencyKey = `${input.purpose}:${input.orderId}`;
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
        entityType: "Order",
        entityId: input.orderId,
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

async function attemptSend(emailId: string, adapter: EmailAdapter = getEmailAdapter()) {
  const row = await prisma.transactionalEmail.findUniqueOrThrow({ where: { id: emailId } });
  if (row.status === "SENT") {
    return { ok: true as const, alreadySent: true };
  }

  const result = await adapter.send({
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
    return { ok: true as const, alreadySent: false };
  }

  await prisma.transactionalEmail.update({
    where: { id: emailId },
    data: {
      status: "FAILED",
      attemptCount: { increment: 1 },
      lastError: result.detail ?? "send failed",
    },
  });
  return { ok: false as const, detail: result.detail ?? "send failed" };
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

  const customerBodies = buildOrderReceivedCustomerBodies(snapshot);
  const customerUpsert = await upsertPendingEmail({
    purpose: "ORDER_RECEIVED",
    toEmail: snapshot.contact.email,
    subject: customerBodies.subject,
    textBody: customerBodies.text,
    htmlBody: customerBodies.html,
    orderId,
  });

  let customerOk = false;
  let detail: string | undefined;
  try {
    const sent = await attemptSend(customerUpsert.id);
    customerOk = sent.ok;
    if (!sent.ok) detail = sent.detail;
  } catch (error) {
    detail = error instanceof Error ? error.message : "unknown";
    await prisma.transactionalEmail.update({
      where: { id: customerUpsert.id },
      data: {
        status: "FAILED",
        attemptCount: { increment: 1 },
        lastError: detail,
      },
    });
  }

  const internalTo = internalNotifyTo();
  let internalOk: boolean | null = null;
  if (internalTo) {
    const internalBodies = buildOrderReceivedInternalBodies(snapshot);
    const internalUpsert = await upsertPendingEmail({
      purpose: "ORDER_RECEIVED_INTERNAL",
      toEmail: internalTo,
      subject: internalBodies.subject,
      textBody: internalBodies.text,
      htmlBody: internalBodies.html,
      orderId,
    });
    try {
      const sent = await attemptSend(internalUpsert.id);
      internalOk = sent.ok;
      if (!sent.ok && !detail) detail = sent.detail;
    } catch (error) {
      internalOk = false;
      const msg = error instanceof Error ? error.message : "unknown";
      if (!detail) detail = msg;
      await prisma.transactionalEmail.update({
        where: { id: internalUpsert.id },
        data: {
          status: "FAILED",
          attemptCount: { increment: 1 },
          lastError: msg,
        },
      });
    }
  }

  return { customerOk, internalOk, ...(detail ? { detail } : {}) };
}

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

/**
 * Rebuild body from order snapshot (historical prices) and re-attempt send.
 * Admin / orders.view only.
 */
export async function retryTransactionalEmail(
  actorUserId: string,
  emailId: string,
): Promise<OrderEmailListItem> {
  await requireSystemPermission(actorUserId, "orders.view");

  const row = await prisma.transactionalEmail.findUnique({ where: { id: emailId } });
  if (!row || row.entityType !== "Order") {
    throw new AuthError("Email not found", "EMAIL_NOT_FOUND", 404);
  }

  const snapshot = await loadOrderEmailSnapshot(row.entityId);
  if (!snapshot) {
    throw new AuthError("Order not found for email", "ORDER_NOT_FOUND", 404);
  }

  let subject = row.subject;
  let textBody = row.textBody;
  let htmlBody = row.htmlBody;
  let toEmail = row.toEmail;

  if (row.purpose === "ORDER_RECEIVED") {
    const bodies = buildOrderReceivedCustomerBodies(snapshot);
    subject = bodies.subject;
    textBody = bodies.text;
    htmlBody = bodies.html;
    toEmail = snapshot.contact.email || row.toEmail;
  } else if (row.purpose === "ORDER_RECEIVED_INTERNAL") {
    const bodies = buildOrderReceivedInternalBodies(snapshot);
    subject = bodies.subject;
    textBody = bodies.text;
    htmlBody = bodies.html;
    toEmail = internalNotifyTo() || row.toEmail;
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
    action: "order.email_retry",
    entityType: "TransactionalEmail",
    entityId: emailId,
    actorUserId,
    metadata: {
      orderId: row.entityId,
      purpose: row.purpose,
      ok: sent.ok,
    },
  });

  return {
    id: updated.id,
    purpose: updated.purpose,
    status: updated.status,
    toEmail: updated.toEmail,
    subject: updated.subject,
    attemptCount: updated.attemptCount,
    lastError: updated.lastError,
    sentAt: updated.sentAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
  };
}
