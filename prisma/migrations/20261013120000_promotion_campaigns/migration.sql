-- Sales promotion workflow and order-time savings baseline.
-- Existing Promotion rows become LEGACY and keep appliesToNegotiatedPrices = true.
-- promotionBaselineUnitPrice is nullable and is not backfilled.

CREATE TYPE "PromotionCampaignStatus" AS ENUM ('LEGACY', 'DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'CANCELLED');

ALTER TABLE "Promotion" ADD COLUMN "campaignStatus" "PromotionCampaignStatus" NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "Promotion" ADD COLUMN "description" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "appliesToNegotiatedPrices" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Promotion" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "Promotion" ADD COLUMN "submittedByUserId" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Promotion" ADD COLUMN "reviewedByUserId" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "reviewReason" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Promotion" ADD COLUMN "cancelledByUserId" TEXT;

CREATE INDEX "Promotion_campaignStatus_idx" ON "Promotion"("campaignStatus");
CREATE INDEX "Promotion_createdByUserId_idx" ON "Promotion"("createdByUserId");

ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderItem" ADD COLUMN "promotionBaselineUnitPrice" DECIMAL(12,4);
CREATE INDEX "OrderItem_promotionId_idx" ON "OrderItem"("promotionId");

ALTER TABLE "QuoteItem" ADD COLUMN "promotionBaselineUnitPrice" DECIMAL(12,4);
