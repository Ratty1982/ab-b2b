-- Additive inbound Microsoft To Do sync support.
-- Does not rewrite CRM tasks, orders, stock, or prices.

ALTER TYPE "MicrosoftSyncStatus" ADD VALUE IF NOT EXISTS 'REMOVED';

ALTER TABLE "MicrosoftAccountConnection"
  ADD COLUMN IF NOT EXISTS "taskInboundEnabledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastInboundSyncAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inboundBaselineAt" TIMESTAMP(3);

ALTER TABLE "MicrosoftTaskMapping"
  ADD COLUMN IF NOT EXISTS "lastCrmRevision" TEXT,
  ADD COLUMN IF NOT EXISTS "syncedSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "priorCrmStatus" TEXT;
