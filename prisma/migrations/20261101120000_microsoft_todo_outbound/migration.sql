-- Additive outbound Microsoft To Do fields.
-- Does not update, delete, or rewrite CRM tasks, orders, stock, or existing connections.

ALTER TYPE "MicrosoftSyncJobStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW';

ALTER TABLE "MicrosoftAccountConnection" ADD COLUMN "todoListId" TEXT;
ALTER TABLE "MicrosoftAccountConnection" ADD COLUMN "taskOutboundEnabledAt" TIMESTAMP(3);

ALTER TABLE "MicrosoftSyncJob" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "MicrosoftSyncJob_dedupeKey_key" ON "MicrosoftSyncJob"("dedupeKey");
