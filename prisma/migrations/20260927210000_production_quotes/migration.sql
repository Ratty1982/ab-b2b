-- Production B2B Quotes lifecycle

-- QuoteStatus: DECLINED + CONVERTED (REJECTED retained for legacy compatibility)
ALTER TYPE "QuoteStatus" ADD VALUE IF NOT EXISTS 'DECLINED';
ALTER TYPE "QuoteStatus" ADD VALUE IF NOT EXISTS 'CONVERTED';

-- Transactional email
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE IF NOT EXISTS 'QUOTE_SENT';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE IF NOT EXISTS 'QUOTE_DECLINED_INTERNAL';

-- Quote number sequence (QT-000001)
CREATE TABLE IF NOT EXISTS "QuoteNumberSequence" (
    "id" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "QuoteNumberSequence_pkey" PRIMARY KEY ("id")
);
INSERT INTO "QuoteNumberSequence" ("id", "nextValue") VALUES ('default', 1)
ON CONFLICT ("id") DO NOTHING;

-- Expand Quote
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "deliveryTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "customerNotes" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "internalNotes" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "poNumber" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "contactSnapshot" JSONB;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "deliveryAddressId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "deliveryAddress" JSONB;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "salesRepIdSnapshot" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "salesRepCodeSnapshot" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "salesRepNameSnapshot" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "paymentTermsSnapshot" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "sentById" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "firstViewedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "acceptedByUserId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "acceptedByStaffId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "acceptanceNote" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "declinedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "declineReason" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "convertedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "convertedOrderId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "deliveryOverridden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "deliveryOverrideById" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "revisionOfQuoteId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "acceptIdempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Quote_convertedOrderId_key" ON "Quote"("convertedOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "Quote_acceptIdempotencyKey_key" ON "Quote"("acceptIdempotencyKey");
CREATE INDEX IF NOT EXISTS "Quote_status_expiresAt_idx" ON "Quote"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "Quote_createdById_idx" ON "Quote"("createdById");

-- Expand QuoteItem
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "normalUnitPrice" DECIMAL(12,4);
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "customerUnitPrice" DECIMAL(12,2);
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "normalCustomerUnitPrice" DECIMAL(12,2);
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "priceOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "priceOverrideById" TEXT;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "vatCode" TEXT;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "lineVat" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "lineGross" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "caseQty" INTEGER;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "orderingMode" TEXT;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "priceSource" TEXT;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "quantityBreakId" TEXT;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "promotionId" TEXT;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill customerUnitPrice from unitPrice for any existing rows
UPDATE "QuoteItem"
SET "customerUnitPrice" = ROUND("unitPrice", 2),
    "normalUnitPrice" = COALESCE("normalUnitPrice", "unitPrice"),
    "normalCustomerUnitPrice" = COALESCE("normalCustomerUnitPrice", ROUND("unitPrice", 2)),
    "lineGross" = COALESCE(NULLIF("lineGross", 0), "lineTotal")
WHERE "customerUnitPrice" IS NULL;

ALTER TABLE "QuoteItem" ALTER COLUMN "customerUnitPrice" SET NOT NULL;
ALTER TABLE "QuoteItem" ALTER COLUMN "normalUnitPrice" SET NOT NULL;
ALTER TABLE "QuoteItem" ALTER COLUMN "normalCustomerUnitPrice" SET NOT NULL;

-- Order ↔ Quote linkage
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "sourceQuoteId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "sourceQuoteNumber" TEXT;
CREATE INDEX IF NOT EXISTS "Order_sourceQuoteId_idx" ON "Order"("sourceQuoteId");
