-- Trade credit control on Order (separate from fulfilment status).

CREATE TYPE "OrderCreditStatus" AS ENUM ('NOT_REQUIRED', 'APPROVED', 'HOLD', 'REVIEW_REQUIRED');

ALTER TABLE "Order"
  ADD COLUMN "creditStatus" "OrderCreditStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "creditDecisionReason" TEXT,
  ADD COLUMN "creditLimitAtOrder" DECIMAL(12,2),
  ADD COLUMN "autopartExposureAtOrder" DECIMAL(12,2),
  ADD COLUMN "importedAvailableCreditAtOrder" DECIMAL(12,2),
  ADD COLUMN "pendingAbExposureAtOrder" DECIMAL(12,2),
  ADD COLUMN "effectiveAvailableCreditAtOrder" DECIMAL(12,2),
  ADD COLUMN "orderCreditRequirement" DECIMAL(12,2),
  ADD COLUMN "creditOverBy" DECIMAL(12,2),
  ADD COLUMN "creditCheckedAt" TIMESTAMP(3),
  ADD COLUMN "creditSourceImportedAt" TIMESTAMP(3),
  ADD COLUMN "creditApprovedByUserId" TEXT,
  ADD COLUMN "creditApprovedAt" TIMESTAMP(3),
  ADD COLUMN "creditApprovalNote" TEXT,
  ADD COLUMN "previousCreditStatus" "OrderCreditStatus";

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_creditApprovedByUserId_fkey"
  FOREIGN KEY ("creditApprovedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_creditStatus_idx" ON "Order"("creditStatus");
CREATE INDEX "Order_companyId_creditStatus_placedAt_idx" ON "Order"("companyId", "creditStatus", "placedAt");
