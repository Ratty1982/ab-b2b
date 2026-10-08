-- CreateEnum
CREATE TYPE "AutopartAccountClassification" AS ENUM ('TRADE_CANDIDATE', 'INTERNAL', 'CASH', 'STAFF', 'OBSOLETE', 'DO_NOT_USE', 'UNIDENTIFIED', 'REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "AutopartAccountClassificationSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "AutopartMasterImportKind" AS ENUM ('CUSTOMER_MASTER', 'INVOICE_LINES', 'LEDGER');

-- CreateEnum
CREATE TYPE "AutopartMasterImportStatus" AS ENUM ('UPLOADED', 'PREVIEWED', 'RUNNING', 'COMMITTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutopartImportIssueSeverity" AS ENUM ('ERROR', 'WARNING');

-- CreateEnum
CREATE TYPE "AutopartImportIssueResolution" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "AutopartLedgerKind" AS ENUM ('INVOICE', 'CREDIT', 'PAYMENT', 'JOURNAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AutopartDocumentMatchStatus" AS ENUM ('MATCHED', 'PARTIALLY_MATCHED', 'LEDGER_ONLY', 'PRODUCT_LINES_ONLY', 'AMOUNT_DISCREPANCY', 'AMBIGUOUS', 'REQUIRES_REVIEW');

-- CreateTable
CREATE TABLE "AutopartAccount" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'AUTOPART',
    "accountCode" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "nameTruncated" BOOLEAN NOT NULL DEFAULT false,
    "areaCode" TEXT,
    "repCode" TEXT,
    "classification" "AutopartAccountClassification" NOT NULL,
    "classificationSource" "AutopartAccountClassificationSource" NOT NULL DEFAULT 'AUTO',
    "classificationNote" TEXT,
    "companyId" TEXT,
    "portalEligible" BOOLEAN NOT NULL DEFAULT false,
    "historicalAccessEnabled" BOOLEAN NOT NULL DEFAULT false,
    "historicalAccessGrantedAt" TIMESTAMP(3),
    "historicalAccessGrantedById" TEXT,
    "historicalAccessRevokedAt" TIMESTAMP(3),
    "lastImportBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopartImportBatch" (
    "id" TEXT NOT NULL,
    "kind" "AutopartMasterImportKind" NOT NULL,
    "status" "AutopartMasterImportStatus" NOT NULL,
    "filename" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "storagePath" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "columnMap" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "rejectedRows" INTEGER NOT NULL DEFAULT 0,
    "unmatchedAccounts" INTEGER NOT NULL DEFAULT 0,
    "reconciliationStatus" TEXT,
    "errorSummary" TEXT,
    "diagnostics" JSONB,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopartImportIssue" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceRowNumber" INTEGER,
    "sourceRecordId" TEXT,
    "issueType" TEXT NOT NULL,
    "severity" "AutopartImportIssueSeverity" NOT NULL,
    "explanation" TEXT NOT NULL,
    "rawExcerpt" TEXT,
    "resolution" "AutopartImportIssueResolution" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopartImportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopartInvoiceLine" (
    "id" TEXT NOT NULL,
    "sourceIdentity" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountId" TEXT,
    "rawInvAndLn" TEXT NOT NULL,
    "documentReference" TEXT,
    "documentType" TEXT,
    "sourceLineNumber" INTEGER,
    "partNumber" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "salesAmount" DECIMAL(14,2) NOT NULL,
    "salesMeasure" TEXT NOT NULL DEFAULT 'NET_EX_VAT',
    "importBatchId" TEXT NOT NULL,
    "rawSource" JSONB NOT NULL,
    "parseIssue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopartLedgerTransaction" (
    "id" TEXT NOT NULL,
    "sourceIdentity" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountId" TEXT,
    "rawType" TEXT NOT NULL,
    "ledgerKind" "AutopartLedgerKind" NOT NULL,
    "reference" TEXT NOT NULL,
    "transactionDate" DATE,
    "goodsAmount" DECIMAL(14,2),
    "vatAmount" DECIMAL(14,2),
    "totalAmount" DECIMAL(14,2),
    "runningBalance" DECIMAL(14,2),
    "originalName" TEXT,
    "sacct" TEXT,
    "importBatchId" TEXT NOT NULL,
    "rawSource" JSONB NOT NULL,
    "parseIssue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartLedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopartDocumentMatch" (
    "id" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountId" TEXT,
    "documentReference" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "status" "AutopartDocumentMatchStatus" NOT NULL,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "lineSalesSum" DECIMAL(14,2),
    "ledgerGoods" DECIMAL(14,2),
    "ledgerCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartDocumentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutopartAccount_companyId_idx" ON "AutopartAccount"("companyId");

-- CreateIndex
CREATE INDEX "AutopartAccount_classification_idx" ON "AutopartAccount"("classification");

-- CreateIndex
CREATE INDEX "AutopartAccount_historicalAccessEnabled_idx" ON "AutopartAccount"("historicalAccessEnabled");

-- CreateIndex
CREATE INDEX "AutopartAccount_originalName_idx" ON "AutopartAccount"("originalName");

-- CreateIndex
CREATE UNIQUE INDEX "AutopartAccount_sourceSystem_accountCode_key" ON "AutopartAccount"("sourceSystem", "accountCode");

-- CreateIndex
CREATE INDEX "AutopartImportBatch_kind_status_createdAt_idx" ON "AutopartImportBatch"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AutopartImportBatch_fileHash_idx" ON "AutopartImportBatch"("fileHash");

-- CreateIndex
CREATE INDEX "AutopartImportIssue_batchId_severity_idx" ON "AutopartImportIssue"("batchId", "severity");

-- CreateIndex
CREATE INDEX "AutopartImportIssue_batchId_issueType_idx" ON "AutopartImportIssue"("batchId", "issueType");

-- CreateIndex
CREATE INDEX "AutopartImportIssue_sourceRecordId_idx" ON "AutopartImportIssue"("sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "AutopartInvoiceLine_sourceIdentity_key" ON "AutopartInvoiceLine"("sourceIdentity");

-- CreateIndex
CREATE INDEX "AutopartInvoiceLine_accountCode_idx" ON "AutopartInvoiceLine"("accountCode");

-- CreateIndex
CREATE INDEX "AutopartInvoiceLine_accountId_idx" ON "AutopartInvoiceLine"("accountId");

-- CreateIndex
CREATE INDEX "AutopartInvoiceLine_documentReference_idx" ON "AutopartInvoiceLine"("documentReference");

-- CreateIndex
CREATE INDEX "AutopartInvoiceLine_partNumber_idx" ON "AutopartInvoiceLine"("partNumber");

-- CreateIndex
CREATE INDEX "AutopartInvoiceLine_importBatchId_idx" ON "AutopartInvoiceLine"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "AutopartLedgerTransaction_sourceIdentity_key" ON "AutopartLedgerTransaction"("sourceIdentity");

-- CreateIndex
CREATE INDEX "AutopartLedgerTransaction_accountCode_idx" ON "AutopartLedgerTransaction"("accountCode");

-- CreateIndex
CREATE INDEX "AutopartLedgerTransaction_accountId_idx" ON "AutopartLedgerTransaction"("accountId");

-- CreateIndex
CREATE INDEX "AutopartLedgerTransaction_reference_idx" ON "AutopartLedgerTransaction"("reference");

-- CreateIndex
CREATE INDEX "AutopartLedgerTransaction_transactionDate_idx" ON "AutopartLedgerTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX "AutopartLedgerTransaction_ledgerKind_idx" ON "AutopartLedgerTransaction"("ledgerKind");

-- CreateIndex
CREATE INDEX "AutopartLedgerTransaction_importBatchId_idx" ON "AutopartLedgerTransaction"("importBatchId");

-- CreateIndex
CREATE INDEX "AutopartDocumentMatch_status_idx" ON "AutopartDocumentMatch"("status");

-- CreateIndex
CREATE INDEX "AutopartDocumentMatch_accountId_idx" ON "AutopartDocumentMatch"("accountId");

-- CreateIndex
CREATE INDEX "AutopartDocumentMatch_documentReference_idx" ON "AutopartDocumentMatch"("documentReference");

-- CreateIndex
CREATE UNIQUE INDEX "AutopartDocumentMatch_accountCode_documentType_documentRefe_key" ON "AutopartDocumentMatch"("accountCode", "documentType", "documentReference");

-- AddForeignKey
ALTER TABLE "AutopartAccount" ADD CONSTRAINT "AutopartAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopartAccount" ADD CONSTRAINT "AutopartAccount_historicalAccessGrantedById_fkey" FOREIGN KEY ("historicalAccessGrantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopartImportBatch" ADD CONSTRAINT "AutopartImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopartImportIssue" ADD CONSTRAINT "AutopartImportIssue_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AutopartImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopartImportIssue" ADD CONSTRAINT "AutopartImportIssue_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopartInvoiceLine" ADD CONSTRAINT "AutopartInvoiceLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AutopartAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopartInvoiceLine" ADD CONSTRAINT "AutopartInvoiceLine_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "AutopartImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopartLedgerTransaction" ADD CONSTRAINT "AutopartLedgerTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AutopartAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopartLedgerTransaction" ADD CONSTRAINT "AutopartLedgerTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "AutopartImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopartDocumentMatch" ADD CONSTRAINT "AutopartDocumentMatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AutopartAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopartDocumentMatch" ADD CONSTRAINT "AutopartDocumentMatch_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "AutopartImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

