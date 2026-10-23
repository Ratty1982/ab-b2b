-- Durable, resumable customer history confirmation.
-- Staging rows are not sales. Cutover and live history change only when publication commits.

CREATE TYPE "CustomerSalesHistoryJobStatus" AS ENUM ('QUEUED', 'STAGING', 'PUBLISHING', 'COMPLETE', 'FAILED');

CREATE TABLE "CustomerSalesHistoryJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "CustomerSalesHistoryJobStatus" NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT NOT NULL DEFAULT 'PLAN',
    "upload561lId" TEXT,
    "uploadSlrbId" TEXT,
    "sha256561l" TEXT,
    "sha256Slrb" TEXT,
    "filename561l" TEXT,
    "filenameSlrb" TEXT,
    "actorUserId" TEXT NOT NULL,
    "runnerToken" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "stageCursor" INTEGER NOT NULL DEFAULT 0,
    "rowsProcessed" INTEGER NOT NULL DEFAULT 0,
    "rowsStaged" INTEGER NOT NULL DEFAULT 0,
    "rowsStored" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "productLines" INTEGER NOT NULL DEFAULT 0,
    "supportingDocuments" INTEGER NOT NULL DEFAULT 0,
    "ledgerRows" INTEGER NOT NULL DEFAULT 0,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "otherCustomerRows" INTEGER NOT NULL DEFAULT 0,
    "countedFileRows" BOOLEAN NOT NULL DEFAULT false,
    "historyFrom" TIMESTAMP(3),
    "historyTo" TIMESTAMP(3),
    "historyStatus" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerSalesHistoryJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerSalesHistoryStage" (
    "jobId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "duplicate" BOOLEAN NOT NULL DEFAULT false,
    "documentType" TEXT NOT NULL,
    "documentReference" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "accountCode" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "units" DECIMAL(12,3),
    "salesNet" DECIMAL(12,2),
    "goodsNet" DECIMAL(12,2),
    "vat" DECIMAL(12,2),
    "grossTotal" DECIMAL(12,2),
    "documentDate" TIMESTAMP(3),
    "rawInvAndLn" TEXT,
    "source" TEXT NOT NULL,
    "matchedVariantId" TEXT,
    "matchStatus" TEXT,

    CONSTRAINT "CustomerSalesHistoryStage_pkey" PRIMARY KEY ("jobId","seq")
);

CREATE INDEX "CustomerSalesHistoryJob_companyId_status_idx" ON "CustomerSalesHistoryJob"("companyId", "status");
CREATE INDEX "CustomerSalesHistoryJob_upload561lId_idx" ON "CustomerSalesHistoryJob"("upload561lId");
CREATE INDEX "CustomerSalesHistoryJob_uploadSlrbId_idx" ON "CustomerSalesHistoryJob"("uploadSlrbId");
CREATE UNIQUE INDEX "CustomerSalesHistoryStage_identity_key"
  ON "CustomerSalesHistoryStage"("jobId", "kind", "documentType", "documentReference", "lineNumber", "fingerprint");
CREATE INDEX "CustomerSalesHistoryStage_jobId_kind_idx" ON "CustomerSalesHistoryStage"("jobId", "kind");

ALTER TABLE "CustomerSalesHistoryJob"
  ADD CONSTRAINT "CustomerSalesHistoryJob_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerSalesHistoryStage"
  ADD CONSTRAINT "CustomerSalesHistoryStage_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "CustomerSalesHistoryJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Repeated SKUs stay distinct because the fingerprint includes the source line.
-- Skip the index when older rows already share a fingerprint, so this migration can deploy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "AutopartSalesLine"
    WHERE "source" = '561L'
      AND "companyId" IS NOT NULL
      AND "sourceFingerprint" IS NOT NULL
    GROUP BY "companyId", "sourceFingerprint"
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "AutopartSalesLine_company_561l_fingerprint_uidx"
      ON "AutopartSalesLine" ("companyId", "sourceFingerprint")
      WHERE "source" = '561L' AND "companyId" IS NOT NULL AND "sourceFingerprint" IS NOT NULL;
  END IF;
END $$;
