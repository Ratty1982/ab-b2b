-- Autopart product cost + usage intelligence from 231PO3NEW (internal only).

ALTER TABLE "StockSyncRun" ADD COLUMN "commercialJson" JSONB;

CREATE TABLE "AutopartProductCostPosition" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productVariantId" TEXT,
    "latestCost" DECIMAL(12,4) NOT NULL,
    "previousCost" DECIMAL(12,4),
    "firstObservedAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "lastChangedAt" TIMESTAMP(3),
    "sourceImportedAt" TIMESTAMP(3) NOT NULL,
    "sourceSyncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartProductCostPosition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopartProductCostPosition_sku_key" ON "AutopartProductCostPosition"("sku");
CREATE UNIQUE INDEX "AutopartProductCostPosition_productVariantId_key" ON "AutopartProductCostPosition"("productVariantId");
CREATE INDEX "AutopartProductCostPosition_lastChangedAt_idx" ON "AutopartProductCostPosition"("lastChangedAt");
CREATE INDEX "AutopartProductCostPosition_sourceSyncRunId_idx" ON "AutopartProductCostPosition"("sourceSyncRunId");

ALTER TABLE "AutopartProductCostPosition"
  ADD CONSTRAINT "AutopartProductCostPosition_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AutopartProductCostSnapshot" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productVariantId" TEXT,
    "businessDate" DATE NOT NULL,
    "latestCost" DECIMAL(12,4) NOT NULL,
    "sourceImportedAt" TIMESTAMP(3) NOT NULL,
    "sourceSyncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartProductCostSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopartProductCostSnapshot_sku_businessDate_key"
  ON "AutopartProductCostSnapshot"("sku", "businessDate");
CREATE INDEX "AutopartProductCostSnapshot_productVariantId_businessDate_idx"
  ON "AutopartProductCostSnapshot"("productVariantId", "businessDate");
CREATE INDEX "AutopartProductCostSnapshot_businessDate_idx"
  ON "AutopartProductCostSnapshot"("businessDate");
CREATE INDEX "AutopartProductCostSnapshot_sourceSyncRunId_idx"
  ON "AutopartProductCostSnapshot"("sourceSyncRunId");

ALTER TABLE "AutopartProductCostSnapshot"
  ADD CONSTRAINT "AutopartProductCostSnapshot_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AutopartProductUsageSnapshot" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productVariantId" TEXT,
    "businessDate" DATE NOT NULL,
    "stk" DECIMAL(14,4),
    "pickQty" DECIMAL(14,4),
    "physicalStk" DECIMAL(14,4),
    "ryr" DECIMAL(14,4),
    "curr" DECIMAL(14,4),
    "mth1" DECIMAL(14,4),
    "mth2" DECIMAL(14,4),
    "mth3" DECIMAL(14,4),
    "mth4" DECIMAL(14,4),
    "mth5" DECIMAL(14,4),
    "mth6" DECIMAL(14,4),
    "mth7" DECIMAL(14,4),
    "mth8" DECIMAL(14,4),
    "mth9" DECIMAL(14,4),
    "mth10" DECIMAL(14,4),
    "mth11" DECIMAL(14,4),
    "mth12" DECIMAL(14,4),
    "sourceImportedAt" TIMESTAMP(3) NOT NULL,
    "sourceSyncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartProductUsageSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopartProductUsageSnapshot_sku_businessDate_key"
  ON "AutopartProductUsageSnapshot"("sku", "businessDate");
CREATE INDEX "AutopartProductUsageSnapshot_productVariantId_businessDate_idx"
  ON "AutopartProductUsageSnapshot"("productVariantId", "businessDate");
CREATE INDEX "AutopartProductUsageSnapshot_businessDate_idx"
  ON "AutopartProductUsageSnapshot"("businessDate");
CREATE INDEX "AutopartProductUsageSnapshot_sourceSyncRunId_idx"
  ON "AutopartProductUsageSnapshot"("sourceSyncRunId");

ALTER TABLE "AutopartProductUsageSnapshot"
  ADD CONSTRAINT "AutopartProductUsageSnapshot_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
