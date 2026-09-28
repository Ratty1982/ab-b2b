-- Autopart customer historic purchases (561L/SLRB) + current credit (407P100).
-- Separate from AB Order / Invoice / accounting ledger.

CREATE TYPE "AutopartHistoricDocumentType" AS ENUM ('INVOICE', 'CREDIT', 'PAYMENT', 'JOURNAL', 'UNKNOWN');
CREATE TYPE "AutopartHistoricLineMatchStatus" AS ENUM ('MATCHED', 'NOT_IN_AB_CATALOGUE');
CREATE TYPE "AutopartCustomerImportType" AS ENUM ('HISTORY_561L_SLRB', 'CREDIT_407P100');
CREATE TYPE "AutopartCustomerImportStatus" AS ENUM ('PREVIEWED', 'COMMITTED', 'FAILED', 'BLOCKED');

CREATE TABLE "AutopartCustomerAccountAlias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "verifiedById" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopartCustomerAccountAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopartCustomerImportRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "AutopartCustomerImportType" NOT NULL,
    "status" "AutopartCustomerImportStatus" NOT NULL,
    "filename" TEXT,
    "filenameSlrb" TEXT,
    "fileHash" TEXT,
    "fileHashSlrb" TEXT,
    "detectedAccount" TEXT,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsValid" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rowsUnmatched" INTEGER NOT NULL DEFAULT 0,
    "issues" JSONB,
    "diagnostics" JSONB,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AutopartCustomerImportRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopartSalesDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "autopartCustomerCode" TEXT NOT NULL,
    "documentType" "AutopartHistoricDocumentType" NOT NULL,
    "documentReference" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3),
    "goodsNet" DECIMAL(12,2),
    "vat" DECIMAL(12,2),
    "grossTotal" DECIMAL(12,2),
    "source" TEXT NOT NULL DEFAULT 'SLRB',
    "importRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartSalesDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopartSalesLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT,
    "autopartCustomerCode" TEXT NOT NULL,
    "documentType" "AutopartHistoricDocumentType" NOT NULL,
    "documentReference" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "descriptionSnapshot" TEXT,
    "units" DECIMAL(12,3) NOT NULL,
    "salesNet" DECIMAL(12,2) NOT NULL,
    "matchedVariantId" TEXT,
    "matchStatus" "AutopartHistoricLineMatchStatus" NOT NULL DEFAULT 'NOT_IN_AB_CATALOGUE',
    "rawInvAndLn" TEXT,
    "source" TEXT NOT NULL DEFAULT '561L',
    "importRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartSalesLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopartCreditPosition" (
    "companyId" TEXT NOT NULL,
    "autopartCustomerCode" TEXT NOT NULL,
    "invoices" DECIMAL(12,2) NOT NULL,
    "picking" DECIMAL(12,2) NOT NULL,
    "dropShip" DECIMAL(12,2) NOT NULL,
    "crossDock" DECIMAL(12,2) NOT NULL,
    "suspends" DECIMAL(12,2) NOT NULL,
    "unConsol" DECIMAL(12,2) NOT NULL,
    "totalExposure" DECIMAL(12,2) NOT NULL,
    "creditLimit" DECIMAL(12,2) NOT NULL,
    "availableCreditRaw" DECIMAL(12,2) NOT NULL,
    "sourceReport" TEXT NOT NULL DEFAULT '407P100',
    "sourceImportedAt" TIMESTAMP(3) NOT NULL,
    "sourceImportRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartCreditPosition_pkey" PRIMARY KEY ("companyId")
);

CREATE UNIQUE INDEX "AutopartCustomerAccountAlias_companyId_alias_key" ON "AutopartCustomerAccountAlias"("companyId", "alias");
CREATE INDEX "AutopartCustomerAccountAlias_alias_idx" ON "AutopartCustomerAccountAlias"("alias");

CREATE INDEX "AutopartCustomerImportRun_companyId_createdAt_idx" ON "AutopartCustomerImportRun"("companyId", "createdAt");
CREATE INDEX "AutopartCustomerImportRun_companyId_type_status_idx" ON "AutopartCustomerImportRun"("companyId", "type", "status");
CREATE INDEX "AutopartCustomerImportRun_fileHash_idx" ON "AutopartCustomerImportRun"("fileHash");

CREATE UNIQUE INDEX "AutopartSalesDocument_companyId_documentType_documentReference_key" ON "AutopartSalesDocument"("companyId", "documentType", "documentReference");
CREATE INDEX "AutopartSalesDocument_companyId_documentDate_idx" ON "AutopartSalesDocument"("companyId", "documentDate");
CREATE INDEX "AutopartSalesDocument_autopartCustomerCode_idx" ON "AutopartSalesDocument"("autopartCustomerCode");
CREATE INDEX "AutopartSalesDocument_documentReference_idx" ON "AutopartSalesDocument"("documentReference");

CREATE UNIQUE INDEX "AutopartSalesLine_companyId_documentType_documentReference_lineNumber_key" ON "AutopartSalesLine"("companyId", "documentType", "documentReference", "lineNumber");
CREATE INDEX "AutopartSalesLine_companyId_sku_idx" ON "AutopartSalesLine"("companyId", "sku");
CREATE INDEX "AutopartSalesLine_matchedVariantId_idx" ON "AutopartSalesLine"("matchedVariantId");
CREATE INDEX "AutopartSalesLine_autopartCustomerCode_idx" ON "AutopartSalesLine"("autopartCustomerCode");
CREATE INDEX "AutopartSalesLine_documentReference_idx" ON "AutopartSalesLine"("documentReference");

CREATE INDEX "AutopartCreditPosition_autopartCustomerCode_idx" ON "AutopartCreditPosition"("autopartCustomerCode");
CREATE INDEX "AutopartCreditPosition_sourceImportedAt_idx" ON "AutopartCreditPosition"("sourceImportedAt");

ALTER TABLE "AutopartCustomerAccountAlias" ADD CONSTRAINT "AutopartCustomerAccountAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutopartCustomerAccountAlias" ADD CONSTRAINT "AutopartCustomerAccountAlias_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutopartCustomerImportRun" ADD CONSTRAINT "AutopartCustomerImportRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutopartCustomerImportRun" ADD CONSTRAINT "AutopartCustomerImportRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutopartSalesDocument" ADD CONSTRAINT "AutopartSalesDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutopartSalesDocument" ADD CONSTRAINT "AutopartSalesDocument_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "AutopartCustomerImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutopartSalesLine" ADD CONSTRAINT "AutopartSalesLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutopartSalesLine" ADD CONSTRAINT "AutopartSalesLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AutopartSalesDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopartSalesLine" ADD CONSTRAINT "AutopartSalesLine_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "AutopartCustomerImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutopartCreditPosition" ADD CONSTRAINT "AutopartCreditPosition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutopartCreditPosition" ADD CONSTRAINT "AutopartCreditPosition_sourceImportRunId_fkey" FOREIGN KEY ("sourceImportRunId") REFERENCES "AutopartCustomerImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
