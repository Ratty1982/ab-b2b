-- Autopart 216V backorder intelligence (current outstanding position + daily history).

CREATE TYPE "AutopartBackorderChangeStatus" AS ENUM ('NEW', 'UNCHANGED', 'QUANTITY_REDUCED', 'QUANTITY_INCREASED', 'CLEARED');
CREATE TYPE "AutopartBackorderSnapshotStatus" AS ENUM ('COMMITTED', 'FAILED');

CREATE TABLE "AutopartBackorderFeedSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configured" BOOLEAN NOT NULL DEFAULT false,
    "scheduleHour" INTEGER NOT NULL DEFAULT 18,
    "workingDaysOnly" BOOLEAN NOT NULL DEFAULT true,
    "allowedSender" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "AutopartBackorderFeedSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopartBackorderSnapshot" (
    "id" TEXT NOT NULL,
    "status" "AutopartBackorderSnapshotStatus" NOT NULL,
    "filename" TEXT,
    "fileHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'EMAIL',
    "businessDate" DATE NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "outstandingLineCount" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "accountCount" INTEGER NOT NULL DEFAULT 0,
    "skuCount" INTEGER NOT NULL DEFAULT 0,
    "outstandingQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "outstandingValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "emptyValid" BOOLEAN NOT NULL DEFAULT false,
    "previousSnapshotId" TEXT,
    "createdById" TEXT,
    "diagnostics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopartBackorderSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopartBackorderSnapshot_fileHash_key" ON "AutopartBackorderSnapshot"("fileHash");
CREATE INDEX "AutopartBackorderSnapshot_status_importedAt_idx" ON "AutopartBackorderSnapshot"("status", "importedAt");
CREATE INDEX "AutopartBackorderSnapshot_businessDate_idx" ON "AutopartBackorderSnapshot"("businessDate");

CREATE TABLE "AutopartBackorderLine" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerAccount" TEXT NOT NULL,
    "customerNameSnapshot" TEXT NOT NULL,
    "customerOrderRef" TEXT NOT NULL DEFAULT '',
    "partNumber" TEXT NOT NULL,
    "partMatchKey" TEXT NOT NULL,
    "descriptionSnapshot" TEXT NOT NULL,
    "outstandingQty" DECIMAL(14,4) NOT NULL,
    "unitValue" DECIMAL(12,4),
    "outstandingValue" DECIMAL(12,2),
    "changeStatus" "AutopartBackorderChangeStatus" NOT NULL,
    "previousQty" DECIMAL(14,4),
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastChangedAt" TIMESTAMP(3) NOT NULL,
    "lineNumberInFile" INTEGER NOT NULL,
    "companyId" TEXT,
    "autopartProductId" TEXT,

    CONSTRAINT "AutopartBackorderLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutopartBackorderLine_snapshotId_changeStatus_idx" ON "AutopartBackorderLine"("snapshotId", "changeStatus");
CREATE INDEX "AutopartBackorderLine_identityKey_idx" ON "AutopartBackorderLine"("identityKey");
CREATE INDEX "AutopartBackorderLine_partMatchKey_idx" ON "AutopartBackorderLine"("partMatchKey");
CREATE INDEX "AutopartBackorderLine_customerAccount_idx" ON "AutopartBackorderLine"("customerAccount");
CREATE INDEX "AutopartBackorderLine_orderNumber_idx" ON "AutopartBackorderLine"("orderNumber");
CREATE INDEX "AutopartBackorderLine_companyId_idx" ON "AutopartBackorderLine"("companyId");
CREATE INDEX "AutopartBackorderLine_autopartProductId_idx" ON "AutopartBackorderLine"("autopartProductId");

ALTER TABLE "AutopartBackorderLine"
  ADD CONSTRAINT "AutopartBackorderLine_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "AutopartBackorderSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AutopartBackorderLine"
  ADD CONSTRAINT "AutopartBackorderLine_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutopartBackorderLine"
  ADD CONSTRAINT "AutopartBackorderLine_autopartProductId_fkey"
  FOREIGN KEY ("autopartProductId") REFERENCES "AutopartProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
