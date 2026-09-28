/**
 * ORDER_PART_DESPATCHED transactional email.
 *
 * Sent when 504C (or authoritative fulfilment) confirms a partial despatch.
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

export async function enqueueOrderPartDespatchedEmail(input: {
  orderId: string;
  /** Autopart document number — scopes idempotency per invoice. */
  invoiceExternalRef: string;
  lineQuantitiesKnown: boolean;
}): Promise<{
  queued: boolean;
  sent: boolean;
  emailId: string | null;
  detail?: string;
}> {
  const snapshot = await loadOrderEmailSnapshot(input.orderId);
  if (!snapshot?.contact.email) {
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
  return {
    queued: upsert.created,
    sent: result.emailSent,
    emailId: upsert.id,
  };
}
