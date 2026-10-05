-- Purchasing Intelligence Phase 1: Incoming supply + purchasing settings.
-- Incoming is purchasing-only and must never be added to sellable Avail.

ALTER TABLE "Inventory" ADD COLUMN "incomingQty" INTEGER;
ALTER TABLE "Inventory" ADD COLUMN "sourceIncomingRaw" TEXT;

CREATE TABLE "PurchasingSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "defaultTargetCoverWeeks" DECIMAL(6,2) NOT NULL DEFAULT 8,
    "defaultSafetyStockQty" INTEGER NOT NULL DEFAULT 0,
    "criticalCoverWeeks" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "watchCoverWeeks" DECIMAL(6,2) NOT NULL DEFAULT 3,
    "overstockCoverWeeks" DECIMAL(6,2) NOT NULL DEFAULT 26,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchasingSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VariantPurchasingSettings" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
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

    CONSTRAINT "VariantPurchasingSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VariantPurchasingSettings_variantId_key" ON "VariantPurchasingSettings"("variantId");
CREATE INDEX "VariantPurchasingSettings_supplierName_idx" ON "VariantPurchasingSettings"("supplierName");

ALTER TABLE "VariantPurchasingSettings" ADD CONSTRAINT "VariantPurchasingSettings_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PurchasingPlanLine" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "plannedQty" INTEGER,
    "note" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchasingPlanLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchasingPlanLine_variantId_key" ON "PurchasingPlanLine"("variantId");

ALTER TABLE "PurchasingPlanLine" ADD CONSTRAINT "PurchasingPlanLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AutopartSalesDocument_documentDate_idx" ON "AutopartSalesDocument"("documentDate");
