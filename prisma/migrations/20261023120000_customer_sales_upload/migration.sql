-- Temporary streamed uploads for one customer's sales reports.
-- These rows are not imported sales. The sales reset does not read or delete them.

CREATE TYPE "CustomerSalesUploadRole" AS ENUM ('HISTORY_561L', 'HISTORY_SLRB', 'ONGOING');

CREATE TYPE "CustomerSalesUploadStatus" AS ENUM ('STORED', 'PREVIEWED', 'PROCESSING', 'COMMITTED', 'FAILED', 'EXPIRED');

CREATE TABLE "CustomerSalesUpload" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT,
    "role" "CustomerSalesUploadRole" NOT NULL,
    "status" "CustomerSalesUploadStatus" NOT NULL DEFAULT 'STORED',
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "accountCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSalesUpload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerSalesUpload_companyId_createdAt_idx" ON "CustomerSalesUpload"("companyId", "createdAt");

CREATE INDEX "CustomerSalesUpload_expiresAt_status_idx" ON "CustomerSalesUpload"("expiresAt", "status");

ALTER TABLE "CustomerSalesUpload"
  ADD CONSTRAINT "CustomerSalesUpload_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerSalesUpload"
  ADD CONSTRAINT "CustomerSalesUpload_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
