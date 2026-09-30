-- Ongoing Autopart 504 + TRM21QC sales feeds (additive; 504C retained).
-- Keep company-scoped document uniqueness — historic DB may contain the same
-- Autopart documentReference under more than one companyId.

ALTER TYPE "AutopartCustomerImportType" ADD VALUE IF NOT EXISTS 'ONGOING_504';
ALTER TYPE "AutopartCustomerImportType" ADD VALUE IF NOT EXISTS 'ONGOING_TRM21QC';

DO $$ BEGIN
  CREATE TYPE "AutopartSalesReconciliationStatus" AS ENUM (
    'AWAITING_504',
    'AWAITING_LINES',
    'MATCHED',
    'VALUE_MISMATCH',
    'UNKNOWN_DOCUMENT_TYPE',
    'COMPLETE',
    'UNMAPPED_CUSTOMER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Optional company for unmatched ongoing docs only (historic rows remain populated).
ALTER TABLE "AutopartSalesDocument" ALTER COLUMN "companyId" DROP NOT NULL;

ALTER TABLE "AutopartSalesDocument"
  ADD COLUMN IF NOT EXISTS "reconciliationStatus" "AutopartSalesReconciliationStatus",
  ADD COLUMN IF NOT EXISTS "abOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "abOrderNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "has504" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hasTrm21qc" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "customerOrderNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "customerNameSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "initialsSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "reportType504" TEXT,
  ADD COLUMN IF NOT EXISTS "linesNetSum" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "valueMismatchMinor" INTEGER;

CREATE INDEX IF NOT EXISTS "AutopartSalesDocument_reconciliationStatus_idx"
  ON "AutopartSalesDocument" ("reconciliationStatus");
CREATE INDEX IF NOT EXISTS "AutopartSalesDocument_abOrderNumber_idx"
  ON "AutopartSalesDocument" ("abOrderNumber");
CREATE INDEX IF NOT EXISTS "AutopartSalesDocument_has504_hasTrm21qc_idx"
  ON "AutopartSalesDocument" ("has504", "hasTrm21qc");

-- Partial unique: ongoing Autopart document numbers are globally unique in MAM.
CREATE UNIQUE INDEX IF NOT EXISTS "AutopartSalesDocument_ongoing_doc_uidx"
  ON "AutopartSalesDocument" ("documentType", "documentReference")
  WHERE "has504" = true OR "hasTrm21qc" = true;

ALTER TABLE "AutopartSalesLine"
  ADD COLUMN IF NOT EXISTS "sourceFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceCost" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "sourceMargin" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "sourcePerc" DECIMAL(8,3);

CREATE INDEX IF NOT EXISTS "AutopartSalesLine_sourceFingerprint_idx"
  ON "AutopartSalesLine" ("sourceFingerprint");

CREATE TABLE IF NOT EXISTS "AutopartOngoingSalesFeedSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "configured" BOOLEAN NOT NULL DEFAULT false,
  "scheduleHoursJson" TEXT NOT NULL DEFAULT '[13,18]',
  "workingDaysOnly" BOOLEAN NOT NULL DEFAULT true,
  "allowedSender" TEXT,
  "filenamePattern504" TEXT NOT NULL DEFAULT '*504*',
  "filenamePatternTrm21qc" TEXT NOT NULL DEFAULT '*TRM21QC*',
  "excludeFilenamePattern504c" TEXT NOT NULL DEFAULT '*504C*',
  "lastPolledAt" TIMESTAMP(3),
  "lastSuccess504At" TIMESTAMP(3),
  "lastSuccessTrm21qcAt" TIMESTAMP(3),
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" TEXT,
  CONSTRAINT "AutopartOngoingSalesFeedSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AutopartOngoingSalesFeedSettings" ("id")
VALUES ('default')
ON CONFLICT ("id") DO NOTHING;
