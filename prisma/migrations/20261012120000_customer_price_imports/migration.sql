-- Customer-specific trade price upload batches.
-- Stores validated rows for approval. Raw spreadsheets are not stored.

CREATE TYPE "CustomerPriceImportStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

CREATE TYPE "CustomerPriceImportAction" AS ENUM ('NEW', 'UPDATE', 'UNCHANGED', 'INVALID');

CREATE TABLE "CustomerPriceImport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "CustomerPriceImportStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "productsFound" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "updateCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "rowFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPriceImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerPriceImportLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "variantId" TEXT,
    "productName" TEXT,
    "action" "CustomerPriceImportAction" NOT NULL,
    "proposedPrice" DECIMAL(12,4),
    "existingPrice" DECIMAL(12,4),
    "normalPrice" DECIMAL(12,4),
    "percentChange" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "existingStartsAt" TIMESTAMP(3),
    "existingEndsAt" TIMESTAMP(3),
    "existingUpdatedAt" TIMESTAMP(3),
    "messages" JSONB NOT NULL,

    CONSTRAINT "CustomerPriceImportLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerPriceImport_companyId_createdAt_idx" ON "CustomerPriceImport"("companyId", "createdAt");

CREATE INDEX "CustomerPriceImport_companyId_status_rowFingerprint_idx" ON "CustomerPriceImport"("companyId", "status", "rowFingerprint");

CREATE UNIQUE INDEX "CustomerPriceImport_one_pending_fingerprint" ON "CustomerPriceImport"("companyId", "rowFingerprint") WHERE "status" = 'PENDING_APPROVAL';

CREATE INDEX "CustomerPriceImport_status_idx" ON "CustomerPriceImport"("status");

CREATE INDEX "CustomerPriceImportLine_importId_idx" ON "CustomerPriceImportLine"("importId");

CREATE INDEX "CustomerPriceImportLine_variantId_idx" ON "CustomerPriceImportLine"("variantId");

ALTER TABLE "CustomerPriceImport" ADD CONSTRAINT "CustomerPriceImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPriceImport" ADD CONSTRAINT "CustomerPriceImport_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerPriceImport" ADD CONSTRAINT "CustomerPriceImport_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerPriceImportLine" ADD CONSTRAINT "CustomerPriceImportLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CustomerPriceImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPriceImportLine" ADD CONSTRAINT "CustomerPriceImportLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
