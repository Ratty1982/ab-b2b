-- Ongoing 504 / TRM21QC import row diagnostics

CREATE TYPE "AutopartImportDiagnosticStatus" AS ENUM (
  'INSERTED',
  'UPDATED',
  'UNCHANGED',
  'SKIPPED',
  'WARNING',
  'ERROR'
);

CREATE TABLE "AutopartImportDiagnostic" (
  "id" TEXT NOT NULL,
  "importRunId" TEXT NOT NULL,
  "status" "AutopartImportDiagnosticStatus" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "rowNumber" INTEGER,
  "customerAccount" TEXT,
  "documentReference" TEXT,
  "documentDate" TEXT,
  "sku" TEXT,
  "description" TEXT,
  "quantity" TEXT,
  "salesNet" TEXT,
  "abOrderReference" TEXT,
  "customerOrderNumber" TEXT,
  "companyId" TEXT,
  "abOrderId" TEXT,
  "isWarning" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AutopartImportDiagnostic_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutopartImportDiagnostic_importRunId_status_idx"
  ON "AutopartImportDiagnostic"("importRunId", "status");
CREATE INDEX "AutopartImportDiagnostic_importRunId_reasonCode_idx"
  ON "AutopartImportDiagnostic"("importRunId", "reasonCode");
CREATE INDEX "AutopartImportDiagnostic_importRunId_documentReference_idx"
  ON "AutopartImportDiagnostic"("importRunId", "documentReference");
CREATE INDEX "AutopartImportDiagnostic_importRunId_customerAccount_idx"
  ON "AutopartImportDiagnostic"("importRunId", "customerAccount");
CREATE INDEX "AutopartImportDiagnostic_importRunId_sku_idx"
  ON "AutopartImportDiagnostic"("importRunId", "sku");
CREATE INDEX "AutopartImportDiagnostic_importRunId_isWarning_idx"
  ON "AutopartImportDiagnostic"("importRunId", "isWarning");

ALTER TABLE "AutopartImportDiagnostic"
  ADD CONSTRAINT "AutopartImportDiagnostic_importRunId_fkey"
  FOREIGN KEY ("importRunId") REFERENCES "AutopartCustomerImportRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
