/**
 * Shared Autopart export eligibility for hold-until-complete.
 * List filters stay aligned with blocksAutopartExportForStockHold.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { VERIFIED_STOCK_RELEASE_REASONS } from "@/domain/order-stock-hold";

const verifiedReleaseReasons = [...VERIFIED_STOCK_RELEASE_REASONS];

/** Orders that may appear on the admin READY export list. */
export function orderPassesStockHoldExportFilter(): Prisma.OrderWhereInput {
  return {
    NOT: { stockHoldState: "WAITING_STOCK" },
    OR: [
      { stockReleasePolicy: { not: "HOLD_UNTIL_COMPLETE" } },
      {
        stockReleasePolicy: "HOLD_UNTIL_COMPLETE",
        stockHoldState: "READY_TO_EXPORT",
        stockReleasedAt: { not: null },
        stockReleaseReason: { in: verifiedReleaseReasons },
      },
    ],
  };
}

/** Orders the admin BLOCKED list should include because of the stock hold. */
export function orderBlockedByStockHoldFilter(): Prisma.OrderWhereInput {
  return {
    OR: [
      { stockHoldState: "WAITING_STOCK" },
      {
        stockReleasePolicy: "HOLD_UNTIL_COMPLETE",
        NOT: {
          stockHoldState: "READY_TO_EXPORT",
          stockReleasedAt: { not: null },
          stockReleaseReason: { in: verifiedReleaseReasons },
        },
      },
    ],
  };
}

export async function orderHasAutopartExportRecord(
  db: Prisma.TransactionClient | typeof prisma,
  order: {
    id: string;
    autopartExportStatus: string;
    autopartExportCount: number;
    autopartExportedAt: Date | null;
    autopartExportBatchId: string | null;
  },
): Promise<boolean> {
  if (order.autopartExportStatus !== "NOT_EXPORTED") return true;
  if (order.autopartExportCount > 0 || order.autopartExportedAt || order.autopartExportBatchId) {
    return true;
  }
  const batch = await db.autopartOrderExportBatch.findFirst({
    where: { orderIds: { array_contains: order.id } },
    select: { id: true },
  });
  return batch != null;
}
