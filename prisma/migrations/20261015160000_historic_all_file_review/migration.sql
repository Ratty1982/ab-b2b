-- Staging for accounts in a 561L-ALL / SLRB-ALL pair that are not yet verified.
-- Certified sales stay on AutopartSalesDocument and AutopartSalesLine.
-- These tables are not read by Sales Intelligence.

CREATE TYPE "AutopartHistoryReviewReason" AS ENUM ('UNKNOWN', 'AMBIGUOUS', 'UNLINKED', 'NOT_VERIFIED');
CREATE TYPE "AutopartHistoryReviewStatus" AS ENUM ('OPEN', 'APPLIED', 'SUPERSEDED');

CREATE TABLE "AutopartHistoryAllImport" (
  "id" TEXT NOT NULL,
  "status" "AutopartCustomerImportStatus" NOT NULL,
  "filename561l" TEXT,
  "filenameSlrb" TEXT,
  "fileHash561l" TEXT NOT NULL,
  "fileHashSlrb" TEXT,
  "fileBody561l" BYTEA,
  "fileBodySlrb" BYTEA,
  "accountsRead" INTEGER NOT NULL DEFAULT 0,
  "accountsCommitted" INTEGER NOT NULL DEFAULT 0,
  "accountsReviewed" INTEGER NOT NULL DEFAULT 0,
  "documentsWritten" INTEGER NOT NULL DEFAULT 0,
  "linesWritten" INTEGER NOT NULL DEFAULT 0,
  "summary" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AutopartHistoryAllImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopartHistoryReviewAccount" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "accountCode" TEXT NOT NULL,
  "reason" "AutopartHistoryReviewReason" NOT NULL,
  "status" "AutopartHistoryReviewStatus" NOT NULL DEFAULT 'OPEN',
  "companyId" TEXT,
  "invoiceDocuments" INTEGER NOT NULL DEFAULT 0,
  "creditDocuments" INTEGER NOT NULL DEFAULT 0,
  "ledgerRows" INTEGER NOT NULL DEFAULT 0,
  "lineCount" INTEGER NOT NULL DEFAULT 0,
  "lineNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "goodsNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "warnings" JSONB,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutopartHistoryReviewAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopartHistoryStagedDocument" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "accountCode" TEXT NOT NULL,
  "documentType" "AutopartHistoricDocumentType" NOT NULL,
  "documentReference" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3),
  "goodsNet" DECIMAL(14,2),
  "vat" DECIMAL(14,2),
  "grossTotal" DECIMAL(14,2),
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutopartHistoryStagedDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopartHistoryStagedLine" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "accountCode" TEXT NOT NULL,
  "documentType" "AutopartHistoricDocumentType" NOT NULL,
  "documentReference" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "sku" TEXT NOT NULL,
  "descriptionSnapshot" TEXT,
  "units" DECIMAL(14,3) NOT NULL,
  "salesNet" DECIMAL(14,2) NOT NULL,
  "rawInvAndLn" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutopartHistoryStagedLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutopartHistoryAllImport_status_createdAt_idx" ON "AutopartHistoryAllImport"("status", "createdAt");
CREATE INDEX "AutopartHistoryAllImport_fileHash561l_fileHashSlrb_idx" ON "AutopartHistoryAllImport"("fileHash561l", "fileHashSlrb");
CREATE UNIQUE INDEX "AutopartHistoryReviewAccount_importId_accountCode_key" ON "AutopartHistoryReviewAccount"("importId", "accountCode");
CREATE INDEX "AutopartHistoryReviewAccount_accountCode_status_idx" ON "AutopartHistoryReviewAccount"("accountCode", "status");
CREATE INDEX "AutopartHistoryReviewAccount_status_createdAt_idx" ON "AutopartHistoryReviewAccount"("status", "createdAt");
CREATE UNIQUE INDEX "AutopartHistoryStagedDocument_importId_accountCode_document_key" ON "AutopartHistoryStagedDocument"("importId", "accountCode", "documentType", "documentReference");
CREATE INDEX "AutopartHistoryStagedDocument_accountCode_documentReference_idx" ON "AutopartHistoryStagedDocument"("accountCode", "documentReference");
CREATE UNIQUE INDEX "AutopartHistoryStagedLine_importId_accountCode_documentType_key" ON "AutopartHistoryStagedLine"("importId", "accountCode", "documentType", "documentReference", "lineNumber");
CREATE INDEX "AutopartHistoryStagedLine_accountCode_documentReference_idx" ON "AutopartHistoryStagedLine"("accountCode", "documentReference");

ALTER TABLE "AutopartHistoryAllImport" ADD CONSTRAINT "AutopartHistoryAllImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopartHistoryReviewAccount" ADD CONSTRAINT "AutopartHistoryReviewAccount_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AutopartHistoryAllImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutopartHistoryReviewAccount" ADD CONSTRAINT "AutopartHistoryReviewAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopartHistoryStagedDocument" ADD CONSTRAINT "AutopartHistoryStagedDocument_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AutopartHistoryAllImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutopartHistoryStagedLine" ADD CONSTRAINT "AutopartHistoryStagedLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AutopartHistoryAllImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
