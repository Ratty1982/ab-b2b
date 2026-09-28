-- Customer-facing SalesRep contact profile (separate from User auth).

ALTER TABLE "SalesRep" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
ALTER TABLE "SalesRep" ADD COLUMN IF NOT EXISTS "jobTitle" TEXT;
ALTER TABLE "SalesRep" ADD COLUMN IF NOT EXISTS "businessEmail" TEXT;
ALTER TABLE "SalesRep" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "SalesRep" ADD COLUMN IF NOT EXISTS "mobile" TEXT;
ALTER TABLE "SalesRep" ADD COLUMN IF NOT EXISTS "customerContactEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SalesRep" ADD COLUMN IF NOT EXISTS "photoMediaId" TEXT;
ALTER TABLE "SalesRep" ADD COLUMN IF NOT EXISTS "photoAlt" TEXT;
ALTER TABLE "SalesRep" ADD COLUMN IF NOT EXISTS "photoFocalX" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "SalesRep" ADD COLUMN IF NOT EXISTS "photoFocalY" INTEGER NOT NULL DEFAULT 50;

CREATE INDEX IF NOT EXISTS "SalesRep_photoMediaId_idx" ON "SalesRep"("photoMediaId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SalesRep_photoMediaId_fkey'
  ) THEN
    ALTER TABLE "SalesRep"
      ADD CONSTRAINT "SalesRep_photoMediaId_fkey"
      FOREIGN KEY ("photoMediaId") REFERENCES "CmsMedia"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
