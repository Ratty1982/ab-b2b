/**
 * Resolve the assigned sales representative notification email from the
 * immutable order-time salesRepIdSnapshot — never from the live company
 * assignment or the logged-in staff user placing the order.
 *
 * Once the sales-rep ORDER_RECEIVED_INTERNAL outbox row exists, its toEmail
 * is the pinned historical recipient for retries.
 */
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import {
  classifySalesRepNotificationCandidate,
  normalizeOrderNotificationEmail,
  orderReceivedInternalSalesRepIdempotencyKey,
  type OrderSalesRepNotificationResolveResult,
  type OrderSalesRepNotificationSkipReason,
} from "@/domain/order-sales-rep-notification";

const SKIP_AUDIT_ACTION = "email.order_sales_rep_notification_skipped";

export type OrderSalesRepNotificationLookup = OrderSalesRepNotificationResolveResult & {
  companyId: string | null;
  /** True when the recipient was taken from the existing sales-rep outbox row. */
  pinnedFromOutbox?: boolean;
};

export async function resolveOrderSalesRepNotificationEmail(
  orderId: string,
): Promise<OrderSalesRepNotificationLookup> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      companyId: true,
      salesRepIdSnapshot: true,
      salesRepNameSnapshot: true,
    },
  });
  if (!order) {
    return { ok: false, reason: "no_sales_rep_snapshot", companyId: null };
  }
  if (!order.salesRepIdSnapshot) {
    return { ok: false, reason: "no_sales_rep_snapshot", companyId: order.companyId };
  }

  const pinned = await prisma.transactionalEmail.findUnique({
    where: { idempotencyKey: orderReceivedInternalSalesRepIdempotencyKey(orderId) },
    select: { toEmail: true },
  });
  if (pinned) {
    const email = normalizeOrderNotificationEmail(pinned.toEmail);
    if (email) {
      return {
        ok: true,
        email,
        salesRepId: order.salesRepIdSnapshot,
        displayName: order.salesRepNameSnapshot?.trim() || email,
        companyId: order.companyId,
        pinnedFromOutbox: true,
      };
    }
  }

  const salesRep = await prisma.salesRep.findUnique({
    where: { id: order.salesRepIdSnapshot },
    select: {
      id: true,
      active: true,
      displayName: true,
      businessEmail: true,
      user: { select: { name: true, email: true, status: true } },
    },
  });

  const resolved = classifySalesRepNotificationCandidate({
    salesRepIdSnapshot: order.salesRepIdSnapshot,
    salesRep,
  });
  return { ...resolved, companyId: order.companyId };
}

/**
 * Record a one-time skip diagnostic. Must never throw — audit failures must not
 * block configured Admin/env ORDER_RECEIVED_INTERNAL recipients.
 */
export async function recordOrderSalesRepNotificationSkip(input: {
  orderId: string;
  companyId?: string | null;
  reason: OrderSalesRepNotificationSkipReason;
}): Promise<void> {
  try {
    const existing = await prisma.auditEvent.findFirst({
      where: {
        action: SKIP_AUDIT_ACTION,
        entityType: "Order",
        entityId: input.orderId,
      },
      select: { id: true },
    });
    if (existing) return;

    await recordAuditEvent({
      action: SKIP_AUDIT_ACTION,
      entityType: "Order",
      entityId: input.orderId,
      companyId: input.companyId ?? null,
      metadata: { reason: input.reason },
    });
  } catch (error) {
    console.error("[ab:email] Failed to record sales-rep notification skip", {
      orderId: input.orderId,
      reason: input.reason,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
