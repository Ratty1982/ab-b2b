-- Additive Outlook Calendar / CRM appointment support.
-- Does not rewrite CRM tasks, orders, stock, or prices.
-- Does not enable calendar sync. Does not create Outlook events.
-- Ordinary CRM tasks never become calendar events.

CREATE TYPE "AppointmentType" AS ENUM ('MEETING', 'CALL', 'CUSTOMER_VISIT', 'FOLLOW_UP', 'OTHER');
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "CrmAppointment" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" "AppointmentType" NOT NULL DEFAULT 'MEETING',
  "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "timeZone" TEXT NOT NULL DEFAULT 'Europe/London',
  "location" TEXT,
  "ownerId" TEXT NOT NULL,
  "companyId" TEXT,
  "contactId" TEXT,
  "opportunityId" TEXT,
  "relatedTaskId" TEXT,
  "reminderMinutes" INTEGER,
  "attendees" JSONB,
  "syncToOutlook" BOOLEAN NOT NULL DEFAULT false,
  "teamsMeetingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CrmAppointment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmAppointment_ownerId_startAt_idx" ON "CrmAppointment"("ownerId", "startAt");
CREATE INDEX "CrmAppointment_companyId_startAt_idx" ON "CrmAppointment"("companyId", "startAt");
CREATE INDEX "CrmAppointment_status_startAt_idx" ON "CrmAppointment"("status", "startAt");
CREATE INDEX "CrmAppointment_type_startAt_idx" ON "CrmAppointment"("type", "startAt");
CREATE INDEX "CrmAppointment_opportunityId_idx" ON "CrmAppointment"("opportunityId");
CREATE INDEX "CrmAppointment_relatedTaskId_idx" ON "CrmAppointment"("relatedTaskId");
CREATE INDEX "CrmAppointment_syncToOutlook_status_idx" ON "CrmAppointment"("syncToOutlook", "status");

ALTER TABLE "CrmAppointment"
  ADD CONSTRAINT "CrmAppointment_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmAppointment"
  ADD CONSTRAINT "CrmAppointment_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmAppointment"
  ADD CONSTRAINT "CrmAppointment_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmAppointment"
  ADD CONSTRAINT "CrmAppointment_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmAppointment"
  ADD CONSTRAINT "CrmAppointment_relatedTaskId_fkey"
  FOREIGN KEY ("relatedTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MicrosoftAccountConnection"
  ADD COLUMN IF NOT EXISTS "calendarOutboundEnabledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "calendarInboundEnabledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastCalendarInboundSyncAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "calendarInboundBaselineAt" TIMESTAMP(3);

-- Retarget calendar mapping from optional Task to optional CrmAppointment.
ALTER TABLE "MicrosoftCalendarMapping" DROP CONSTRAINT IF EXISTS "MicrosoftCalendarMapping_taskId_fkey";
DROP INDEX IF EXISTS "MicrosoftCalendarMapping_userId_taskId_key";
ALTER TABLE "MicrosoftCalendarMapping" DROP COLUMN IF EXISTS "taskId";

ALTER TABLE "MicrosoftCalendarMapping"
  ADD COLUMN IF NOT EXISTS "appointmentId" TEXT,
  ADD COLUMN IF NOT EXISTS "immutableEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "iCalUId" TEXT,
  ADD COLUMN IF NOT EXISTS "changeKey" TEXT,
  ADD COLUMN IF NOT EXISTS "remoteEtag" TEXT,
  ADD COLUMN IF NOT EXISTS "lastCrmRevision" TEXT,
  ADD COLUMN IF NOT EXISTS "syncedSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "transactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "outlookWebLink" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "MicrosoftCalendarMapping_userId_appointmentId_key"
  ON "MicrosoftCalendarMapping"("userId", "appointmentId");
CREATE INDEX IF NOT EXISTS "MicrosoftCalendarMapping_appointmentId_idx"
  ON "MicrosoftCalendarMapping"("appointmentId");

ALTER TABLE "MicrosoftCalendarMapping"
  ADD CONSTRAINT "MicrosoftCalendarMapping_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "CrmAppointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
