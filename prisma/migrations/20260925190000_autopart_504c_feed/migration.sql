-- Autopart 504C invoice/despatch feed (automatic polling defaults OFF).

CREATE TYPE "AutopartDocumentKind" AS ENUM ('INVOICE', 'CREDIT', 'UNKNOWN');
CREATE TYPE "Autopart504cImportStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED', 'DRY_RUN');

ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'ORDER_DESPATCHED';

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "autopartDocumentKind" "AutopartDocumentKind";
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "autopartAccountCode" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "autopartCustomerOrderNumber" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "autopartDocumentAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "autopartInitials" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "autopartImportRunId" TEXT;

CREATE INDEX IF NOT EXISTS "Invoice_orderId_idx" ON "Invoice"("orderId");
CREATE INDEX IF NOT EXISTS "Invoice_autopartCustomerOrderNumber_idx" ON "Invoice"("autopartCustomerOrderNumber");
CREATE INDEX IF NOT EXISTS "Invoice_autopartImportRunId_idx" ON "Invoice"("autopartImportRunId");

CREATE TABLE "Autopart504cFeedSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configured" BOOLEAN NOT NULL DEFAULT false,
    "scheduleHoursJson" TEXT NOT NULL DEFAULT '[13,16]',
    "workingDaysOnly" BOOLEAN NOT NULL DEFAULT true,
    "allowedSender" TEXT,
    "subjectContains" TEXT DEFAULT '504C',
    "filenamePattern" TEXT NOT NULL DEFAULT '*504C*',
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "imapUser" TEXT,
    "imapPasswordEnc" TEXT,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "imapMailbox" TEXT DEFAULT 'INBOX',
    "lastPolledAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,
    CONSTRAINT "Autopart504cFeedSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Autopart504cFeedSettings" ("id", "enabled", "configured", "updatedAt")
VALUES ('default', false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "Autopart504cImportRun" (
    "id" TEXT NOT NULL,
    "status" "Autopart504cImportStatus" NOT NULL,
    "isDryRun" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "filename" TEXT,
    "messageId" TEXT,
    "fileHash" TEXT,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "abReferencesFound" INTEGER NOT NULL DEFAULT 0,
    "ordersMatched" INTEGER NOT NULL DEFAULT 0,
    "newInvoices" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "unmatchedAbRefs" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "nonAbRows" INTEGER NOT NULL DEFAULT 0,
    "ordersDespatched" INTEGER NOT NULL DEFAULT 0,
    "emailsQueued" INTEGER NOT NULL DEFAULT 0,
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "emailsFailed" INTEGER NOT NULL DEFAULT 0,
    "diagnostics" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Autopart504cImportRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Autopart504cImportRun_startedAt_idx" ON "Autopart504cImportRun"("startedAt");
CREATE INDEX "Autopart504cImportRun_status_idx" ON "Autopart504cImportRun"("status");
CREATE INDEX "Autopart504cImportRun_fileHash_idx" ON "Autopart504cImportRun"("fileHash");

ALTER TABLE "Autopart504cImportRun" ADD CONSTRAINT "Autopart504cImportRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_autopartImportRunId_fkey" FOREIGN KEY ("autopartImportRunId") REFERENCES "Autopart504cImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
