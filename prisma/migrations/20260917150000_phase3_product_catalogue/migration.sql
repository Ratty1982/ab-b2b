-- Phase 3 product master: status, commercial/physical fields, media join, import jobs.
-- Additive and backfill-safe against Phase 2 databases that already have Product/ProductVariant.

CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'DISCONTINUED');
CREATE TYPE "ProductImportStatus" AS ENUM ('UPLOADED', 'READY', 'APPLIED', 'FAILED');

ALTER TABLE "Category"
  ADD COLUMN "imageMediaId" TEXT,
  ADD COLUMN "imageAlt" TEXT;

ALTER TABLE "Product"
  ADD COLUMN "shortDescription" TEXT,
  ADD COLUMN "specifications" JSONB,
  ADD COLUMN "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "isTradeVisible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isNew" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "metaTitle" TEXT,
  ADD COLUMN "metaDescription" TEXT;

UPDATE "Product" SET "status" = CASE WHEN "isActive" THEN 'ACTIVE'::"ProductStatus" ELSE 'INACTIVE'::"ProductStatus" END;

ALTER TABLE "ProductVariant"
  ADD COLUMN "mpn" TEXT,
  ADD COLUMN "minOrderQty" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "orderIncrement" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'EA',
  ADD COLUMN "lengthMm" DECIMAL(10,2),
  ADD COLUMN "widthMm" DECIMAL(10,2),
  ADD COLUMN "heightMm" DECIMAL(10,2),
  ADD COLUMN "tradePrice" DECIMAL(12,4),
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "ProductMedia" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "altText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductImportJob" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "status" "ProductImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB NOT NULL,
    "unknownBrands" JSONB,
    "unknownCategories" JSONB,
    "preview" JSONB,
    "result" JSONB,
    "errorReport" TEXT,
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "ProductImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Brand_isActive_sortOrder_idx" ON "Brand"("isActive", "sortOrder");

CREATE INDEX "Category_imageMediaId_idx" ON "Category"("imageMediaId");
CREATE INDEX "Category_isActive_sortOrder_idx" ON "Category"("isActive", "sortOrder");

CREATE INDEX "Product_status_isTradeVisible_idx" ON "Product"("status", "isTradeVisible");
CREATE INDEX "Product_updatedAt_idx" ON "Product"("updatedAt");
CREATE INDEX "Product_isFeatured_idx" ON "Product"("isFeatured");
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");

CREATE INDEX "ProductVariant_barcode_idx" ON "ProductVariant"("barcode");
CREATE INDEX "ProductVariant_mpn_idx" ON "ProductVariant"("mpn");

CREATE UNIQUE INDEX "ProductMedia_productId_mediaId_key" ON "ProductMedia"("productId", "mediaId");
CREATE INDEX "ProductMedia_productId_sortOrder_idx" ON "ProductMedia"("productId", "sortOrder");
CREATE INDEX "ProductMedia_mediaId_idx" ON "ProductMedia"("mediaId");

CREATE INDEX "ProductImportJob_createdAt_idx" ON "ProductImportJob"("createdAt");
CREATE INDEX "ProductImportJob_uploadedById_idx" ON "ProductImportJob"("uploadedById");
CREATE INDEX "ProductImportJob_status_idx" ON "ProductImportJob"("status");

ALTER TABLE "Category" ADD CONSTRAINT "Category_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "CmsMedia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "CmsMedia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductImportJob" ADD CONSTRAINT "ProductImportJob_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Copy existing minQty=1 quantity breaks onto variant.tradePrice when unset.
UPDATE "ProductVariant" AS v
SET "tradePrice" = qb."unitPrice"
FROM "QuantityBreak" AS qb
WHERE qb."variantId" = v.id
  AND qb."minQty" = 1
  AND v."tradePrice" IS NULL;
