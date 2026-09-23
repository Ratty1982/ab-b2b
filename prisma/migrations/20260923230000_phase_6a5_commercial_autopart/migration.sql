-- Phase 6A.5: verified Autopart customer account on Company + claimed code on TradeApplication.

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "autopartCustomerCode" TEXT,
  ADD COLUMN IF NOT EXISTS "autopartCustomerCodeVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "autopartCustomerCodeVerifiedById" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Company_autopartCustomerCode_key"
  ON "Company"("autopartCustomerCode");

CREATE INDEX IF NOT EXISTS "Company_autopartCustomerCode_idx"
  ON "Company"("autopartCustomerCode");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Company_autopartCustomerCodeVerifiedById_fkey'
  ) THEN
    ALTER TABLE "Company"
      ADD CONSTRAINT "Company_autopartCustomerCodeVerifiedById_fkey"
      FOREIGN KEY ("autopartCustomerCodeVerifiedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "TradeApplication"
  ADD COLUMN IF NOT EXISTS "claimedAutopartCustomerCode" TEXT;
