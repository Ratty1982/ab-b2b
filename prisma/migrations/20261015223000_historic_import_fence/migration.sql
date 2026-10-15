-- One global lock row for historical ALL imports.
-- Claims take SELECT ... FOR UPDATE on this row and increase fence.
-- A worker whose fence no longer matches cannot write or finish the replacement job.
-- VERIFYING is the recoverable account-verification state. It is not used in this migration.

CREATE TABLE "AutopartHistoryImportLock" (
    "id" INTEGER NOT NULL,
    "fence" BIGINT NOT NULL DEFAULT 0,
    "owner" TEXT,
    "importId" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    CONSTRAINT "AutopartHistoryImportLock_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AutopartHistoryImportLock" ("id", "fence") VALUES (1, 0);

ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "lockFence" BIGINT;

ALTER TYPE "AutopartHistoryReviewStatus" ADD VALUE 'VERIFYING';
