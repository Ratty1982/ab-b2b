/**
 * ORDER_DESPATCHED transactional email.
 * Sent on authoritative full despatch from matched 504 + TRM21QC evidence.
 * Failures must not roll back invoice/status — callers catch and record for retry.
 */

import {
  buildOrderDespatchedCustomerBodies,
  buildOrderRemainingDespatchedCustomerBodies,
} from "@/server/orders/email";
import {
  loadOrderEmailSnapshot,
  safeAttemptDetailed,
  upsertPendingEmail,
} from "@/server/email/transactional";
import { getEmailFooterMeta } from "@/server/email/settings";
import { recordAuditEvent } from "@/server/audit/record";

/**
 * Queue + attempt ORDER_DESPATCHED for an order.
 * Idempotent via upsertPendingEmail key ORDER_DESPATCHED:{orderId}.
 */
export async function enqueueOrderDespatchedEmail(
  orderId: string,
  opts?: { remainingAfterBackorder?: boolean; actorUserId?: string | null },
): Promise<{
  queued: boolean;
  sent: boolean;
  emailId: string | null;
  detail?: string;
}> {
  const snapshot = await loadOrderEmailSnapshot(orderId);
  if (!snapshot?.contact.email) {
    await recordAuditEvent({
      action: "order.despatch_email_failed",
      entityType: "Order",
      entityId: orderId,
      actorUserId: opts?.actorUserId ?? null,
      metadata: {
        error: "order snapshot missing contact email",
        source: "AUTOPART_504_TRM",
        purpose: "ORDER_DESPATCHED",
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
  const bodies = opts?.remainingAfterBackorder
    ? buildOrderRemainingDespatchedCustomerBodies(snapshot, footer)
    : buildOrderDespatchedCustomerBodies(snapshot, footer);
  const upsert = await upsertPendingEmail({
    purpose: "ORDER_DESPATCHED",
    toEmail: snapshot.contact.email,
    subject: bodies.subject,
    textBody: bodies.text,
    htmlBody: bodies.html,
    entityType: "Order",
    entityId: orderId,
    idempotencyKey: `ORDER_DESPATCHED:${orderId}`,
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
      entityId: orderId,
      actorUserId: opts?.actorUserId ?? null,
      metadata: {
        error: detail,
        source: "AUTOPART_504_TRM",
        purpose: "ORDER_DESPATCHED",
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
