import { prisma } from "@/infra/database/client";
import { STOCK_SYNC_MUTEX_ID } from "@/domain/stock";

export async function tryAcquireStockSyncLock(holder: string): Promise<boolean> {
  await prisma.$executeRaw`
    INSERT INTO "StockSyncMutex" ("id")
    VALUES (${STOCK_SYNC_MUTEX_ID})
    ON CONFLICT ("id") DO NOTHING
  `;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "StockSyncMutex"
    SET "holder" = ${holder}, "lockedAt" = NOW()
    WHERE "id" = ${STOCK_SYNC_MUTEX_ID}
      AND (
        "holder" IS NULL
        OR "lockedAt" < NOW() - INTERVAL '45 minutes'
      )
    RETURNING "id"
  `;
  if (!rows[0]) return false;
  await prisma.stockSyncRun.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - 45 * 60 * 1000) },
    },
    data: {
      status: "FAILED",
      errorSummary: "Previous sync exceeded the lock timeout",
      completedAt: new Date(),
    },
  });
  return true;
}

export async function releaseStockSyncLock(holder: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "StockSyncMutex"
    SET "holder" = NULL, "lockedAt" = NULL
    WHERE "id" = ${STOCK_SYNC_MUTEX_ID} AND "holder" = ${holder}
  `;
}
