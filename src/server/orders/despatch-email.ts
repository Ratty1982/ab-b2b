/**
 * ORDER_DESPATCHED transactional email.
 * Sent on first PROCESSING → DESPATCHED transition from 504C invoice reconciliation.
 * Failures must not roll back invoice/status — callers catch and record for retry.
 */

import { buildOrderDespatchedCustomerBodies } from "@/server/orders/email";
import {
  loadOrderEmailSnapshot,
  safeAttemptDetailed,
  upsertPendingEmail,
} from "@/server/email/transactional";
import { getEmailFooterMeta } from "@/server/email/settings";

/**
 * Queue + attempt ORDER_DESPATCHED for an order.
 * Idempotent via upsertPendingEmail key ORDER_DESPATCHED:{orderId}.
 */
export async function enqueueOrderDespatchedEmail(orderId: string): Promise<{
  queued: boolean;
  sent: boolean;
  emailId: string | null;
  detail?: string;
}> {
  const snapshot = await loadOrderEmailSnapshot(orderId);
  if (!snapshot?.contact.email) {
    return {
      queued: false,
      sent: false,
      emailId: null,
      detail: "order snapshot missing contact email",
    };
  }

  const footer = await getEmailFooterMeta();
  const bodies = buildOrderDespatchedCustomerBodies(snapshot, footer);
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
  return {
    queued: upsert.created,
    sent: result.emailSent,
    emailId: upsert.id,
  };
}
