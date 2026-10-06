-- Internal Autopart product/stock master (not B2B catalogue ProductVariant).
-- Catalogue link is optional and never auto-creates public products.

CREATE TABLE "AutopartProduct" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "description" TEXT,
    "availQty" INTEGER NOT NULL DEFAULT 0,
    "physicalQty" INTEGER,
    "incomingQty" INTEGER,
    "sourceAvailRaw" TEXT,
    "sourceIncomingRaw" TEXT,
    "latestCost" DECIMAL(12,4),
    "sourceUpdatedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "sourceSyncRunId" TEXT,
    "presentInLatestFeed" BOOLEAN NOT NULL DEFAULT true,
    "catalogueVariantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopartProduct_matchKey_key" ON "AutopartProduct"("matchKey");
CREATE UNIQUE INDEX "AutopartProduct_catalogueVariantId_key" ON "AutopartProduct"("catalogueVariantId");
CREATE INDEX "AutopartProduct_sku_idx" ON "AutopartProduct"("sku");
CREATE INDEX "AutopartProduct_catalogueVariantId_idx" ON "AutopartProduct"("catalogueVariantId");
CREATE INDEX "AutopartProduct_lastSeenAt_idx" ON "AutopartProduct"("lastSeenAt");
CREATE INDEX "AutopartProduct_presentInLatestFeed_idx" ON "AutopartProduct"("presentInLatestFeed");

ALTER TABLE "AutopartProduct"
  ADD CONSTRAINT "AutopartProduct_catalogueVariantId_fkey"
  FOREIGN KEY ("catalogueVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AutopartProductPurchasingSettings" (
    "id" TEXT NOT NULL,
    "autopartProductId" TEXT NOT NULL,
    "supplierName" TEXT,
    "supplierSku" TEXT,
    "leadTimeDays" INTEGER,
    "minimumOrderQty" INTEGER,
    "orderMultiple" INTEGER,
    "safetyStockQty" INTEGER,
    "targetCoverWeeks" DECIMAL(6,2),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartProductPurchasingSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopartProductPurchasingSettings_autopartProductId_key"
  ON "AutopartProductPurchasingSettings"("autopartProductId");
CREATE INDEX "AutopartProductPurchasingSettings_supplierName_idx"
  ON "AutopartProductPurchasingSettings"("supplierName");

ALTER TABLE "AutopartProductPurchasingSettings"
  ADD CONSTRAINT "AutopartProductPurchasingSettings_autopartProductId_fkey"
  FOREIGN KEY ("autopartProductId") REFERENCES "AutopartProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AutopartPurchasingPlanLine" (
    "id" TEXT NOT NULL,
    "autopartProductId" TEXT NOT NULL,
    "plannedQty" INTEGER,
    "note" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartPurchasingPlanLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopartPurchasingPlanLine_autopartProductId_key"
  ON "AutopartPurchasingPlanLine"("autopartProductId");

ALTER TABLE "AutopartPurchasingPlanLine"
  ADD CONSTRAINT "AutopartPurchasingPlanLine_autopartProductId_fkey"
  FOREIGN KEY ("autopartProductId") REFERENCES "AutopartProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deterministic backfill from current Autopart warehouse Inventory (real Avail / Incoming).
-- Do not invent stock from sales. External SKUs wait for the next 231PO3NEW apply.
INSERT INTO "AutopartProduct" (
  "id", "sku", "matchKey", "description", "availQty", "physicalQty", "incomingQty",
  "sourceAvailRaw", "sourceIncomingRaw", "latestCost", "sourceUpdatedAt",
  "firstSeenAt", "lastSeenAt", "sourceSyncRunId", "presentInLatestFeed",
  "catalogueVariantId", "createdAt", "updatedAt"
)
SELECT
  'ap_' || md5(v.id),
  v.sku,
  UPPER(btrim(v.sku)),
  p.name,
  i."qtyOnHand",
  NULL,
  i."incomingQty",
  i."sourceAvailRaw",
  i."sourceIncomingRaw",
  c."latestCost",
  i."externalSyncedAt",
  COALESCE(i."externalSyncedAt", i."updatedAt"),
  COALESCE(i."externalSyncedAt", i."updatedAt"),
  NULL,
  true,
  v.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Inventory" i
INNER JOIN "Warehouse" w ON w.id = i."warehouseId" AND w.code = 'AUTOPART'
INNER JOIN "ProductVariant" v ON v.id = i."variantId"
INNER JOIN "Product" p ON p.id = v."productId"
LEFT JOIN "AutopartProductCostPosition" c ON c."productVariantId" = v.id
ON CONFLICT ("matchKey") DO NOTHING;
