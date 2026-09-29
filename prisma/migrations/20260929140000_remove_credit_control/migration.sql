-- Remove Automotive Brands customer credit control (407P100 / exposure / holds).
-- Historic Autopart CREDIT documents (561L/SLRB) are unchanged.
-- Payment terms and Autopart customer linking are unchanged.

-- 1) Drop 407P100 credit position snapshots
DROP TABLE IF EXISTS "AutopartCreditPosition";

-- 2) Delete obsolete 407P100 import runs (history runs kept)
DELETE FROM "AutopartCustomerImportRun"
WHERE "type"::text IN ('CREDIT_407P100', 'CREDIT_407P100_BULK');

-- 3) Rebuild AutopartCustomerImportType without 407P100 values
CREATE TYPE "AutopartCustomerImportType_new" AS ENUM ('HISTORY_561L_SLRB');

ALTER TABLE "AutopartCustomerImportRun"
  ALTER COLUMN "type" TYPE "AutopartCustomerImportType_new"
  USING (
    CASE
      WHEN "type"::text = 'HISTORY_561L_SLRB' THEN 'HISTORY_561L_SLRB'::"AutopartCustomerImportType_new"
      ELSE 'HISTORY_561L_SLRB'::"AutopartCustomerImportType_new"
    END
  );

DROP TYPE "AutopartCustomerImportType";
ALTER TYPE "AutopartCustomerImportType_new" RENAME TO "AutopartCustomerImportType";

-- 4) Remove Order credit-control columns + indexes
DROP INDEX IF EXISTS "Order_creditStatus_idx";
DROP INDEX IF EXISTS "Order_companyId_creditStatus_placedAt_idx";

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_creditApprovedByUserId_fkey";

ALTER TABLE "Order"
  DROP COLUMN IF EXISTS "creditStatus",
  DROP COLUMN IF EXISTS "creditDecisionReason",
  DROP COLUMN IF EXISTS "creditLimitAtOrder",
  DROP COLUMN IF EXISTS "autopartExposureAtOrder",
  DROP COLUMN IF EXISTS "importedAvailableCreditAtOrder",
  DROP COLUMN IF EXISTS "pendingAbExposureAtOrder",
  DROP COLUMN IF EXISTS "effectiveAvailableCreditAtOrder",
  DROP COLUMN IF EXISTS "orderCreditRequirement",
  DROP COLUMN IF EXISTS "creditOverBy",
  DROP COLUMN IF EXISTS "creditCheckedAt",
  DROP COLUMN IF EXISTS "creditSourceImportedAt",
  DROP COLUMN IF EXISTS "creditApprovedByUserId",
  DROP COLUMN IF EXISTS "creditApprovedAt",
  DROP COLUMN IF EXISTS "creditApprovalNote",
  DROP COLUMN IF EXISTS "previousCreditStatus";

DROP TYPE IF EXISTS "OrderCreditStatus";

-- 5) Remove Company manual credit limit
ALTER TABLE "Company" DROP COLUMN IF EXISTS "creditLimit";
