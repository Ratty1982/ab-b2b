-- Additive live stock-change history for Autopart syncs.
-- Does not reset Inventory or alter previous Phase 5/5A tables.

CREATE TABLE "StockSyncChange" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "variantId" TEXT,
    "productId" TEXT,
    "skuSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "variantLabelSnapshot" TEXT,
    "previousQty" INTEGER NOT NULL,
    "newQty" INTEGER NOT NULL,
    "previousAvailability" TEXT NOT NULL,
    "newAvailability" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSyncChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockSyncChange_runId_idx" ON "StockSyncChange"("runId");
CREATE INDEX "StockSyncChange_variantId_idx" ON "StockSyncChange"("variantId");
CREATE INDEX "StockSyncChange_createdAt_idx" ON "StockSyncChange"("createdAt");

ALTER TABLE "StockSyncChange" ADD CONSTRAINT "StockSyncChange_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StockSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockSyncChange" ADD CONSTRAINT "StockSyncChange_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
