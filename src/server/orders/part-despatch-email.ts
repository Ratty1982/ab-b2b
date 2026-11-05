/**
 * ORDER_PART_DESPATCHED transactional email.
 *
 * Sent when 504 + TRM21QC fulfilment confirms a partial despatch.
 * Failures must not roll back invoice/status.
 *
 * Idempotent per invoice document: ORDER_PART_DESPATCHED:{orderId}:{invoiceExternalRef}
 * so multiple partial invoices can each notify once without duplicating the same event.
 */

import { buildOrderPartDespatchedCustomerBodies } from "@/server/orders/email";
import {
  loadOrderEmailSnapshot,
  safeAttemptDetailed,
  upsertPendingEmail,
} from "@/server/email/transactional";
import { getEmailFooterMeta } from "@/server/email/settings";
import { recordAuditEvent } from "@/server/audit/record";

export async function enqueueOrderPartDespatchedEmail(input: {
  orderId: string;
  /** Autopart document number — scopes idempotency per invoice. */
  invoiceExternalRef: string;
  lineQuantitiesKnown: boolean;
  newlyDespatchedLines?: Array<{ sku: string; name: string; qty: number }>;
  stillToComeLines?: Array<{ sku: string; name: string; qty: number }>;
  actorUserId?: string | null;
}): Promise<{
  queued: boolean;
  sent: boolean;
  emailId: string | null;
  detail?: string;
}> {
  const snapshot = await loadOrderEmailSnapshot(input.orderId);
  if (!snapshot?.contact.email) {
    await recordAuditEvent({
      action: "order.despatch_email_failed",
      entityType: "Order",
      entityId: input.orderId,
      actorUserId: input.actorUserId ?? null,
      metadata: {
        error: "order snapshot missing contact email",
        source: "AUTOPART_504_TRM",
        purpose: "ORDER_PART_DESPATCHED",
        invoiceExternalRef: input.invoiceExternalRef,
      },
    });
    return {
      queued: false,
      sent: false,
      emailId: null,
      detail: "order snapshot missing contact email",
    };
  }

  const footer = await getEmailFooterMeta();
  const bodies = buildOrderPartDespatchedCustomerBodies(snapshot, {
    lineQuantitiesKnown: input.lineQuantitiesKnown,
    ...(input.newlyDespatchedLines ? { newlyDespatchedLines: input.newlyDespatchedLines } : {}),
    ...(input.stillToComeLines ? { stillToComeLines: input.stillToComeLines } : {}),
    footer,
  });
  const upsert = await upsertPendingEmail({
    purpose: "ORDER_PART_DESPATCHED",
    toEmail: snapshot.contact.email,
    subject: bodies.subject,
    textBody: bodies.text,
    htmlBody: bodies.html,
    entityType: "Order",
    entityId: input.orderId,
    idempotencyKey: `ORDER_PART_DESPATCHED:${input.orderId}:${input.invoiceExternalRef}`,
  });

  const result = await safeAttemptDetailed(upsert.id);
  if (!result.emailSent) {
    const detail =
      result.emailStatus === "DEFERRED"
        ? "Transactional email delivery is disabled"
        : result.emailStatus === "FAILED"
          ? "SMTP or delivery failure"
          : `email status ${result.emailStatus}`;
    await recordAuditEvent({
      action: "order.despatch_email_failed",
      entityType: "Order",
      entityId: input.orderId,
      actorUserId: input.actorUserId ?? null,
      metadata: {
        error: detail,
        source: "AUTOPART_504_TRM",
        purpose: "ORDER_PART_DESPATCHED",
        invoiceExternalRef: input.invoiceExternalRef,
        emailId: upsert.id,
        emailStatus: result.emailStatus,
        queuedNew: upsert.created,
      },
    });
    return {
      queued: upsert.created,
      sent: false,
      emailId: upsert.id,
      detail,
    };
  }
  return {
    queued: upsert.created,
    sent: true,
    emailId: upsert.id,
  };
}
