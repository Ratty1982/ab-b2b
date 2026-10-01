-- Product Documents (SDS and future catalogue file types). Additive only.

CREATE TYPE "ProductDocumentType" AS ENUM (
  'SAFETY_DATA_SHEET',
  'TECHNICAL_DATA_SHEET',
  'INSTRUCTIONS',
  'CERTIFICATE',
  'DECLARATION',
  'FITTING_GUIDE',
  'OTHER'
);

CREATE TYPE "ProductDocumentStatus" AS ENUM (
  'CURRENT',
  'ARCHIVED'
);

CREATE TABLE "ProductDocument" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productVariantId" TEXT,
  "type" "ProductDocumentType" NOT NULL,
  "status" "ProductDocumentStatus" NOT NULL DEFAULT 'CURRENT',
  "title" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL DEFAULT 'database',
  "bytes" BYTEA,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "revision" TEXT,
  "documentDate" TIMESTAMP(3),
  "notes" TEXT,
  "sourceMetadata" JSONB,
  "uploadedById" TEXT,
  "archivedAt" TIMESTAMP(3),
  "archivedById" TEXT,
  "replacesDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductDocument_productId_type_status_idx"
  ON "ProductDocument"("productId", "type", "status");
CREATE INDEX "ProductDocument_productId_status_idx"
  ON "ProductDocument"("productId", "status");
CREATE INDEX "ProductDocument_checksumSha256_idx"
  ON "ProductDocument"("checksumSha256");
CREATE INDEX "ProductDocument_type_status_idx"
  ON "ProductDocument"("type", "status");
CREATE INDEX "ProductDocument_uploadedById_idx"
  ON "ProductDocument"("uploadedById");

ALTER TABLE "ProductDocument"
  ADD CONSTRAINT "ProductDocument_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
