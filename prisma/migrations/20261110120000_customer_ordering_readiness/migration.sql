-- READY_FOR_SALES stamps (assessment, not a second Company.status).
-- No backfill: existing ACTIVE customers stay orderable via compatibility policy.

ALTER TABLE "Company"
ADD COLUMN IF NOT EXISTS "orderingEnabledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "orderingEnabledById" TEXT,
ADD COLUMN IF NOT EXISTS "creditLimitReviewedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "creditLimitReviewedById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Company_orderingEnabledById_fkey'
  ) THEN
    ALTER TABLE "Company"
      ADD CONSTRAINT "Company_orderingEnabledById_fkey"
      FOREIGN KEY ("orderingEnabledById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Company_creditLimitReviewedById_fkey'
  ) THEN
    ALTER TABLE "Company"
      ADD CONSTRAINT "Company_creditLimitReviewedById_fkey"
      FOREIGN KEY ("creditLimitReviewedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
