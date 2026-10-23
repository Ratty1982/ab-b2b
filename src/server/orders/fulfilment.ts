/**
 * Authoritative order fulfilment events + line despatch quantities.
 *
 * Rules:
 * - Never invent despatchedQty from financial totals alone.
 * - Timeline events must be backed by real place/export/invoice/manual evidence.
 * - Email failures must not roll back fulfilment state.
 * - Historical events may record source AUTOPART_504C. New line despatch is MANUAL
 *   or the 504 + TRM21QC fulfilment service.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";

export async function recordFulfilmentEvent(
  tx: Prisma.TransactionClient | typeof prisma,
  input: {
    orderId: string;
    kind:
      | "ORDER_RECEIVED"
      | "EXPORTED_FOR_PROCESSING"
      | "INVOICE_LINKED"
      | "PART_DESPATCHED"
      | "DESPATCHED"
      | "ADMINISTRATIVELY_CLOSED"
      | "NOTE";
    summary: string;
    source:
      | "ORDER_PLACE"
      | "QUOTE_CONVERT"
      | "AUTOPART_EXPORT"
      | "AUTOPART_504C"
      | "AUTOPART_504_TRM"
      | "MANUAL";
    invoiceId?: string | null;
    lineQuantitiesKnown?: boolean;
    limitation?: string | null;
    metadata?: Prisma.InputJsonValue;
    occurredAt?: Date;
  },
): Promise<string> {
  const row = await tx.orderFulfilmentEvent.create({
    data: {
      orderId: input.orderId,
      kind: input.kind,
      summary: input.summary,
      source: input.source,
      invoiceId: input.invoiceId ?? null,
      lineQuantitiesKnown: input.lineQuantitiesKnown ?? false,
      limitation: input.limitation ?? null,
      ...(input.metadata != null ? { metadata: input.metadata } : {}),
      occurredAt: input.occurredAt ?? new Date(),
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Apply authoritative line-level despatch quantities (future Autopart line feed / manual).
 * Increases despatchedQty; never decreases historical ordered/backorder snapshots.
 */
export async function applyAuthoritativeLineDespatch(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    lines: Array<{ orderItemId: string; despatchedQty: number }>;
    source: "MANUAL";
    invoiceId?: string | null;
    summary: string;
    limitation?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<{
  status: "PARTIALLY_DESPATCHED" | "DISPATCHED";
  fullyComplete: boolean;
}> {
  for (const line of input.lines) {
    const item = await tx.orderItem.findFirst({
      where: { id: line.orderItemId, orderId: input.orderId },
      select: { id: true, qty: true, despatchedQty: true },
    });
    if (!item) continue;
    const next = Math.min(item.qty, Math.max(item.despatchedQty, Math.trunc(line.despatchedQty)));
    await tx.orderItem.update({
      where: { id: item.id },
      data: { despatchedQty: next },
    });
  }

  const items = await tx.orderItem.findMany({
    where: { orderId: input.orderId },
    select: { qty: true, despatchedQty: true },
  });
  const fullyComplete = items.length > 0 && items.every((i) => i.despatchedQty >= i.qty);
  const status = fullyComplete ? "DISPATCHED" : "PARTIALLY_DESPATCHED";

  await tx.order.update({
    where: { id: input.orderId },
    data: { status },
  });

  await recordFulfilmentEvent(tx, {
    orderId: input.orderId,
    kind: fullyComplete ? "DESPATCHED" : "PART_DESPATCHED",
    summary: input.summary,
    source: input.source,
    invoiceId: input.invoiceId ?? null,
    lineQuantitiesKnown: true,
    limitation: input.limitation ?? null,
    ...(input.metadata != null ? { metadata: input.metadata } : {}),
  });

  return { status, fullyComplete };
}
