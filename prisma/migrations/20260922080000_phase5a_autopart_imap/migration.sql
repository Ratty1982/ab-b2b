-- Phase 5A: IMAP mailbox acquisition metadata. Additive. Does not reset Inventory.

CREATE TABLE "AutopartImapSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "inboundEmailAddress" TEXT NOT NULL DEFAULT '',
    "imapHost" TEXT,
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "imapUsername" TEXT,
    "imapPasswordEncrypted" TEXT,
    "mailbox" TEXT NOT NULL DEFAULT 'INBOX',
    "allowedSenderEmails" TEXT NOT NULL DEFAULT '',
    "attachmentFilenamePattern" TEXT NOT NULL DEFAULT '231PO3NEW*.txt',
    "pollIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "lookbackDays" INTEGER NOT NULL DEFAULT 14,
    "maxMessages" INTEGER NOT NULL DEFAULT 100,
    "autoArchiveProcessedEmails" BOOLEAN NOT NULL DEFAULT false,
    "lastPollAt" TIMESTAMP(3),
    "lastPollError" TEXT,
    "lastEmailFrom" TEXT,
    "lastEmailSubject" TEXT,
    "lastEmailUid" TEXT,
    "lastAttachmentFilename" TEXT,
    "lastEmailReceivedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartImapSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AutopartImapSettings" ("id", "updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP);

CREATE TABLE "StockEmailReceipt" (
    "id" TEXT NOT NULL,
    "receiptKey" TEXT NOT NULL,
    "emailUid" TEXT NOT NULL,
    "emailMessageId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "attachmentFilename" TEXT,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockEmailReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockEmailReceipt_receiptKey_key" ON "StockEmailReceipt"("receiptKey");
CREATE INDEX "StockEmailReceipt_emailUid_idx" ON "StockEmailReceipt"("emailUid");
CREATE INDEX "StockEmailReceipt_emailMessageId_idx" ON "StockEmailReceipt"("emailMessageId");
CREATE INDEX "StockEmailReceipt_consumed_idx" ON "StockEmailReceipt"("consumed");
