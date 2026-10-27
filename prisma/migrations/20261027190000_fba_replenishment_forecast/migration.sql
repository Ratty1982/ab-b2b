-- Amazon FBA UK replenishment ledger and forecast settings.
-- Separate from AutopartSalesDocument. Does not change 504/TRM financial rows.

CREATE TABLE "FbaReplenishmentImport" (
    "id" TEXT NOT NULL,
    "filename504" TEXT NOT NULL,
    "filenameTrm" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "actorUserId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "exceptionCount" INTEGER NOT NULL DEFAULT 0,
    "exceptions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FbaReplenishmentImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FbaReplenishmentImport_fileHash_key" ON "FbaReplenishmentImport"("fileHash");
CREATE INDEX "FbaReplenishmentImport_importedAt_idx" ON "FbaReplenishmentImport"("importedAt");

CREATE TABLE "FbaReplenishmentDocument" (
    "id" TEXT NOT NULL,
    "importId" TEXT,
    "documentReference" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentDate" DATE,
    "customerAccount" TEXT NOT NULL DEFAULT '',
    "customerName" TEXT NOT NULL DEFAULT '',
    "goodsNet" DECIMAL(12,2),
    "sourceFileHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FbaReplenishmentDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FbaReplenishmentDocument_documentReference_documentType_key" ON "FbaReplenishmentDocument"("documentReference", "documentType");
CREATE INDEX "FbaReplenishmentDocument_documentDate_idx" ON "FbaReplenishmentDocument"("documentDate");
CREATE INDEX "FbaReplenishmentDocument_importId_idx" ON "FbaReplenishmentDocument"("importId");

ALTER TABLE "FbaReplenishmentDocument"
  ADD CONSTRAINT "FbaReplenishmentDocument_importId_fkey"
  FOREIGN KEY ("importId") REFERENCES "FbaReplenishmentImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FbaReplenishmentLine" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "description" TEXT,
    "qty" DECIMAL(14,4) NOT NULL,
    "salesNet" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FbaReplenishmentLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FbaReplenishmentLine_documentId_lineKey_key" ON "FbaReplenishmentLine"("documentId", "lineKey");
CREATE INDEX "FbaReplenishmentLine_matchKey_idx" ON "FbaReplenishmentLine"("matchKey");

ALTER TABLE "FbaReplenishmentLine"
  ADD CONSTRAINT "FbaReplenishmentLine_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "FbaReplenishmentDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FbaAmazonSalesImport" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "actorUserId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "marketplace" TEXT NOT NULL DEFAULT 'AMAZON_UK',
    "completeDaily" BOOLEAN NOT NULL DEFAULT false,
    "coverageFrom" DATE,
    "coverageTo" DATE,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FbaAmazonSalesImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FbaAmazonSalesImport_fileHash_key" ON "FbaAmazonSalesImport"("fileHash");
CREATE INDEX "FbaAmazonSalesImport_importedAt_idx" ON "FbaAmazonSalesImport"("importedAt");

CREATE TABLE "FbaAmazonSalesLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "saleDate" DATE NOT NULL,
    "unitsSold" DECIMAL(14,4) NOT NULL,
    "unitsCredited" DECIMAL(14,4) NOT NULL,
    "marketplace" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FbaAmazonSalesLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FbaAmazonSalesLine_importId_matchKey_saleDate_marketplace_key" ON "FbaAmazonSalesLine"("importId", "matchKey", "saleDate", "marketplace");
CREATE INDEX "FbaAmazonSalesLine_matchKey_saleDate_idx" ON "FbaAmazonSalesLine"("matchKey", "saleDate");

ALTER TABLE "FbaAmazonSalesLine"
  ADD CONSTRAINT "FbaAmazonSalesLine_importId_fkey"
  FOREIGN KEY ("importId") REFERENCES "FbaAmazonSalesImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FbaInboundShipment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FbaInboundShipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FbaInboundShipment_reference_matchKey_key" ON "FbaInboundShipment"("reference", "matchKey");
CREATE INDEX "FbaInboundShipment_matchKey_status_idx" ON "FbaInboundShipment"("matchKey", "status");

CREATE TABLE "FbaForecastSettings" (
    "id" TEXT NOT NULL,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 14,
    "targetCoverWeeks" DECIMAL(6,2) NOT NULL DEFAULT 6,
    "safetyStockQty" INTEGER NOT NULL DEFAULT 0,
    "caseMultiple" INTEGER,
    "overstockCoverWeeks" DECIMAL(6,2) NOT NULL DEFAULT 16,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FbaForecastSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FbaSkuForecastOverride" (
    "id" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "leadTimeDays" INTEGER,
    "targetCoverWeeks" DECIMAL(6,2),
    "safetyStockQty" INTEGER,
    "caseMultiple" INTEGER,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FbaSkuForecastOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FbaSkuForecastOverride_matchKey_key" ON "FbaSkuForecastOverride"("matchKey");
