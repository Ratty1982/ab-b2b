-- Additive CRM fields for production live testing (Leads / Opportunities / Activities / Tasks / Quotes).

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "nextActionAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "nextActionNote" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lostReason" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "convertedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Lead_ownerId_status_idx" ON "Lead"("ownerId", "status");
CREATE INDEX IF NOT EXISTS "Lead_companyId_idx" ON "Lead"("companyId");
CREATE INDEX IF NOT EXISTS "Lead_createdAt_idx" ON "Lead"("createdAt");

ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "wonAt" TIMESTAMP(3);
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "lostAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Opportunity_ownerId_stage_idx" ON "Opportunity"("ownerId", "stage");
CREATE INDEX IF NOT EXISTS "Opportunity_expectedClose_idx" ON "Opportunity"("expectedClose");
CREATE INDEX IF NOT EXISTS "Opportunity_updatedAt_idx" ON "Opportunity"("updatedAt");

ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "leadId" TEXT;
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "opportunityId" TEXT;

CREATE INDEX IF NOT EXISTS "Activity_leadId_occurredAt_idx" ON "Activity"("leadId", "occurredAt");
CREATE INDEX IF NOT EXISTS "Activity_opportunityId_occurredAt_idx" ON "Activity"("opportunityId", "occurredAt");
CREATE INDEX IF NOT EXISTS "Activity_type_occurredAt_idx" ON "Activity"("type", "occurredAt");

DO $$ BEGIN
  ALTER TABLE "Activity" ADD CONSTRAINT "Activity_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Activity" ADD CONSTRAINT "Activity_opportunityId_fkey"
    FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "opportunityId" TEXT;
CREATE INDEX IF NOT EXISTS "Quote_opportunityId_idx" ON "Quote"("opportunityId");

DO $$ BEGIN
  ALTER TABLE "Quote" ADD CONSTRAINT "Quote_opportunityId_fkey"
    FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "taskType" TEXT;
CREATE INDEX IF NOT EXISTS "Task_dueAt_status_idx" ON "Task"("dueAt", "status");
CREATE INDEX IF NOT EXISTS "Task_taskType_status_idx" ON "Task"("taskType", "status");
