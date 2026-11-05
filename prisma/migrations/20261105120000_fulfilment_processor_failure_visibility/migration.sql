-- Persist visible post-import fulfilment processor failures without replaying financial imports.
ALTER TABLE "AutopartOngoingSalesFeedSettings"
  ADD COLUMN IF NOT EXISTS "fulfilmentLastError" TEXT,
  ADD COLUMN IF NOT EXISTS "fulfilmentLastErrorAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "fulfilmentLastErrorImportRunId" TEXT,
  ADD COLUMN IF NOT EXISTS "fulfilmentLastErrorFeed" TEXT;

ALTER TABLE "AutopartCustomerImportRun"
  ADD COLUMN IF NOT EXISTS "fulfilmentProcessorStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "fulfilmentProcessorError" TEXT,
  ADD COLUMN IF NOT EXISTS "fulfilmentProcessorAt" TIMESTAMP(3);
