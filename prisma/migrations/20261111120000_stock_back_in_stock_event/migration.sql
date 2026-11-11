-- Durable Autopart Avail 0→positive transitions for the admin Back in Stock dashboard.
CREATE TABLE IF NOT EXISTS "StockBackInStockEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT,
    "previousQty" INTEGER NOT NULL,
    "newQty" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockBackInStockEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockBackInStockEvent_runId_variantId_key"
  ON "StockBackInStockEvent"("runId", "variantId");

CREATE INDEX IF NOT EXISTS "StockBackInStockEvent_observedAt_idx"
  ON "StockBackInStockEvent"("observedAt" DESC);

CREATE INDEX IF NOT EXISTS "StockBackInStockEvent_variantId_observedAt_idx"
  ON "StockBackInStockEvent"("variantId", "observedAt" DESC);

CREATE INDEX IF NOT EXISTS "StockBackInStockEvent_productId_idx"
  ON "StockBackInStockEvent"("productId");

ALTER TABLE "StockBackInStockEvent"
  ADD CONSTRAINT "StockBackInStockEvent_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "StockSyncRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockBackInStockEvent"
  ADD CONSTRAINT "StockBackInStockEvent_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
