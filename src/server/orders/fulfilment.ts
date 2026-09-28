/**
 * Authoritative order fulfilment events + line despatch quantities.
 *
 * Rules:
 * - Never invent despatchedQty from Autopart Avail or 504C financial totals alone.
 * - Timeline events must be backed by real place/export/invoice/manual evidence.
 * - Email failures must not roll back fulfilment state.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { moneyToString, moneyZero, parseMoney, addMoney } from "@/domain/money";
import { compareAbOrderTo504cFinancials } from "@/domain/autopart-504c-plan";

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
      | "NOTE";
    summary: string;
    source: "ORDER_PLACE" | "QUOTE_CONVERT" | "AUTOPART_EXPORT" | "AUTOPART_504C" | "MANUAL";
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
    source: "AUTOPART_504C" | "MANUAL";
    invoiceId?: string | null;
    summary: string;
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
    limitation: null,
  });

  return { status, fullyComplete };
}

/**
 * Financial completion check across all linked Autopart invoices for an order.
 * 504C Goods includes SDEL delivery — compare to AB subtotal + deliveryTotal.
 */
export async function orderInvoicesFinanciallyComplete(orderId: string): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      subtotal: true,
      deliveryTotal: true,
      vatTotal: true,
      grandTotal: true,
      invoices: {
        where: { autopartDocumentKind: "INVOICE" },
        select: { subtotal: true, vatTotal: true, grandTotal: true },
      },
    },
  });
  if (!order || order.invoices.length === 0) return false;

  let goods = moneyZero();
  let vat = moneyZero();
  let value = moneyZero();
  for (const inv of order.invoices) {
    goods = addMoney(goods, parseMoney(String(inv.subtotal)) ?? moneyZero());
    vat = addMoney(vat, parseMoney(String(inv.vatTotal)) ?? moneyZero());
    value = addMoney(value, parseMoney(String(inv.grandTotal)) ?? moneyZero());
  }

  const compare = compareAbOrderTo504cFinancials({
    abGoods: moneyToString(parseMoney(String(order.subtotal)) ?? moneyZero(), 2),
    abDelivery: moneyToString(parseMoney(String(order.deliveryTotal)) ?? moneyZero(), 2),
    abVat: moneyToString(parseMoney(String(order.vatTotal)) ?? moneyZero(), 2),
    abTotal: moneyToString(parseMoney(String(order.grandTotal)) ?? moneyZero(), 2),
    c504Goods: moneyToString(goods, 2),
    c504Vat: moneyToString(vat, 2),
    c504Value: moneyToString(value, 2),
  });

  return compare.status === "OK";
}

export const FULFILMENT_LINE_QTY_LIMITATION =
  "504C provides order-level invoice totals only — SKU despatch quantities are not available from this feed.";
